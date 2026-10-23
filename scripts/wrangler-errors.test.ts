import { describe, expect, it } from "vitest";
import { isWorkerMissing } from "./wrangler-errors.ts";

describe("isWorkerMissing", () => {
  it.each([
    // Messaggio reale di wrangler 4.151 al primo deploy in CI (2026-10-23).
    [
      '✘ [ERROR] Worker "qui-staging" (env: staging) not found.\n\n  If this is a new Worker, run `wrangler deploy` first to create it.',
    ],
    ['✘ [ERROR] Worker "qui" not found.'],
    ["This Worker does not exist on your account. [code: 10007]"],
  ])("Worker assente: %s", (out) => {
    expect(isWorkerMissing(out)).toBe(true);
  });

  it.each([
    [
      "✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable",
    ],
    ["Authentication error [code: 10000]"],
    ["✘ [ERROR] A request to the Cloudflare API failed. Account not found."],
    ["fetch failed: getaddrinfo ENOTFOUND api.cloudflare.com"],
  ])("altro errore, il deploy si ferma: %s", (out) => {
    expect(isWorkerMissing(out)).toBe(false);
  });
});
