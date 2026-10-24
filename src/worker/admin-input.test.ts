import { describe, expect, it } from "vitest";
import { parseAdminAction } from "./admin-input.ts";

const P = ["AV"];

describe("parseAdminAction", () => {
  it("accetta i comandi validi", () => {
    expect(parseAdminAction({ p: "AV", kind: "ack", ids: [1, 2] }, P)).toEqual({
      ok: true,
      value: { prov: "AV", cmd: { kind: "ack", ids: [1, 2] } },
    });
    expect(parseAdminAction({ p: "AV", kind: "readOnly", on: true }, P).ok).toBe(true);
    expect(parseAdminAction({ p: "AV", kind: "contest", id: 3, status: "closed" }, P).ok).toBe(
      true,
    );
    expect(parseAdminAction({ p: "AV", kind: "unfreeze", station: 1001 }, P).ok).toBe(true);
  });

  it("congelamento: al massimo 3 ore, nota ripulita e di lunghezza ragionevole", () => {
    const ok = parseAdminAction(
      {
        p: "AV",
        kind: "freeze",
        station: 1001,
        note: " Il gestore segnala:\nrifornimento ",
        hours: 2,
      },
      P,
    );
    expect(ok).toEqual({
      ok: true,
      value: {
        prov: "AV",
        cmd: { kind: "freeze", station: 1001, note: "Il gestore segnala: rifornimento", hours: 2 },
      },
    });
    expect(
      parseAdminAction({ p: "AV", kind: "freeze", station: 1, note: "ok!", hours: 4 }, P),
    ).toEqual({ ok: false, error: "al massimo 3 ore" });
    expect(
      parseAdminAction({ p: "AV", kind: "freeze", station: 1, note: "x", hours: 1 }, P).ok,
    ).toBe(false);
  });

  it("annullamento: da 1 a 200 segnalazioni, sempre con una motivazione", () => {
    expect(
      parseAdminAction({ p: "AV", kind: "annul", ids: [5, 6], reason: " spam	in serie " }, P),
    ).toEqual({
      ok: true,
      value: { prov: "AV", cmd: { kind: "annul", ids: [5, 6], reason: "spam in serie" } },
    });
    const bad = (o: object) => parseAdminAction({ p: "AV", kind: "annul", ...o }, P).ok;
    expect(bad({ ids: [], reason: "spam" })).toBe(false);
    expect(bad({ ids: Array.from({ length: 201 }, (_, i) => i + 1), reason: "spam" })).toBe(false);
    expect(bad({ ids: [1.5], reason: "spam" })).toBe(false);
    expect(bad({ ids: [1] })).toBe(false);
    expect(bad({ ids: [1], reason: "no" })).toBe(false);
  });

  it("stato impostato da QUI: verde o rosso, carburante o tutti, da 1 a 8 ore, con la fonte", () => {
    const cmd = { p: "AV", kind: "setState", station: 1001, fuel: "B", state: "green", hours: 2 };
    expect(parseAdminAction({ ...cmd, note: "Il gestore ha confermato per telefono" }, P)).toEqual({
      ok: true,
      value: {
        prov: "AV",
        cmd: {
          kind: "setState",
          station: 1001,
          fuel: "B",
          state: "green",
          note: "Il gestore ha confermato per telefono",
          hours: 2,
        },
      },
    });
    const ok = (o: object) => parseAdminAction({ ...cmd, note: "Verificato", ...o }, P).ok;
    expect(ok({ fuel: null, state: "red", hours: 8 })).toBe(true);
    expect(ok({ hours: 9 })).toBe(false);
    expect(ok({ hours: 0 })).toBe(false);
    expect(ok({ state: "amber" })).toBe(false);
    expect(ok({ fuel: "X" })).toBe(false);
    expect(ok({ note: "" })).toBe(false);
    expect(parseAdminAction({ p: "AV", kind: "clearState", station: 1001 }, P).ok).toBe(true);
  });

  it("rifiuta campi extra, comandi sconosciuti e province non attive", () => {
    expect(parseAdminAction({ p: "AV", kind: "readOnly", on: true, x: 1 }, P)).toEqual({
      ok: false,
      error: "campo non ammesso: x",
    });
    expect(parseAdminAction({ p: "AV", kind: "drop_table" }, P).ok).toBe(false);
    expect(parseAdminAction({ p: "AV", kind: "toString" }, P).ok).toBe(false);
    expect(parseAdminAction({ p: "AV", kind: "__proto__" }, P).ok).toBe(false);
    expect(parseAdminAction({ p: "NA", kind: "readOnly", on: true }, P).ok).toBe(false);
    expect(parseAdminAction({ p: "AV", kind: "contest", id: 3, status: "deleted" }, P).ok).toBe(
      false,
    );
    expect(parseAdminAction([], P).ok).toBe(false);
  });
});
