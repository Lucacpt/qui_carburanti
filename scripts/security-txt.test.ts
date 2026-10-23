// security.txt (RFC 9116) ha una scadenza obbligatoria: un file scaduto dice ai ricercatori che
// il canale non è più seguito. Questo test avvisa un mese prima.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = readFileSync(new URL("../public/.well-known/security.txt", import.meta.url), "utf8");
const field = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(text)?.[1]?.trim();

describe("public/.well-known/security.txt", () => {
  it("ha un contatto e una policy", () => {
    expect(field("Contact")).toMatch(/^https:\/\//);
    expect(field("Policy")).toMatch(/SECURITY\.md$/);
  });

  it("non scade nei prossimi 30 giorni (rinnovare Expires, al massimo di un anno)", () => {
    const expires = Date.parse(field("Expires") ?? "");
    const month = 30 * 24 * 60 * 60 * 1000;
    expect(expires - Date.now()).toBeGreaterThan(month);
    expect(expires - Date.now()).toBeLessThan(13 * month);
  });
});
