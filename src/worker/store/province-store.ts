// Logica di una provincia (SDD §5.3, §7, §8.1, ADR-0011). Nessuna API Cloudflare qui dentro:
// riceve un'interfaccia SQL minima, così si testa in Node con node:sqlite (stesso motore dei DO).

import { DEFAULT_PARAMS, type StateParams } from "../../domain/config.ts";
import type { ContestInput } from "../../domain/input.ts";
import { FUEL_BIT } from "../../domain/mimit.ts";
import { aggregateQueue } from "../../domain/queue.ts";
import { buildSnapshot, type SnapshotEntry } from "../../domain/snapshot.ts";
import { computeState } from "../../domain/state.ts";
import {
  Flag,
  type Fuel,
  type Queue,
  type Report,
  State,
  type StateResult,
} from "../../domain/types.ts";

export type SqlValue = ArrayBuffer | string | number | null;
export interface SqlLike {
  exec<T extends Record<string, SqlValue>>(
    query: string,
    ...bindings: SqlValue[]
  ): { toArray(): T[] };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Regole anti-abuso (SDD §8.1). */
export const ABUSE = {
  sameStationWindowMs: 45 * MIN,
  sameStationMax: 3,
  hourlyMax: 20,
  maxTimeoutMs: DAY,
} as const;

const RETENTION = {
  transitionsMs: 30 * DAY,
  contactMs: 30 * DAY,
  contestsMs: 180 * DAY,
  statsMs: 90 * DAY,
} as const;

const SNAPSHOT_TTL_MS = 30_000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reports (station INTEGER NOT NULL, fuel TEXT NOT NULL,
     has INTEGER NOT NULL, near INTEGER NOT NULL, queue INTEGER, lim INTEGER,
     ts INTEGER NOT NULL, rkey TEXT NOT NULL, pkey TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS reports_sft ON reports (station, fuel, ts)",
  "CREATE INDEX IF NOT EXISTS reports_rkey ON reports (rkey, ts)",
  `CREATE TABLE IF NOT EXISTS abuse (rkey TEXT PRIMARY KEY, level INTEGER NOT NULL,
     until INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  "CREATE TABLE IF NOT EXISTS pow_used (sig TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS current (station INTEGER NOT NULL, fuel TEXT NOT NULL,
     state INTEGER NOT NULL, flags INTEGER NOT NULL, PRIMARY KEY (station, fuel))`,
  // ADR-0011 D: registro anonimo. NESSUNA rkey/pkey (un test lo verifica).
  `CREATE TABLE IF NOT EXISTS transitions (station INTEGER NOT NULL, fuel TEXT NOT NULL,
     ts INTEGER NOT NULL, from_state INTEGER, to_state INTEGER NOT NULL, flags INTEGER NOT NULL,
     confirmations INTEGER NOT NULL, absences INTEGER NOT NULL, cause TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS transitions_ts ON transitions (ts)",
  "CREATE TABLE IF NOT EXISTS frozen (station INTEGER PRIMARY KEY, until INTEGER NOT NULL, note TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS contests (id INTEGER PRIMARY KEY, station INTEGER NOT NULL,
     fuel TEXT, reason TEXT NOT NULL, contact TEXT, ts INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'new')`,
  `CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL,
     kind TEXT NOT NULL, station INTEGER, fuel TEXT, detail TEXT, sent INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS stats_hourly (hour INTEGER NOT NULL, fuel TEXT NOT NULL,
     pos INTEGER NOT NULL DEFAULT 0, neg INTEGER NOT NULL DEFAULT 0,
     dropped INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hour, fuel))`,
  "CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
];

/** Segnalazione già validata, con PoW verificato e chiavi anonime calcolate dal Worker. */
export interface StoreReport {
  readonly id: number;
  readonly fuel: Fuel;
  readonly has: boolean;
  readonly near: boolean;
  readonly queue: Queue | undefined;
  readonly limit: boolean | undefined;
  readonly rkey: string;
  readonly pkey: string;
  readonly powSig: string;
  readonly powExpiresMs: number;
}

/** "dropped" si risponde come "accepted": l'abuso non riceve segnali per tarare l'attacco. */
export type ReportStatus = "accepted" | "dropped" | "invalid_station" | "read_only";

export interface SnapshotBody {
  readonly body: string;
  readonly etag: string;
}

type Cause = "report" | "hold" | "ttl" | "window" | "fresh" | "time" | "freeze";

interface ReportRow extends Record<string, SqlValue> {
  has: number;
  near: number;
  queue: number | null;
  lim: number | null;
  ts: number;
  rkey: string;
  pkey: string;
}

/** FNV-1a 32 bit: ETag stabile e sincrono. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class ProvinceStore {
  private readonly sql: SqlLike;
  private readonly params: StateParams;
  private stations = new Map<number, number>();
  private cache: (SnapshotBody & { at: number }) | undefined;

  constructor(sql: SqlLike, params: StateParams = DEFAULT_PARAMS) {
    this.sql = sql;
    this.params = params;
  }

  migrate(): void {
    for (const stmt of SCHEMA) this.sql.exec(stmt);
  }

  /** Anagrafica: id impianto → bitmask dei carburanti venduti. */
  setStations(stations: ReadonlyMap<number, number>): void {
    this.stations = new Map(stations);
  }

  knowsStation(id: number): boolean {
    return this.stations.has(id);
  }

  // ---------------------------------------------------------------- configurazione

  isReadOnly(): boolean {
    return this.first<{ v: string }>("SELECT v FROM config WHERE k = 'read_only'")?.v === "1";
  }

  setReadOnly(on: boolean): void {
    this.sql.exec(
      "INSERT INTO config (k, v) VALUES ('read_only', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      on ? "1" : "0",
    );
    this.cache = undefined;
  }

  // ---------------------------------------------------------------- segnalazioni

  report(r: StoreReport, now: number): ReportStatus {
    if (this.isReadOnly()) return "read_only";
    const mask = this.stations.get(r.id);
    if (mask === undefined || (mask & FUEL_BIT[r.fuel]) === 0) return "invalid_station";

    // Anti-replay: ogni soluzione PoW vale una sola volta.
    if (this.first("SELECT 1 AS x FROM pow_used WHERE sig = ?", r.powSig))
      return this.drop(r.fuel, now);
    this.sql.exec("INSERT INTO pow_used (sig, expires) VALUES (?, ?)", r.powSig, r.powExpiresMs);

    // Timeout progressivo in corso.
    const abuse = this.first<{ level: number; until: number }>(
      "SELECT level, until FROM abuse WHERE rkey = ?",
      r.rkey,
    );
    if (abuse && abuse.until > now) return this.drop(r.fuel, now);

    // Regole di frequenza (SDD §8.1).
    const sameStation = this.count(
      "SELECT COUNT(*) AS n FROM reports WHERE rkey = ? AND station = ? AND ts > ?",
      r.rkey,
      r.id,
      now - ABUSE.sameStationWindowMs,
    );
    const lastHour = this.count(
      "SELECT COUNT(*) AS n FROM reports WHERE rkey = ? AND ts > ?",
      r.rkey,
      now - HOUR,
    );
    if (sameStation >= ABUSE.sameStationMax || lastHour >= ABUSE.hourlyMax) {
      this.escalate(r.rkey, abuse?.level ?? 0, now);
      return this.drop(r.fuel, now);
    }

    this.sql.exec(
      "INSERT INTO reports (station, fuel, has, near, queue, lim, ts, rkey, pkey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r.id,
      r.fuel,
      r.has ? 1 : 0,
      r.near ? 1 : 0,
      r.has ? (r.queue ?? null) : null,
      r.has && r.limit !== undefined ? (r.limit ? 1 : 0) : null,
      now,
      r.rkey,
      r.pkey,
    );
    this.stat(r.fuel, now, r.has ? "pos" : "neg");
    this.updateState(r.id, r.fuel, now, "report");
    this.cache = undefined;
    return "accepted";
  }

  stateOf(id: number, fuel: Fuel, now: number): StateResult {
    return computeState(this.reportsFor(id, fuel, now), now, this.params);
  }

  // ---------------------------------------------------------------- snapshot

  snapshot(prov: string, now: number): SnapshotBody {
    if (this.cache && now - this.cache.at < SNAPSHOT_TTL_MS) return this.cache;
    const pairs = this.sql
      .exec<{ station: number; fuel: string }>(
        "SELECT DISTINCT station, fuel FROM reports WHERE ts > ?",
        now - this.params.windowMs,
      )
      .toArray();
    const frozen = this.frozenNotes(now);
    const entries: SnapshotEntry[] = pairs.map(({ station, fuel }) => {
      const reports = this.reportsFor(station, fuel as Fuel, now);
      let result = computeState(reports, now, this.params);
      const isFrozen = frozen.has(station);
      // Congelamento (procedura contestazioni): mai verde, sempre ambra con la nota del gestore.
      if (isFrozen) result = { ...result, state: State.AMBER };
      return {
        id: station,
        fuel: fuel as Fuel,
        result,
        queue: aggregateQueue(reports, now),
        frozen: isFrozen,
      };
    });
    const snap = buildSnapshot(prov, now, entries, this.isReadOnly());
    const body = JSON.stringify({ ...snap, fz: [...frozen] });
    this.cache = { body, etag: `"${fnv1a(body)}"`, at: now };
    return this.cache;
  }

  // ---------------------------------------------------------------- manutenzione (alarm)

  /** Pulizia e ricalcolo degli stati che cambiano col tempo. Restituisce true se ci sono segnalazioni attive. */
  maintenance(now: number): boolean {
    const p = this.params;
    this.sql.exec("DELETE FROM reports WHERE ts <= ?", now - p.windowMs);
    this.sql.exec("DELETE FROM pow_used WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM abuse WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM frozen WHERE until <= ?", now);
    this.sql.exec("DELETE FROM transitions WHERE ts <= ?", now - RETENTION.transitionsMs);
    this.sql.exec("UPDATE contests SET contact = NULL WHERE ts <= ?", now - RETENTION.contactMs);
    this.sql.exec("DELETE FROM contests WHERE ts <= ?", now - RETENTION.contestsMs);
    this.sql.exec(
      "DELETE FROM stats_hourly WHERE hour <= ?",
      Math.floor((now - RETENTION.statsMs) / HOUR),
    );

    const current = this.sql
      .exec<{ station: number; fuel: string }>("SELECT station, fuel FROM current")
      .toArray();
    for (const { station, fuel } of current) this.updateState(station, fuel as Fuel, now);
    this.sql.exec("DELETE FROM current WHERE state = ?", State.GREY);
    this.cache = undefined;
    return this.count("SELECT COUNT(*) AS n FROM reports") > 0;
  }

  // ---------------------------------------------------------------- contestazioni e congelamento

  contest(c: ContestInput, now: number): void {
    this.sql.exec(
      "INSERT INTO contests (station, fuel, reason, contact, ts) VALUES (?, ?, ?, ?, ?)",
      c.id,
      c.fuel ?? null,
      c.reason,
      c.contact ?? null,
      now,
    );
    this.alert("contest", c.id, c.fuel ?? null, c.reason, now);
  }

  /** Congela un impianto (tutti i carburanti) con una nota attribuita, per al massimo `durationMs`. */
  freeze(id: number, note: string, now: number, durationMs = 3 * HOUR): void {
    this.sql.exec(
      "INSERT INTO frozen (station, until, note) VALUES (?, ?, ?) ON CONFLICT(station) DO UPDATE SET until = excluded.until, note = excluded.note",
      id,
      now + durationMs,
      note,
    );
    const fuels = this.sql
      .exec<{ fuel: string; state: number }>(
        "SELECT fuel, state FROM current WHERE station = ?",
        id,
      )
      .toArray();
    for (const { fuel, state } of fuels) {
      const computed = this.stateOf(id, fuel as Fuel, now);
      const shown = { ...computed, state: State.AMBER, flags: computed.flags | Flag.FROZEN };
      this.logTransition(id, fuel as Fuel, now, { state }, shown, "freeze");
    }
    this.cache = undefined;
  }

  pendingAlerts(): Array<{
    id: number;
    kind: string;
    station: number | null;
    detail: string | null;
  }> {
    return this.sql
      .exec<{ id: number; kind: string; station: number | null; detail: string | null }>(
        "SELECT id, kind, station, detail FROM alerts WHERE sent = 0 ORDER BY id",
      )
      .toArray();
  }

  // ---------------------------------------------------------------- interni

  private reportsFor(id: number, fuel: Fuel, now: number): Report[] {
    return this.sql
      .exec<ReportRow>(
        "SELECT has, near, queue, lim, ts, rkey, pkey FROM reports WHERE station = ? AND fuel = ? AND ts > ?",
        id,
        fuel,
        now - this.params.windowMs,
      )
      .toArray()
      .map((row) => ({
        has: row.has === 1,
        near: row.near === 1,
        ts: row.ts,
        rkey: row.rkey,
        pkey: row.pkey,
        queue: (row.queue ?? undefined) as Queue | undefined,
        limit: row.lim === null ? undefined : row.lim === 1,
      }));
  }

  private updateState(id: number, fuel: Fuel, now: number, cause?: Cause): StateResult {
    const next = this.stateOf(id, fuel, now);
    const prev = this.first<{ state: number; flags: number }>(
      "SELECT state, flags FROM current WHERE station = ? AND fuel = ?",
      id,
      fuel,
    );
    if (prev && prev.state === next.state && prev.flags === next.flags) return next;
    this.sql.exec(
      "INSERT INTO current (station, fuel, state, flags) VALUES (?, ?, ?, ?) ON CONFLICT(station, fuel) DO UPDATE SET state = excluded.state, flags = excluded.flags",
      id,
      fuel,
      next.state,
      next.flags,
    );
    this.logTransition(id, fuel, now, prev ?? null, next, cause ?? causeOf(prev ?? null, next));
    // ADR-0011 C: un "rosso in verifica" avvisa subito i maintainer.
    if (next.flags & Flag.RED_PENDING && !((prev?.flags ?? 0) & Flag.RED_PENDING)) {
      this.alert("red_pending", id, fuel, `${next.absences} assenze in pochi minuti`, now);
    }
    return next;
  }

  private logTransition(
    id: number,
    fuel: Fuel,
    now: number,
    prev: { state: number } | null,
    next: StateResult,
    cause: Cause,
  ): void {
    this.sql.exec(
      "INSERT INTO transitions (station, fuel, ts, from_state, to_state, flags, confirmations, absences, cause) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      fuel,
      Math.floor(now / MIN) * MIN,
      prev?.state ?? null,
      next.state,
      next.flags,
      next.confirmations,
      next.absences,
      cause,
    );
  }

  private escalate(rkey: string, level: number, now: number): void {
    const next = level + 1;
    const until = now + Math.min(2 ** next * MIN, ABUSE.maxTimeoutMs);
    this.sql.exec(
      "INSERT INTO abuse (rkey, level, until, expires) VALUES (?, ?, ?, ?) ON CONFLICT(rkey) DO UPDATE SET level = excluded.level, until = excluded.until, expires = excluded.expires",
      rkey,
      next,
      until,
      now + DAY,
    );
  }

  private drop(fuel: Fuel, now: number): ReportStatus {
    this.stat(fuel, now, "dropped");
    return "dropped";
  }

  private stat(fuel: Fuel, now: number, col: "pos" | "neg" | "dropped"): void {
    this.sql.exec(
      `INSERT INTO stats_hourly (hour, fuel, ${col}) VALUES (?, ?, 1) ON CONFLICT(hour, fuel) DO UPDATE SET ${col} = ${col} + 1`,
      Math.floor(now / HOUR),
      fuel,
    );
  }

  private alert(
    kind: string,
    station: number,
    fuel: string | null,
    detail: string,
    now: number,
  ): void {
    this.sql.exec(
      "INSERT INTO alerts (ts, kind, station, fuel, detail) VALUES (?, ?, ?, ?, ?)",
      now,
      kind,
      station,
      fuel,
      detail,
    );
  }

  private frozenNotes(now: number): Map<number, string> {
    const rows = this.sql
      .exec<{ station: number; note: string }>(
        "SELECT station, note FROM frozen WHERE until > ?",
        now,
      )
      .toArray();
    return new Map(rows.map((r) => [r.station, r.note]));
  }

  private first<T extends Record<string, SqlValue>>(
    query: string,
    ...b: SqlValue[]
  ): T | undefined {
    return this.sql.exec<T>(query, ...b).toArray()[0];
  }

  private count(query: string, ...b: SqlValue[]): number {
    return this.first<{ n: number }>(query, ...b)?.n ?? 0;
  }
}

function causeOf(prev: { state: number; flags: number } | null, next: StateResult): Cause {
  if (next.state === State.GREY) return "window";
  if (prev && prev.flags & Flag.RED_PENDING && next.state === State.RED) return "hold";
  if (next.flags & Flag.RED_EXPIRED) return "ttl";
  if (prev?.state === State.GREEN) return "fresh";
  return "time";
}
