// Tipi del dominio. Nessuna dipendenza da Cloudflare o dal DOM (SDD §3).

/** Carburanti tracciati: Benzina, Gasolio, GPL, Metano, HVO. */
export const FUELS = ["B", "G", "L", "M", "H"] as const;
export type Fuel = (typeof FUELS)[number];

/** Stati di una coppia (distributore, carburante). Valori numerici come nello snapshot (SDD §5.2). */
export const State = { GREY: 0, RED: 1, AMBER: 2, GREEN: 3 } as const;
export type State = (typeof State)[keyof typeof State];

/** Flag a bit che spiegano *perché* uno stato è ambra o congelato. */
export const Flag = { NONE: 0, FROZEN: 1, CONTESTED: 2, SINGLE_ABSENCE: 4 } as const;

/** Una segnalazione, così come la vede il dominio (già validata e anonimizzata dal Worker). */
export interface Report {
  /** true = "c'è carburante", false = "non c'è". */
  readonly has: boolean;
  /** Il client dichiara di essere entro ~150 m dal distributore. Non verificabile dal server. */
  readonly near: boolean;
  /** Ora del server, epoch ms. Mai l'ora del client. */
  readonly ts: number;
  /** Segnalatore anonimo: HMAC(K_giorno, prefisso IP ‖ token). */
  readonly rkey: string;
  /** Prefisso di rete anonimo: HMAC(K_giorno, prefisso IP). */
  readonly pkey: string;
}

export interface StateResult {
  readonly state: State;
  /** Segnalatori distinti che hanno confermato la presenza negli ultimi FRESH minuti. */
  readonly confirmations: number;
  /** Ora dell'ultima conferma di presenza (epoch ms), se esiste nella finestra. */
  readonly lastConfirmMs: number | null;
  /** Combinazione di valori `Flag`. */
  readonly flags: number;
}
