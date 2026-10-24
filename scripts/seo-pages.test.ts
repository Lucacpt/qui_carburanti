// Pagine statiche della fase 1 SEO: anagrafica sì, stato del carburante mai (docs/08-seo.md).

import { describe, expect, it } from "vitest";
import type { Station } from "../src/client/data.ts";
import { slugify, stationPage, type TownGroup, townPage, townsIndexPage } from "./seo-pages.ts";
import { buildSitemap } from "./sitemap.ts";

const st = (id: number, over: Partial<Station> = {}): Station => ({
  id,
  lat: 41.06517,
  lon: 15.31486,
  brand: "Agip Eni",
  name: "CALAGGIO SUD",
  address: "Autostrada A16, Km. 106+500",
  town: "VALLATA",
  fuels: ["B", "G"],
  text: "",
  ...over,
});
const town: TownGroup = {
  name: "Sant'Angelo dei Lombardi",
  slug: "sant-angelo-dei-lombardi",
  stations: [st(3518), st(3519, { brand: "Q8", name: "<script>" })],
};

const ld = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].flatMap((m) => {
    const v = JSON.parse(m[1] ?? "null");
    return Array.isArray(v) ? v : [v];
  });

describe("slugify", () => {
  it("minuscole, niente accenti, apostrofi e spazi diventano trattini", () => {
    expect(slugify("Sant'Angelo dei Lombardi")).toBe("sant-angelo-dei-lombardi");
    expect(slugify("Chiusano di San Domenico")).toBe("chiusano-di-san-domenico");
    expect(slugify("Cassano Irpino")).toBe("cassano-irpino");
    expect(slugify("Lapìo")).toBe("lapio");
  });
});

describe("scheda statica di un impianto", () => {
  const html = stationPage(st(3518), town, "2026-10-21");

  it("ha una sola h1, il canonical, il title del piano e carica l'app", () => {
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('<link rel="canonical" href="https://quicarburanti.it/d/3518">');
    expect(html).toContain(
      "<title>Agip Eni CALAGGIO SUD, Sant&#39;Angelo dei Lombardi: c&#39;è carburante? — QUI</title>",
    );
    expect(html).toContain('<script type="module" src="/app.js"></script>');
    expect(html).toContain('<main id="app"');
  });

  it("JSON-LD: GasStation con indirizzo e coordinate, breadcrumb; mai valutazioni", () => {
    const [station, crumbs] = ld(html);
    expect(station["@type"]).toBe("GasStation");
    expect(station.geo).toEqual({
      "@type": "GeoCoordinates",
      latitude: 41.06517,
      longitude: 15.31486,
    });
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement.map((i: { item: string }) => i.item)).toEqual([
      "https://quicarburanti.it/",
      "https://quicarburanti.it/comune/sant-angelo-dei-lombardi",
      "https://quicarburanti.it/d/3518",
    ]);
    expect(html).not.toMatch(/aggregateRating|review/i);
  });

  it("MAI uno stato del carburante nell'HTML statico (la regola d'oro del piano)", () => {
    expect(html).not.toMatch(/disponibile|esaurit|segnalat[oa] |confermat|nessuna informazione/i);
  });

  it("cita la fonte MIMIT e la data dell'anagrafica", () => {
    expect(html).toContain("IODL 2.0");
    expect(html).toContain("2026-10-21");
  });
});

describe("pagina di un comune e indice", () => {
  it("elenca gli impianti con i link alle schede e testo sicuro", () => {
    const html = townPage(town, "2026-10-21");
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('<a href="/d/3518">Agip Eni CALAGGIO SUD</a>');
    expect(html).toContain("Q8 &#60;script&#62;");
    expect(html).not.toContain("<script>");
    expect(ld(html)[0]["@type"]).toBe("ItemList");
    expect(html).toContain('href="/?q=Sant\'Angelo%20dei%20Lombardi"');
    expect(html).not.toMatch(/disponibile|esaurit/i);
  });

  it("l'indice porta a ogni comune con il numero di impianti", () => {
    const html = townsIndexPage([town], "2026-10-21");
    expect(html).toContain(
      '<a href="/comune/sant-angelo-dei-lombardi">Sant&#39;Angelo dei Lombardi</a> (2)',
    );
  });
});

describe("sitemap con i comuni", () => {
  it("aggiunge /comuni e una pagina per comune", () => {
    const xml = buildSitemap(
      [{ id: 1, lastmod: "2026-10-21" }],
      [{ slug: "vallata", lastmod: "2026-10-21" }],
    );
    expect(xml).toContain("<loc>https://quicarburanti.it/comuni</loc>");
    expect(xml).toContain(
      "<loc>https://quicarburanti.it/comune/vallata</loc><lastmod>2026-10-21</lastmod>",
    );
  });
});
