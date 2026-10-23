// Durable Object di una provincia: involucro sottile attorno a ProvinceStore.
// Un solo DO per provincia ⇒ le segnalazioni sono serializzate: niente doppi conteggi (ADR-0002).

import { DurableObject } from "cloudflare:workers";
import type { ContestInput } from "../../domain/input.ts";
import type { ProvinceRegistry } from "../../domain/mimit.ts";
import type { Env } from "../env.ts";
import { assertJurisdiction } from "../jurisdiction.ts";
import {
  ProvinceStore,
  type ReportStatus,
  type SnapshotBody,
  type SqlLike,
  type StoreReport,
} from "../store/province-store.ts";

const REGISTRY_REFRESH_MS = 60 * 60_000;
const ALARM_EVERY_MS = 60_000;

export class ProvinceDO extends DurableObject<Env> {
  private readonly store: ProvinceStore;
  private registryAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    assertJurisdiction(ctx.id, env);
    this.store = new ProvinceStore(ctx.storage.sql as unknown as SqlLike);
    void ctx.blockConcurrencyWhile(async () => this.store.migrate());
  }

  async report(prov: string, input: StoreReport): Promise<ReportStatus> {
    const now = Date.now();
    await this.loadRegistry(prov, now);
    const status = this.store.report(input, now);
    if (status === "accepted") await this.ensureAlarm(now);
    return status;
  }

  async snapshot(prov: string): Promise<SnapshotBody> {
    return this.store.snapshot(prov, Date.now());
  }

  async contest(prov: string, input: ContestInput): Promise<"ok" | "invalid_station"> {
    const now = Date.now();
    await this.loadRegistry(prov, now);
    if (!this.store.knowsStation(input.id)) return "invalid_station";
    this.store.contest(input, now);
    return "ok";
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    if (this.store.maintenance(now)) await this.ctx.storage.setAlarm(now + ALARM_EVERY_MS);
  }

  private async ensureAlarm(now: number): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + ALARM_EVERY_MS);
    }
  }

  /** L'anagrafica è un asset statico pubblico: il DO la legge dal binding ASSETS e la tiene in memoria. */
  private async loadRegistry(prov: string, now: number): Promise<void> {
    if (now - this.registryAt < REGISTRY_REFRESH_MS) return;
    const base = "https://assets.invalid/r/";
    const manifest = await this.env.ASSETS.fetch(`${base}manifest.json`).then(
      (r) => r.json() as Promise<{ files: Record<string, string> }>,
    );
    const file = manifest.files[prov];
    if (!file) throw new Error(`anagrafica assente per ${prov}`);
    const reg = await this.env.ASSETS.fetch(`${base}${file}`).then(
      (r) => r.json() as Promise<ProvinceRegistry>,
    );
    this.store.setStations(new Map(reg.st.map((s) => [s[0], s[7]])));
    this.registryAt = now;
  }
}
