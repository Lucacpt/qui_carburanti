// Sitemap XML di QUI (docs/08-seo.md): le pagine del sito più una scheda per impianto.
// Funzione pura, testata in sitemap.test.ts; la scrive scripts/build-sitemap.ts durante la build.

export const ORIGIN = "https://quicarburanti.it";

/** Pagine indicizzabili. Fuori, di proposito: /admin, /dati (dati locali), /api/*, 404. */
export const PAGES: readonly string[] = [
  "/",
  "/come-funziona",
  "/progetto",
  "/privacy",
  "/termini",
  "/cookie",
];

export interface SitemapStation {
  readonly id: number;
  /** Data dell'estrazione MIMIT da cui vengono i dati della scheda (AAAA-MM-GG). */
  readonly lastmod: string;
}

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

function url(loc: string, lastmod?: string): string {
  const mod = lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  return `  <url><loc>${escapeXml(`${ORIGIN}${loc}`)}</loc>${mod}</url>`;
}

export function buildSitemap(stations: readonly SitemapStation[]): string {
  const ids = [...stations].sort((a, b) => a.id - b.id);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...PAGES.map((p) => url(p)),
    ...ids.map((s) => url(`/d/${s.id}`, s.lastmod)),
    "</urlset>",
    "",
  ].join("\n");
}
