// Ricerca locale sull'anagrafica (ADR-0007): nessuna richiesta di rete, nessun geocoder.

import { nearby, type Point } from "./geo.ts";

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

/**
 * I distributori attorno a un comune cercato, come se chi cerca fosse al suo centro: quelli entro
 * `radiusKm` (o almeno i `min` più vicini) più tutti quelli del comune, anche se è molto esteso.
 */
export function townArea<T extends Point & { readonly town: string }>(
  stations: readonly T[],
  town: Town,
  radiusKm: number,
  min: number,
): T[] {
  const area = new Set(nearby(stations, town, radiusKm, min));
  for (const s of stations) if (normalize(s.town) === town.key) area.add(s);
  return [...area];
}

/** Inizio di un indirizzo vero: le altre righe MIMIT ("STARZE", "MANFREDI 97") non si propongono. */
const STREET_START =
  /^(via|viale|corso|piazza|piazzale|largo|vico|traversa|contrada|localit[aà]|strada|statale|provinciale|nazionale|variante|s\.s\.|ss\d*|ex)$/i;
/** Dopo queste parole un numero fa parte del nome ("Statale 7"), non è un civico. */
const ROAD_CLASS = /^(statale|provinciale|strada|s\.s\.|ss|sp|autostrada)$/i;
const LOWER = new Set(["di", "de", "del", "della", "delle", "dei", "degli", "dello", "e", "a"]);
const UPPER = /^(s\.s\.|ss\d*|sp\d*|a\d+)$/i;

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      UPPER.test(w)
        ? w.toUpperCase()
        : i > 0 && LOWER.has(w)
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/**
 * La via di un indirizzo MIMIT, per l'autocompletamento: "VIA ROMA 422 83032" → "Via Roma".
 * Senza civico, CAP, "SNC" e chilometri; null se non sembra una via.
 */
export function streetName(address: string): string | null {
  const head = (address.split(/,| - /)[0] ?? "")
    .replace(/^via via /i, "via ")
    .replace(/^(c\.da|cda)\s/i, "contrada ")
    .replace(/^loc\.?\s/i, "località ");
  const words: string[] = [];
  for (const w of head.trim().split(/\s+/)) {
    if (/^(snc|sn|km\.?|\d{5})$/i.test(w)) break;
    if (/^\d/.test(w) && !ROAD_CLASS.test(words.at(-1) ?? "")) break;
    words.push(w);
  }
  if (words.length < 2 || !STREET_START.test(words[0] ?? "")) return null;
  return titleCase(words.join(" "));
}

/** Suggerimenti per la ricerca: i comuni, poi le vie dei distributori con il loro comune. */
export function searchSuggestions(
  towns: readonly Town[],
  stations: ReadonlyArray<{ readonly address: string; readonly town: string }>,
): string[] {
  const names = new Map(towns.map((t) => [t.key, t.name]));
  const streets = new Set<string>();
  for (const s of stations) {
    const street = streetName(s.address);
    if (street) streets.add(`${street}, ${names.get(normalize(s.town)) ?? titleCase(s.town)}`);
  }
  const collator = new Intl.Collator("it");
  return [
    ...towns.map((t) => t.name).sort(collator.compare),
    ...[...streets].sort(collator.compare),
  ];
}
