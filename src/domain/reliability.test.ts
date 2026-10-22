// Proprietà che qualunque implementazione ragionevole dell'affidabilità deve rispettare.
// Le soglie esatte sono una scelta di design: i test non le fissano.

import { describe, expect, it } from "vitest";
import { reliability } from "./reliability.ts";
import { Flag, State, type StateResult } from "./types.ts";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const min = (m: number) => NOW - m * 60_000;

const green = (confirmations: number, minAgo: number): StateResult => ({
  state: State.GREEN,
  confirmations,
  lastConfirmMs: min(minAgo),
  absences: 0,
  lastAbsenceMs: null,
  flags: Flag.NONE,
});

describe("reliability", () => {
  it("grigio → 0 (non applicabile); ogni altro stato → da 1 a 3", () => {
    expect(reliability({ ...green(0, 0), state: State.GREY, lastConfirmMs: null }, NOW)).toBe(0);
    for (const c of [3, 5, 10]) {
      for (const m of [0, 10, 30, 44]) {
        const v = reliability(green(c, m), NOW);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(3);
      }
    }
  });

  it("verde con molte conferme recentissime → alta (3)", () => {
    expect(reliability(green(6, 2), NOW)).toBe(3);
  });

  it("più conferme, a parità di età, non abbassano mai l'affidabilità", () => {
    for (const m of [1, 15, 30, 44]) {
      let prev = 0;
      for (let c = 3; c <= 12; c++) {
        const v = reliability(green(c, m), NOW);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it("informazioni più vecchie, a parità di conferme, non alzano mai l'affidabilità", () => {
    for (const c of [3, 6, 10]) {
      let prev = 3;
      for (let m = 0; m <= 44; m++) {
        const v = reliability(green(c, m), NOW);
        expect(v).toBeLessThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it("rosso scaduto e rosso in verifica → bassa (1): sono informazioni incerte per definizione", () => {
    for (const flags of [Flag.RED_EXPIRED, Flag.RED_PENDING]) {
      const s: StateResult = {
        ...green(0, 0),
        state: State.AMBER,
        flags,
        absences: 3,
        lastAbsenceMs: min(5),
        lastConfirmMs: null,
      };
      expect(reliability(s, NOW)).toBe(1);
    }
  });

  it("rosso confermato da 5 persone pochi minuti fa → almeno media (≥ 2)", () => {
    const s: StateResult = {
      ...green(0, 0),
      state: State.RED,
      absences: 5,
      lastAbsenceMs: min(3),
      lastConfirmMs: null,
    };
    expect(reliability(s, NOW)).toBeGreaterThanOrEqual(2);
  });
});
