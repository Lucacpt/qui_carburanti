// Guardia privacy (NFR-PR1..PR6): cerca nel codice pattern che non devono MAI comparire.
// È una rete di sicurezza grossolana, non sostituisce la review: un falso positivo si risolve
// modificando il codice o, se davvero necessario, questa lista con una motivazione nella PR.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIRS = ["src", "public"];
const SKIP = [/\.test\.ts$/, /^public\/r\//];

const RULES: Array<{ re: RegExp; why: string; allow?: RegExp }> = [
  { re: /document\.cookie/, why: "niente cookie (NFR-PR4)" },
  {
    re: /navigator\.(userAgent|plugins|hardwareConcurrency|deviceMemory|languages)|getContext\(\s*["']webgl/,
    why: "niente fingerprinting (NFR-PR5)",
  },
  {
    re: /(src|href)\s*=\s*["']https?:\/\/[^"']+\.(js|css|woff2?)["']|fetch\(\s*["'`]https?:\/\//,
    why: "nessuna richiesta a domini terzi dal client (NFR-PR4)",
  },
  {
    re: /cf-connecting-ip/i,
    why: "l'IP si legge in un solo punto e si trasforma subito in HMAC (NFR-PR2)",
    allow: /^src\/worker\/identity\.ts$/,
  },
  {
    re: /\b(latitude|longitude)\b\s*:/i,
    why: "il server non riceve coordinate (NFR-PR1)",
    allow: /^public\//,
  },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const violations: string[] = [];
for (const dir of DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (SKIP.some((re) => re.test(rel))) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.re.test(line) && !rule.allow?.test(rel)) {
          violations.push(`${rel}:${i + 1}  ${rule.why}\n    ${line.trim()}`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`Guardia privacy: ${violations.length} violazioni\n\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("Guardia privacy: ok");
