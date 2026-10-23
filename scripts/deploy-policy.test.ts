// Regole di deploy come test (SDD §12, docs/procedure/rilascio.md). wrangler eredita alcune chiavi
// tra ambienti (routes, workers_dev) e non altre (vars, binding): un errore qui manderebbe lo staging
// sul dominio di produzione, o un ambiente senza Durable Objects.

import { describe, expect, it } from "vitest";
import { config, targets } from "./wrangler-config.ts";

const PRODUCTION_DOMAIN = "quicarburanti.it";
const envs = Object.entries(config.env ?? {});
const names = (list: ReadonlyArray<{ readonly name: string }> | undefined) =>
  (list ?? []).map((b) => b.name).sort();

describe("regole di deploy (wrangler.jsonc)", () => {
  it("produzione solo sul dominio, come custom domain", () => {
    expect(config.routes).toEqual([{ pattern: PRODUCTION_DOMAIN, custom_domain: true }]);
  });

  it("esiste un ambiente di staging", () => {
    expect(config.env?.staging).toBeDefined();
  });

  for (const [name, t] of targets) {
    it(`${name}: niente *.workers.dev né URL di anteprima (condividerebbero i dati)`, () => {
      expect(t.workers_dev ?? config.workers_dev).toBe(false);
      expect(t.preview_urls ?? config.preview_urls).toBe(false);
    });
  }

  for (const [name, t] of envs) {
    it(`${name}: routes proprie, mai il dominio di produzione`, () => {
      expect(t.routes, "routes si eredita: senza, userebbe il dominio di produzione").toBeDefined();
      for (const r of t.routes ?? []) expect(r.pattern).not.toBe(PRODUCTION_DOMAIN);
    });

    it(`${name}: stessi binding e variabili della produzione (non si ereditano)`, () => {
      expect(names(t.durable_objects?.bindings)).toEqual(names(config.durable_objects?.bindings));
      expect(names(t.ratelimits)).toEqual(names(config.ratelimits));
      expect(Object.keys(t.vars ?? {}).sort()).toEqual(Object.keys(config.vars ?? {}).sort());
    });

    it(`${name}: contatori del rate limit separati dalla produzione`, () => {
      const prod = new Set((config.ratelimits ?? []).map((r) => r.namespace_id));
      for (const r of t.ratelimits ?? []) expect(prod.has(r.namespace_id)).toBe(false);
    });
  }
});
