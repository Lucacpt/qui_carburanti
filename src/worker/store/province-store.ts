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
  FUELS,
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
  // ADR-0013 rev. 2: indicazioni di QUI, con la nota che ne dice la fonte. Al massimo 8 ore.
  `CREATE TABLE IF NOT EXISTS overrides (station INTEGER NOT NULL, fuel TEXT NOT NULL,
     state INTEGER NOT NULL, note TEXT NOT NULL, ts INTEGER NOT NULL, until INTEGER NOT NULL,
     PRIMARY KEY (station, fuel))`,
  // Reti bloccate a mano fino a mezzanotte UTC, quando la chiave del giorno cambia e il codice
  // di rete non vale più nulla.
  "CREATE TABLE IF NOT EXISTS blocked (pkey TEXT PRIMARY KEY, until INTEGER NOT NULL)",
  // Impianti indicati come chiusi da QUI, con la nota che ne dice la fonte, fino alla riapertura.
  "CREATE TABLE IF NOT EXISTS closed (station INTEGER PRIMARY KEY, note TEXT NOT NULL, ts INTEGER NOT NULL)",
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
  readonly overrides: Array<Override & { until: number }>;
  readonly closed: Array<{ station: number; note: string; ts: number }>;
  readonly notice: Notice | null;
  /** Reti bloccate adesso, con l'abbreviazione di 4 caratteri: mai il codice intero. */
  readonly blocked: Array<{ net: string; until: number }>;
  readonly stats: Array<{ hour: number; fuel: string; pos: number; neg: number; dropped: number }>;
  readonly log: Array<{
    ts: number;
    action: string;
    station: number | null;
    detail: string | null;
  }>;
}

/** Avviso mostrato a tutti in cima all'app, con scadenza. */
export type Notice = { readonly text: string; readonly until: number };

export type AdminLogRow = {
  readonly ts: number;
  readonly action: string;
  readonly station: number | null;
  readonly detail: string | null;
};

/** Indicazione di QUI su un carburante di un impianto. */
export type Override = {
  readonly station: number;
  readonly fuel: string;
  readonly state: number;
  readonly note: string;
  readonly ts: number;
};

/**
 * Una segnalazione delle ultime 8 ore come la vede l'admin. Nessun codice dei segnalatori: `net` è
 * un'abbreviazione di 4 caratteri del codice di rete (che cambia ogni giorno), quanto basta per
 * riconoscere una serie dalla stessa rete e annullarla.
 */
export interface RecentReport {
  readonly id: number;
  readonly ts: number;
  readonly station: number;
  readonly fuel: string;
  readonly has: number;
  readonly near: number;
  readonly queue: number | null;
  readonly lim: number | null;
  readonly net: string;
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
  readonly overrides: Array<Override & { until: number }>;
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

type Cause =
  | "report"
  | "hold"
  | "ttl"
  | "window"
  | "fresh"
  | "time"
  | "freeze"
  | "unfreeze"
  | "annul"
  | "official"
  | "clear"
  | "users";

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
    if (!this.consumePow(r.powSig, r.powExpiresMs)) return this.drop(r.fuel, now);

    // Timeout progressivo in corso.
    if (this.first("SELECT 1 AS x FROM blocked WHERE pkey = ? AND until > ?", r.pkey, now)) {
      return this.drop(r.fuel, now);
    }
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
    this.yieldOverride(r.id, r.fuel, now);
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
    const overrides = this.activeOverrides(now);
    const official = new Map(overrides.map((o) => [`${o.station}:${o.fuel}`, o]));
    // Un'indicazione di QUI si mostra anche dove nessuno ha segnalato.
    const seen = new Set(pairs.map((p) => `${p.station}:${p.fuel}`));
    for (const o of overrides) {
      if (!seen.has(`${o.station}:${o.fuel}`)) pairs.push({ station: o.station, fuel: o.fuel });
    }
    const entries: SnapshotEntry[] = pairs.map(({ station, fuel }) => {
      const reports = this.reportsFor(station, fuel as Fuel, now);
      const ov = official.get(`${station}:${fuel}`);
      let result = ov
        ? officialResult(ov.state as State, ov.ts)
        : computeState(reports, now, this.params);
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
    const ov = overrides.map((o) => [o.station, o.fuel, o.note]);
    const cl = this.sql
      .exec<{ station: number; note: string }>("SELECT station, note FROM closed ORDER BY station")
      .toArray()
      .map((c) => [c.station, c.note]);
    const nt = this.notice(now)?.text ?? null;
    const body = JSON.stringify({ ...snap, fz: [...frozen], ov, cl, nt });
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
    this.sql.exec("DELETE FROM overrides WHERE until <= ?", now);
    this.sql.exec("DELETE FROM blocked WHERE until <= ?", now);
    if (this.storedNotice() && !this.notice(now))
      this.sql.exec("DELETE FROM config WHERE k = 'notice'");
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
      q("SELECT MIN(until) AS t FROM overrides"),
      q("SELECT MIN(until) AS t FROM blocked"),
      this.storedNotice()?.until ?? null,
    ].filter((t): t is number => t !== null);
    return times.length > 0 ? Math.min(...times) : null;
  }

  // ---------------------------------------------------------------- contestazioni e congelamento

  /** Consuma una firma PoW: true se nuova, false se già usata (replay). */
  private consumePow(sig: string, expiresMs: number): boolean {
    if (this.first("SELECT 1 AS x FROM pow_used WHERE sig = ?", sig)) return false;
    this.sql.exec("INSERT INTO pow_used (sig, expires) VALUES (?, ?)", sig, expiresMs);
    return true;
  }

  /** "replay" se la PoW era già stata usata: la contestazione viene ignorata in silenzio. */
  contest(c: ContestInput, powSig: string, powExpiresMs: number, now: number): "ok" | "replay" {
    if (!this.consumePow(powSig, powExpiresMs)) return "replay";
    this.sql.exec(
      "INSERT INTO contests (station, fuel, reason, contact, ts) VALUES (?, ?, ?, ?, ?)",
      c.id,
      c.fuel ?? null,
      c.reason,
      c.contact ?? null,
      now,
    );
    this.alert("contest", c.id, c.fuel ?? null, c.reason, now);
    return "ok";
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
      overrides: this.sql
        .exec<AdminOverview["overrides"][number]>(
          "SELECT station, fuel, state, note, ts, until FROM overrides WHERE until > ? ORDER BY until",
          now,
        )
        .toArray(),
      closed: this.sql
        .exec<AdminOverview["closed"][number]>(
          "SELECT station, note, ts FROM closed ORDER BY ts DESC",
        )
        .toArray(),
      notice: this.notice(now),
      blocked: this.sql
        .exec<{ pkey: string; until: number }>(
          "SELECT pkey, until FROM blocked WHERE until > ? ORDER BY until",
          now,
        )
        .toArray()
        .map((b) => ({ net: fnv1a(b.pkey).slice(0, 4), until: b.until })),
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
      overrides: this.sql
        .exec<StationHistory["overrides"][number]>(
          "SELECT station, fuel, state, note, ts, until FROM overrides WHERE station = ? AND until > ?",
          id,
          now,
        )
        .toArray(),
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

  /** Le segnalazioni delle ultime 8 ore, dalla più recente (ADR-0013 rev. 2). */
  recentReports(now: number): RecentReport[] {
    return this.sql
      .exec<Omit<RecentReport, "net"> & { pkey: string }>(
        `SELECT rowid AS id, ts, station, fuel, has, near, queue, lim, pkey FROM reports
         WHERE ts > ? ORDER BY ts DESC LIMIT 500`,
        now - this.params.windowMs,
      )
      .toArray()
      .map(({ pkey, ...r }) => ({ ...r, net: fnv1a(pkey).slice(0, 4) }));
  }

  /**
   * Annulla segnalazioni (spam, errori evidenti) e ricalcola subito gli stati. La motivazione resta
   * nel registro delle azioni. Restituisce quante ne ha trovate.
   */
  annulReports(ids: readonly number[], reason: string, now: number): number {
    const found: Array<{ station: number; fuel: string; has: number }> = [];
    for (const id of ids) {
      const row = this.first<{ station: number; fuel: string; has: number }>(
        "SELECT station, fuel, has FROM reports WHERE rowid = ?",
        id,
      );
      if (!row) continue;
      this.sql.exec("DELETE FROM reports WHERE rowid = ?", id);
      found.push(row);
    }
    if (found.length === 0) return 0;
    const pairs = new Map(found.map((r) => [`${r.station}:${r.fuel}`, r]));
    for (const { station, fuel } of pairs.values()) {
      // Un "c'è" annullato non deve sopravvivere come "ultima disponibilità": se resta verde,
      // updateState la riscrive con le conferme rimaste.
      if (found.some((r) => r.station === station && r.fuel === fuel && r.has === 1)) {
        this.sql.exec("DELETE FROM last_green WHERE station = ? AND fuel = ?", station, fuel);
      }
      this.updateState(station, fuel as Fuel, now, "annul");
    }
    const stations = new Set(found.map((r) => r.station));
    const only = stations.size === 1 ? [...stations][0] : undefined;
    const n = found.length;
    const what = n === 1 ? "1 segnalazione" : `${n} segnalazioni`;
    this.logAdmin("annul", only ?? null, `${what} · ${reason}`, now);
    this.cache = undefined;
    return n;
  }

  /**
   * Indicazione di QUI su un carburante (o tutti quelli venduti), con la nota che ne dice la fonte.
   * `false` se l'impianto non vende quel carburante.
   */
  adminSetState(
    id: number,
    fuel: Fuel | null,
    state: "green" | "red",
    note: string,
    hours: number,
    now: number,
  ): boolean {
    const mask = this.stations.get(id) ?? 0;
    const sold = FUELS.filter((f) => (mask & FUEL_BIT[f]) !== 0);
    const fuels = fuel === null ? sold : sold.filter((f) => f === fuel);
    if (fuels.length === 0) return false;
    const shown = state === "green" ? State.GREEN : State.RED;
    for (const f of fuels) {
      const prev = this.first<{ state: number }>(
        "SELECT state FROM current WHERE station = ? AND fuel = ?",
        id,
        f,
      );
      this.sql.exec(
        `INSERT INTO overrides (station, fuel, state, note, ts, until) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(station, fuel) DO UPDATE SET state = excluded.state, note = excluded.note,
         ts = excluded.ts, until = excluded.until`,
        id,
        f,
        shown,
        note,
        now,
        now + hours * HOUR,
      );
      this.logTransition(id, f, now, prev ?? null, officialResult(shown, now), "official");
    }
    const what = `${fuel ?? "tutti i carburanti"} ${state === "green" ? "verde" : "rosso"}`;
    this.logAdmin("set_state", id, `${what} · ${hours} h · ${note}`, now);
    this.cache = undefined;
    return true;
  }

  /**
   * Blocca fino a mezzanotte UTC la rete da cui è arrivata una segnalazione: le sue prossime
   * segnalazioni vengono scartate in silenzio. Con `annul` cancella anche quelle già arrivate.
   * null se la segnalazione non c'è più.
   */
  blockNetwork(
    reportId: number,
    annul: boolean,
    reason: string,
    now: number,
  ): { annulled: number } | null {
    const row = this.first<{ pkey: string; station: number }>(
      "SELECT pkey, station FROM reports WHERE rowid = ?",
      reportId,
    );
    if (!row) return null;
    const until = Math.floor(now / DAY) * DAY + DAY;
    this.sql.exec(
      "INSERT INTO blocked (pkey, until) VALUES (?, ?) ON CONFLICT(pkey) DO UPDATE SET until = excluded.until",
      row.pkey,
      until,
    );
    const net = fnv1a(row.pkey).slice(0, 4);
    this.logAdmin("block_net", row.station, `rete ${net} fino a mezzanotte UTC · ${reason}`, now);
    let annulled = 0;
    if (annul) {
      const ids = this.sql
        .exec<{ id: number }>("SELECT rowid AS id FROM reports WHERE pkey = ?", row.pkey)
        .toArray()
        .map((r) => r.id);
      annulled = this.annulReports(ids, `rete ${net} bloccata · ${reason}`, now);
    }
    return { annulled };
  }

  /**
   * Sblocca una rete (per abbreviazione) o tutte (`null`): per un blocco dato per errore, per
   * esempio su una rete condivisa. Restituisce quante ne ha sbloccate.
   */
  unblockNetworks(net: string | null, now: number): number {
    const keys = this.sql
      .exec<{ pkey: string }>("SELECT pkey FROM blocked")
      .toArray()
      .map((b) => b.pkey)
      .filter((pkey) => net === null || fnv1a(pkey).slice(0, 4) === net);
    for (const pkey of keys) this.sql.exec("DELETE FROM blocked WHERE pkey = ?", pkey);
    if (keys.length > 0)
      this.logAdmin("unblock_net", null, net === null ? "tutte le reti" : `rete ${net}`, now);
    return keys.length;
  }

  /** Impianto indicato come chiuso da QUI, con la fonte, fino alla riapertura. */
  closeStation(id: number, note: string, now: number): void {
    this.sql.exec(
      "INSERT INTO closed (station, note, ts) VALUES (?, ?, ?) ON CONFLICT(station) DO UPDATE SET note = excluded.note, ts = excluded.ts",
      id,
      note,
      now,
    );
    this.logAdmin("close", id, note, now);
    this.cache = undefined;
  }

  /** `false` se l'impianto non era segnato come chiuso. */
  reopenStation(id: number, now: number): boolean {
    if (!this.first("SELECT 1 AS x FROM closed WHERE station = ?", id)) return false;
    this.sql.exec("DELETE FROM closed WHERE station = ?", id);
    this.logAdmin("reopen", id, null, now);
    this.cache = undefined;
    return true;
  }

  /** Avviso a tutti per `hours` ore; `text` null lo toglie. */
  setNotice(text: string | null, hours: number, now: number): void {
    if (text === null) {
      this.sql.exec("DELETE FROM config WHERE k = 'notice'");
      this.logAdmin("notice", null, "tolto", now);
    } else {
      const v = JSON.stringify({ text, until: now + hours * HOUR });
      this.sql.exec(
        "INSERT INTO config (k, v) VALUES ('notice', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        v,
      );
      this.logAdmin("notice", null, `${hours} h · ${text}`, now);
    }
    this.cache = undefined;
  }

  /** Tutto il registro delle azioni (180 giorni), per l'esportazione. */
  adminLog(): AdminLogRow[] {
    return this.sql
      .exec<AdminLogRow>(
        "SELECT ts, action, station, detail FROM admin_log ORDER BY ts DESC, id DESC",
      )
      .toArray();
  }

  /** Toglie le indicazioni di QUI da un impianto (un carburante o tutti). `false` se non ce n'erano. */
  clearState(id: number, now: number, fuel: Fuel | null = null): boolean {
    const rows = this.sql
      .exec<{ fuel: string; state: number }>(
        "SELECT fuel, state FROM overrides WHERE station = ? AND until > ?",
        id,
        now,
      )
      .toArray()
      .filter((r) => fuel === null || r.fuel === fuel);
    for (const r of rows) {
      this.sql.exec("DELETE FROM overrides WHERE station = ? AND fuel = ?", id, r.fuel);
    }
    if (rows.length === 0) return false;
    for (const { fuel, state } of rows) {
      const computed = this.stateOf(id, fuel as Fuel, now);
      this.logTransition(id, fuel as Fuel, now, { state }, computed, "clear");
    }
    this.logAdmin("clear_state", id, fuel ?? "tutti i carburanti", now);
    this.cache = undefined;
    return true;
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

  /**
   * Cede agli utenti: se le segnalazioni arrivate DOPO l'indicazione di QUI danno da sole uno stato
   * chiaro (verde o rosso), l'indicazione decade e l'admin riceve un avviso.
   */
  private yieldOverride(id: number, fuel: Fuel, now: number): void {
    const ov = this.first<{ state: number; ts: number }>(
      "SELECT state, ts FROM overrides WHERE station = ? AND fuel = ? AND until > ?",
      id,
      fuel,
      now,
    );
    if (!ov) return;
    const after = computeState(
      this.reportsFor(id, fuel, now).filter((r) => r.ts > ov.ts),
      now,
      this.params,
    );
    if (after.state !== State.GREEN && after.state !== State.RED) return;
    this.sql.exec("DELETE FROM overrides WHERE station = ? AND fuel = ?", id, fuel);
    this.logTransition(id, fuel, now, { state: ov.state }, this.stateOf(id, fuel, now), "users");
    const users = after.state === State.GREEN ? "verde" : "rosso";
    this.alert("override_superseded", id, fuel, `gli utenti segnalano ${users}`, now);
  }

  private storedNotice(): Notice | null {
    const v = this.first<{ v: string }>("SELECT v FROM config WHERE k = 'notice'")?.v;
    if (!v) return null;
    try {
      const n = JSON.parse(v) as Notice;
      return typeof n.text === "string" && typeof n.until === "number" ? n : null;
    } catch {
      return null;
    }
  }

  private notice(now: number): Notice | null {
    const n = this.storedNotice();
    return n && n.until > now ? n : null;
  }

  private activeOverrides(now: number): Override[] {
    return this.sql
      .exec<{ station: number; fuel: string; state: number; note: string; ts: number }>(
        "SELECT station, fuel, state, note, ts FROM overrides WHERE until > ?",
        now,
      )
      .toArray();
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

/** Lo stato di un'indicazione di QUI: nessun conteggio degli utenti, età dall'indicazione. */
function officialResult(state: State, ts: number): StateResult {
  return {
    state,
    confirmations: 0,
    absences: 0,
    flags: Flag.OFFICIAL,
    lastConfirmMs: ts,
    lastAbsenceMs: null,
    evidence: [],
  };
}

function causeOf(prev: { state: number; flags: number } | null, next: StateResult): Cause {
  if (next.state === State.GREY) return "window";
  if (prev && prev.flags & Flag.RED_PENDING && next.state === State.RED) return "hold";
  if (next.flags & Flag.RED_EXPIRED) return "ttl";
  if (prev?.state === State.GREEN) return "fresh";
  return "time";
}
