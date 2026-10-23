import type { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { type AccessConfig, accessConfig, type Jwk, verifyAccessJwt } from "./access.ts";

type CryptoKey = webcrypto.CryptoKey;

const NOW = Date.UTC(2026, 9, 24, 10, 0, 0);
const CFG: AccessConfig = {
  teamDomain: "qui-admin.cloudflareaccess.com",
  aud: "aud-di-prova",
  emails: ["admin@esempio.it"],
};

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let keys: Jwk[];
let privateKey: CryptoKey;
let otherKey: CryptoKey;

async function rsa() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
}

beforeAll(async () => {
  const pair = await rsa();
  privateKey = pair.privateKey;
  otherKey = (await rsa()).privateKey;
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  keys = [{ kid: "k1", kty: "RSA", n: pub.n ?? "", e: pub.e ?? "" }];
});

async function token(
  over: Record<string, unknown> = {},
  opts: { key?: CryptoKey; alg?: string } = {},
) {
  const head = enc({ alg: opts.alg ?? "RS256", kid: "k1" });
  const body = enc({
    iss: `https://${CFG.teamDomain}`,
    aud: [CFG.aud],
    email: "Admin@Esempio.it",
    exp: NOW / 1000 + 3600,
    nbf: NOW / 1000 - 10,
    ...over,
  });
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    opts.key ?? privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

describe("verifyAccessJwt", () => {
  it("accetta un token valido dell'admin (email senza distinzione di maiuscole)", async () => {
    expect(await verifyAccessJwt(await token(), CFG, keys, NOW)).toEqual({
      ok: true,
      email: "admin@esempio.it",
    });
  });

  const cases: Array<[string, Record<string, unknown>, { otherKey?: true; alg?: string }, string]> =
    [
      ["firma di un'altra chiave", {}, { otherKey: true }, "firma non valida"],
      ["altra applicazione Access", { aud: ["altra"] }, {}, "applicazione errata"],
      ["altro team", { iss: "https://altro.cloudflareaccess.com" }, {}, "emittente errato"],
      ["token scaduto", { exp: NOW / 1000 - 3600 }, {}, "token scaduto"],
      ["utente non in elenco", { email: "intruso@esempio.it" }, {}, "utente non ammesso"],
      ["algoritmo 'none'", {}, { alg: "none" }, "algoritmo non ammesso"],
    ];
  it.each(cases)("rifiuta: %s", async (_name, over, opts, error) => {
    const t = await token(over, {
      ...(opts.otherKey ? { key: otherKey } : {}),
      ...(opts.alg ? { alg: opts.alg } : {}),
    });
    expect(await verifyAccessJwt(t, CFG, keys, NOW)).toEqual({ ok: false, error });
  });

  it("rifiuta token malformati o con chiave sconosciuta", async () => {
    expect((await verifyAccessJwt("a.b", CFG, keys, NOW)).ok).toBe(false);
    expect((await verifyAccessJwt(await token(), CFG, [], NOW)).ok).toBe(false);
  });
});

describe("accessConfig", () => {
  it("senza tutti i valori l'area admin resta chiusa", () => {
    expect(accessConfig({})).toBeNull();
    expect(
      accessConfig({ ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com", ACCESS_AUD: "a" }),
    ).toBeNull();
    expect(
      accessConfig({
        ACCESS_TEAM_DOMAIN: "evil.example.com",
        ACCESS_AUD: "a",
        ADMIN_EMAILS: "a@b.it",
      }),
    ).toBeNull();
  });

  it("legge team, aud ed email (normalizzate)", () => {
    expect(
      accessConfig({
        ACCESS_TEAM_DOMAIN: "qui-admin.cloudflareaccess.com",
        ACCESS_AUD: "abc",
        ADMIN_EMAILS: " Admin@Esempio.it , ",
      }),
    ).toEqual({
      teamDomain: "qui-admin.cloudflareaccess.com",
      aud: "abc",
      emails: ["admin@esempio.it"],
    });
  });
});
