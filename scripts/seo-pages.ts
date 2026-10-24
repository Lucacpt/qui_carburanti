// Pagine statiche per motori e crawler delle IA (docs/08-seo.md, fase 1): una scheda per impianto,
// una pagina per comune con impianti, l'indice dei comuni. Solo anagrafica MIMIT: MAI lo stato del
// carburante, che resta quello in tempo reale disegnato dall'app (regola d'oro del piano SEO).
// Funzioni pure, testate in seo-pages.test.ts; i file li scrive scripts/build-seo.ts.

import { FUEL_NAMES, type Station } from "../src/client/data.ts";
import { directionsUrl } from "../src/client/nav.ts";
import { ORIGIN } from "./sitemap.ts";

export interface TownGroup {
  readonly name: string;
  readonly slug: string;
  readonly stations: readonly Station[];
}

/** "Sant'Angelo dei Lombardi" → "sant-angelo-dei-lombardi". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** JSON-LD dentro <script>: "</" chiuderebbe il tag, quindi < diventa \u003c. */
const jsonLd = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

const SOURCE =
  "Anagrafica degli impianti: Ministero delle Imprese e del Made in Italy (MIMIT), licenza IODL 2.0.";

interface Shell {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly body: string;
  readonly ld: unknown;
  /** Le schede caricano l'app, che disegna lo stato in tempo reale al posto del contenuto statico. */
  readonly app: boolean;
}

function page(s: Shell): string {
  const url = `${ORIGIN}${s.path}`;
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(s.title)}</title>
  <meta name="description" content="${esc(s.description)}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#EA580C">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="QUI">
  <meta property="og:locale" content="it_IT">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${esc(s.title)}">
  <meta property="og:description" content="${esc(s.description)}">
  <meta property="og:image" content="${ORIGIN}/og.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="QUI: dove c'è carburante, adesso. Provincia di Avellino, quicarburanti.it">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/app.css">
${s.app ? '  <script type="module" src="/app.js"></script>\n' : ""}  ${jsonLd(s.ld)}
</head>
<body>
  <header class="top">
    <a href="/" class="home"><img src="/icon.svg" width="40" height="40" alt=""><span class="brand-name">QUI</span></a>
    <span class="beta">Beta</span>
  </header>
${s.app ? '  <div id="banner" class="banner" role="status" hidden></div>\n' : ""}  <main id="app" class="page">
${s.body}
  </main>
  <footer class="foot">
    <p>Informazioni degli utenti, non verificate. Non è una fonte ufficiale. Non usare il telefono mentre guidi.</p>
    <p><a href="/">Tutti i distributori</a> · <a href="/comuni">Comuni</a> · <a href="/come-funziona">Come funziona</a> · <a href="/privacy">Privacy</a> · <a href="/termini">Termini</a></p>
  </footer>
${s.app ? '  <div id="live" class="sr-only" aria-live="polite"></div>\n' : ""}</body>
</html>
`;
}

const crumbs = (items: Array<[string, string]>) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({
    "@type": "ListItem",
    position: i + 1,
    name,
    item: `${ORIGIN}${path}`,
  })),
});

const label = (st: Station) => `${st.brand} ${st.name}`.trim();

/** La scheda di un impianto: anagrafica, link al comune, "Portami qui". Nessuno stato. */
export function stationPage(st: Station, town: TownGroup, date: string): string {
  const path = `/d/${st.id}`;
  const name = label(st);
  const fuels = st.fuels.map((f) => FUEL_NAMES[f]).join(", ");
  return page({
    path,
    title: `${name}, ${town.name}: c'è carburante? — QUI`,
    description: `Segnalazioni in tempo reale degli automobilisti per ${name}, ${st.address}, ${town.name}. Gratis, senza account.`,
    app: true,
    ld: [
      {
        "@context": "https://schema.org",
        "@type": "GasStation",
        name,
        ...(st.brand ? { brand: { "@type": "Brand", name: st.brand } } : {}),
        address: {
          "@type": "PostalAddress",
          streetAddress: st.address,
          addressLocality: town.name,
          addressRegion: "AV",
          addressCountry: "IT",
        },
        geo: { "@type": "GeoCoordinates", latitude: st.lat, longitude: st.lon },
        url: `${ORIGIN}${path}`,
      },
      crumbs([
        ["QUI", "/"],
        [town.name, `/comune/${town.slug}`],
        [name, path],
      ]),
    ],
    body: `    <div class="detail">
      <p><a href="/comune/${town.slug}">← Distributori a ${esc(town.name)}</a></p>
      <h1>${esc(name)}</h1>
      <p>${esc(st.address)}, ${esc(town.name)}</p>
      <p><a class="btn primary" href="${esc(directionsUrl("google", st.lat, st.lon, name))}" rel="noopener noreferrer">🧭 Portami qui</a></p>
      <p>Carburanti venduti: ${esc(fuels)}.</p>
      <p class="note-box">Lo stato in tempo reale compare qui con JavaScript attivo: sono le segnalazioni di chi è appena passato.</p>
      <p class="muted small">${SOURCE} Dati aggiornati al ${esc(date)}.</p>
    </div>`,
  });
}

/** La pagina di un comune: gli impianti con link alle schede. Nessuno stato. */
export function townPage(town: TownGroup, date: string): string {
  const path = `/comune/${town.slug}`;
  const n = town.stations.length;
  const list = [...town.stations].sort((a, b) => label(a).localeCompare(label(b), "it"));
  return page({
    path,
    title: `Distributori a ${town.name}: dove c'è carburante — QUI`,
    description: `${n === 1 ? "Il distributore" : `I ${n} distributori`} di ${town.name} (AV) con le segnalazioni in tempo reale degli automobilisti: dove c'è carburante adesso. Gratis, senza account.`,
    app: false,
    ld: [
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `Distributori a ${town.name}`,
        itemListElement: list.map((st, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: label(st),
          url: `${ORIGIN}/d/${st.id}`,
        })),
      },
      crumbs([
        ["QUI", "/"],
        ["Comuni", "/comuni"],
        [town.name, path],
      ]),
    ],
    body: `    <h1>Distributori a ${esc(town.name)}</h1>
    <p>${n === 1 ? "Un distributore" : `${n} distributori`} in provincia di Avellino. Apri una scheda per vedere le segnalazioni in tempo reale, oppure <a href="/?q=${encodeURIComponent(town.name)}">la lista con i dintorni</a>.</p>
    <ul class="town-list">
${list.map((st) => `      <li><a href="/d/${st.id}">${esc(label(st))}</a> — ${esc(st.address)}</li>`).join("\n")}
    </ul>
    <p class="muted small">${SOURCE} Dati aggiornati al ${esc(date)}.</p>`,
  });
}

/** L'indice dei comuni con impianti: il collegamento tra la home e le pagine dei comuni. */
export function townsIndexPage(towns: readonly TownGroup[], date: string): string {
  const total = towns.reduce((n, t) => n + t.stations.length, 0);
  return page({
    path: "/comuni",
    title: "Distributori di carburante per comune, provincia di Avellino — QUI",
    description: `I ${total} distributori della provincia di Avellino divisi per comune, con le segnalazioni in tempo reale degli automobilisti. Gratis, senza account.`,
    app: false,
    ld: crumbs([
      ["QUI", "/"],
      ["Comuni", "/comuni"],
    ]),
    body: `    <h1>Distributori per comune</h1>
    <p>${towns.length} comuni della provincia di Avellino con almeno un distributore, ${total} impianti in tutto.</p>
    <ul class="town-list">
${towns.map((t) => `      <li><a href="/comune/${t.slug}">${esc(t.name)}</a> (${t.stations.length})</li>`).join("\n")}
    </ul>
    <p class="muted small">${SOURCE} Dati aggiornati al ${esc(date)}.</p>`,
  });
}
