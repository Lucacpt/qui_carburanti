import { describe, expect, it } from "vitest";
import { ago, clock, describeState, shortAge } from "./labels.ts";
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
    evidence: [],
    ...over,
  };
}

describe("ago", () => {
  it.each([
    [0, "proprio ora"],
    [12, "12 min fa"],
    [60, "1 h fa"],
    [135, "2 h 15 min fa"],
  ])("%i minuti → %s", (m, text) => {
    expect(ago(min(m), NOW)).toBe(text);
  });
});

describe("shortAge", () => {
  it("compatta per la lista: ora, minuti con l'apice, ore intere", () => {
    expect(shortAge(null, NOW)).toBe("");
    expect(shortAge(min(0), NOW)).toBe("ora");
    expect(shortAge(min(12), NOW)).toBe("12′");
    expect(shortAge(min(59), NOW)).toBe("59′");
    expect(shortAge(min(135), NOW)).toBe("2 h");
  });
});

describe("clock", () => {
  // NOW = 12:00 UTC del 22 ottobre 2026 = 14:00 in Italia (ora legale)
  it("usa il fuso italiano e dice oggi, ieri o la data", () => {
    expect(clock(min(30), NOW)).toBe("oggi alle 13:30");
    expect(clock(Date.UTC(2026, 9, 21, 20, 10), NOW)).toBe("ieri alle 22:10");
    expect(clock(Date.UTC(2026, 9, 19, 7, 5), NOW)).toBe("il 2026-10-19 alle 09:05");
  });
});

describe("describeState", () => {
  it("grigio con una disponibilità recente: lo dice, con l'orario, senza diventare verde", () => {
    const l = describeState(result({ state: State.GREY }), NOW, Date.UTC(2026, 9, 21, 20, 10));
    expect(l.title).toBe("Nessuna informazione recente");
    expect(l.detail).toBe("ultima disponibilità segnalata ieri alle 22:10");
    expect(l.operatorLink).toBe(false);
  });

  it("l'ultima disponibilità si mostra solo sul grigio, mai sopra uno stato attuale", () => {
    const red = result({ state: State.RED, absences: 3, lastAbsenceMs: min(12) });
    expect(describeState(red, NOW, min(600)).title).toBe("Segnalato esaurito");
  });

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

  it("indicazione di QUI: attribuita a QUI, mai agli utenti, con l'età", () => {
    const green = describeState(
      result({ state: State.GREEN, flags: Flag.OFFICIAL, lastConfirmMs: min(20) }),
      NOW,
    );
    expect(green).toEqual({
      title: "Disponibile secondo QUI",
      detail: "indicazione di QUI 20 min fa",
      operatorLink: false,
    });
    const red = describeState(
      result({ state: State.RED, flags: Flag.OFFICIAL, lastConfirmMs: min(3) }),
      NOW,
    );
    expect(red.title).toBe("Segnalato esaurito da QUI");
    expect(red.operatorLink).toBe(true);
    expect(`${green.title} ${red.title}`).not.toMatch(/utenti/);
  });

  it("nessun testo afferma come fatto che un distributore 'è esaurito' o 'non ha carburante'", () => {
    const all: StateResult[] = [
      result({ state: State.GREY }),
      result({ state: State.RED, absences: 3, lastAbsenceMs: min(1) }),
      result({ state: State.GREEN, confirmations: 3, lastConfirmMs: min(1) }),
      result({ state: State.GREEN, flags: Flag.OFFICIAL, lastConfirmMs: min(5) }),
      result({ state: State.RED, flags: Flag.OFFICIAL, lastConfirmMs: min(5) }),
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
