// Scrive i file per motori di ricerca e modelli di IA, dall'anagrafica in public/r/ e dalle pagine:
// public/sitemap.xml, public/llms-full.txt e le pagine statiche della fase 1 (docs/08-seo.md):
// public/d/<id>.html, public/comune/<slug>.html, public/comuni.html. Tutti generati, fuori da git.
// Eseguito dalla build insieme al client (wrangler.jsonc "build"): seguono sempre i dati veri.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Station, stationsFromRegistry } from "../src/client/data.ts";
import { normalize } from "../src/client/search.ts";
import type { ProvinceRegistry } from "../src/domain/mimit.ts";
import type { TownsFile } from "../src/domain/towns.ts";
import { buildLlmsFull } from "./llms.ts";
import { slugify, stationPage, type TownGroup, townPage, townsIndexPage } from "./seo-pages.ts";
import { buildSitemap, type SitemapStation } from "./sitemap.ts";

const PUBLIC = new URL("../public/", import.meta.url);
const text = (path: string) => readFileSync(new URL(path, PUBLIC), "utf8");
const read = (path: string) => JSON.parse(text(path));

/** Pagine da cui viene il testo di llms-full.txt (le legali restano link in llms.txt). */
const LLMS_PAGES = ["/come-funziona", "/progetto"];

const manifest = read("r/manifest.json") as {
  files: Record<string, string>;
  comuni?: Record<string, string>;
};
const sitemapStations: SitemapStation[] = [];
const counts = new Map<string, number>();
const groups = new Map<string, { name: string; stations: Station[] }>();
let date = "";
for (const [prov, file] of Object.entries(manifest.files)) {
  const reg = read(`r/${file}`) as ProvinceRegistry & { date: string };
  date = reg.date;
  // Nomi dei comuni scritti bene (Wikidata) al posto del maiuscolo dell'anagrafica MIMIT.
  const towns = manifest.comuni?.[prov] ? (read(`r/${manifest.comuni[prov]}`) as TownsFile) : null;
  const proper = new Map((towns?.co ?? []).map(([name]) => [normalize(name), name]));
  for (const st of stationsFromRegistry(reg)) {
    sitemapStations.push({ id: st.id, lastmod: reg.date });
    counts.set(st.town, (counts.get(st.town) ?? 0) + 1);
    const key = normalize(st.town);
    const g = groups.get(key) ?? { name: proper.get(key) ?? st.town, stations: [] };
    g.stations.push(st);
    groups.set(key, g);
  }
}

const towns: TownGroup[] = [...groups.values()]
  .map((g) => ({ ...g, slug: slugify(g.name) }))
  .sort((a, b) => a.name.localeCompare(b.name, "it"));

// Le pagine si rigenerano da zero: un impianto chiuso nell'anagrafica non deve restare online.
for (const dir of ["d", "comune"])
  rmSync(new URL(`${dir}/`, PUBLIC), { recursive: true, force: true });
mkdirSync(new URL("d/", PUBLIC), { recursive: true });
mkdirSync(new URL("comune/", PUBLIC), { recursive: true });
for (const town of towns) {
  writeFileSync(new URL(`comune/${town.slug}.html`, PUBLIC), townPage(town, date));
  for (const st of town.stations) {
    writeFileSync(new URL(`d/${st.id}.html`, PUBLIC), stationPage(st, town, date));
  }
}
writeFileSync(new URL("comuni.html", PUBLIC), townsIndexPage(towns, date));

writeFileSync(
  new URL("sitemap.xml", PUBLIC),
  buildSitemap(
    sitemapStations,
    towns.map((t) => ({ slug: t.slug, lastmod: date })),
  ),
);
const pages = LLMS_PAGES.map((path) => ({ path, html: text(`${path.slice(1)}.html`) }));
writeFileSync(new URL("llms-full.txt", PUBLIC), buildLlmsFull(pages, { date, towns: counts }));
console.log(
  `seo: ${sitemapStations.length} schede, ${towns.length} comuni, sitemap e llms-full.txt aggiornati`,
);
