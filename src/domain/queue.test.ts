import { describe, expect, it } from "vitest";
import { aggregateQueue } from "./queue.ts";
import type { Queue, Report } from "./types.ts";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
let seq = 0;
const r = (minAgo: number, queue?: Queue, limit?: boolean, pkey?: string): Report => {
  seq++;
  return {
    has: true,
    near: true,
    ts: NOW - minAgo * 60_000,
    rkey: `r${seq}`,
    pkey: pkey ?? `p${seq}`,
    queue,
    limit,
  };
};

describe("aggregateQueue", () => {
  it("senza indicazioni: sconosciuto", () => {
    expect(aggregateQueue([r(5)], NOW)).toEqual({ queue: 0, limit: 0 });
  });

  it("vince il valore indicato da più reti", () => {
    expect(aggregateQueue([r(1, 1), r(5, 3), r(6, 3)], NOW).queue).toBe(3);
  });

  it("a parità vince il più recente", () => {
    expect(aggregateQueue([r(1, 2), r(5, 3)], NOW).queue).toBe(2);
  });

  it("una sola rete conta una volta, con la sua ultima indicazione", () => {
    const sameNet = [r(1, 3, undefined, "x"), r(2, 3, undefined, "x"), r(3, 3, undefined, "x")];
    expect(aggregateQueue([...sameNet, r(4, 1), r(5, 1)], NOW).queue).toBe(1);
  });

  it("ignora indicazioni più vecchie di 30 minuti e le assenze", () => {
    const absence: Report = { ...r(1, 3), has: false };
    expect(aggregateQueue([r(31, 3), absence], NOW).queue).toBe(0);
  });

  it("limite di erogazione: a maggioranza", () => {
    expect(
      aggregateQueue([r(1, undefined, true), r(2, undefined, true), r(3, undefined, false)], NOW)
        .limit,
    ).toBe(1);
  });
});
