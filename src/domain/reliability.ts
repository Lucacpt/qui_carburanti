// Indicatore di affidabilità a 3 livelli (ADR-0006 rev. v0.3.3, FR-23).
// Non cambia lo stato: dice a chi guida QUANTO fidarsi dello stato mostrato.
// Regole del maintainer:
//   alta  = almeno 4 persone negli ultimi 10 minuti, di cui almeno 2 sul posto
//   media = verde o rosso pieno che non arriva all'alta (es. 3 persone, l'ultima 40 minuti fa)
//   bassa = qualsiasi ambra (da verificare, contrastante, rosso in verifica o scaduto, congelato)

import { State, type StateResult } from "./types.ts";

/** 0 = non applicabile (grigio), 1 = bassa, 2 = media, 3 = alta. */
export type Reliability = 0 | 1 | 2 | 3;

export const HIGH_WINDOW_MS = 10 * 60_000;
export const HIGH_MIN_PEOPLE = 4;
export const HIGH_MIN_NEAR = 2;

export function reliability(s: StateResult, now: number): Reliability {
  if (s.state === State.GREY) return 0;
  // L'ambra è per definizione un'informazione da verificare.
  if (s.state !== State.GREEN && s.state !== State.RED) return 1;

  // "Persone" = reti diverse: più token dallo stesso telefono o dalla stessa rete contano una volta.
  const recent = s.evidence.filter((e) => e.ts <= now && now - e.ts <= HIGH_WINDOW_MS);
  const people = new Set(recent.map((e) => e.pkey)).size;
  const nearPeople = new Set(recent.filter((e) => e.near).map((e) => e.pkey)).size;

  return people >= HIGH_MIN_PEOPLE && nearPeople >= HIGH_MIN_NEAR ? 3 : 2;
}
