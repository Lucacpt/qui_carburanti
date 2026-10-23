// Le pagine legali promettono tempi e regole precisi: qui si verifica che coincidano con il codice.
// Ogni numero "contrattuale" nelle pagine è marcato con data-legal="chiave"; se cambi una costante,
// questo test fallisce finché non aggiorni anche il testo (e la data della pagina).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEAR_KM } from "../src/client/geo.ts";
import { STORAGE_KEYS } from "../src/client/local.ts";
import { DEFAULT_PARAMS } from "../src/domain/config.ts";
import { POW_TTL_MS } from "../src/worker/pow.ts";
import { ABUSE, RETENTION } from "../src/worker/store/province-store.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function duration(ms: number): string {
  if (ms % DAY === 0 && ms >= 2 * DAY) return `${ms / DAY} giorni`;
  if (ms % HOUR === 0) return ms === HOUR ? "1 ora" : `${ms / HOUR} ore`;
  return `${ms / MIN} minuti`;
}
const num = (n: number) => String(n).replace(".", ",");

const EXPECTED: Record<string, string> = {
  nearM: `${Math.round(NEAR_KM * 1000)} metri`,
  reportsMs: duration(DEFAULT_PARAMS.windowMs),
  freshMs: duration(DEFAULT_PARAMS.freshMs),
  redHoldMs: duration(DEFAULT_PARAMS.redHoldMs),
  redTtlMs: duration(DEFAULT_PARAMS.redTtlMs),
  wNear: num(DEFAULT_PARAMS.wNear),
  wRemote: num(DEFAULT_PARAMS.wRemote),
  greenMin: num(DEFAULT_PARAMS.greenMin),
  redMin: num(DEFAULT_PARAMS.redMin),
  powMs: duration(POW_TTL_MS),
  sameStationMax: num(ABUSE.sameStationMax),
  sameStationWindowMs: duration(ABUSE.sameStationWindowMs),
  hourlyMax: num(ABUSE.hourlyMax),
  abuseMaxMs: duration(ABUSE.maxTimeoutMs),
  abuseKeepMs: duration(ABUSE.keepMs),
  contactMs: duration(RETENTION.contactMs),
  contestsMs: duration(RETENTION.contestsMs),
  transitionsMs: duration(RETENTION.transitionsMs),
  statsMs: duration(RETENTION.statsMs),
  lastGreenMs: duration(RETENTION.lastGreenMs),
};

const page = (name: string) =>
  readFileSync(new URL(`../public/${name}.html`, import.meta.url), "utf8");

function marked(html: string): Array<[string, string]> {
  return [...html.matchAll(/data-legal="([^"]+)">([^<]*)</g)].map((m) => [m[1] ?? "", m[2] ?? ""]);
}

describe("pagine legali coerenti con il codice", () => {
  for (const name of ["privacy", "termini", "cookie"]) {
    it(`${name}: ogni valore marcato corrisponde alla costante`, () => {
      for (const [key, text] of marked(page(name))) {
        expect(EXPECTED, `chiave sconosciuta "${key}" in ${name}.html`).toHaveProperty(key);
        expect(text, `${name}.html, data-legal="${key}"`).toBe(EXPECTED[key]);
      }
    });
  }

  it("l'informativa cita tutti i tempi di conservazione dei dati personali", () => {
    const keys = new Set(marked(page("privacy")).map(([k]) => k));
    for (const k of ["reportsMs", "abuseKeepMs", "powMs", "contactMs", "contestsMs", "nearM"]) {
      expect(keys.has(k), `manca data-legal="${k}" in privacy.html`).toBe(true);
    }
  });

  it("la pagina cookie elenca esattamente le chiavi salvate sul telefono", () => {
    const listed = new Set(
      [...page("cookie").matchAll(/<code>(qui\.[a-z]+)<\/code>/g)].map((m) => m[1]),
    );
    expect(listed).toEqual(new Set(Object.values(STORAGE_KEYS)));
  });

  it("nessuna pagina pubblica promette 'nessun identificativo' (esistono codici pseudonimi)", () => {
    for (const name of ["privacy", "termini", "cookie", "progetto", "come-funziona"]) {
      expect(page(name)).not.toMatch(/non conserv\w+ (alcun )?identificativ/i);
    }
  });
});
