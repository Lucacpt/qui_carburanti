// Scarica l'anagrafica MIMIT e genera public/r/<PROV>.<hash>.json + public/r/manifest.json.
// Uso: node scripts/import-mimit.ts AV [BN ...]
// Nell'MVP gira a mano o in CI; il cron giornaliero arriva al giorno 4-5 (SDD §7.3).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { buildProvinceRegistry, parseMimitCsv, validateRegistry } from "../src/domain/mimit.ts";

const BASE = "https://www.mimit.gov.it/images/exportCSV";
const OUT = new URL("../public/r/", import.meta.url);
const MAX_AGE_DAYS = 3;

interface Manifest {
  v: 1;
  date: string;
  files: Record<string, string>;
  counts: Record<string, number>;
}

async function download(name: string): Promise<string> {
  const res = await fetch(`${BASE}/${name}`, {
    headers: { "User-Agent": "QUI-import (https://github.com/Lucacpt/qui_carburanti)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

function readManifest(): Manifest {
  const path = new URL("manifest.json", OUT);
  if (!existsSync(path)) return { v: 1, date: "", files: {}, counts: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

async function main() {
  const provinces = process.argv.slice(2).map((p) => p.toUpperCase());
  if (provinces.length === 0) throw new Error("Indica almeno una provincia, es. AV");

  const [anag, prezzi] = await Promise.all([
    download("anagrafica_impianti_attivi.csv").then(parseMimitCsv),
    download("prezzo_alle_8.csv").then(parseMimitCsv),
  ]);
  const ageDays = (Date.now() - Date.parse(anag.extractedOn)) / 86_400_000;
  if (ageDays > MAX_AGE_DAYS)
    throw new Error(`Anagrafica vecchia: estrazione del ${anag.extractedOn}`);

  mkdirSync(OUT, { recursive: true });
  const manifest = readManifest();
  for (const prov of provinces) {
    const reg = buildProvinceRegistry(anag, prezzi, prov);
    const errors = validateRegistry(reg, manifest.counts[prov]);
    if (errors.length > 0) throw new Error(errors.join("\n"));

    const json = JSON.stringify(reg);
    const hash = createHash("sha256").update(json).digest("hex").slice(0, 8);
    const file = `${prov}.${hash}.json`;
    for (const old of readdirSync(OUT)) {
      if (old.startsWith(`${prov}.`) && old !== file) rmSync(new URL(old, OUT));
    }
    writeFileSync(new URL(file, OUT), json);
    manifest.files[prov] = file;
    manifest.counts[prov] = reg.st.length;
    console.log(`${prov}: ${reg.st.length} impianti, ${reg.brands.length} bandiere → r/${file}`);
  }
  manifest.date = anag.extractedOn;
  writeFileSync(new URL("manifest.json", OUT), `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
