// Politica regionale come test (ADR-0012): i dati di QUI stanno solo nell'UE.
// wrangler non permette di dichiarare la giurisdizione dei Durable Objects, quindi si controlla qui
// la configurazione di ogni ambiente di deploy. Se aggiungi un binding che salva dati, questo test
// ti obbliga a decidere dove li salva prima che arrivi in produzione.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface WranglerConfig {
  readonly vars?: Record<string, string>;
  readonly env?: Record<string, WranglerConfig>;
  readonly observability?: { readonly enabled?: boolean };
  readonly logpush?: boolean;
  readonly tail_consumers?: readonly unknown[];
  readonly r2_buckets?: ReadonlyArray<{ readonly jurisdiction?: string }>;
  readonly [key: string]: unknown;
}

/** JSONC → JSON. Le stringhe si copiano intere: "/api/*" contiene "/*" ma non è un commento. */
function stripJsonc(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const config = JSON.parse(
  stripJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")),
) as WranglerConfig;

// La radice è la produzione; ogni env.* è un altro deploy. vars e binding NON si ereditano.
const targets: Array<[string, WranglerConfig]> = [
  ["produzione", config],
  ...Object.entries(config.env ?? {}),
];

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

    it(`${name}: nessun log persistente (NFR-PR6)`, () => {
      expect(t.observability?.enabled ?? false).toBe(false);
      expect(t.logpush ?? false).toBe(false);
      expect(t.tail_consumers ?? []).toHaveLength(0);
    });
  }
});
