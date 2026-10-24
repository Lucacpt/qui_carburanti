// Ricerca locale sull'anagrafica (ADR-0007): nessuna richiesta di rete, nessun geocoder.

import type { Point } from "./geo.ts";

/** Un comune della provincia con il suo centro (Wikidata), anche se non ha distributori. */
export interface Town extends Point {
  readonly name: string;
  /** Nome normalizzato, per la ricerca. */
  readonly key: string;
}

const ABBREVIATIONS: Record<string, string> = {
  "v.le": "viale",
  "p.zza": "piazza",
  "p.za": "piazza",
  "c.so": "corso",
  "c.da": "contrada",
  "loc.": "localita",
  "fraz.": "frazione",
  "s.s.": "statale",
  ss: "statale",
  "s.p.": "provinciale",
  sp: "provinciale",
};

/** minuscolo, senza accenti, abbreviazioni MIMIT espanse, solo lettere e cifre. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .join(" ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Ogni parola della ricerca deve essere l'inizio di una parola del testo ("aria" trova "Ariano"). */
export function matches(normalizedText: string, query: string): boolean {
  const q = normalize(query).split(" ").filter(Boolean);
  if (q.length === 0) return true;
  const words = normalizedText.split(" ");
  return q.every((t) => words.some((w) => w.startsWith(t)));
}

/**
 * Il comune che la ricerca indica: il nome esatto, altrimenti il più corto che corrisponde
 * ("chius" → Chiusano di San Domenico). Il nome scelto viene mostrato, così chi cerca vede se
 * deve scrivere di più.
 */
export function findTown(towns: readonly Town[], query: string): Town | null {
  const q = normalize(query);
  if (!q) return null;
  const exact = towns.find((t) => t.key === q);
  if (exact) return exact;
  const hits = towns.filter((t) => matches(t.key, query));
  return hits.reduce<Town | null>(
    (best, t) => (!best || t.key.length < best.key.length ? t : best),
    null,
  );
}
