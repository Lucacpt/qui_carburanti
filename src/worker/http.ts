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

export async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "richiesta troppo grande");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON non valido");
  }
}
