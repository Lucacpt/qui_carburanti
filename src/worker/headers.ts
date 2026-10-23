// Header di sicurezza per OGNI risposta (SDD §6.3). Gli asset statici li ricevono da public/_headers;
// un test verifica che i due elenchi coincidano.

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}
