// Aggregazione di coda e limite di erogazione (report v0.3 §5.2, FR-21).
// Per ogni rete conta l'ultima indicazione; vince il valore indicato da più reti, a parità il più recente.

import type { Queue, Report } from "./types.ts";

export const QUEUE_WINDOW_MS = 30 * 60_000;

export interface QueueInfo {
  /** 0 = sconosciuta. */
  readonly queue: 0 | Queue;
  /** 0 = sconosciuto o nessun limite, 1 = limite segnalato. */
  readonly limit: 0 | 1;
}

function majority<T>(entries: ReadonlyArray<{ value: T; ts: number }>): T | undefined {
  const tally = new Map<T, { n: number; ts: number }>();
  for (const e of entries) {
    const t = tally.get(e.value);
    tally.set(e.value, { n: (t?.n ?? 0) + 1, ts: Math.max(t?.ts ?? 0, e.ts) });
  }
  let best: { value: T; n: number; ts: number } | undefined;
  for (const [value, { n, ts }] of tally) {
    if (!best || n > best.n || (n === best.n && ts > best.ts)) best = { value, n, ts };
  }
  return best?.value;
}

function latestPerPrefix<T>(
  reports: readonly Report[],
  pick: (r: Report) => T | undefined,
): Array<{ value: T; ts: number }> {
  const latest = new Map<string, { value: T; ts: number }>();
  for (const r of reports) {
    const value = pick(r);
    if (value === undefined) continue;
    const prev = latest.get(r.pkey);
    if (!prev || r.ts > prev.ts) latest.set(r.pkey, { value, ts: r.ts });
  }
  return [...latest.values()];
}

export function aggregateQueue(reports: readonly Report[], now: number): QueueInfo {
  const fresh = reports.filter((r) => r.has && r.ts <= now && now - r.ts <= QUEUE_WINDOW_MS);
  const queue = majority(latestPerPrefix(fresh, (r) => r.queue)) ?? 0;
  const limit = majority(latestPerPrefix(fresh, (r) => r.limit)) === true ? 1 : 0;
  return { queue, limit };
}
