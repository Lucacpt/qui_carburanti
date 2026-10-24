// Rigenera public/og.png, l'anteprima dei link su WhatsApp, Facebook e X (1200×630), da
// scripts/og-image.html con un browser Chromium headless. Non gira in CI: l'immagine sta nel
// repository e scripts/social-preview.test.ts ne controlla formato, dimensioni e peso.
// Uso: node scripts/og-image.ts   (CHROME=/percorso/del/browser se non è in un percorso noto)
// I font sono quelli del sistema: l'immagine pubblicata è fatta su Windows (Segoe UI Black).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const browser = [
  process.env.CHROME,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));
if (!browser) {
  console.error("Nessun browser Chromium trovato: imposta CHROME=/percorso/del/browser.");
  process.exit(1);
}

const out = fileURLToPath(new URL("../public/og.png", import.meta.url));
const r = spawnSync(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1200,630",
    `--screenshot=${out}`,
    new URL("./og-image.html", import.meta.url).href,
  ],
  { stdio: "inherit" },
);
if (r.status === 0) console.log(`Scritto ${out}`);
process.exit(r.status ?? 1);
