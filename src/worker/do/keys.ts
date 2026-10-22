// Chiave HMAC del giorno (SDD §6.1): casuale, ruotata a mezzanotte UTC e poi DISTRUTTA.
// Senza questa chiave gli hash di ieri non sono più collegabili a nessun IP, nemmeno da noi.

import { DurableObject } from "cloudflare:workers";
import { randomHex } from "../crypto.ts";
import type { Env } from "../env.ts";

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export class KeyDO extends DurableObject<Env> {
  async dayKey(): Promise<{ day: string; key: string }> {
    const now = Date.now();
    const day = utcDay(now);
    const stored = await this.ctx.storage.get<{ day: string; key: string }>("k");
    if (stored?.day === day) return stored;
    // Sovrascrivere la chiave di ieri equivale a distruggerla.
    const fresh = { day, key: randomHex(32) };
    await this.ctx.storage.put("k", fresh);
    await this.ctx.storage.setAlarm(nextUtcMidnight(now));
    return fresh;
  }

  /** A mezzanotte la chiave viene cancellata anche se nessuno ne chiede una nuova. */
  override async alarm(): Promise<void> {
    await this.ctx.storage.delete("k");
  }
}
