import { describe, expect, it } from "vitest";
import { parseContest, parseReport } from "./input.ts";

const P = ["AV"];
const ok = { p: "AV", id: 12345, f: "B", h: 1, n: 1, tk: "AAAAAAAAAAAAAAAAAAAAAA", pow: "eyJ9" };

describe("parseReport", () => {
  it("accetta una segnalazione valida", () => {
    const r = parseReport({ ...ok, q: 3, lim: 1 }, P);
    expect(r).toEqual({
      ok: true,
      value: {
        prov: "AV",
        id: 12345,
        fuel: "B",
        has: true,
        near: true,
        queue: 3,
        limit: true,
        token: ok.tk,
        pow: ok.pow,
      },
    });
  });

  it("RIFIUTA qualsiasi campo non previsto, a partire dalle coordinate (NFR-PR1)", () => {
    for (const extra of [{ lat: 40.9 }, { lon: 14.8 }, { latitude: 1 }, { ua: "x" }]) {
      const r = parseReport({ ...ok, ...extra }, P);
      expect(r.ok).toBe(false);
    }
  });

  it.each([
    ["provincia non attiva", { p: "NA" }],
    ["id non intero", { id: 1.5 }],
    ["carburante sconosciuto", { f: "X" }],
    ["h non binario", { h: 2 }],
    ["token corto", { tk: "abc" }],
    ["pow vuoto", { pow: "" }],
    ["coda con assenza", { h: 0, q: 2 }],
    ["limite con assenza", { h: 0, lim: 1 }],
    ["coda fuori scala", { q: 4 }],
  ])("rifiuta: %s", (_name, patch) => {
    expect(parseReport({ ...ok, ...patch }, P).ok).toBe(false);
  });

  it("rifiuta body che non sono oggetti", () => {
    for (const b of [null, [], "x", 3]) expect(parseReport(b, P).ok).toBe(false);
  });
});

describe("parseContest", () => {
  const base = { p: "AV", id: 12345, reason: "has_fuel", pow: "eyJ9" };

  it("accetta una contestazione e pulisce il contatto", () => {
    const r = parseContest({ ...base, contact: "  gestore@example.org\u0007 " }, P);
    expect(r.ok && r.value.contact).toBe("gestore@example.org");
  });

  it("rifiuta motivi sconosciuti e contatti troppo lunghi", () => {
    expect(parseContest({ ...base, reason: "spam" }, P).ok).toBe(false);
    expect(parseContest({ ...base, contact: "x".repeat(121) }, P).ok).toBe(false);
  });
});
