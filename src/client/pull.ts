// Tira giù per aggiornare: in cima alla lista, trascinando verso il basso si ricarica lo stato e,
// se è attiva, la posizione. Qui la parte senza DOM; il gesto è onPullDown in view.ts.
// Il ricaricamento del browser azzererebbe l'ordinamento per distanza, quindi nella lista è spento
// (overscroll-behavior con la classe "ptr-on" su <html>, vedi app.css).

/** Spostamento del dito (px) oltre cui, al rilascio, si aggiorna. */
export const PULL_TRIGGER_PX = 90;
const PULL_MAX_PX = 150;
/** Sotto questa soglia il gesto è ancora indeciso: tocco, tremolio o scorrimento laterale. */
export const PULL_DEAD_ZONE_PX = 10;
/** Quanto resta visibile l'esito ("✓ Lista aggiornata"): chi tira giù deve sapere se è servito. */
export const PULL_RESULT_MS = 1_500;

/** Altezza dell'indicatore e se al rilascio si aggiorna, dato lo spostamento verticale del dito. */
export function pullProgress(dy: number): { height: number; ready: boolean } {
  const d = Math.max(0, Math.min(dy, PULL_MAX_PX));
  return { height: Math.round(d / 2), ready: dy >= PULL_TRIGGER_PX };
}
