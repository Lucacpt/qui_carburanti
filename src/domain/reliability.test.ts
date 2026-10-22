import { describe, expect, it } from "vitest";
import { reliability } from "./reliability.ts";
import { type Evidence, Flag, State, type StateResult } from "./types.ts";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const min = (m: number) => NOW - m * 60_000;

let seq = 0;
/** Una persona (rete nuova) che ha segnalato `minAgo` minuti fa, sul posto salvo diversa indicazione. */
const ev = (minAgo: number, near = true, pkey?: string): Evidence => ({
  ts: min(minAgo),
  near,
  pkey: pkey ?? `p${++seq}`,
});

function result(state: State, evidence: Evidence[], flags: number = Flag.NONE): StateResult {
  const last = evidence.length > 0 ? Math.max(...evidence.map((e) => e.ts)) : null;
  const isRed = state === State.RED;
  return {
    state,
    flags,
    confirmations: isRed ? 0 : evidence.length,
    lastConfirmMs: isRed ? null : last,
    absences: isRed ? evidence.length : 0,
    lastAbsenceMs: isRed ? last : null,
    evidence,
  };
}
const green = (...e: Evidence[]) => result(State.GREEN, e);

describe("reliability — regole del maintainer", () => {
  it("ALTA: 4 persone negli ultimi 10 minuti, di cui 2 sul posto", () => {
    expect(reliability(green(ev(1), ev(3), ev(5, false), ev(9, false)), NOW)).toBe(3);
  });

  it("MEDIA: 3 persone hanno detto che c'è, l'ultima 40 minuti fa", () => {
    expect(reliability(green(ev(40), ev(42), ev(44)), NOW)).toBe(2);
  });

  it("media se le 4 persone ci sono ma una è di 11 minuti fa", () => {
    expect(reliability(green(ev(1), ev(3), ev(5), ev(11)), NOW)).toBe(2);
  });

  it("media se le 4 persone sono recenti ma solo 1 è sul posto", () => {
    expect(reliability(green(ev(1), ev(3, false), ev(5, false), ev(9, false)), NOW)).toBe(2);
  });

  it("4 segnalazioni dalla stessa rete contano come 1 persona: niente alta", () => {
    const sameNet = [ev(1, true, "x"), ev(2, true, "x"), ev(3, true, "x"), ev(4, true, "x")];
    expect(reliability(green(...sameNet, ev(5), ev(6)), NOW)).toBe(2);
  });

  it("rosso pieno: alta con 4 persone recenti di cui 2 sul posto, altrimenti media", () => {
    expect(reliability(result(State.RED, [ev(11), ev(12), ev(13, false), ev(14)]), NOW)).toBe(2);
    expect(reliability(result(State.RED, [ev(1), ev(2), ev(3, false), ev(4)]), NOW)).toBe(3);
  });

  it("qualsiasi ambra → bassa", () => {
    for (const flags of [
      Flag.NONE,
      Flag.CONTESTED,
      Flag.SINGLE_ABSENCE,
      Flag.RED_PENDING,
      Flag.RED_EXPIRED,
      Flag.FROZEN,
    ]) {
      expect(reliability(result(State.AMBER, [ev(1), ev(2), ev(3), ev(4)], flags), NOW)).toBe(1);
    }
  });

  it("grigio → 0 (non applicabile)", () => {
    expect(reliability(result(State.GREY, []), NOW)).toBe(0);
  });
});

describe("reliability — proprietà", () => {
  it("più persone, a parità di età, non abbassano mai l'affidabilità", () => {
    for (const age of [1, 9, 15, 44]) {
      let prev = 0;
      const people: Evidence[] = [];
      for (let n = 1; n <= 10; n++) {
        people.push(ev(age));
        const v = reliability(green(...people), NOW);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it("il passare del tempo non alza mai l'affidabilità", () => {
    const people = [ev(0), ev(0), ev(0, false), ev(0, false), ev(0)];
    let prev = 3;
    for (let t = 0; t <= 45; t++) {
      const v = reliability(green(...people), NOW + t * 60_000);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});
