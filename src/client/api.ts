// Chiamate alle API di QUI. Il PoW si calcola in anticipo, quando l'utente apre un distributore,
// così il tocco su "C'è" / "Non c'è" risponde subito.

import type { Challenge } from "../worker/pow.ts";
import { scriptUrl } from "./tt.ts";

const POW_MAX_AGE_MS = 4 * 60_000; // le sfide scadono dopo 5'

function solveInWorker(c: Challenge): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(scriptUrl("/pow.js"));
    w.onmessage = (e: MessageEvent<{ ok: boolean; payload?: string }>) => {
      w.terminate();
      if (e.data.ok && e.data.payload) resolve(e.data.payload);
      else reject(new Error("pow"));
    };
    w.onerror = () => {
      w.terminate();
      reject(new Error("pow"));
    };
    w.postMessage(c);
  });
}

async function freshPow(prov: string): Promise<string> {
  const res = await fetch(`/api/challenge?p=${encodeURIComponent(prov)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("challenge");
  return solveInWorker((await res.json()) as Challenge);
}

let prepared: { prov: string; at: number; pow: Promise<string> } | undefined;

/** Avvia il calcolo in background (best effort). */
export function preparePow(prov: string): void {
  if (prepared && prepared.prov === prov && Date.now() - prepared.at < POW_MAX_AGE_MS) return;
  const pow = freshPow(prov);
  pow.catch(() => undefined);
  prepared = { prov, at: Date.now(), pow };
}

/** Una soluzione PoW si usa una sola volta: la prende e ne prepara un'altra. */
async function takePow(prov: string): Promise<string> {
  const p = prepared;
  prepared = undefined;
  const pow = p && p.prov === prov && Date.now() - p.at < POW_MAX_AGE_MS ? p.pow : freshPow(prov);
  try {
    return await pow;
  } catch {
    return freshPow(prov);
  }
}

export type SendResult = { ok: true } | { ok: false; message: string };

/** Mai codici o dettagli tecnici a chi usa l'app: solo cosa fare. */
export const RETRY_MESSAGE = "Non è andata a buon fine. Riprova tra poco.";
export const OFFLINE_MESSAGE = "Connessione assente: riprova tra poco";

/**
 * Il PoW fallisce per due motivi diversi: la rete (fetch della sfida, TypeError) oppure il calcolo
 * nel Worker. Dire "connessione assente" per il secondo manda chi usa l'app nella direzione sbagliata.
 */
export function powFailureMessage(err: unknown): string {
  return err instanceof TypeError ? OFFLINE_MESSAGE : RETRY_MESSAGE;
}

async function takePowResult(prov: string): Promise<{ pow: string } | { message: string }> {
  try {
    return { pow: await takePow(prov) };
  } catch (err) {
    return { message: powFailureMessage(err) };
  }
}

async function post(path: string, body: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 202) return { ok: true };
    // Unica eccezione voluta: la sola lettura durante un attacco, con il suo messaggio.
    if (res.status === 503) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, message: data.error ?? "Segnalazioni sospese temporaneamente" };
    }
    return { ok: false, message: RETRY_MESSAGE };
  } catch {
    return { ok: false, message: OFFLINE_MESSAGE };
  }
}

export async function sendReport(
  prov: string,
  body: { id: number; f: string; h: 0 | 1; n: 0 | 1; tk: string; q?: 1 | 2 | 3; lim?: 0 | 1 },
): Promise<SendResult> {
  const r = await takePowResult(prov);
  if ("message" in r) return { ok: false, message: r.message };
  return post("/api/report", { p: prov, ...body, pow: r.pow });
}

export async function sendContest(
  prov: string,
  body: { id: number; reason: string; contact?: string },
): Promise<SendResult> {
  const r = await takePowResult(prov);
  if ("message" in r) return { ok: false, message: r.message };
  return post("/api/contest", { p: prov, ...body, pow: r.pow });
}
