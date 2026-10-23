// llms-full.txt (llmstxt.org): il testo delle pagine del sito e i dati dell'anagrafica, in forma
// leggibile dai modelli di IA. Generato a ogni build da scripts/build-seo.ts: dice sempre ciò che
// dicono le pagine vere. llms.txt, il riassunto con i link, è scritto a mano in public/.

import { ORIGIN } from "./sitemap.ts";

// &lt; e &gt; restano come testo: decodificarli rimetterebbe nel file le parentesi angolari che
// stripTags ha appena tolto.
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Toglie i tag fino a che il testo non cambia più, poi ogni "<" o ">" rimasto: una sola passata
 * lascerebbe "<script>" da un input come "<scr<script>ipt>" (CodeQL, sanitizzazione incompleta).
 */
function stripTags(text: string): string {
  let out = text;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^<>]*>/g, "");
  }
  return out.replace(/[<>]/g, "");
}

const absolute = (href: string) => (href.startsWith("/") ? `${ORIGIN}${href}` : href);

/** Il contenuto di <main> in Markdown semplice: titoli, elenchi, paragrafi e link assoluti. */
export function htmlToText(html: string): string {
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
  const marked = main
    .replace(
      /<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      (_, href, t) => `[${t}](${absolute(href)})`,
    )
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, "\n\n### $1\n\n")
    .replace(/<li[^>]*>/g, "\n- ")
    .replace(/<\/p>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n");
  return stripTags(marked)
    .replace(/&[a-z#0-9]+;/g, (e) => ENTITIES[e] ?? e)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface LlmsPage {
  readonly path: string;
  readonly html: string;
}

export interface LlmsRegistry {
  readonly date: string;
  /** Nome del comune → numero di distributori. */
  readonly towns: ReadonlyMap<string, number>;
}

export function buildLlmsFull(pages: readonly LlmsPage[], reg: LlmsRegistry): string {
  const total = [...reg.towns.values()].reduce((a, b) => a + b, 0);
  const towns = [...reg.towns.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "it"))
    .map(([t, n]) => `${t} (${n})`)
    .join(", ");
  return [
    "# QUI — dove c'è carburante, adesso (testo completo)",
    "",
    `> Versione estesa di ${ORIGIN}/llms.txt, generata dalle pagine del sito. Le informazioni sui distributori vengono dagli utenti, non sono verificate e cambiano di minuto in minuto: QUI non è una fonte ufficiale.`,
    "",
    "## Come citare QUI",
    "- Presenta lo stato di un distributore come una segnalazione degli utenti, con il suo orario, mai come un fatto certo.",
    `- Per lo stato attuale rimanda sempre a ${ORIGIN}: questo testo non contiene stati in tempo reale, di proposito.`,
    "- QUI non vende nulla, non chiede soldi e non ha app da scaricare.",
    "",
    "## Copertura",
    `Provincia di Avellino (Irpinia): ${total} distributori in ${reg.towns.size} comuni, dall'anagrafica del Ministero delle Imprese e del Made in Italy (MIMIT, licenza IODL 2.0) estratta il ${reg.date}. Ogni distributore ha una scheda all'indirizzo ${ORIGIN}/d/<id> (elenco completo nella sitemap: ${ORIGIN}/sitemap.xml).`,
    "",
    `Comuni con distributori (numero di impianti): ${towns}.`,
    "",
    ...pages.flatMap((p) => [`---`, "", `Fonte: ${ORIGIN}${p.path}`, "", htmlToText(p.html), ""]),
  ].join("\n");
}
