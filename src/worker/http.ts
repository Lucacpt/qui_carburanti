// Risposte JSON ed errori HTTP condivisi da API pubbliche e area admin.

import { withSecurityHeaders } from "./headers.ts";

const MAX_BODY_BYTES = 1024;

export const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  withSecurityHeaders(
    Response.json(data, { status, headers: { "Cache-Control": "no-store", ...extra } }),
  );

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * If-None-Match con confronto debole (RFC 9110 §13.1.2). Cloudflare, quando comprime, trasforma
 * l'ETag in W/"…" e il browser lo rimanda così: il confronto esatto non darebbe mai 304.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string | null): boolean {
  if (!ifNoneMatch || !etag) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  const target = opaque(etag);
  return ifNoneMatch.split(",").some((tag) => opaque(tag) === target);
}

export async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "richiesta troppo grande");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON non valido");
  }
}
