import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLlmsFull, htmlToText } from "./llms.ts";
import { ORIGIN, PAGES } from "./sitemap.ts";

const publicFile = (p: string) => new URL(`../public/${p}`, import.meta.url);

describe("htmlToText", () => {
  it("tiene solo <main>, con titoli, elenchi e link assoluti", () => {
    const html =
      '<header><h1>QUI</h1></header><main><h2>Titolo</h2><p>Vedi la <a href="/privacy">privacy</a> &amp; altro.</p><ul><li>uno</li><li>due</li></ul></main><footer>x</footer>';
    expect(htmlToText(html)).toBe(
      `## Titolo\n\nVedi la [privacy](${ORIGIN}/privacy) & altro.\n\n- uno\n- due`,
    );
  });

  it("nessun tag sopravvive, nemmeno annidato o spezzato, né rinasce dalle entità", () => {
    for (const html of [
      "<main><scr<script>ipt>alert(1)</script></main>",
      "<main><<b>img src=x onerror=alert(1)>></main>",
      "<main>&lt;script&gt;alert(1)&lt;/script&gt;</main>",
      "<main><p>testo</p><script</main>",
    ]) {
      expect(htmlToText(html), html).not.toMatch(/[<>]/);
    }
  });
});

describe("llms-full.txt", () => {
  const towns = new Map([
    ["AVELLINO", 22],
    ["VALLATA", 1],
  ]);
  const full = buildLlmsFull([{ path: "/progetto", html: "<main><p>Testo.</p></main>" }], {
    date: "2026-10-21",
    towns,
  });

  it("dice come citare QUI e non contiene stati in tempo reale", () => {
    expect(full).toContain("mai come un fatto certo");
    expect(full).not.toMatch(/Disponibile alle|esaurito dalle/);
  });

  it("riporta copertura, fonte, data e comuni dell'anagrafica", () => {
    expect(full).toContain("23 distributori in 2 comuni");
    expect(full).toContain("MIMIT, licenza IODL 2.0) estratta il 2026-10-21");
    expect(full).toContain("AVELLINO (22), VALLATA (1)");
    expect(full).toContain(`Fonte: ${ORIGIN}/progetto`);
  });
});

describe("public/llms.txt", () => {
  const text = readFileSync(publicFile("llms.txt"), "utf8");

  it("segue il formato llmstxt.org: titolo, riassunto, sezioni di link", () => {
    expect(text.startsWith("# QUI")).toBe(true);
    expect(text).toMatch(/^> .+/m);
    expect(text).toMatch(/^## Pagine$/m);
  });

  it("ogni link interno porta a una pagina o a un file che esiste", () => {
    const generated = ["sitemap.xml", "llms-full.txt", ".well-known/security.txt"];
    for (const [, path] of text.matchAll(/\]\(https:\/\/quicarburanti\.it(\/[^)]*)\)/g)) {
      const p = path ?? "";
      const ok =
        PAGES.includes(p) || generated.includes(p.slice(1)) || existsSync(publicFile(p.slice(1)));
      expect(ok, `${p} non esiste`).toBe(true);
    }
  });
});
