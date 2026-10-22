import { describe, expect, it } from "vitest";
import { ago, describeState } from "./labels.ts";
import { Flag, State, type StateResult } from "./types.ts";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const min = (m: number) => NOW - m * 60_000;

function result(over: Partial<StateResult>): StateResult {
  return {
    state: State.AMBER,
    confirmations: 0,
    lastConfirmMs: null,
    absences: 0,
    lastAbsenceMs: null,
    flags: Flag.NONE,
    ...over,
  };
}

describe("ago", () => {
  it.each([
    [0, "adesso"],
    [12, "12 min fa"],
    [60, "1 h fa"],
    [135, "2 h 15 min fa"],
  ])("%i minuti → %s", (m, text) => {
    expect(ago(min(m), NOW)).toBe(text);
  });
});

describe("describeState", () => {
  it("rosso: riporta quante persone e quando, e mostra il link per il gestore", () => {
    const l = describeState(result({ state: State.RED, absences: 3, lastAbsenceMs: min(12) }), NOW);
    expect(l.title).toBe("Segnalato esaurito");
    expect(l.detail).toBe("da 3 persone · ultima segnalazione 12 min fa");
    expect(l.operatorLink).toBe(true);
  });

  it("rosso scaduto: dice che potrebbe essere stato rifornito", () => {
    const l = describeState(
      result({ flags: Flag.RED_EXPIRED, absences: 3, lastAbsenceMs: min(120) }),
      NOW,
    );
    expect(l.detail).toContain("2 h fa");
    expect(l.detail).toContain("potrebbe essere stato rifornito");
  });

  it("verde: conferme e tempo, senza link per il gestore", () => {
    const l = describeState(
      result({ state: State.GREEN, confirmations: 4, lastConfirmMs: min(5) }),
      NOW,
    );
    expect(l.detail).toBe("4 conferme · ultima 5 min fa");
    expect(l.operatorLink).toBe(false);
  });

  it("ogni stato con assenze offre al gestore il link per segnalare un errore", () => {
    for (const flags of [Flag.RED_PENDING, Flag.RED_EXPIRED, Flag.CONTESTED, Flag.SINGLE_ABSENCE]) {
      const l = describeState(result({ flags, absences: 1, lastAbsenceMs: min(3) }), NOW);
      expect(l.operatorLink).toBe(true);
    }
  });

  it("nessun testo afferma come fatto che un distributore 'è esaurito' o 'non ha carburante'", () => {
    const all: StateResult[] = [
      result({ state: State.GREY }),
      result({ state: State.RED, absences: 3, lastAbsenceMs: min(1) }),
      result({ state: State.GREEN, confirmations: 3, lastConfirmMs: min(1) }),
      ...[Flag.NONE, Flag.RED_PENDING, Flag.RED_EXPIRED, Flag.CONTESTED, Flag.SINGLE_ABSENCE].map(
        (flags) =>
          result({
            flags,
            absences: 1,
            lastAbsenceMs: min(2),
            confirmations: 1,
            lastConfirmMs: min(9),
          }),
      ),
    ];
    for (const s of all) {
      const { title, detail } = describeState(s, NOW);
      const text = `${title} ${detail}`.toLowerCase();
      expect(text).not.toMatch(/(^|\s)(è esaurito|esaurito$|non ha carburante|chiuso)/);
      expect(title).not.toBe("Esaurito");
    }
  });
});
