// Snapshot pubblico degli stati di una provincia (SDD §5.2). Compatto, deterministico, senza orari esatti.

import type { QueueInfo } from "./queue.ts";
import { type Reliability, reliability } from "./reliability.ts";
import { Flag, type Fuel, State, type StateResult } from "./types.ts";

/** Le età si pubblicano in fasce di 5 minuti: orari esatti permetterebbero di correlare chi ha segnalato. */
export const AGE_BUCKET_MIN = 5;

/** [idImpianto, carburante, stato, conferme, assenze, etàMin, flags, affidabilità, coda, limite] */
export type SnapshotRow = [
  number,
  Fuel,
  State,
  number,
  number,
  number,
  number,
  Reliability,
  QueueInfo["queue"],
  QueueInfo["limit"],
];

/** [idImpianto, carburante, etàMin]: ultima disponibilità confermata di un carburante oggi grigio. */
export type LastGreenRow = [number, Fuel, number];

export interface Snapshot {
  readonly v: 1;
  readonly prov: string;
  /** Ora del server in secondi, arrotondata al minuto. */
  readonly t: number;
  /** Modalità sola lettura attiva. */
  readonly ro: boolean;
  readonly s: SnapshotRow[];
  /** Ultime disponibilità (fino a 24 ore) dei soli carburanti senza segnalazioni recenti. */
  readonly lg: LastGreenRow[];
  /** Segnalazioni accettate nell'ultima ora in provincia: dice se il servizio è vivo. */
  readonly h: number;
}

export interface SnapshotExtras {
  readonly lastGreen: ReadonlyArray<{
    readonly id: number;
    readonly fuel: Fuel;
    readonly ts: number;
  }>;
  readonly lastHour: number;
}

const bucket = (ms: number) =>
  Math.floor(Math.max(0, Math.floor(ms / 60_000)) / AGE_BUCKET_MIN) * AGE_BUCKET_MIN;

export interface SnapshotEntry {
  readonly id: number;
  readonly fuel: Fuel;
  readonly result: StateResult;
  readonly queue: QueueInfo;
  readonly frozen: boolean;
}

/** Il momento a cui si riferisce lo stato: l'ultima assenza se ce ne sono, altrimenti l'ultima conferma. */
function relevantTs(r: StateResult): number | null {
  return r.absences > 0 ? r.lastAbsenceMs : r.lastConfirmMs;
}

export function buildSnapshot(
  prov: string,
  now: number,
  entries: readonly SnapshotEntry[],
  readOnly: boolean,
  extras: SnapshotExtras = { lastGreen: [], lastHour: 0 },
): Snapshot {
  const rows: SnapshotRow[] = [];
  for (const e of entries) {
    if (e.result.state === State.GREY && !e.frozen) continue;
    const ts = relevantTs(e.result);
    rows.push([
      e.id,
      e.fuel,
      e.result.state,
      e.result.confirmations,
      e.result.absences,
      ts === null ? 0 : bucket(now - ts),
      e.result.flags | (e.frozen ? Flag.FROZEN : 0),
      // L'affidabilità misura le segnalazioni degli utenti: non c'entra con un'indicazione di QUI.
      e.result.flags & Flag.OFFICIAL ? 0 : reliability(e.result, now),
      e.queue.queue,
      e.queue.limit,
    ]);
  }
  rows.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  // Solo dove non c'è uno stato attuale: l'ultima disponibilità non deve mai coprirlo.
  const current = new Set(rows.map((r) => `${r[0]}:${r[1]}`));
  const lg: LastGreenRow[] = extras.lastGreen
    .filter((g) => !current.has(`${g.id}:${g.fuel}`))
    .map((g): LastGreenRow => [g.id, g.fuel, bucket(now - g.ts)])
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return {
    v: 1,
    prov,
    t: Math.floor(now / 60_000) * 60,
    ro: readOnly,
    s: rows,
    lg,
    h: extras.lastHour,
  };
}

/** Lato client: ricostruisce lo StateResult (approssimato alla fascia di 5') per le etichette. */
export function rowToResult(row: SnapshotRow, t: number): StateResult {
  const [, , state, confirmations, absences, ageMin, flags] = row;
  const ts = t * 1000 - ageMin * 60_000;
  return {
    state,
    confirmations,
    absences,
    flags,
    lastConfirmMs: absences > 0 ? null : ts,
    lastAbsenceMs: absences > 0 ? ts : null,
    // Le singole segnalazioni non vengono mai pubblicate: l'affidabilità arriva già calcolata nella riga.
    evidence: [],
  };
}
