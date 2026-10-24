// Calcoli geografici, solo sul dispositivo: la posizione non lascia mai il telefono (NFR-PR1).

export interface Point {
  readonly lat: number;
  readonly lon: number;
}

/** Raggio entro cui una segnalazione vale "sul posto" (le coordinate MIMIT possono sbagliare di 100 m). */
export const NEAR_KM = 0.15;

export function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  return `${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km`;
}

/**
 * I punti entro `maxKm` da `p`, o almeno i `min` più vicini se entro quel raggio ce ne sono meno
 * (es. i distributori attorno a un comune che non ne ha). Ordinati per distanza.
 */
export function nearby<T extends Point>(
  items: readonly T[],
  p: Point,
  maxKm: number,
  min: number,
): T[] {
  const byDistance = items
    .map((item) => ({ item, km: distanceKm(p, item) }))
    .sort((a, b) => a.km - b.km);
  const within = byDistance.filter((x) => x.km <= maxKm);
  return (within.length >= min ? within : byDistance.slice(0, min)).map((x) => x.item);
}

/** Centro medio di un insieme di punti (es. i distributori di un comune). */
export function centroid(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), {
    lat: 0,
    lon: 0,
  });
  return { lat: sum.lat / points.length, lon: sum.lon / points.length };
}

/** Gli `n` elementi più vicini a `p` tra quelli che soddisfano `keep`, a qualunque distanza. */
export function closest<T extends Point>(
  items: readonly T[],
  p: Point,
  n: number,
  keep: (item: T) => boolean,
): T[] {
  return items
    .filter(keep)
    .map((item) => ({ item, km: distanceKm(p, item) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n)
    .map((x) => x.item);
}
