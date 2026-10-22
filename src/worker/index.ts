// Entry point del Worker. Gli asset statici sono serviti da Cloudflare senza passare di qui;
// il Worker riceve solo /api/* (vedi `run_worker_first` in wrangler.jsonc).

import { withSecurityHeaders } from "./headers.ts";

export interface Env {
  readonly ASSETS: Fetcher;
}

export default {
  async fetch(request, _env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return withSecurityHeaders(Response.json({ ok: true }));
    }
    return withSecurityHeaders(Response.json({ error: "not_found" }, { status: 404 }));
  },
} satisfies ExportedHandler<Env>;
