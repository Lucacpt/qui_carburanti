import { describe, expect, it } from "vitest";
import { describeState } from "./labels.ts";
import { buildSnapshot, rowToResult, type SnapshotEntry } from "./snapshot.ts";
import { Flag, State, type StateResult } from "./types.ts";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 30);
const min = (m: number) => NOW - m * 60_000;

const res = (over: Partial<StateResult>): StateResult => ({
  state: State.AMBER,
  confirmations: 0,
  lastConfirmMs: null,
  absences: 0,
  lastAbsenceMs: null,
  flags: Flag.NONE,
  evidence: [],
  ...over,
});
const entry = (id: number, result: StateResult, frozen = false): SnapshotEntry => ({
  id,
  fuel: "B",
  result,
  queue: { queue: 0, limit: 0 },
  frozen,
});

describe("buildSnapshot", () => {
  it("esclude il grigio, ordina per id, arrotonda l'ora al minuto", () => {
    const s = buildSnapshot(
      "AV",
      NOW,
      [
        entry(9, res({ state: State.GREEN, confirmations: 3, lastConfirmMs: min(7) })),
        entry(1, res({ state: State.GREY })),
        entry(4, res({ state: State.RED, absences: 3, lastAbsenceMs: min(12) })),
      ],
      false,
    );
    expect(s.s.map((r) => r[0])).toEqual([4, 9]);
    expect(s.t % 60).toBe(0);
  });

  it("pubblica l'età in fasce di 5 minuti, mai l'orario esatto", () => {
    const s = buildSnapshot(
      "AV",
      NOW,
      [entry(1, res({ confirmations: 1, lastConfirmMs: min(13) }))],
      false,
    );
    expect(s.s[0]?.[5]).toBe(10);
  });

  it("un impianto congelato porta il flag FROZEN", () => {
    const s = buildSnapshot(
      "AV",
      NOW,
      [entry(1, res({ confirmations: 1, lastConfirmMs: min(1) }), true)],
      false,
    );
    expect((s.s[0]?.[6] ?? 0) & Flag.FROZEN).toBe(Flag.FROZEN);
  });

  it("ultime disponibilità solo per i carburanti senza stato attuale, in fasce di 5 minuti", () => {
    const s = buildSnapshot(
      "AV",
      NOW,
      [entry(4, res({ state: State.RED, absences: 3, lastAbsenceMs: min(12) }))],
      false,
      {
        lastGreen: [
          { id: 4, fuel: "B", ts: min(600) }, // ha uno stato attuale: non deve comparire
          { id: 7, fuel: "B", ts: min(553) },
        ],
        lastHour: 12,
      },
    );
    expect(s.lg).toEqual([[7, "B", 550]]);
    expect(s.h).toBe(12);
  });

  it("dal lato client la riga ricostruisce un'etichetta coerente", () => {
    const s = buildSnapshot(
      "AV",
      NOW,
      [entry(1, res({ state: State.RED, absences: 3, lastAbsenceMs: min(12) }))],
      false,
    );
    const row = s.s[0];
    if (!row) throw new Error("riga mancante");
    const label = describeState(rowToResult(row, s.t), s.t * 1000);
    expect(label.title).toBe("Segnalato esaurito");
    expect(label.detail).toBe("da 3 persone · ultima segnalazione 10 min fa");
  });
});
