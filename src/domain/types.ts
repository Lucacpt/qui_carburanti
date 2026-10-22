// Tipi del dominio. Nessuna dipendenza da Cloudflare o dal DOM (SDD §3).

/** Carburanti tracciati: Benzina, Gasolio, GPL, Metano, HVO. */
export const FUELS = ["B", "G", "L", "M", "H"] as const;
export type Fuel = (typeof FUELS)[number];

/** Stati di una coppia (distributore, carburante). Valori numerici come nello snapshot (SDD §5.2). */
export const State = { GREY: 0, RED: 1, AMBER: 2, GREEN: 3 } as const;
export type State = (typeof State)[keyof typeof State];

/** Flag a bit che spiegano *perché* uno stato è ambra o congelato. */
export const Flag = {
  NONE: 0,
  /** Stato fissato dai maintainer (es. contestazione del gestore). Impostato dal Durable Object. */
  FROZEN: 1,
  /** Era verde, poi sono arrivate assenze non ancora sufficienti per il rosso. */
  CONTESTED: 2,
  /** Assenze segnalate ma non sufficienti per il rosso (poche, o nessuna sul posto). */
  SINGLE_ABSENCE: 4,
  /** Assenze sufficienti per il rosso, ma arrivate tutte negli ultimi `redHoldMs`: rosso in verifica. */
  RED_PENDING: 8,
  /** Era rosso, ma l'ultima assenza è più vecchia di `redTtlMs`: il distributore può essere stato rifornito. */
  RED_EXPIRED: 16,
} as const;

/** Coda segnalata insieme a una conferma: 1 nessuna, 2 breve (< 15'), 3 lunga (> 15'). */
export type Queue = 1 | 2 | 3;

/** Una segnalazione, così come la vede il dominio (già validata e anonimizzata dal Worker). */
export interface Report {
  /** Facoltativo, solo con `has = true`. */
  readonly queue?: Queue | undefined;
  /** Limite di erogazione segnalato, facoltativo, solo con `has = true`. */
  readonly limit?: boolean | undefined;
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
  /** Segnalatori distinti che hanno segnalato l'assenza dopo l'ultima conferma. */
  readonly absences: number;
  /** Ora dell'ultima assenza successiva all'ultima conferma (epoch ms), se esiste. */
  readonly lastAbsenceMs: number | null;
  /** Combinazione di valori `Flag`. */
  readonly flags: number;
}
