import { describe, expect, it } from "vitest";
import { createChallenge, POW_TTL_MS, requireSecret, solveChallenge, verifyPow } from "./pow.ts";

const SECRET = "segreto-di-test";
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

async function solved(prov = "AV", now = NOW) {
  const c = await createChallenge(SECRET, prov, now, 300);
  return { c, payload: await solveChallenge(c) };
}

describe("proof-of-work", () => {
  it("una soluzione corretta viene accettata", async () => {
    const { payload, c } = await solved();
    const v = await verifyPow(SECRET, payload, "AV", NOW + 1000);
    expect(v).toEqual({ ok: true, signature: c.signature, expiresMs: expect.any(Number) });
  });

  it("rifiuta una sfida di un'altra provincia", async () => {
    const { payload } = await solved("AV");
    expect((await verifyPow(SECRET, payload, "BN", NOW)).ok).toBe(false);
  });

  it("rifiuta una soluzione scaduta", async () => {
    const { payload } = await solved();
    expect((await verifyPow(SECRET, payload, "AV", NOW + POW_TTL_MS + 1000)).ok).toBe(false);
  });

  it("rifiuta una sfida firmata con un altro segreto (sfide fabbricate dal client)", async () => {
    const { payload } = await solved();
    expect((await verifyPow("altro-segreto", payload, "AV", NOW)).ok).toBe(false);
  });

  it("rifiuta un numero sbagliato", async () => {
    const { payload } = await solved();
    const sol = JSON.parse(atob(payload)) as { number: number };
    const wrong = btoa(JSON.stringify({ ...sol, number: sol.number + 1 }));
    expect((await verifyPow(SECRET, wrong, "AV", NOW)).ok).toBe(false);
  });

  it("si rifiuta di funzionare senza un segreto robusto (secret dimenticato in produzione)", () => {
    expect(() => requireSecret(undefined)).toThrow();
    expect(() => requireSecret("corto")).toThrow();
    expect(requireSecret("x".repeat(32))).toHaveLength(32);
  });

  it("rifiuta payload illeggibili", async () => {
    expect((await verifyPow(SECRET, "%%%", "AV", NOW)).ok).toBe(false);
    expect((await verifyPow(SECRET, btoa("{}"), "AV", NOW)).ok).toBe(false);
  });
});
