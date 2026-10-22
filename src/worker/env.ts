import type { KeyDO } from "./do/keys.ts";
import type { ProvinceDO } from "./do/province.ts";

export interface Env {
  readonly ASSETS: Fetcher;
  readonly PROVINCE: DurableObjectNamespace<ProvinceDO>;
  readonly KEYS: DurableObjectNamespace<KeyDO>;
  readonly RL_REPORT: RateLimit;
  /** Segreto per firmare le sfide PoW (wrangler secret put POW_SECRET). */
  readonly POW_SECRET: string;
  /** Province attive, separate da virgola. MVP: "AV". */
  readonly PROVINCES: string;
  /** Difficoltà PoW: numero massimo da cercare (più alto = più lento). */
  readonly POW_MAX: string;
  /** Giurisdizione dei Durable Objects: "eu" in produzione, "none" in locale (npm run dev). */
  readonly DO_JURISDICTION: string;
  /** Solo sviluppo locale (npm run dev): "1" include il messaggio d'errore nelle risposte 500. */
  readonly DEV_ERRORS?: string;
}
