import type { KeyDO } from "./do/keys.ts";
import type { ProvinceDO } from "./do/province.ts";

export interface Env {
  readonly ASSETS: Fetcher;
  readonly PROVINCE: DurableObjectNamespace<ProvinceDO>;
  readonly KEYS: DurableObjectNamespace<KeyDO>;
  readonly RL_REPORT: RateLimit;
  readonly RL_CONTEST: RateLimit;
  /** Segreto per firmare le sfide PoW, generato da scripts/deploy.ts al primo deploy. */
  readonly POW_SECRET: string;
  /** Province attive, separate da virgola. MVP: "AV". */
  readonly PROVINCES: string;
  /** Difficoltà PoW: numero massimo da cercare (più alto = più lento). */
  readonly POW_MAX: string;
  /** Giurisdizione dei Durable Objects: "eu" in produzione, "none" in locale (npm run dev). */
  readonly DO_JURISDICTION: string;
  /** Solo sviluppo locale (npm run dev): "1" include il messaggio d'errore nelle risposte 500. */
  readonly DEV_ERRORS?: string;
  /** Area admin (ADR-0013): team di Cloudflare Access, es. "qui-admin.cloudflareaccess.com". */
  readonly ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag dell'applicazione Access. */
  readonly ACCESS_AUD?: string;
  /** Email ammesse, separate da virgola. Secret: non finisce nel repository. */
  readonly ADMIN_EMAILS?: string;
  /** Solo in locale: "1" apre l'area admin senza Access (accettato solo su localhost). */
  readonly ADMIN_DEV?: string;
}
