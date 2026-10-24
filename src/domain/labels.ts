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

/** "proprio ora", "12 min fa", "2 h fa", "2 h 15 min fa". */
export function ago(ms: number | null, now: number): string {
  if (ms === null) return "";
  const min = Math.max(0, Math.floor((now - ms) / 60_000));
  if (min < 1) return "proprio ora";
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h fa` : `${h} h ${rest} min fa`;
}

const TIME = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  hour: "2-digit",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" });

/** "oggi alle 06:10", "ieri alle 22:10": un orario assoluto si legge meglio di "16 h fa". */
export function clock(ms: number, now: number): string {
  const d = DAY.format(ms);
  const day =
    d === DAY.format(now) ? "oggi" : d === DAY.format(now - 86_400_000) ? "ieri" : `il ${d}`;
  return `${day} alle ${TIME.format(ms)}`;
}

const people = (n: number) => (n === 1 ? "1 persona" : `${n} persone`);
const reports = (n: number) => (n === 1 ? "1 segnalazione" : `${n} segnalazioni`);
const confirmations = (n: number) => (n === 1 ? "1 conferma" : `${n} conferme`);

/**
 * `lastGreenMs`: quando il carburante è stato confermato disponibile l'ultima volta (fino a 24 ore,
 * dal registro anonimo). Si mostra solo sul grigio e solo per le disponibilità: un vecchio
 * "esaurito" non viene mai riproposto (ADR-0011, B).
 */
export function describeState(
  s: StateResult,
  now: number,
  lastGreenMs: number | null = null,
): StateLabel {
  const hasAbsences = s.absences > 0;
  const lastAbs = ago(s.lastAbsenceMs, now);
  const lastConf = ago(s.lastConfirmMs, now);

  // Indicazione del titolare: attribuita a QUI, mai confusa con le segnalazioni degli utenti.
  if (s.flags & Flag.OFFICIAL && (s.state === State.GREEN || s.state === State.RED)) {
    return {
      title: s.state === State.GREEN ? "Disponibile secondo QUI" : "Segnalato esaurito da QUI",
      detail: `indicazione di QUI ${lastConf}`,
      operatorLink: s.state === State.RED,
    };
  }

  if (s.state === State.GREY) {
    if (lastGreenMs !== null) {
      return {
        title: "Nessuna informazione recente",
        detail: `ultima disponibilità segnalata ${clock(lastGreenMs, now)}`,
        operatorLink: false,
      };
    }
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
