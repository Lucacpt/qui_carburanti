// Validazione rigorosa dei body delle API (SDD §9). Ogni campo non previsto viene RIFIUTATO:
// è la garanzia tecnica che il server non riceva mai coordinate o altri dati (NFR-PR1).

import { FUELS, type Fuel, type Queue } from "./types.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ReportInput {
  readonly prov: string;
  readonly id: number;
  readonly fuel: Fuel;
  readonly has: boolean;
  readonly near: boolean;
  readonly queue: Queue | undefined;
  readonly limit: boolean | undefined;
  /** Token anonimo effimero del client (16 byte base64url). */
  readonly token: string;
  /** Soluzione del proof-of-work (base64). */
  readonly pow: string;
}

export const CONTEST_REASONS = ["has_fuel", "no_fuel", "closed", "wrong_data", "other"] as const;
export type ContestReason = (typeof CONTEST_REASONS)[number];

export interface ContestInput {
  readonly prov: string;
  readonly id: number;
  readonly fuel: Fuel | undefined;
  readonly reason: ContestReason;
  readonly contact: string | undefined;
  readonly pow: string;
}

const REPORT_KEYS = new Set(["p", "id", "f", "h", "n", "q", "lim", "tk", "pow"]);
const CONTEST_KEYS = new Set(["p", "id", "f", "reason", "contact", "pow"]);
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function asObject(body: unknown, allowed: Set<string>): Record<string, unknown> | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "body non valido";
  for (const k of Object.keys(body)) if (!allowed.has(k)) return `campo non ammesso: ${k}`;
  return body as Record<string, unknown>;
}

function common(o: Record<string, unknown>, provinces: readonly string[]): string | null {
  if (typeof o.p !== "string" || !provinces.includes(o.p)) return "provincia non valida";
  if (typeof o.id !== "number" || !Number.isInteger(o.id) || o.id < 1 || o.id > 9_999_999) {
    return "id non valido";
  }
  if (typeof o.pow !== "string" || o.pow.length === 0 || o.pow.length > 2048) return "pow mancante";
  return null;
}

const isFuel = (v: unknown): v is Fuel => typeof v === "string" && FUELS.includes(v as Fuel);
const isBit = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

export function parseReport(body: unknown, provinces: readonly string[]): Parsed<ReportInput> {
  const o = asObject(body, REPORT_KEYS);
  if (typeof o === "string") return fail(o);
  const err = common(o, provinces);
  if (err) return fail(err);
  if (!isFuel(o.f)) return fail("carburante non valido");
  if (!isBit(o.h) || !isBit(o.n)) return fail("h/n non validi");
  if (typeof o.tk !== "string" || !TOKEN_RE.test(o.tk)) return fail("token non valido");
  if (o.q !== undefined && (o.h !== 1 || (o.q !== 1 && o.q !== 2 && o.q !== 3))) {
    return fail("coda non valida");
  }
  if (o.lim !== undefined && (o.h !== 1 || !isBit(o.lim))) return fail("limite non valido");
  return {
    ok: true,
    value: {
      prov: o.p as string,
      id: o.id as number,
      fuel: o.f,
      has: o.h === 1,
      near: o.n === 1,
      queue: o.q as Queue | undefined,
      limit: o.lim === undefined ? undefined : o.lim === 1,
      token: o.tk,
      pow: o.pow as string,
    },
  };
}

export function parseContest(body: unknown, provinces: readonly string[]): Parsed<ContestInput> {
  const o = asObject(body, CONTEST_KEYS);
  if (typeof o === "string") return fail(o);
  const err = common(o, provinces);
  if (err) return fail(err);
  if (o.f !== undefined && !isFuel(o.f)) return fail("carburante non valido");
  if (!CONTEST_REASONS.includes(o.reason as ContestReason)) return fail("motivo non valido");
  if (o.contact !== undefined && (typeof o.contact !== "string" || o.contact.length > 120)) {
    return fail("contatto non valido");
  }
  // Niente caratteri di controllo nel contatto: viene letto solo dai maintainer, ma non si sa mai.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: è proprio ciò che vogliamo rimuovere
  const contact = (o.contact as string | undefined)?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return {
    ok: true,
    value: {
      prov: o.p as string,
      id: o.id as number,
      fuel: o.f as Fuel | undefined,
      reason: o.reason as ContestReason,
      contact: contact || undefined,
      pow: o.pow as string,
    },
  };
}
