import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "./config.ts";
import { cappedWeight, computeState, latestPerReporter } from "./state.ts";
import { Flag, type Report, State } from "./types.ts";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const min = (m: number) => NOW - m * 60_000;

let seq = 0;
/** Segnalazione di prova: ogni chiamata è un segnalatore diverso, salvo `rkey` esplicita. */
function r(
  has: boolean,
  minutesAgo: number,
  opts: Partial<Omit<Report, "has" | "ts">> = {},
): Report {
  seq++;
  return {
    has,
    ts: min(minutesAgo),
    near: opts.near ?? true,
    rkey: opts.rkey ?? `r${seq}`,
    pkey: opts.pkey ?? `p${seq}`,
  };
}
const yes = (m: number, o?: Partial<Report>) => r(true, m, o);
const no = (m: number, o?: Partial<Report>) => r(false, m, o);

describe("helper", () => {
  it("latestPerReporter tiene solo l'ultima segnalazione di ogni rkey", () => {
    const out = latestPerReporter([
      yes(30, { rkey: "a" }),
      no(5, { rkey: "a" }),
      yes(10, { rkey: "b" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.rkey === "a")?.has).toBe(false);
  });

  it("cappedWeight limita il contributo di un prefisso a capPrefix", () => {
    const sameNet = [yes(1, { pkey: "x" }), yes(2, { pkey: "x" }), yes(3, { pkey: "x" })];
    expect(cappedWeight(sameNet, DEFAULT_PARAMS)).toBe(1.0);
    expect(cappedWeight([yes(1, { near: false }), yes(2, { near: false })], DEFAULT_PARAMS)).toBe(
      0.5,
    );
  });
});

describe("computeState — tabella dei casi (SDD §8, rev. v0.3.1: soglie a 3 persone)", () => {
  const cases: Array<{
    name: string;
    reports: Report[];
    state: State;
    flags?: number;
    conf?: number;
  }> = [
    { name: "nessuna segnalazione → grigio", reports: [], state: State.GREY },
    {
      name: "solo segnalazioni oltre 8 h → grigio",
      reports: [yes(8 * 60 + 1), yes(9 * 60)],
      state: State.GREY,
    },
    {
      name: "segnalazioni nel futuro ignorate → grigio",
      reports: [yes(-5), yes(-10)],
      state: State.GREY,
    },
    {
      name: "1 conferma sul posto → ambra da verificare",
      reports: [yes(10)],
      state: State.AMBER,
      flags: Flag.NONE,
      conf: 1,
    },
    {
      name: "2 conferme da reti diverse → ambra (ne servono 3)",
      reports: [yes(10), yes(20)],
      state: State.AMBER,
      flags: Flag.NONE,
      conf: 2,
    },
    {
      name: "3 conferme da reti diverse → verde",
      reports: [yes(10), yes(20), yes(30)],
      state: State.GREEN,
      flags: Flag.NONE,
      conf: 3,
    },
    {
      name: "3 conferme dalla stessa rete (CGNAT) → ambra",
      reports: [yes(10, { pkey: "cgnat" }), yes(12, { pkey: "cgnat" }), yes(14, { pkey: "cgnat" })],
      state: State.AMBER,
      conf: 3,
    },
    {
      name: "12 conferme remote da 12 reti → verde (12 × 0,25 = 3,0)",
      reports: Array.from({ length: 12 }, (_, i) => yes(i + 1, { near: false })),
      state: State.GREEN,
      conf: 12,
    },
    {
      name: "11 conferme remote da 11 reti → ambra",
      reports: Array.from({ length: 11 }, (_, i) => yes(i + 1, { near: false })),
      state: State.AMBER,
    },
    {
      name: "2 conferme sul posto + 4 remote → verde (peso 3,0)",
      reports: [yes(5), yes(6), ...[7, 8, 9, 10].map((m) => yes(m, { near: false }))],
      state: State.GREEN,
      conf: 6,
    },
    {
      name: "2 conferme sul posto + 3 remote → ambra (peso 2,75)",
      reports: [yes(5), yes(6), ...[7, 8, 9].map((m) => yes(m, { near: false }))],
      state: State.AMBER,
    },
    {
      name: "3 conferme vecchie (60 min) → ambra non confermato",
      reports: [yes(60), yes(70), yes(80)],
      state: State.AMBER,
      conf: 0,
    },
    {
      name: "1 assenza sul posto, nessuna conferma → ambra assenza da verificare",
      reports: [no(5)],
      state: State.AMBER,
      flags: Flag.SINGLE_ABSENCE,
    },
    {
      name: "2 assenze sul posto da reti diverse → ambra (ne servono 3)",
      reports: [no(5), no(8)],
      state: State.AMBER,
      flags: Flag.SINGLE_ABSENCE,
    },
    {
      name: "3 assenze sul posto da reti diverse → rosso",
      reports: [no(5), no(8), no(11)],
      state: State.RED,
    },
    {
      name: "2 assenze sul posto + 4 remote → rosso (peso 3,0 con almeno una sul posto)",
      reports: [no(5), no(6), ...[11, 12, 13, 14].map((m) => no(m, { near: false }))],
      state: State.RED,
    },
    {
      name: "2 assenze sul posto + 3 remote → ambra (peso 2,75)",
      reports: [no(5), no(6), ...[7, 8, 9].map((m) => no(m, { near: false }))],
      state: State.AMBER,
      flags: Flag.SINGLE_ABSENCE,
    },
    {
      name: "12 assenze remote (peso 3,0 ma nessuna sul posto) → ambra, mai rosso",
      reports: Array.from({ length: 12 }, (_, i) => no(i + 1, { near: false })),
      state: State.AMBER,
      flags: Flag.SINGLE_ABSENCE,
    },
    {
      name: "verde + 1 assenza più recente → ambra contrastante",
      reports: [yes(20), yes(25), yes(30), no(5)],
      state: State.AMBER,
      flags: Flag.CONTESTED,
    },
    {
      name: "verde + 2 assenze più recenti → ancora contrastante",
      reports: [yes(20), yes(25), yes(30), no(5), no(6)],
      state: State.AMBER,
      flags: Flag.CONTESTED,
    },
    {
      name: "verde + 3 assenze più recenti (da oltre 10') → rosso",
      reports: [yes(20), yes(25), yes(30), no(12), no(13), no(14)],
      state: State.RED,
    },
    // ADR-0011 A — simmetria: dopo un rosso, le conferme vecchie non contano più.
    {
      name: "A) rosso + 1 solo 'c'è' → ambra, NON verde",
      reports: [yes(25), yes(30), yes(35), no(12), no(13), no(14), yes(1)],
      state: State.AMBER,
      flags: Flag.NONE,
      conf: 1,
    },
    {
      name: "A) rosso + 3 'c'è' nuovi da reti diverse → verde",
      reports: [yes(25), yes(30), yes(35), no(12), no(13), no(14), yes(1), yes(2), yes(3)],
      state: State.GREEN,
      conf: 3,
    },
    // ADR-0011 B — scadenza del rosso dopo 90' senza nuove assenze.
    {
      name: "B) rosso con ultima assenza 89' fa → ancora rosso",
      reports: [no(89), no(95), no(100)],
      state: State.RED,
    },
    {
      name: "B) rosso con ultima assenza 91' fa → ambra 'esaurito tempo fa, da verificare'",
      reports: [no(91), no(95), no(100)],
      state: State.AMBER,
      flags: Flag.RED_EXPIRED,
    },
    {
      name: "B) rosso di 7 ore fa → ambra, mai più rosso",
      reports: [no(420), no(421), no(422)],
      state: State.AMBER,
      flags: Flag.RED_EXPIRED,
    },
    // ADR-0011 C — rosso in verifica: assenze tutte negli ultimi 10'.
    {
      name: "C) 3 assenze in 3 minuti → ambra 'rosso in verifica'",
      reports: [no(1), no(2), no(3)],
      state: State.AMBER,
      flags: Flag.RED_PENDING,
    },
    {
      name: "C) 3 assenze distribuite su 10 minuti → rosso",
      reports: [no(2), no(5), no(10)],
      state: State.RED,
    },
    {
      name: "C) rosso in verifica + 1 'c'è' → ambra semplice (la verifica ha funzionato)",
      reports: [no(3), no(4), no(5), yes(1)],
      state: State.AMBER,
      flags: Flag.NONE,
    },
    {
      name: "assenze vecchie superate da conferme recenti → verde",
      reports: [no(30), no(35), no(40), yes(10), yes(12), yes(14)],
      state: State.GREEN,
      conf: 3,
    },
    {
      name: "lo stesso segnalatore che cambia idea conta una volta sola",
      reports: [yes(20, { rkey: "a", pkey: "a" }), yes(25), no(5, { rkey: "a", pkey: "a" })],
      state: State.AMBER,
      flags: Flag.SINGLE_ABSENCE,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const out = computeState(c.reports, NOW);
      expect(out.state).toBe(c.state);
      if (c.flags !== undefined) expect(out.flags).toBe(c.flags);
      if (c.conf !== undefined) expect(out.confirmations).toBe(c.conf);
    });
  }
});

describe("computeState — proprietà anti-abuso", () => {
  it("una sola rete non porta MAI a verde, qualunque sia il numero di token", () => {
    for (let n = 1; n <= 50; n++) {
      const sybil = Array.from({ length: n }, (_, i) => yes(i % 40, { pkey: "attacker" }));
      expect(computeState(sybil, NOW).state).not.toBe(State.GREEN);
    }
  });

  it("una sola rete non porta MAI a rosso", () => {
    for (let n = 1; n <= 50; n++) {
      const sybil = Array.from({ length: n }, (_, i) => no(i % 40, { pkey: "attacker" }));
      expect(computeState(sybil, NOW).state).not.toBe(State.RED);
    }
  });

  it("nemmeno DUE reti, con qualunque numero di token, portano a verde o a rosso", () => {
    for (let n = 1; n <= 50; n++) {
      const pos = Array.from({ length: n }, (_, i) => yes(i % 40, { pkey: i % 2 ? "a" : "b" }));
      const neg = Array.from({ length: n }, (_, i) => no(i % 40, { pkey: i % 2 ? "a" : "b" }));
      expect(computeState(pos, NOW).state).not.toBe(State.GREEN);
      expect(computeState(neg, NOW).state).not.toBe(State.RED);
    }
  });

  it("dopo un rosso, UNA conferma non porta mai a verde, comunque fossero le conferme precedenti", () => {
    for (let before = 0; before <= 10; before++) {
      const old = Array.from({ length: before }, (_, i) => yes(20 + i));
      const red = [no(15), no(16), no(17)];
      expect(computeState([...old, ...red], NOW).state).toBe(State.RED);
      expect(computeState([...old, ...red, yes(1)], NOW).state).toBe(State.AMBER);
    }
  });

  it("le tutele del gestore non trasformano mai un rosso in verde", () => {
    for (let age = 0; age <= 8 * 60; age += 7) {
      const out = computeState([no(age), no(age + 1), no(age + 2)], NOW);
      expect(out.state).not.toBe(State.GREEN);
    }
  });

  it("aggiungere una conferma fresca da una rete nuova non peggiora mai lo stato verde", () => {
    const base = [yes(10), yes(20), yes(30)];
    expect(computeState(base, NOW).state).toBe(State.GREEN);
    expect(computeState([...base, yes(1)], NOW).state).toBe(State.GREEN);
  });
});
