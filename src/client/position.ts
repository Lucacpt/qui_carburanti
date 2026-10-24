// Quando la posizione non arriva. Nei browser interni di Instagram e Facebook la geolocalizzazione
// spesso è bloccata, oppure la richiesta di permesso non compare mai e la risposta non arriva:
// il timeout dell'API parte solo dopo il permesso, quindi serve un limite nostro. Senza leggere lo
// user agent (niente fingerprinting, NFR-PR5) il messaggio cita Instagram e Facebook come ipotesi.

/** Oltre questo tempo si smette di aspettare: permesso mai chiesto o GPS che non risponde. */
export const POSITION_WAIT_MS = 20_000;
/** Dopo questo tempo si mostra già l'aiuto, continuando ad aspettare. */
export const POSITION_SLOW_MS = 6_000;

export class PositionTimeout extends Error {
  constructor() {
    super("posizione: nessuna risposta");
  }
}

/** `p`, oppure un errore PositionTimeout se non si risolve entro `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PositionTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const OPEN_IN_BROWSER =
  "Se hai aperto QUI da Instagram o Facebook, tocca ⋯ in alto e scegli «Apri nel browser».";

export const POSITION_HELP = {
  /** Permesso negato, API assente o nessuna risposta: quasi sempre un browser interno a un'app. */
  blocked: `Non riusciamo a leggere la tua posizione. ${OPEN_IN_BROWSER} Oppure scrivi il tuo comune qui sopra.`,
  /** Il telefono ha provato ma non ha trovato la posizione. */
  unavailable: "Posizione non trovata. Scrivi il tuo comune qui sopra, oppure riprova tra poco.",
  /** Si sta ancora aspettando. */
  slow: `Ci sta mettendo un po'. ${OPEN_IN_BROWSER} Oppure scrivi il tuo comune qui sopra.`,
} as const;

/** Nella segnalazione: senza posizione vale da remoto, ma dal browser si può segnalare dal posto. */
export const REPORT_REMOTE_HELP = `Posizione non disponibile: la segnalazione varrà come da remoto. Sei al distributore? ${OPEN_IN_BROWSER}`;

/** Il messaggio per un errore di getCurrentPosition (codici 1-3) o di withTimeout. */
export function positionHelp(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 2 || code === 3 ? POSITION_HELP.unavailable : POSITION_HELP.blocked;
}
