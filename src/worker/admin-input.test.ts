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
