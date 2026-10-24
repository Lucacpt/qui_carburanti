// La pagina d'attesa (public/presto.html) va in produzione al posto della lista finché
// PUBLIC_LAUNCH non vale 1 (scripts/deploy.ts): deve essere leggera, senza script e non indicizzata,
// perché viene servita anche per ognuna delle 230 schede /d/<id>.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = (p: string) => new URL(`../public/${p}`, import.meta.url);
const html = readFileSync(file("presto.html"), "utf8");

describe("public/presto.html", () => {
  it("non è indicizzata e non carica script", () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/<script/i);
  });

  it("dice che QUI arriva a brevissimo, con l'indirizzo da salvare", () => {
    expect(html).toContain("Arriviamo a brevissimo");
    expect(html).toContain("quicarburanti.it");
  });

  it("ogni link interno porta a una pagina che esiste", () => {
    for (const [, path] of html.matchAll(/href="\/([^"#]*)"/g)) {
      const p = path ?? "";
      const ok = p === "" || existsSync(file(p)) || existsSync(file(`${p}.html`));
      expect(ok, `/${p} non esiste`).toBe(true);
    }
  });
});
