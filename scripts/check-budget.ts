// Budget di banda (NFR-P1..P3, SDD §10.1): dimensione brotli di ogni asset pubblico.
// Fallisce se un file supera il proprio budget o se la prima vista supera il totale.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const KB = 1024;

// [regex sul percorso relativo, budget in byte brotli]. Il primo che corrisponde vince.
const BUDGETS: Array<[RegExp, number]> = [
  [/\.html$/, 6 * KB],
  [/\.css$/, 4 * KB],
  [/\.js$/, 20 * KB],
  [/^r\/manifest\.json$/, 1 * KB],
  [/^r\/.+\.json$/, 40 * KB],
  [/\.svg$/, 2 * KB],
  [/^_headers$/, 2 * KB],
];
// Prima vista: shell + stile + script + icona + anagrafica di una provincia (+ snapshot, pochi KB).
const FIRST_VIEW = [/^index\.html$/, /^app\.css$/, /^app\.js$/, /^icon\.svg$/, /^r\/AV\..+\.json$/];
const FIRST_VIEW_BUDGET = 60 * KB;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const br = (buf: Buffer) =>
  brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

let failed = false;
let firstView = 0;
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const size = br(readFileSync(file));
  const budget = BUDGETS.find(([re]) => re.test(rel))?.[1];
  const ok = budget === undefined || size <= budget;
  if (!ok) failed = true;
  if (FIRST_VIEW.some((re) => re.test(rel))) firstView += size;
  const limit = budget === undefined ? "nessun budget" : `${(budget / KB).toFixed(0)} KB`;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${rel.padEnd(28)} ${(size / KB).toFixed(1).padStart(6)} KB / ${limit}`,
  );
}
const fvOk = firstView <= FIRST_VIEW_BUDGET;
console.log(
  `${fvOk ? "ok  " : "FAIL"} prima vista ${(firstView / KB).toFixed(1)} KB / ${FIRST_VIEW_BUDGET / KB} KB`,
);
if (failed || !fvOk) process.exit(1);
