// Link verso il navigatore (FR-06): si passa SOLO la destinazione, mai la posizione di partenza.
// L'app la sceglie l'utente (niente lettura dello user agent: sarebbe fingerprinting).

export type MapsApp = "google" | "apple" | "geo";

export const MAPS_APPS: ReadonlyArray<{ id: MapsApp; label: string }> = [
  { id: "google", label: "Google Maps" },
  { id: "apple", label: "Apple Mappe" },
  { id: "geo", label: "Altra app" },
];

export function directionsUrl(app: MapsApp, lat: number, lon: number, name: string): string {
  const dest = `${lat},${lon}`;
  if (app === "apple") return `https://maps.apple.com/?daddr=${dest}&dirflg=d`;
  if (app === "geo") return `geo:${dest}?q=${dest}(${encodeURIComponent(name)})`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

export const stationPath = (id: number) => `/d/${id}`;

export function parseStationPath(pathname: string): number | null {
  const m = /^\/d\/(\d{1,7})\/?$/.exec(pathname);
  return m?.[1] ? Number(m[1]) : null;
}
