// Parametri dell'algoritmo di stato (SDD §8, ADR-0006 rev. v0.3).
// I default vivono qui; il Durable Object può sovrascriverli a runtime dalla tabella `config`.

const MINUTE = 60_000;

export interface StateParams {
  /** Finestra in cui una conferma è "fresca". */
  readonly freshMs: number;
  /** Oltre questa età le segnalazioni vengono ignorate (e poi cancellate). */
  readonly windowMs: number;
  /** Peso di una segnalazione fatta sul posto. */
  readonly wNear: number;
  /** Peso di una segnalazione fatta da remoto (via ricerca). */
  readonly wRemote: number;
  /** Contributo massimo di un singolo prefisso di rete (CGNAT, Sybil da un solo IP). */
  readonly capPrefix: number;
  /** Peso minimo di conferme fresche per lo stato VERDE. */
  readonly greenMin: number;
  /** Peso minimo di assenze per lo stato ROSSO (serve anche almeno un'assenza sul posto). */
  readonly redMin: number;
}

export const DEFAULT_PARAMS: StateParams = {
  freshMs: 45 * MINUTE,
  windowMs: 8 * 60 * MINUTE,
  wNear: 1.0,
  wRemote: 0.5,
  capPrefix: 1.0,
  // v0.3.1: +1 persona rispetto alla v0.3 su richiesta del maintainer (verde e rosso da 2,0 a 3,0).
  greenMin: 3.0,
  redMin: 3.0,
};
