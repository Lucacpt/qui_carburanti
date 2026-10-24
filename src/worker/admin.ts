// API dell'area admin (ADR-0013): /api/admin/*. Nessuna risposta senza un login Access verificato.
//   GET  /api/admin/overview?p=AV         avvisi, contestazioni, congelamenti, statistiche, registro
//   GET  /api/admin/history?p=AV&id=1234  storico anonimo di un impianto (30 giorni)
//   GET  /api/admin/reports?p=AV          segnalazioni delle ultime 8 ore, senza codici dei segnalatori
//   POST /api/admin/action                comandi (vedi admin-input.ts)

import { type AccessConfig, accessConfig, type Jwk, verifyAccessJwt } from "./access.ts";
import { parseAdminAction } from "./admin-input.ts";
import type { ProvinceDO } from "./do/province.ts";
import type { Env } from "./env.ts";
import { HttpError, json, notFound, readJson } from "./http.ts";

const JWKS_TTL_MS = 60 * 60_000;
const JWKS_RETRY_MS = 5 * 60_000;
const NOINDEX = { "X-Robots-Tag": "noindex, nofollow" };

let jwks: { team: string; at: number; keys: Jwk[] } | undefined;

/** Chiavi pubbliche del team Access (richiesta server-side a Cloudflare, non dal browser). */
async function accessKeys(team: string, now: number, force = false): Promise<Jwk[]> {
  if (!force && jwks?.team === team && now - jwks.at < JWKS_TTL_MS) return jwks.keys;
  const res = await fetch(new URL("/cdn-cgi/access/certs", `https://${team}`));
  if (!res.ok) throw new HttpError(503, "chiavi di Cloudflare Access non disponibili");
  const body = (await res.json()) as { keys?: Jwk[] };
  jwks = { team, at: now, keys: body.keys ?? [] };
  return jwks.keys;
}

/** Scorciatoia per `npm run dev`: mai valida in produzione (vedi scripts/region-policy.test.ts). */
function localDev(url: URL, env: Env): boolean {
  return (
    env.ADMIN_DEV === "1" &&
    env.DO_JURISDICTION === "none" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

async function requireAdmin(request: Request, env: Env, url: URL, now: number): Promise<void> {
  if (localDev(url, env)) return;
  const cfg: AccessConfig | null = accessConfig(env);
  if (!cfg) throw new HttpError(503, "area admin non configurata");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new HttpError(401, "accesso richiesto");
  let check = await verifyAccessJwt(token, cfg, await accessKeys(cfg.teamDomain, now), now);
  // Cloudflare ruota le chiavi: se il token usa una chiave nuova si ricaricano (al massimo ogni 5').
  if (!check.ok && check.error === "chiave sconosciuta" && jwks && now - jwks.at > JWKS_RETRY_MS) {
    check = await verifyAccessJwt(token, cfg, await accessKeys(cfg.teamDomain, now, true), now);
  }
  if (!check.ok) throw new HttpError(403, "accesso negato");
}

/**
 * Le azioni accettano solo JSON dalla nostra origine: un altro sito non può farle eseguire al
 * browser dell'admin sfruttando il cookie di Access (CSRF).
 */
function requireSameOrigin(request: Request, url: URL): void {
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.startsWith("application/json")) throw new HttpError(415, "serve JSON");
  if (request.headers.get("Origin") !== url.origin) throw new HttpError(403, "origine non ammessa");
}

export async function handleAdmin(
  request: Request,
  env: Env,
  url: URL,
  now: number,
  provinces: readonly string[],
  province: (prov: string) => DurableObjectStub<ProvinceDO>,
): Promise<Response> {
  try {
    await requireAdmin(request, env, url, now);
  } catch {
    // Chi non è autenticato non scopre nulla: né che l'area esiste, né perché è stato respinto
    // (configurazione mancante, token assente, firma o email non valide).
    return notFound(NOINDEX);
  }
  // Dopo il login i messaggi restano precisi: li legge solo l'admin.
  try {
    const prov = url.searchParams.get("p") ?? "";

    if (url.pathname === "/api/admin/overview" && request.method === "GET") {
      if (!provinces.includes(prov)) throw new HttpError(400, "provincia non valida");
      return json(await province(prov).adminOverview(), 200, NOINDEX);
    }

    if (url.pathname === "/api/admin/reports" && request.method === "GET") {
      if (!provinces.includes(prov)) throw new HttpError(400, "provincia non valida");
      return json(await province(prov).adminReports(), 200, NOINDEX);
    }

    if (url.pathname === "/api/admin/history" && request.method === "GET") {
      const id = Number(url.searchParams.get("id"));
      if (!provinces.includes(prov)) throw new HttpError(400, "provincia non valida");
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "impianto non valido");
      const h = await province(prov).adminHistory(prov, id);
      if (h === "invalid_station") throw new HttpError(404, "impianto sconosciuto");
      return json(h, 200, NOINDEX);
    }

    if (url.pathname === "/api/admin/action" && request.method === "POST") {
      requireSameOrigin(request, url);
      const parsed = parseAdminAction(await readJson(request, 4096), provinces);
      if (!parsed.ok) throw new HttpError(400, parsed.error);
      const res = await province(parsed.value.prov).adminAction(
        parsed.value.prov,
        parsed.value.cmd,
      );
      if (res === "not_found") throw new HttpError(404, "elemento non trovato");
      if (res === "invalid_station") throw new HttpError(404, "impianto sconosciuto");
      if (res === "invalid_fuel")
        throw new HttpError(400, "l'impianto non vende questo carburante");
      return json({ ok: true }, 200, NOINDEX);
    }

    throw new HttpError(404, "non trovato");
  } catch (err) {
    if (err instanceof HttpError)
      return json({ ok: false, error: err.message }, err.status, NOINDEX);
    throw err;
  }
}
