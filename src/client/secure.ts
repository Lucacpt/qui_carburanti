// Fuori da HTTPS il browser spegne la posizione e la crittografia del PoW (secure context): un link
// senza "https://" aperto da Instagram arriva in http://. Si passa subito alla versione sicura.
// Rete di sicurezza: il rimedio vero è "Always Use HTTPS" su Cloudflare (docs/procedure/rilascio.md).

export interface PageLocation {
  readonly protocol: string;
  readonly hostname: string;
  readonly host: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

/** L'indirizzo https della pagina, o null se è già sicura (o è lo sviluppo in locale). */
export function secureUrl(loc: PageLocation): string | null {
  if (loc.protocol !== "http:" || loc.hostname === "localhost" || loc.hostname === "127.0.0.1") {
    return null;
  }
  return `https://${loc.host}${loc.pathname}${loc.search}${loc.hash}`;
}
