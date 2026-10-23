import { describe, expect, it } from "vitest";
import { buildSitemap, ORIGIN, PAGES } from "./sitemap.ts";

describe("sitemap", () => {
  const xml = buildSitemap([
    { id: 3686, lastmod: "2026-10-21" },
    { id: 3518, lastmod: "2026-10-21" },
  ]);

  it("contiene tutte le pagine del sito e una scheda per impianto, in ordine", () => {
    for (const p of PAGES) expect(xml).toContain(`<loc>${ORIGIN}${p}</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/d/3518</loc><lastmod>2026-10-21</lastmod>`);
    expect(xml.indexOf("/d/3518")).toBeLessThan(xml.indexOf("/d/3686"));
  });

  it("non contiene aree private o pagine senza valore per la ricerca", () => {
    for (const p of ["/admin", "/dati", "/api/", "404"]) expect(xml).not.toContain(p);
  });

  it("è XML valido nella forma attesa dal protocollo sitemaps.org", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    expect(xml.match(/<url>/g)).toHaveLength(PAGES.length + 2);
  });
});
