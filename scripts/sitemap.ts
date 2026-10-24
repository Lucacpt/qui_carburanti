// Sitemap XML di QUI (docs/08-seo.md): le pagine del sito più una scheda per impianto.
// Funzione pura, testata in sitemap.test.ts; la scrive scripts/build-seo.ts durante la build.

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

/** `towns`: gli slug delle pagine dei comuni con impianti (fase 1), più l'indice /comuni. */
export function buildSitemap(
  stations: readonly SitemapStation[],
  towns: ReadonlyArray<{ readonly slug: string; readonly lastmod: string }> = [],
): string {
  const ids = [...stations].sort((a, b) => a.id - b.id);
  const slugs = [...towns].sort((a, b) => a.slug.localeCompare(b.slug));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...PAGES.map((p) => url(p)),
    ...(slugs.length > 0 ? [url("/comuni", slugs[0]?.lastmod)] : []),
    ...slugs.map((t) => url(`/comune/${t.slug}`, t.lastmod)),
    ...ids.map((s) => url(`/d/${s.id}`, s.lastmod)),
    "</urlset>",
    "",
  ].join("\n");
}
