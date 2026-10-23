// Verifica del token di Cloudflare Access per l'area admin (ADR-0013).
// Access protegge /admin al bordo; il Worker ricontrolla la firma a ogni richiesta: se Access fosse
// configurato male (percorso dimenticato, policy troppo larga), le API admin restano chiuse.
// Solo WebCrypto: si testa in Node con chiavi generate al volo.

export interface AccessConfig {
  /** Es. "qui-admin.cloudflareaccess.com" */
  readonly teamDomain: string;
  /** "Application Audience (AUD) tag" dell'applicazione Access. */
  readonly aud: string;
  /** Email ammesse, in minuscolo. Vuoto = nessuno (fail-closed). */
  readonly emails: readonly string[];
}

export interface Jwk {
  readonly kid: string;
  readonly kty: string;
  readonly n: string;
  readonly e: string;
}

export type AccessCheck = { ok: true; email: string } | { ok: false; error: string };

/** Margine per gli orologi non perfettamente allineati. */
const SKEW_S = 60;

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Legge la configurazione dalle variabili; `null` se manca qualcosa (l'area admin resta chiusa). */
export function accessConfig(env: {
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
  readonly ADMIN_EMAILS?: string;
}): AccessConfig | null {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const aud = env.ACCESS_AUD?.trim() ?? "";
  const emails = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain) || !aud || emails.length === 0) {
    return null;
  }
  return { teamDomain, aud, emails };
}

export async function verifyAccessJwt(
  token: string,
  cfg: AccessConfig,
  keys: readonly Jwk[],
  now: number,
): Promise<AccessCheck> {
  const parts = token.split(".");
  const [h, p, s] = parts;
  if (parts.length !== 3 || !h || !p || !s) return { ok: false, error: "token malformato" };
  const header = decodeJson(h);
  const payload = decodeJson(p);
  if (!header || !payload) return { ok: false, error: "token illeggibile" };
  if (header.alg !== "RS256") return { ok: false, error: "algoritmo non ammesso" };

  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) return { ok: false, error: "chiave sconosciuta" };
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${h}.${p}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), signed))) {
    return { ok: false, error: "firma non valida" };
  }

  const nowS = Math.floor(now / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://${cfg.teamDomain}`) return { ok: false, error: "emittente errato" };
  if (!auds.includes(cfg.aud)) return { ok: false, error: "applicazione errata" };
  if (typeof payload.exp !== "number" || payload.exp + SKEW_S < nowS) {
    return { ok: false, error: "token scaduto" };
  }
  if (typeof payload.nbf === "number" && payload.nbf - SKEW_S > nowS) {
    return { ok: false, error: "token non ancora valido" };
  }
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!cfg.emails.includes(email)) return { ok: false, error: "utente non ammesso" };
  return { ok: true, email };
}
