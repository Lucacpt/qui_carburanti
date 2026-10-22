// Proof-of-work in formato ALTCHA (SDD §6.2), implementato senza dipendenze.
// La sfida è firmata con HMAC: il server non conserva stato finché non arriva la soluzione.

import { hmacHex, randomHex, safeEqual, sha256Hex } from "./crypto.ts";

export const POW_TTL_MS = 5 * 60_000;
const MIN_SECRET_LENGTH = 32;

/**
 * Senza un segreto robusto chiunque potrebbe fabbricare sfide già risolte: meglio fermare il servizio.
 * (Un secret dimenticato in produzione diventerebbe la stringa "undefined", nota a tutti.)
 */
export function requireSecret(secret: string | undefined): string {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error("POW_SECRET mancante o troppo corto");
  }
  return secret;
}

export interface Challenge {
  readonly algorithm: "SHA-256";
  readonly challenge: string;
  readonly salt: string;
  readonly maxnumber: number;
  readonly signature: string;
}

export async function createChallenge(
  secret: string,
  prov: string,
  now: number,
  maxNumber: number,
): Promise<Challenge> {
  const expires = Math.floor((now + POW_TTL_MS) / 1000);
  const salt = `${randomHex(12)}?p=${encodeURIComponent(prov)}&expires=${expires}`;
  const number = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % (maxNumber + 1);
  const challenge = await sha256Hex(`${salt}${number}`);
  return {
    algorithm: "SHA-256",
    challenge,
    salt,
    maxnumber: maxNumber,
    signature: await hmacHex(secret, challenge),
  };
}

export type PowCheck =
  | { readonly ok: true; readonly signature: string; readonly expiresMs: number }
  | { readonly ok: false; readonly error: string };

export async function verifyPow(
  secret: string,
  payload: string,
  prov: string,
  now: number,
): Promise<PowCheck> {
  let sol: Record<string, unknown>;
  try {
    sol = JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "pow illeggibile" };
  }
  const { algorithm, challenge, number, salt, signature } = sol;
  if (
    algorithm !== "SHA-256" ||
    typeof challenge !== "string" ||
    typeof salt !== "string" ||
    typeof signature !== "string" ||
    typeof number !== "number" ||
    !Number.isInteger(number)
  ) {
    return { ok: false, error: "pow malformato" };
  }
  const params = new URLSearchParams(salt.split("?")[1] ?? "");
  const expiresMs = Number(params.get("expires")) * 1000;
  if (params.get("p") !== prov) return { ok: false, error: "pow di un'altra provincia" };
  if (!Number.isFinite(expiresMs) || expiresMs <= now) return { ok: false, error: "pow scaduto" };
  if (!safeEqual(await hmacHex(secret, challenge), signature)) {
    return { ok: false, error: "firma non valida" };
  }
  if (!safeEqual(await sha256Hex(`${salt}${number}`), challenge)) {
    return { ok: false, error: "soluzione errata" };
  }
  return { ok: true, signature, expiresMs };
}

/** Risolutore di riferimento (usato nei test; il client ne avrà uno equivalente in un Web Worker). */
export async function solveChallenge(c: Challenge): Promise<string> {
  for (let n = 0; n <= c.maxnumber; n++) {
    if ((await sha256Hex(`${c.salt}${n}`)) === c.challenge) {
      const sol = { algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt };
      return btoa(JSON.stringify({ ...sol, signature: c.signature }));
    }
  }
  throw new Error("nessuna soluzione");
}
