// Deploy di un ambiente con wrangler (CI: .github/workflows/deploy.yml).
// Al primo deploy genera POW_SECRET e lo carica insieme al codice: non passa mai da GitHub né da
// una persona, vive solo come secret del Worker. Per ruotarlo: eliminarlo dalla dashboard e
// rifare il deploy (le sfide aperte, valide 5 minuti, vanno perse).
// Uso: node scripts/deploy.ts staging|production   (con CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID)

import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkerMissing } from "./wrangler-errors.ts";

const target = process.argv[2];
if (target !== "staging" && target !== "production") {
  console.error("Uso: node scripts/deploy.ts staging|production");
  process.exit(2);
}
// In CI token e account arrivano dall'environment GitHub (in locale basta `wrangler login`).
if (process.env.GITHUB_ACTIONS === "true") {
  const missing = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `Mancano ${missing.join(" e ")} nell'environment GitHub "${target}".\n` +
        "Settings → Environments → " +
        `${target}: il token va in "Environment secrets", l'Account ID in "Environment variables". ` +
        "Poi Re-run jobs (docs/procedure/rilascio.md).",
    );
    process.exit(1);
  }
}
// La radice di wrangler.jsonc è la produzione: --env= vuoto la seleziona in modo esplicito.
const envFlag = `--env=${target === "production" ? "" : target}`;

function wrangler(args: string[], options: SpawnSyncOptions = {}) {
  return spawnSync("npx", ["wrangler", ...args, envFlag], {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
}

/** Se il Worker ha già POW_SECRET; al primo deploy il Worker non esiste ancora. */
function hasPowSecret(): boolean {
  const list = wrangler(["secret", "list", "--format", "json"]);
  const out = `${list.stdout ?? ""}${list.stderr ?? ""}`;
  if (list.status === 0) {
    const secrets = JSON.parse(String(list.stdout).slice(String(list.stdout).indexOf("["))) as {
      name: string;
    }[];
    return secrets.some((s) => s.name === "POW_SECRET");
  }
  if (isWorkerMissing(out)) return false;
  // Qualsiasi altro errore (token, rete): fermarsi, non rigenerare un segreto che forse esiste.
  console.error(out);
  throw new Error("Impossibile leggere i secret del Worker");
}

const args = ["deploy"];
let dir: string | undefined;
if (!hasPowSecret()) {
  dir = mkdtempSync(join(tmpdir(), "qui-deploy-"));
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify({ POW_SECRET: randomBytes(48).toString("base64url") }), {
    mode: 0o600,
  });
  args.push("--secrets-file", file);
  console.log(`${target}: primo deploy, POW_SECRET generato e caricato come secret del Worker.`);
}

try {
  const r = wrangler(args, { stdio: "inherit" });
  if (r.status !== 0) process.exitCode = r.status ?? 1;
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
