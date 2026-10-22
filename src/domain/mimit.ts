// Parsing dei file open data MIMIT e costruzione dell'anagrafica compatta per provincia.
// SDD §5.1 e §7.3; mappatura carburanti nel report v0.3 §5.1.

import type { Fuel } from "./types.ts";

export interface MimitFile {
  /** Data della riga "Estrazione del AAAA-MM-GG". */
  readonly extractedOn: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** La prima riga è "Estrazione del ...", la seconda l'intestazione. Separatore `|` (dal 10/02/2026) o `;`. */
export function parseMimitCsv(text: string): MimitFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const m = /^Estrazione del (\d{4}-\d{2}-\d{2})/.exec(lines[0] ?? "");
  if (!m?.[1]) throw new Error("MIMIT: manca la riga 'Estrazione del AAAA-MM-GG'");
  const headerLine = lines[1];
  if (headerLine === undefined) throw new Error("MIMIT: manca l'intestazione");
  const sep = headerLine.includes("|") ? "|" : ";";
  return {
    extractedOn: m[1],
    header: headerLine.split(sep).map((h) => h.trim()),
    rows: lines.slice(2).map((l) => l.split(sep)),
  };
}

// L'ordine conta: "Gasolio HVO" deve diventare HVO, non gasolio.
const FUEL_RULES: ReadonlyArray<readonly [RegExp, Fuel]> = [
  [/hvo/i, "H"],
  [/gpl/i, "L"],
  [/metano|l-gnc|\bgnc\b/i, "M"],
  [/gasolio|diesel/i, "G"],
  [/benzina|super|perform/i, "B"],
];

/** Descrizione commerciale MIMIT → categoria QUI. `null` per ciò che non tracciamo (es. GNL per camion). */
export function classifyFuel(desc: string): Fuel | null {
  if (/gnl/i.test(desc)) return null;
  for (const [re, fuel] of FUEL_RULES) if (re.test(desc)) return fuel;
  return null;
}

export const FUEL_BIT: Readonly<Record<Fuel, number>> = { B: 1, G: 2, L: 4, M: 8, H: 16 };
const DEFAULT_FUELS = FUEL_BIT.B | FUEL_BIT.G;

/** [idImpianto, latE5, lonE5, brandIdx, nome, indirizzo, comune, fuelsMask] */
export type RegistryRow = [number, number, number, number, string, string, string, number];

export interface ProvinceRegistry {
  readonly v: 1;
  readonly prov: string;
  readonly src: string;
  readonly date: string;
  readonly brands: string[];
  readonly st: RegistryRow[];
}

function col(file: MimitFile, name: string): number {
  const i = file.header.indexOf(name);
  if (i < 0) throw new Error(`MIMIT: colonna '${name}' assente`);
  return i;
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Bounding box larga dell'Italia: scarta coordinate assenti, a zero o invertite. */
function plausibleItaly(lat: number, lon: number): boolean {
  return lat > 35 && lat < 48 && lon > 6 && lon < 19;
}

export function buildProvinceRegistry(
  anag: MimitFile,
  prezzi: MimitFile,
  prov: string,
): ProvinceRegistry {
  const [cId, cBrand, cName, cAddr, cTown, cProv, cLat, cLon] = [
    "idImpianto",
    "Bandiera",
    "Nome Impianto",
    "Indirizzo",
    "Comune",
    "Provincia",
    "Latitudine",
    "Longitudine",
  ].map((n) => col(anag, n)) as [number, number, number, number, number, number, number, number];

  const fuels = new Map<number, number>();
  const pId = col(prezzi, "idImpianto");
  const pDesc = col(prezzi, "descCarburante");
  for (const row of prezzi.rows) {
    const fuel = classifyFuel(row[pDesc] ?? "");
    const id = Number(row[pId]);
    if (fuel !== null && Number.isInteger(id)) fuels.set(id, (fuels.get(id) ?? 0) | FUEL_BIT[fuel]);
  }

  const brands: string[] = [];
  const st: RegistryRow[] = [];
  for (const row of anag.rows) {
    if (clean(row[cProv]) !== prov) continue;
    const id = Number(row[cId]);
    const lat = Number(row[cLat]);
    const lon = Number(row[cLon]);
    if (!Number.isInteger(id) || !plausibleItaly(lat, lon)) continue;
    const brand = clean(row[cBrand]) || "Pompe Bianche";
    let bi = brands.indexOf(brand);
    if (bi < 0) bi = brands.push(brand) - 1;
    st.push([
      id,
      Math.round(lat * 1e5),
      Math.round(lon * 1e5),
      bi,
      clean(row[cName]),
      clean(row[cAddr]),
      clean(row[cTown]),
      fuels.get(id) ?? DEFAULT_FUELS,
    ]);
  }
  st.sort((a, b) => a[0] - b[0]);
  return { v: 1, prov, src: "MIMIT, licenza IODL 2.0", date: anag.extractedOn, brands, st };
}

/** Controlli prima di pubblicare: niente anagrafica vuota né variazioni anomale rispetto a ieri. */
export function validateRegistry(reg: ProvinceRegistry, previousCount?: number): string[] {
  const errors: string[] = [];
  if (reg.st.length === 0) errors.push(`${reg.prov}: nessun impianto`);
  if (previousCount !== undefined && previousCount > 0) {
    const delta = Math.abs(reg.st.length - previousCount) / previousCount;
    if (delta > 0.1) {
      errors.push(`${reg.prov}: ${previousCount} → ${reg.st.length} impianti (variazione > 10%)`);
    }
  }
  return errors;
}
