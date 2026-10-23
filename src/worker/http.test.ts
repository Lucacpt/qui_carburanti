import { describe, expect, it } from "vitest";
import { etagMatches } from "./http.ts";

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
