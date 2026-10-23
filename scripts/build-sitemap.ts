// Scrive public/sitemap.xml dall'anagrafica pubblicata in public/r/ (una scheda per impianto).
// Eseguito dalla build insieme al client (wrangler.jsonc "build"): l'elenco segue sempre l'anagrafica.

import { readFileSync, writeFileSync } from "node:fs";
import { buildSitemap, type SitemapStation } from "./sitemap.ts";

const PUBLIC = new URL("../public/", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, PUBLIC), "utf8"));

const manifest = read("r/manifest.json") as { files: Record<string, string> };
const stations: SitemapStation[] = [];
for (const file of Object.values(manifest.files)) {
  const reg = read(`r/${file}`) as { date: string; st: number[][] };
  for (const row of reg.st) stations.push({ id: Number(row[0]), lastmod: reg.date });
}

writeFileSync(new URL("sitemap.xml", PUBLIC), buildSitemap(stations));
console.log(`sitemap: ${stations.length} schede + pagine del sito`);
