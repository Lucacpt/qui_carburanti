// Entry point del Worker. Gli asset statici sono serviti da Cloudflare senza passare di qui;
// il Worker riceve solo /api/* (vedi `run_worker_first` in wrangler.jsonc). API: SDD §9.

import { parseContest, parseReport } from "../domain/input.ts";
import type { Env } from "./env.ts";
import { withSecurityHeaders } from "./headers.ts";
import { anonymousKeys } from "./identity.ts";
import { createChallenge, requireSecret, verifyPow } from "./pow.ts";

export { KeyDO } from "./do/keys.ts";
export { ProvinceDO } from "./do/province.ts";

const MAX_BODY_BYTES = 1024;
const SNAPSHOT_RE = /^\/api\/s\/([A-Z]{2})$/;

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  withSecurityHeaders(
    Response.json(data, { status, headers: { "Cache-Control": "no-store", ...extra } }),
  );

const provinces = (env: Env) =>
  env.PROVINCES.split(",")
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * In produzione segnalazioni e chiave del giorno restano in UE (giurisdizione "eu"), come dice
 * l'informativa privacy. In locale workerd non supporta le giurisdizioni.
 */
function located<T extends Rpc.DurableObjectBranded | undefined>(
  env: Env,
  ns: DurableObjectNamespace<T>,
): DurableObjectNamespace<T> {
  const j = env.DO_JURISDICTION;
  return j && j !== "none" ? ns.jurisdiction(j as DurableObjectJurisdiction) : ns;
}

function province(env: Env, prov: string) {
  const ns = located(env, env.PROVINCE);
  return ns.get(ns.idFromName(prov));
}

let dayKeyCache: { day: string; key: string } | undefined;
async function dayKey(env: Env, now: number): Promise<string> {
  const today = new Date(now).toISOString().slice(0, 10);
  if (dayKeyCache?.day !== today) {
    const ns = located(env, env.KEYS);
    dayKeyCache = await ns.get(ns.idFromName("global")).dayKey();
  }
  return dayKeyCache.key;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "richiesta troppo grande");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON non valido");
  }
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const now = Date.now();
  const method = request.method;

  if (url.pathname === "/api/health") return json({ ok: true });

  if (url.pathname === "/api/challenge" && method === "GET") {
    const prov = url.searchParams.get("p") ?? "";
    if (!provinces(env).includes(prov)) throw new HttpError(400, "provincia non valida");
    return json(
      await createChallenge(requireSecret(env.POW_SECRET), prov, now, Number(env.POW_MAX)),
    );
  }

  if (url.pathname === "/api/report" && method === "POST") {
    const parsed = parseReport(await readJson(request), provinces(env));
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    const r = parsed.value;
    const pow = await verifyPow(requireSecret(env.POW_SECRET), r.pow, r.prov, now);
    if (!pow.ok) throw new HttpError(400, pow.error);
    const keys = await anonymousKeys(request, await dayKey(env, now), r.token);
    // Limite grossolano per rete: oltre la soglia si scarta in silenzio (CGNAT ⇒ soglia alta).
    const { success } = await env.RL_REPORT.limit({ key: keys.pkey });
    if (!success) return json({ ok: true }, 202);
    const status = await province(env, r.prov).report(r.prov, {
      id: r.id,
      fuel: r.fuel,
      has: r.has,
      near: r.near,
      queue: r.queue,
      limit: r.limit,
      rkey: keys.rkey,
      pkey: keys.pkey,
      powSig: pow.signature,
      powExpiresMs: pow.expiresMs,
    });
    if (status === "invalid_station")
      throw new HttpError(400, "distributore o carburante non valido");
    if (status === "read_only") {
      return json({ ok: false, error: "Segnalazioni sospese temporaneamente" }, 503);
    }
    return json({ ok: true }, 202);
  }

  if (url.pathname === "/api/contest" && method === "POST") {
    const parsed = parseContest(await readJson(request), provinces(env));
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    const pow = await verifyPow(
      requireSecret(env.POW_SECRET),
      parsed.value.pow,
      parsed.value.prov,
      now,
    );
    if (!pow.ok) throw new HttpError(400, pow.error);
    const res = await province(env, parsed.value.prov).contest(parsed.value.prov, parsed.value);
    if (res === "invalid_station") throw new HttpError(400, "distributore non valido");
    return json({ ok: true }, 202);
  }

  const snap = SNAPSHOT_RE.exec(url.pathname);
  if (snap?.[1] && method === "GET") {
    const prov = snap[1];
    if (!provinces(env).includes(prov)) throw new HttpError(404, "provincia non attiva");
    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/api/s/${prov}`);
    let res = await cache.match(cacheKey);
    if (!res) {
      const { body, etag } = await province(env, prov).snapshot(prov);
      res = withSecurityHeaders(
        new Response(body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
            ETag: etag,
          },
        }),
      );
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    if (request.headers.get("If-None-Match") === res.headers.get("ETag")) {
      return withSecurityHeaders(new Response(null, { status: 304, headers: res.headers }));
    }
    return res;
  }

  throw new HttpError(404, "non trovato");
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      // Niente log: l'errore potrebbe contenere dati della richiesta (NFR-PR6).
      if (err instanceof HttpError) return json({ ok: false, error: err.message }, err.status);
      const detail = env.DEV_ERRORS === "1" ? { detail: String(err) } : {};
      return json({ ok: false, error: "errore interno", ...detail }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
