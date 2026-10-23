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
  /** Quanto resta il contatore di un codice dopo l'ultimo blocco. */
  keepMs: DAY,
} as const;

/** Tempi di conservazione: l'informativa li cita (lo verifica scripts/legal-pages.test.ts). */
export const RETENTION = {
  transitionsMs: 30 * DAY,
  contactMs: 30 * DAY,
  contestsMs: 180 * DAY,
  alertsMs: 180 * DAY,
  statsMs: 90 * DAY,
  /** Ultima disponibilità confermata, mostrata sul grigio ("ieri alle 22:10"). */
  lastGreenMs: DAY,
  /** Azioni dell'admin (congelamenti, sola lettura…): servono a rendere conto delle decisioni. */
  adminLogMs: 180 * DAY,
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
  // Anonima come transitions: solo impianto, carburante e minuto dell'ultima conferma da verde.
  `CREATE TABLE IF NOT EXISTS last_green (station INTEGER NOT NULL, fuel TEXT NOT NULL,
     ts INTEGER NOT NULL, PRIMARY KEY (station, fuel))`,
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
  // ADR-0013: registro delle azioni admin. Nessun dato degli utenti, solo cosa è stato deciso.
  `CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL,
     action TEXT NOT NULL, station INTEGER, detail TEXT)`,
];

export interface AdminOverview {
  readonly readOnly: boolean;
  readonly lastHour: number;
  readonly alerts: Array<{
    id: number;
    ts: number;
    kind: string;
    station: number | null;
    fuel: string | null;
    detail: string | null;
  }>;
  readonly contests: Array<{
    id: number;
    ts: number;
    station: number;
    fuel: string | null;
    reason: string;
    contact: string | null;
    status: string;
  }>;
  readonly frozen: Array<{ station: number; until: number; note: string }>;
  readonly stats: Array<{ hour: number; fuel: string; pos: number; neg: number; dropped: number }>;
  readonly log: Array<{
    ts: number;
    action: string;
    station: number | null;
    detail: string | null;
  }>;
}

export interface StationHistory {
  readonly transitions: Array<{
    ts: number;
    fuel: string;
    from_state: number | null;
    to_state: number;
    flags: number;
    confirmations: number;
    absences: number;
    cause: string;
  }>;
  readonly contests: AdminOverview["contests"];
  readonly frozen: { until: number; note: string } | null;
}

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

type Cause = "report" | "hold" | "ttl" | "window" | "fresh" | "time" | "freeze" | "unfreeze";

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
    const lastGreen = this.sql
      .exec<{ station: number; fuel: string; ts: number }>(
        "SELECT station, fuel, ts FROM last_green WHERE ts > ?",
        now - RETENTION.lastGreenMs,
      )
      .toArray()
      .map((r) => ({ id: r.station, fuel: r.fuel as Fuel, ts: r.ts }));
    const lastHour = this.count("SELECT COUNT(*) AS n FROM reports WHERE ts > ?", now - HOUR);
    const snap = buildSnapshot(prov, now, entries, this.isReadOnly(), { lastGreen, lastHour });
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
    this.sql.exec("DELETE FROM alerts WHERE ts <= ?", now - RETENTION.alertsMs);
    this.sql.exec("DELETE FROM last_green WHERE ts <= ?", now - RETENTION.lastGreenMs);
    this.sql.exec("DELETE FROM admin_log WHERE ts <= ?", now - RETENTION.adminLogMs);
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

  /**
   * Prossima scadenza di un dato conservato. Senza segnalazioni l'alarm non gira ogni minuto:
   * si risveglia qui, così i tempi promessi dall'informativa valgono anche se nessuno usa QUI.
   */
  nextExpiry(): number | null {
    const q = (query: string) => this.first<{ t: number | null }>(query)?.t ?? null;
    const times = [
      q(`SELECT MIN(ts) + ${RETENTION.lastGreenMs} AS t FROM last_green`),
      q(`SELECT MIN(ts) + ${RETENTION.transitionsMs} AS t FROM transitions`),
      q(`SELECT MIN(ts) + ${RETENTION.contactMs} AS t FROM contests WHERE contact IS NOT NULL`),
      q(`SELECT MIN(ts) + ${RETENTION.contestsMs} AS t FROM contests`),
      q(`SELECT MIN(ts) + ${RETENTION.alertsMs} AS t FROM alerts`),
      q(`SELECT MIN(ts) + ${RETENTION.adminLogMs} AS t FROM admin_log`),
      q(`SELECT MIN(hour) * ${HOUR} + ${RETENTION.statsMs} AS t FROM stats_hourly`),
      q("SELECT MIN(expires) AS t FROM abuse"),
      q("SELECT MIN(expires) AS t FROM pow_used"),
      q("SELECT MIN(until) AS t FROM frozen"),
    ].filter((t): t is number => t !== null);
    return times.length > 0 ? Math.min(...times) : null;
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

  // ---------------------------------------------------------------- area admin (ADR-0013)

  adminOverview(now: number): AdminOverview {
    return {
      readOnly: this.isReadOnly(),
      lastHour: this.count("SELECT COUNT(*) AS n FROM reports WHERE ts > ?", now - HOUR),
      alerts: this.sql
        .exec<AdminOverview["alerts"][number]>(
          "SELECT id, ts, kind, station, fuel, detail FROM alerts WHERE sent = 0 ORDER BY ts DESC LIMIT 200",
        )
        .toArray(),
      contests: this.sql
        .exec<AdminOverview["contests"][number]>(
          "SELECT id, ts, station, fuel, reason, contact, status FROM contests ORDER BY ts DESC LIMIT 200",
        )
        .toArray(),
      frozen: this.sql
        .exec<AdminOverview["frozen"][number]>(
          "SELECT station, until, note FROM frozen WHERE until > ? ORDER BY until",
          now,
        )
        .toArray(),
      stats: this.sql
        .exec<AdminOverview["stats"][number]>(
          "SELECT hour, fuel, pos, neg, dropped FROM stats_hourly WHERE hour >= ? ORDER BY hour",
          Math.floor((now - DAY) / HOUR),
        )
        .toArray(),
      log: this.sql
        .exec<AdminOverview["log"][number]>(
          "SELECT ts, action, station, detail FROM admin_log ORDER BY ts DESC, id DESC LIMIT 50",
        )
        .toArray(),
    };
  }

  stationHistory(id: number, now: number): StationHistory {
    const frozen = this.first<{ until: number; note: string }>(
      "SELECT until, note FROM frozen WHERE station = ? AND until > ?",
      id,
      now,
    );
    return {
      transitions: this.sql
        .exec<StationHistory["transitions"][number]>(
          `SELECT ts, fuel, from_state, to_state, flags, confirmations, absences, cause
           FROM transitions WHERE station = ? ORDER BY ts DESC LIMIT 500`,
          id,
        )
        .toArray(),
      contests: this.sql
        .exec<AdminOverview["contests"][number]>(
          "SELECT id, ts, station, fuel, reason, contact, status FROM contests WHERE station = ? ORDER BY ts DESC",
          id,
        )
        .toArray(),
      frozen: frozen ?? null,
    };
  }

  ackAlerts(ids: readonly number[], now: number): void {
    for (const id of ids) this.sql.exec("UPDATE alerts SET sent = 1 WHERE id = ?", id);
    this.logAdmin("ack", null, `${ids.length} avvisi visti`, now);
  }

  /** `false` se la contestazione non esiste (o è già stata cancellata dopo 180 giorni). */
  setContestStatus(id: number, status: string, now: number): boolean {
    const c = this.first<{ station: number }>("SELECT station FROM contests WHERE id = ?", id);
    if (!c) return false;
    this.sql.exec("UPDATE contests SET status = ? WHERE id = ?", status, id);
    this.logAdmin("contest", c.station, `contestazione ${id}: ${status}`, now);
    return true;
  }

  adminFreeze(id: number, note: string, hours: number, now: number): void {
    this.freeze(id, note, now, hours * HOUR);
    this.logAdmin("freeze", id, `${hours} h · ${note}`, now);
  }

  /** `false` se l'impianto non era congelato. */
  unfreeze(id: number, now: number): boolean {
    if (!this.first("SELECT 1 AS x FROM frozen WHERE station = ?", id)) return false;
    this.sql.exec("DELETE FROM frozen WHERE station = ?", id);
    const fuels = this.sql
      .exec<{ fuel: string }>("SELECT fuel FROM current WHERE station = ?", id)
      .toArray();
    for (const { fuel } of fuels) {
      const computed = this.stateOf(id, fuel as Fuel, now);
      this.logTransition(id, fuel as Fuel, now, { state: State.AMBER }, computed, "unfreeze");
    }
    this.cache = undefined;
    this.logAdmin("unfreeze", id, null, now);
    return true;
  }

  adminReadOnly(on: boolean, now: number): void {
    this.setReadOnly(on);
    this.logAdmin("read_only", null, on ? "attivata" : "disattivata", now);
  }

  private logAdmin(action: string, station: number | null, detail: string | null, now: number) {
    this.sql.exec(
      "INSERT INTO admin_log (ts, action, station, detail) VALUES (?, ?, ?, ?)",
      now,
      action,
      station,
      detail,
    );
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
    // Prima del confronto con lo stato precedente: ogni nuova conferma da verde va ricordata.
    if (next.state === State.GREEN && next.lastConfirmMs !== null) {
      this.sql.exec(
        "INSERT INTO last_green (station, fuel, ts) VALUES (?, ?, ?) ON CONFLICT(station, fuel) DO UPDATE SET ts = MAX(ts, excluded.ts)",
        id,
        fuel,
        Math.floor(next.lastConfirmMs / MIN) * MIN,
      );
    }
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
      now + ABUSE.keepMs,
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
