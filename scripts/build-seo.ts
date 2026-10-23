// Scrive i file per motori di ricerca e modelli di IA, dall'anagrafica in public/r/ e dalle pagine:
// public/sitemap.xml (una scheda per impianto) e public/llms-full.txt (testo completo del sito).
// Eseguito dalla build insieme al client (wrangler.jsonc "build"): seguono sempre i dati veri.

import { readFileSync, writeFileSync } from "node:fs";
import { buildLlmsFull } from "./llms.ts";
import { buildSitemap, type SitemapStation } from "./sitemap.ts";

const PUBLIC = new URL("../public/", import.meta.url);
const text = (path: string) => readFileSync(new URL(path, PUBLIC), "utf8");
const read = (path: string) => JSON.parse(text(path));

/** Pagine da cui viene il testo di llms-full.txt (le legali restano link in llms.txt). */
const LLMS_PAGES = ["/come-funziona", "/progetto"];

const manifest = read("r/manifest.json") as { files: Record<string, string> };
const stations: SitemapStation[] = [];
const towns = new Map<string, number>();
let date = "";
for (const file of Object.values(manifest.files)) {
  const reg = read(`r/${file}`) as { date: string; st: (string | number)[][] };
  date = reg.date;
  for (const row of reg.st) {
    stations.push({ id: Number(row[0]), lastmod: reg.date });
    const town = String(row[6]);
    towns.set(town, (towns.get(town) ?? 0) + 1);
  }
}

writeFileSync(new URL("sitemap.xml", PUBLIC), buildSitemap(stations));
const pages = LLMS_PAGES.map((path) => ({ path, html: text(`${path.slice(1)}.html`) }));
writeFileSync(new URL("llms-full.txt", PUBLIC), buildLlmsFull(pages, { date, towns }));
console.log(`seo: sitemap con ${stations.length} schede, llms-full.txt con ${towns.size} comuni`);
