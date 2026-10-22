// Ricerca locale sull'anagrafica (ADR-0007): nessuna richiesta di rete, nessun geocoder.

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
