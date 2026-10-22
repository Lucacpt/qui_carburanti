// Dati del client: anagrafica (statica, in cache) e snapshot degli stati (ogni 90 s, con ETag).

import type { ProvinceRegistry } from "../domain/mimit.ts";
import { FUEL_BIT } from "../domain/mimit.ts";
import type { SnapshotRow } from "../domain/snapshot.ts";
import { FUELS, type Fuel } from "../domain/types.ts";
import type { Point } from "./geo.ts";
import { normalize } from "./search.ts";

export const FUEL_NAMES: Readonly<Record<Fuel, string>> = {
  B: "Benzina",
  G: "Gasolio",
  L: "GPL",
  M: "Metano",
  H: "HVO",
};

export interface Station extends Point {
  readonly id: number;
  readonly brand: string;
  readonly name: string;
  readonly address: string;
  readonly town: string;
  readonly fuels: readonly Fuel[];
  /** Testo normalizzato per la ricerca locale. */
  readonly text: string;
}

export interface SnapshotData {
  /** Ora del server in secondi. */
  readonly t: number;
  readonly readOnly: boolean;
  readonly rows: ReadonlyMap<string, SnapshotRow>;
  readonly frozen: ReadonlyMap<number, string>;
}

export const rowKey = (id: number, fuel: Fuel) => `${id}:${fuel}`;

export function fuelsFromMask(mask: number): Fuel[] {
  return FUELS.filter((f) => (mask & FUEL_BIT[f]) !== 0);
}

export function stationsFromRegistry(reg: ProvinceRegistry): Station[] {
  return reg.st.map(([id, latE5, lonE5, brandIdx, name, address, town, mask]) => {
    const brand = reg.brands[brandIdx] ?? "";
    return {
      id,
      lat: latE5 / 1e5,
      lon: lonE5 / 1e5,
      brand,
      name,
      address,
      town,
      fuels: fuelsFromMask(mask),
      text: normalize(`${brand} ${name} ${address} ${town}`),
    };
  });
}

export async function loadStations(prov: string): Promise<Station[]> {
  const manifest = (await (await fetch("/r/manifest.json", { cache: "no-cache" })).json()) as {
    files: Record<string, string>;
  };
  const file = manifest.files[prov];
  if (!file) throw new Error(`anagrafica assente per ${prov}`);
  return stationsFromRegistry((await (await fetch(`/r/${file}`)).json()) as ProvinceRegistry);
}

export async function loadSnapshot(prov: string): Promise<SnapshotData> {
  const res = await fetch(`/api/s/${prov}`);
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  const body = (await res.json()) as {
    t: number;
    ro: boolean;
    s: SnapshotRow[];
    fz?: [number, string][];
  };
  return {
    t: body.t,
    readOnly: body.ro,
    rows: new Map(body.s.map((row) => [rowKey(row[0], row[1]), row])),
    frozen: new Map(body.fz ?? []),
  };
}
