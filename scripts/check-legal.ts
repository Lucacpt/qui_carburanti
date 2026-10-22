// Segnaposto nei documenti legali: in sviluppo li elenca, con --strict (rilascio) blocca.
// Un'informativa con "[DA COMPILARE: nome e cognome]" in produzione non identifica il titolare.
// Uso: node scripts/check-legal.ts [--strict]

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIRS = ["public", "docs/legale"];
const MARKERS: Array<[RegExp, string]> = [
  [/\[DA COMPILARE[^\]]*\]/g, "segnaposto da compilare"],
  [/data-bozza/g, "avviso di bozza da rimuovere dopo la revisione legale"],
];

const strict = process.argv.includes("--strict");
const found: string[] = [];
for (const dir of DIRS) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (!/\.(html|md)$/.test(name)) continue;
    const file = join(ROOT, dir, name);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const [re, why] of MARKERS) {
        for (const m of line.matchAll(re)) {
          found.push(`${relative(ROOT, file).replaceAll("\\", "/")}:${i + 1}  ${why}: ${m[0]}`);
        }
      }
    });
  }
}

if (found.length === 0) {
  console.log("Documenti legali: nessun segnaposto");
} else {
  console.log(`Documenti legali: ${found.length} segnaposto\n${found.join("\n")}`);
  if (strict) {
    console.error("\nRilascio bloccato: completa i documenti legali prima di pubblicare.");
    process.exit(1);
  }
}
