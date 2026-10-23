// Algoritmo di stato per una coppia (distributore, carburante). SDD §8.
// Funzione pura: stesse segnalazioni + stesso `now` ⇒ stesso risultato.

import { DEFAULT_PARAMS, type StateParams } from "./config.ts";
import { type Evidence, Flag, type Report, State, type StateResult } from "./types.ts";

/** Per ogni segnalatore (`rkey`) tiene solo la segnalazione più recente. */
export function latestPerReporter(reports: readonly Report[]): Report[] {
  const latest = new Map<string, Report>();
  for (const r of reports) {
    const prev = latest.get(r.rkey);
    if (prev === undefined || r.ts > prev.ts) latest.set(r.rkey, r);
  }
  return [...latest.values()];
}

/** Somma dei pesi, con il contributo di ogni prefisso di rete limitato a `capPrefix`. */
export function cappedWeight(reports: readonly Report[], p: StateParams): number {
  const byPrefix = new Map<string, number>();
  for (const r of reports) {
    const w = r.near ? p.wNear : p.wRemote;
    byPrefix.set(r.pkey, (byPrefix.get(r.pkey) ?? 0) + w);
  }
  let total = 0;
  for (const w of byPrefix.values()) total += Math.min(w, p.capPrefix);
  return total;
}

export function computeState(
  reports: readonly Report[],
  now: number,
  p: StateParams = DEFAULT_PARAMS,
): StateResult {
  const inWindow = reports.filter((r) => r.ts <= now && now - r.ts <= p.windowMs);
  const recent = latestPerReporter(inWindow);
  if (recent.length === 0) {
    return {
      state: State.GREY,
      confirmations: 0,
      lastConfirmMs: null,
      absences: 0,
      lastAbsenceMs: null,
      flags: Flag.NONE,
      evidence: [],
    };
  }

  const positives = recent.filter((r) => r.has);
  const negatives = recent.filter((r) => !r.has);
  const lastPos = maxTs(positives);
  const lastNeg = maxTs(negatives);
  // Simmetria (ADR-0011, A): ogni lato conta solo ciò che è arrivato DOPO l'ultima segnalazione opposta.
  // Così un "c'è" isolato dopo un rosso non resuscita le conferme vecchie, già smentite.
  const neg = negatives.filter((r) => lastPos === null || r.ts > lastPos);
  const pos45 = positives.filter(
    (r) => (lastNeg === null || r.ts > lastNeg) && now - r.ts <= p.freshMs,
  );
  // Conferme fresche precedenti alle assenze: servono solo a dire "era verde, ora è contrastante".
  const wasGreen =
    cappedWeight(
      positives.filter((r) => now - r.ts <= p.freshMs),
      p,
    ) >= p.greenMin;

  const negW = cappedWeight(neg, p);
  const posW45 = cappedWeight(pos45, p);
  const negNear = neg.some((r) => r.near);
  // I conteggi mostrati ("da 3 persone") contano le RETI distinte, non i token: un telefono che
  // rigenera il token non deve poter scrivere "da 12 persone" (ADR-0011, E: solo fatti).
  const base = {
    confirmations: networks(pos45),
    lastConfirmMs: lastPos,
    absences: networks(neg),
    lastAbsenceMs: maxTs(neg),
    evidence: pos45.map(toEvidence),
  };

  // Cascata di decisione: vince la prima regola che corrisponde (SDD §8).
  // 1. Rosso prima del verde, ma con due tutele per il gestore (ADR-0011, B e C).
  if (negW >= p.redMin && negNear) {
    const first = Math.min(...neg.map((r) => r.ts));
    const last = Math.max(...neg.map((r) => r.ts));
    if (now - last > p.redTtlMs) return { ...base, state: State.AMBER, flags: Flag.RED_EXPIRED };
    if (now - first < p.redHoldMs) return { ...base, state: State.AMBER, flags: Flag.RED_PENDING };
    return { ...base, state: State.RED, flags: Flag.NONE, evidence: neg.map(toEvidence) };
  }
  // 2. Conferme fresche sufficienti, tutte successive all'ultima assenza (quindi negW è 0).
  if (posW45 >= p.greenMin) return { ...base, state: State.GREEN, flags: Flag.NONE };
  // 3. Assenze non sufficienti per il rosso (poche, o nessuna fatta sul posto).
  if (negW > 0) {
    return { ...base, state: State.AMBER, flags: wasGreen ? Flag.CONTESTED : Flag.SINGLE_ABSENCE };
  }
  // 4. Solo conferme insufficienti o non fresche. Qui lastPos non è mai null: senza conferme, neg = recent ≠ ∅.
  return { ...base, state: State.AMBER, flags: Flag.NONE };
}

const toEvidence = (r: Report): Evidence => ({ ts: r.ts, near: r.near, pkey: r.pkey });

/** Numero di reti (prefissi) distinte: è il limite superiore onesto delle "persone" coinvolte. */
const networks = (reports: readonly Report[]): number => new Set(reports.map((r) => r.pkey)).size;

function maxTs(reports: readonly Report[]): number | null {
  return reports.length > 0 ? Math.max(...reports.map((r) => r.ts)) : null;
}
