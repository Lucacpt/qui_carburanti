// Comuni di una provincia con il loro centro (Wikidata, CC0). Servono a cercare i distributori più
// vicini a un comune che non ne ha: la ricerca resta sul telefono, senza geocoder (ADR-0007).

/** [nome, latitudine × 1e5, longitudine × 1e5], come le coordinate dell'anagrafica. */
export type TownRow = [name: string, latE5: number, lonE5: number];

export interface TownsFile {
  readonly v: 1;
  readonly prov: string;
  readonly src: string;
  readonly date: string;
  readonly co: TownRow[];
}

interface ProvinceTowns {
  /** Prefisso del codice ISTAT dei comuni della provincia. */
  readonly istat: string;
  /** Numero di comuni secondo l'elenco ISTAT: se cambia (fusioni), l'import si ferma. */
  readonly count: number;
  readonly bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
}

export const PROVINCE_TOWNS: Readonly<Record<string, ProvinceTowns>> = {
  AV: {
    istat: "064",
    count: 118,
    bbox: { latMin: 40.6, latMax: 41.4, lonMin: 14.4, lonMax: 15.7 },
  },
};

/** Una riga dei risultati SPARQL di Wikidata (scripts/import-comuni.ts). */
export interface WikidataBinding {
  readonly istat: { readonly value: string };
  readonly nome: { readonly value: string };
  readonly coord: { readonly value: string };
}

/** Un comune per codice ISTAT (Wikidata può avere più coordinate), ordinati per nome. */
export function townsFromWikidata(bindings: readonly WikidataBinding[]): TownRow[] {
  const byCode = new Map<string, TownRow>();
  for (const b of bindings) {
    if (byCode.has(b.istat.value)) continue;
    const m = /^Point\(([-0-9.]+) ([-0-9.]+)\)$/.exec(b.coord.value);
    if (!m) continue;
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    byCode.set(b.istat.value, [b.nome.value.trim(), Math.round(lat * 1e5), Math.round(lon * 1e5)]);
  }
  return [...byCode.values()].sort((a, b) => a[0].localeCompare(b[0], "it"));
}

export function validateTowns(rows: readonly TownRow[], prov: string): string[] {
  const p = PROVINCE_TOWNS[prov];
  if (!p) return [`provincia ${prov} senza comuni configurati (PROVINCE_TOWNS)`];
  const errors: string[] = [];
  if (rows.length !== p.count) {
    errors.push(
      `${prov}: ${rows.length} comuni invece di ${p.count} (fusioni? verifica l'elenco ISTAT)`,
    );
  }
  for (const [name, latE5, lonE5] of rows) {
    const lat = latE5 / 1e5;
    const lon = lonE5 / 1e5;
    if (!name) errors.push("comune senza nome");
    if (lat < p.bbox.latMin || lat > p.bbox.latMax || lon < p.bbox.lonMin || lon > p.bbox.lonMax) {
      errors.push(`${name}: coordinate fuori provincia (${lat}, ${lon})`);
    }
  }
  return errors;
}
