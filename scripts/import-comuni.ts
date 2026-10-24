// Scarica da Wikidata (CC0) i comuni di una provincia con le coordinate e genera
// public/r/comuni-<PROV>.<hash>.json, indicato in public/r/manifest.json alla voce "comuni".
// Uso: node scripts/import-comuni.ts AV
// I comuni cambiano di rado (fusioni): si rilancia solo se validateTowns segnala un numero diverso.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  PROVINCE_TOWNS,
  type TownsFile,
  townsFromWikidata,
  validateTowns,
  type WikidataBinding,
} from "../src/domain/towns.ts";

const OUT = new URL("../public/r/", import.meta.url);
const SPARQL = "https://query.wikidata.org/sparql";

// Per codice ISTAT e senza filtrare il tipo: Montoro (fusione del 2013) su Wikidata non è
// classificato come gli altri comuni. Fuori i comuni soppressi: con una data di fine (P576) o
// "sostituito da" (P1366), come Montoro Inferiore e Superiore, che non hanno la P576.
const query = (istat: string) => `SELECT ?istat ?nome ?coord WHERE {
  ?c wdt:P635 ?istat; wdt:P625 ?coord.
  FILTER(STRSTARTS(?istat, "${istat}") && STRLEN(?istat) = 6)
  FILTER NOT EXISTS { ?c wdt:P576 ?fine }
  FILTER NOT EXISTS { ?c wdt:P1366 ?nuovo }
  ?c rdfs:label ?nome FILTER(LANG(?nome) = "it")
}`;

async function main() {
  const prov = (process.argv[2] ?? "").toUpperCase();
  const p = PROVINCE_TOWNS[prov];
  if (!p) throw new Error("Indica una provincia configurata in PROVINCE_TOWNS, es. AV");

  const res = await fetch(`${SPARQL}?query=${encodeURIComponent(query(p.istat))}`, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": "QUI-import (https://github.com/Lucacpt/qui_carburanti)",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Wikidata: HTTP ${res.status}`);
  const bindings = ((await res.json()) as { results: { bindings: WikidataBinding[] } }).results
    .bindings;
  const co = townsFromWikidata(bindings);
  const errors = validateTowns(co, prov);
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const data: TownsFile = {
    v: 1,
    prov,
    src: "Wikidata (CC0)",
    date: new Date().toISOString().slice(0, 10),
    co,
  };
  const json = JSON.stringify(data);
  const file = `comuni-${prov}.${createHash("sha256").update(json).digest("hex").slice(0, 8)}.json`;
  for (const old of readdirSync(OUT)) {
    if (old.startsWith(`comuni-${prov}.`) && old !== file) rmSync(new URL(old, OUT));
  }
  writeFileSync(new URL(file, OUT), json);

  const manifestUrl = new URL("manifest.json", OUT);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
    comuni?: Record<string, string>;
  };
  manifest.comuni = { ...manifest.comuni, [prov]: file };
  writeFileSync(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${prov}: ${co.length} comuni → r/${file}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
