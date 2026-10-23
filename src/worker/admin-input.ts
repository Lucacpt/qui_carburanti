// Comandi dell'area admin (ADR-0013), validati come le API pubbliche: ogni campo non previsto è
// rifiutato. Nessun tipo Cloudflare: si testa in Node.

import type { Parsed } from "../domain/input.ts";

export const CONTEST_STATUSES = ["new", "in_progress", "closed"] as const;
export type ContestStatus = (typeof CONTEST_STATUSES)[number];

/** Il congelamento dura al massimo 3 ore (procedura contestazioni). */
export const MAX_FREEZE_HOURS = 3;
export const MAX_NOTE = 200;

export type AdminCommand =
  | { readonly kind: "ack"; readonly ids: readonly number[] }
  | { readonly kind: "contest"; readonly id: number; readonly status: ContestStatus }
  | {
      readonly kind: "freeze";
      readonly station: number;
      readonly note: string;
      readonly hours: number;
    }
  | { readonly kind: "unfreeze"; readonly station: number }
  | { readonly kind: "readOnly"; readonly on: boolean };

const KEYS: Record<AdminCommand["kind"], readonly string[]> = {
  ack: ["ids"],
  contest: ["id", "status"],
  freeze: ["station", "note", "hours"],
  unfreeze: ["station"],
  readOnly: ["on"],
};

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isId = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 9_999_999;

export function parseAdminAction(
  body: unknown,
  provinces: readonly string[],
): Parsed<{ prov: string; cmd: AdminCommand }> {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return fail("body non valido");
  const o = body as Record<string, unknown>;
  if (typeof o.p !== "string" || !provinces.includes(o.p)) return fail("provincia non valida");
  // hasOwn: "toString" o "__proto__" non devono trovare proprietà ereditate.
  if (typeof o.kind !== "string" || !Object.hasOwn(KEYS, o.kind))
    return fail("comando sconosciuto");
  const kind = o.kind as AdminCommand["kind"];
  const allowed = KEYS[kind];
  for (const k of Object.keys(o)) {
    if (k !== "p" && k !== "kind" && !allowed.includes(k)) return fail(`campo non ammesso: ${k}`);
  }
  const prov = o.p;
  switch (kind) {
    case "ack":
      if (!Array.isArray(o.ids) || o.ids.length === 0 || o.ids.length > 200 || !o.ids.every(isId)) {
        return fail("ids non validi");
      }
      return { ok: true, value: { prov, cmd: { kind, ids: o.ids as number[] } } };
    case "contest":
      if (!isId(o.id)) return fail("id non valido");
      if (!CONTEST_STATUSES.includes(o.status as ContestStatus)) return fail("stato non valido");
      return {
        ok: true,
        value: { prov, cmd: { kind, id: o.id, status: o.status as ContestStatus } },
      };
    case "freeze": {
      if (!isId(o.station)) return fail("impianto non valido");
      if (typeof o.hours !== "number" || !Number.isInteger(o.hours) || o.hours < 1) {
        return fail("durata non valida");
      }
      if (o.hours > MAX_FREEZE_HOURS) return fail(`al massimo ${MAX_FREEZE_HOURS} ore`);
      // La nota si mostra a tutti nella scheda: niente caratteri di controllo, lunghezza limitata.
      const note =
        typeof o.note === "string"
          ? // biome-ignore lint/suspicious/noControlCharactersInRegex: è proprio ciò che vogliamo rimuovere
            o.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
          : "";
      if (note.length < 3 || note.length > MAX_NOTE) return fail("nota da 3 a 200 caratteri");
      return { ok: true, value: { prov, cmd: { kind, station: o.station, note, hours: o.hours } } };
    }
    case "unfreeze":
      if (!isId(o.station)) return fail("impianto non valido");
      return { ok: true, value: { prov, cmd: { kind, station: o.station } } };
    case "readOnly":
      if (typeof o.on !== "boolean") return fail("valore non valido");
      return { ok: true, value: { prov, cmd: { kind, on: o.on } } };
  }
}
