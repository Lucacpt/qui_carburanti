// Politica regionale come test (ADR-0012): i dati di QUI stanno solo nell'UE.
// wrangler non permette di dichiarare la giurisdizione dei Durable Objects, quindi si controlla qui
// la configurazione di ogni ambiente di deploy. Se aggiungi un binding che salva dati, questo test
// ti obbliga a decidere dove li salva prima che arrivi in produzione.

import { describe, expect, it } from "vitest";
import { stripJsonc, targets } from "./wrangler-config.ts";

// Archivi senza una giurisdizione UE dichiarabile in questo file: vietati finché non si verifica
// dove salvano i dati (e si aggiornano informativa, registro e questo elenco).
const UNVERIFIED_STORAGE = [
  "kv_namespaces",
  "d1_databases",
  "queues",
  "analytics_engine_datasets",
  "vectorize",
  "hyperdrive",
  "workflows",
];

describe("politica regionale UE (wrangler.jsonc)", () => {
  it("il parser JSONC non scambia per commenti i percorsi dentro le stringhe", () => {
    expect(JSON.parse(stripJsonc('{"a": ["/api/*"], // c\n "b": 1, /* x */}'))).toEqual({
      a: ["/api/*"],
      b: 1,
    });
  });

  for (const [name, t] of targets) {
    it(`${name}: Durable Objects in giurisdizione "eu"`, () => {
      expect(t.vars?.DO_JURISDICTION, `vars.DO_JURISDICTION in ${name}`).toBe("eu");
    });

    it(`${name}: nessun archivio senza garanzia UE`, () => {
      for (const key of UNVERIFIED_STORAGE) {
        expect(t[key], `${key} in ${name}: verifica la residenza dei dati`).toBeUndefined();
      }
      for (const bucket of t.r2_buckets ?? []) {
        expect(bucket.jurisdiction, `bucket R2 in ${name}`).toBe("eu");
      }
    });

    it(`${name}: area admin senza scorciatoie e senza email pubbliche (ADR-0013)`, () => {
      expect(t.vars?.ADMIN_DEV, "ADMIN_DEV vale solo in .dev.vars").toBeUndefined();
      expect(t.vars?.ADMIN_EMAILS, "ADMIN_EMAILS è un secret: wrangler secret put").toBeUndefined();
    });

    it(`${name}: nessun log persistente (NFR-PR6)`, () => {
      expect(t.observability?.enabled ?? false).toBe(false);
      expect(t.logpush ?? false).toBe(false);
      expect(t.tail_consumers ?? []).toHaveLength(0);
    });
  }
});
