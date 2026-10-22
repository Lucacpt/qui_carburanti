// Testi mostrati per ogni stato (ADR-0011, E). Riportano FATTI ("segnalato da 3 persone"),
// mai giudizi sul distributore ("è esaurito"). Un test vieta le formulazioni assertive.

import { Flag, State, type StateResult } from "./types.ts";

export interface StateLabel {
  /** Riga principale, breve. */
  readonly title: string;
  /** Dettaglio con numeri e tempi. */
  readonly detail: string;
  /** Mostrare il link "Sei il gestore? Segnala un errore". */
  readonly operatorLink: boolean;
}

export const OPERATOR_LINK_TEXT = "Sei il gestore? Segnala un errore";

/** "adesso", "12 min fa", "2 h fa", "2 h 15 min fa". */
export function ago(ms: number | null, now: number): string {
  if (ms === null) return "";
  const min = Math.max(0, Math.floor((now - ms) / 60_000));
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h fa` : `${h} h ${rest} min fa`;
}

const people = (n: number) => (n === 1 ? "1 persona" : `${n} persone`);
const reports = (n: number) => (n === 1 ? "1 segnalazione" : `${n} segnalazioni`);
const confirmations = (n: number) => (n === 1 ? "1 conferma" : `${n} conferme`);

export function describeState(s: StateResult, now: number): StateLabel {
  const hasAbsences = s.absences > 0;
  const lastAbs = ago(s.lastAbsenceMs, now);
  const lastConf = ago(s.lastConfirmMs, now);

  if (s.state === State.GREY) {
    return {
      title: "Nessuna informazione",
      detail: "Nessuna segnalazione nelle ultime 8 ore",
      operatorLink: false,
    };
  }
  if (s.state === State.GREEN) {
    return {
      title: "Disponibile secondo gli utenti",
      detail: `${confirmations(s.confirmations)} · ultima ${lastConf}`,
      operatorLink: false,
    };
  }
  if (s.state === State.RED) {
    return {
      title: "Segnalato esaurito",
      detail: `da ${people(s.absences)} · ultima segnalazione ${lastAbs}`,
      operatorLink: true,
    };
  }
  // AMBRA: il flag spiega il motivo.
  if (s.flags & Flag.RED_PENDING) {
    return {
      title: "Segnalazioni di assenza in verifica",
      detail: `${reports(s.absences)} negli ultimi minuti`,
      operatorLink: true,
    };
  }
  if (s.flags & Flag.RED_EXPIRED) {
    return {
      title: "Segnalato esaurito, da verificare",
      detail: `ultima segnalazione ${lastAbs}: potrebbe essere stato rifornito`,
      operatorLink: true,
    };
  }
  if (s.flags & Flag.CONTESTED) {
    return {
      title: "Segnalazioni contrastanti",
      detail: `era disponibile, poi ${reports(s.absences)} di assenza · ultima ${lastAbs}`,
      operatorLink: true,
    };
  }
  if (hasAbsences) {
    return {
      title: "Segnalata assenza, da verificare",
      detail: `${reports(s.absences)} · ultima ${lastAbs}`,
      operatorLink: true,
    };
  }
  return {
    title: "Da verificare",
    detail:
      s.confirmations > 0
        ? `${confirmations(s.confirmations)} · ultima ${lastConf}`
        : `ultima conferma ${lastConf}`,
    operatorLink: false,
  };
}
