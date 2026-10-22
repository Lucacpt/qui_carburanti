// Smoke test end-to-end contro un'istanza di QUI (locale con `npm run dev`, oppure staging).
// Uso: node scripts/smoke.ts [http://127.0.0.1:8787]

import { randomBytes } from "node:crypto";
import { type Challenge, solveChallenge } from "../src/worker/pow.ts";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const PROV = "AV";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // non ancora pronto
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${BASE} non risponde`);
}

async function powPayload(): Promise<string> {
  const c = (await (await fetch(`${BASE}/api/challenge?p=${PROV}`)).json()) as Challenge;
  return solveChallenge(c);
}

const token = () => randomBytes(16).toString("base64url");

async function main() {
  await waitForServer();
  // L'anagrafica si prende dall'istanza sotto test: in staging può differire dal disco locale.
  const manifest = (await (await fetch(`${BASE}/r/manifest.json`)).json()) as {
    files: Record<string, string>;
  };
  const file = manifest.files[PROV];
  if (!file || !/^[A-Z]{2}\.[0-9a-f]{8}\.json$/.test(file)) throw new Error("manifest non valido");
  const reg = (await (await fetch(`${BASE}/r/${file}`)).json()) as { st: number[][] };
  const station = reg.st.find((s) => ((s[7] ?? 0) & 1) === 1)?.[0];
  if (!Number.isInteger(station)) throw new Error("nessun impianto con benzina");

  const health = await fetch(`${BASE}/api/health`);
  check("health", health.ok);
  check(
    "CSP sulle API",
    (health.headers.get("content-security-policy") ?? "").includes("connect-src 'self'"),
  );

  const home = await fetch(`${BASE}/`);
  check(
    "home servita con CSP",
    home.ok && (home.headers.get("content-security-policy") ?? "").length > 0,
  );

  const report = (body: object) =>
    fetch(`${BASE}/api/report`, { method: "POST", body: JSON.stringify(body) });

  const valid = { p: PROV, id: station, f: "B", h: 1, n: 1, tk: token(), pow: await powPayload() };
  const r1 = await report(valid);
  check("segnalazione valida → 202", r1.status === 202, String(r1.status));

  const replay = await report({ ...valid, tk: token() });
  check("replay del PoW → 202 silenzioso", replay.status === 202, String(replay.status));

  const withCoords = await report({ ...valid, pow: await powPayload(), lat: 40.9 });
  check("coordinate nel body → 400", withCoords.status === 400, String(withCoords.status));

  const badPow = await report({ ...valid, pow: btoa("{}") });
  check("PoW non valido → 400", badPow.status === 400, String(badPow.status));

  const snap = await fetch(`${BASE}/api/s/${PROV}`);
  const body = (await snap.json()) as { s: unknown[][] };
  const etag = snap.headers.get("etag") ?? "";
  check("snapshot 200 con ETag", snap.ok && etag.length > 0);
  check(
    "snapshot contiene l'impianto segnalato",
    body.s.some((row) => row[0] === station),
  );

  const again = await fetch(`${BASE}/api/s/${PROV}`, { headers: { "If-None-Match": etag } });
  check("If-None-Match → 304", again.status === 304, String(again.status));

  const contest = await fetch(`${BASE}/api/contest`, {
    method: "POST",
    body: JSON.stringify({ p: PROV, id: station, reason: "has_fuel", pow: await powPayload() }),
  });
  check("contestazione → 202", contest.status === 202, String(contest.status));

  console.log(failures === 0 ? "\nSmoke test: tutto ok" : `\nSmoke test: ${failures} errori`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
