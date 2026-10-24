import { describe, expect, it } from "vitest";
import { etagMatches, forBrowser } from "./http.ts";

describe("forBrowser (lista degli stati)", () => {
  // Come la restituisce caches.default con il Browser Cache TTL della zona (produzione, 2026-10-24).
  const cached = () =>
    new Response('{"t":1}', {
      headers: {
        "Cache-Control": "public, max-age=14400",
        ETag: '"6b574a0d"',
        "X-Content-Type-Options": "nosniff",
      },
    });

  it("il browser ricontrolla sempre, senza perdere ETag e header di sicurezza", async () => {
    const res = forBrowser(cached());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("ETag")).toBe('"6b574a0d"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe('{"t":1}');
  });

  it("304 senza corpo", async () => {
    const res = forBrowser(cached(), 304);
    expect(res.status).toBe(304);
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toBe("");
  });
});

describe("etagMatches (If-None-Match, confronto debole)", () => {
  it.each([
    ['"68eb93c3"', '"68eb93c3"', true],
    // Staging, 2026-10-23: Cloudflare comprime in brotli e rimanda l'ETag indebolito.
    ['W/"68eb93c3"', '"68eb93c3"', true],
    ['"68eb93c3"', 'W/"68eb93c3"', true],
    ['W/"68eb93c3"', 'W/"68eb93c3"', true],
    ['"aaaa", W/"68eb93c3"', '"68eb93c3"', true],
    ["*", '"68eb93c3"', true],
    ['"00000000"', '"68eb93c3"', false],
    ['W/"68eb93c"', '"68eb93c3"', false],
    ["68eb93c3", '"68eb93c3"', false],
    [null, '"68eb93c3"', false],
    ['"68eb93c3"', null, false],
  ])("If-None-Match %s contro ETag %s → %s", (header, etag, expected) => {
    expect(etagMatches(header, etag)).toBe(expected);
  });
});
