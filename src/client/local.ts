// Ciò che QUI salva sul telefono (e solo lì): token anti-spam, preferenze, un contatore privato.
// Il token nasce solo alla PRIMA segnalazione: chi consulta e basta non riceve nulla (ADR-0005 rev. v0.3).

import type { MapsApp } from "./nav.ts";

/** Elenco completo: la cookie policy deve citarle tutte (lo verifica scripts/legal-pages.test.ts). */
export const STORAGE_KEYS = {
  token: "qui.token",
  notice: "qui.notice",
  maps: "qui.maps",
  helped: "qui.helped",
  fuel: "qui.fuel",
} as const;
const K = STORAGE_KEYS;
const PREFIX = "qui.";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // modalità privata o archivio pieno: si continua senza ricordare
  }
}

const today = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-GG in ora locale

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Token del giorno, ruotato a mezzanotte. `null` se l'utente non ha mai segnalato. */
export function currentToken(): string | null {
  const raw = get(K.token);
  if (!raw) return null;
  const [day, token] = raw.split("|");
  return day === today() && token ? token : null;
}

export function newToken(): string {
  const token = base64url(crypto.getRandomValues(new Uint8Array(16)));
  set(K.token, `${today()}|${token}`);
  return token;
}

export const noticeSeen = () => get(K.notice) === "1";
export const markNoticeSeen = () => set(K.notice, "1");

export function mapsApp(): MapsApp {
  const v = get(K.maps);
  return v === "apple" || v === "geo" ? v : "google";
}
export const setMapsApp = (app: MapsApp) => set(K.maps, app);

export function helpedCount(): number {
  return Number(get(K.helped) ?? "0") || 0;
}
export function incrementHelped(): number {
  const n = helpedCount() + 1;
  set(K.helped, String(n));
  return n;
}

export const savedFuel = () => get(K.fuel);
export const saveFuel = (fuel: string) => set(K.fuel, fuel);

// ------------------------------------------------------------------ pagina "I tuoi dati"

const LABELS: Record<string, string> = {
  [K.token]: "Codice anti-spam del giorno",
  [K.notice]: "Hai già letto l'avviso sulle segnalazioni",
  [K.maps]: "App di navigazione preferita",
  [K.helped]: "Quante volte hai aiutato",
  [K.fuel]: "Carburante scelto nel filtro",
};

function ourKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
  } catch {
    return [];
  }
}

/** Tutto ciò che QUI ha salvato su questo dispositivo, anche chiavi di versioni precedenti. */
export function storedData(): Array<{ key: string; label: string; value: string }> {
  return ourKeys().map((key) => ({ key, label: LABELS[key] ?? key, value: get(key) ?? "" }));
}

export function clearStoredData(): void {
  for (const key of ourKeys()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // archivio non accessibile: non c'è nulla da cancellare
    }
  }
}
