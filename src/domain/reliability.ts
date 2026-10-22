// Indicatore di affidabilità a 3 livelli (ADR-0006 ibrido A + C, FR-23).
// Non cambia lo stato: dice a chi guida QUANTO fidarsi dello stato mostrato.

import { State, type StateResult } from "./types.ts";

/** 0 = non applicabile (grigio), 1 = bassa, 2 = media, 3 = alta. */
export type Reliability = 0 | 1 | 2 | 3;

export function reliability(s: StateResult, now: number): Reliability {
  if (s.state === State.GREY) return 0;
  // TODO(human): restituisci 1, 2 o 3 in base a quante persone e a quanto è recente l'informazione.
  // Hai: s.state, s.flags, s.confirmations, s.lastConfirmMs, s.absences, s.lastAbsenceMs, now.
  return 1;
}
