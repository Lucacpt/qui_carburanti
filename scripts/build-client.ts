// Costruisce il client: public/app.js (modulo ES) e public/pow.js (Web Worker del proof-of-work).
// Eseguito automaticamente da `wrangler dev` e `wrangler deploy` (vedi "build" in wrangler.jsonc).

import { type BuildOptions, build } from "esbuild";

const common: BuildOptions = {
  bundle: true,
  minify: true,
  legalComments: "none",
  charset: "utf8",
  // NFR-C1: iOS Safari ≥ 15, Chrome Android ≥ 90, Firefox Android ≥ 100
  target: ["es2020", "safari15", "chrome90", "firefox100"],
};

await build({
  ...common,
  entryPoints: ["src/client/main.ts"],
  outfile: "public/app.js",
  format: "esm",
});
await build({
  ...common,
  entryPoints: ["src/client/pow-worker.ts"],
  outfile: "public/pow.js",
  format: "iife",
});
console.log("client: public/app.js, public/pow.js");
