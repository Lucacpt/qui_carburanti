// La pagina d'attesa (public/presto.html) va in produzione al posto della lista finché
// PUBLIC_LAUNCH non vale 1 (scripts/deploy.ts): deve essere leggera, senza script e non indicizzata,
// perché viene servita anche per ognuna delle 230 schede /d/<id>.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = (p: string) => new URL(`../public/${p}`, import.meta.url);
const html = readFileSync(file("presto.html"), "utf8");
const css = readFileSync(file("presto.css"), "utf8");

const color = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];

/** Rapporto di contrasto WCAG 2.x tra due colori #rrggbb. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("public/presto.html", () => {
  it("non è indicizzata e non carica script", () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/<script/i);
  });

  it("dice che QUI arriva a brevissimo, con l'indirizzo da salvare", () => {
    expect(html).toContain("Arriviamo a brevissimo");
    expect(html).toContain("quicarburanti.it");
  });

  it("usa solo il proprio foglio di stile: la CSP (style-src 'self') blocca gli stili inline", () => {
    expect(html).toContain('<link rel="stylesheet" href="/presto.css">');
    expect(html).not.toMatch(/<style|\sstyle=/i);
  });

  it("il testo bianco sull'arancione e quello scuro sul bianco sono leggibili (WCAG AA, 4,5:1)", () => {
    const [orange, card, deep, white] = ["orange", "card", "deep", "white"].map(color);
    expect(orange && card && deep && white, "--orange, --card, --deep, --white").toBeTruthy();
    for (const bg of [orange, card, deep]) {
      expect(contrast(bg ?? "", white ?? ""), `${bg} col bianco`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("ogni link interno porta a una pagina che esiste", () => {
    for (const [, path] of html.matchAll(/href="\/([^"#]*)"/g)) {
      const p = path ?? "";
      const ok = p === "" || existsSync(file(p)) || existsSync(file(`${p}.html`));
      expect(ok, `/${p} non esiste`).toBe(true);
    }
  });
});
