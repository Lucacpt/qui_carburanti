import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, withSecurityHeaders } from "./headers.ts";

describe("header di sicurezza", () => {
  it("connect-src resta 'self': il browser non può inviare dati a terzi (NFR-PR4)", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("connect-src 'self';");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("default-src 'none'");
  });

  it("vengono applicati alle risposte del Worker senza perdere status e body", async () => {
    const res = withSecurityHeaders(new Response("ok", { status: 201 }));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("ok");
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
  });

  it("public/_headers contiene gli stessi header per gli asset statici", () => {
    const file = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(file).toContain(`  ${k}: ${v}\n`);
  });
});
