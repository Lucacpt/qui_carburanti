// Ciò che QUI salva sul telefono (e solo lì): token anti-spam, preferenze, un contatore privato.
// Il token nasce solo alla PRIMA segnalazione: chi consulta e basta non riceve nulla (ADR-0005 rev. v0.3).

import type { MapsApp } from "./nav.ts";

const K = {
  token: "qui.token",
  notice: "qui.notice",
  maps: "qui.maps",
  helped: "qui.helped",
  fuel: "qui.fuel",
} as const;

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
