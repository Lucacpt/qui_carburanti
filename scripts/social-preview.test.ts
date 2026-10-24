// Anteprima dei link (Open Graph, docs/08-seo.md fase 1 punto 6). Su WhatsApp, il canale principale
// durante una crisi, un link senza immagine passa inosservato. Ogni pagina pubblica ha la stessa
// immagine, public/og.png, rigenerabile con: node scripts/og-image.ts

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORIGIN } from "./sitemap.ts";

const read = (p: string) => readFileSync(new URL(`../public/${p}`, import.meta.url));
// Le pagine che nessuno condivide restano fuori: 404 e area admin non sono indicizzate.
const PAGES = readdirSync(new URL("../public/", import.meta.url)).filter(
  (f) => f.endsWith(".html") && f !== "404.html" && f !== "admin.html",
);

// Spazi e a capo liberi tra gli attributi: l'editor manda a capo i tag lunghi (vedi privacy.html).
const meta = (html: string, key: string) =>
  new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"\\s*/?>`).exec(html)?.[1];

describe("public/og.png", () => {
  const png = read("og.png");

  it("è un PNG 1200×630, il formato largo di WhatsApp, Facebook e X", () => {
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it("pesa meno di 150 KB: le app di messaggistica scartano le immagini pesanti", () => {
    expect(png.length).toBeLessThan(150 * 1024);
  });
});

describe.each(PAGES)("%s", (file) => {
  const html = read(file).toString("utf8");

  it("ha titolo, descrizione e immagine assoluta per l'anteprima", () => {
    expect(meta(html, "og:type")).toBe("website");
    expect(meta(html, "og:locale")).toBe("it_IT");
    expect(meta(html, "og:title")).toBeTruthy();
    expect(meta(html, "og:description")?.length ?? 0).toBeGreaterThanOrEqual(80);
    expect(meta(html, "og:image")).toBe(`${ORIGIN}/og.png`);
    expect(meta(html, "og:image:width")).toBe("1200");
    expect(meta(html, "og:image:height")).toBe("630");
    expect(meta(html, "og:image:alt")).toBeTruthy();
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
  });

  it("og:url è l'indirizzo canonico, se la pagina ne ha uno solo", () => {
    const canonical = /<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/.exec(html)?.[1];
    if (file === "index.html") {
      // La shell dell'app serve anche /d/<id> e /dati: un og:url fisso farebbe confluire su
      // Facebook ogni scheda condivisa nella home.
      expect(meta(html, "og:url")).toBeUndefined();
    } else if (file === "presto.html") {
      // Prima del lancio la pagina d'attesa risponde a ogni indirizzo: è sempre la home.
      expect(meta(html, "og:url")).toBe(`${ORIGIN}/`);
    } else {
      expect(meta(html, "og:url")).toBe(canonical);
    }
  });
});
