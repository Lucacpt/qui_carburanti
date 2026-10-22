// Algoritmo di stato per una coppia (distributore, carburante). SDD §8.
// Funzione pura: stesse segnalazioni + stesso `now` ⇒ stesso risultato.

import { DEFAULT_PARAMS, type StateParams } from "./config.ts";
import { Flag, type Report, State, type StateResult } from "./types.ts";

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
    return { state: State.GREY, confirmations: 0, lastConfirmMs: null, flags: Flag.NONE };
  }

  const positives = recent.filter((r) => r.has);
  const lastPos = positives.length > 0 ? Math.max(...positives.map((r) => r.ts)) : null;
  // Contano solo le assenze successive all'ultima conferma: un "c'è" più recente le supera.
  const neg = recent.filter((r) => !r.has && (lastPos === null || r.ts > lastPos));
  const pos45 = positives.filter((r) => now - r.ts <= p.freshMs);

  const negW = cappedWeight(neg, p);
  const posW45 = cappedWeight(pos45, p);
  const negNear = neg.some((r) => r.near);
  const base = { confirmations: pos45.length, lastConfirmMs: lastPos };

  // Cascata di decisione: vince la prima regola che corrisponde (SDD §8).
  // 1. Rosso prima del verde: assenze sufficienti e PIÙ RECENTI delle conferme sono l'informazione più fresca.
  if (negW >= p.redMin && negNear) return { ...base, state: State.RED, flags: Flag.NONE };
  // 2. Conferme fresche sufficienti; se dopo è arrivata qualche assenza, lo stato è contrastante.
  if (posW45 >= p.greenMin) {
    return negW > 0
      ? { ...base, state: State.AMBER, flags: Flag.CONTESTED }
      : { ...base, state: State.GREEN, flags: Flag.NONE };
  }
  // 3. Assenze non sufficienti per il rosso (poche, o nessuna fatta sul posto).
  if (negW > 0) return { ...base, state: State.AMBER, flags: Flag.SINGLE_ABSENCE };
  // 4. Solo conferme insufficienti o non fresche. Qui lastPos non è mai null: senza conferme, neg = recent ≠ ∅.
  return { ...base, state: State.AMBER, flags: Flag.NONE };
}
