# Piano SEO di QUI

> Versione 1 · 2026-10-24. Audit del codice e dello staging, poi un piano per fasi. Vincolo che non si tratta: **nessun tracciamento** (niente Analytics, pixel, cookie, script di terzi). La CSP lo impedisce anche tecnicamente.

## In breve
- **Il patrimonio c'è:** 230 impianti in 92 comuni della provincia di Avellino (22 nel capoluogo, 8 sulla A16), con marchio, nome e indirizzo dall'anagrafica MIMIT. È la base per una SEO locale che risponde a ricerche come "distributore benzina Ariano Irpino".
- **Il problema principale:** oggi tutto il contenuto è disegnato da JavaScript. Chi non lo esegue (crawler delle IA, anteprime di WhatsApp e social, molti motori minori) vede solo "Caricamento dei distributori…". Google lo esegue, ma più tardi e non sempre.
- **La specificità di QUI:** il traffico arriva a ondate, durante una carenza. Le pagine devono essere già indicizzate **prima** della crisi: servono pagine stabili (impianti, comuni) che si posizionano nei periodi tranquilli.
- **La regola d'oro:** mai uno stato del carburante nell'HTML statico o nei meta tag. Uno snippet di Google con "Disponibile" vecchio di ore sarebbe sbagliato e pericoloso, anche legalmente. Lo stato resta solo quello in tempo reale, disegnato dall'app.

## 1. Audit (2026-10-24)

**Pagine analizzate:** 8 file HTML in `public/` più la scheda `/d/<id>` (servita da `index.html`).
**Punteggio: 44/100 prima di questo lavoro, 53/100 dopo le PR `feat/seo` e `fix/errori-header`.** Il resto arriva con la fase 1.

| Area | Prima | Dopo | Note |
|---|---|---|---|
| Scansione e indicizzazione | 3/15 | 11/15 | Mancavano `robots.txt`, sitemap e canonical; ogni indirizzo inventato rispondeva 200 ("soft 404") |
| Meta e head | 7/15 | 8/15 | Title e description presenti e unici, ma senza luogo né "benzina/distributori"; niente Open Graph né Twitter Card |
| Titoli (h1-h3) | 2/10 | 2/10 | Su **ogni** pagina l'`<h1>` è il logo "QUI"; il titolo vero è un `<h2>` |
| Contenuto leggibile senza JS | 1/15 | 1/15 | Home e schede sono vuote senza JavaScript |
| Dati strutturati | 0/10 | 0/10 | Nessun JSON-LD |
| Link interni | 6/10 | 6/10 | Nessun link rotto; manca un indice dei comuni e degli impianti in HTML |
| Prestazioni e mobile | 15/15 | 15/15 | Prima vista 18 KB, nessuno script di terzi, viewport, HTTPS, HSTS: eccellente |
| Immagini | 10/10 | 10/10 | Una sola immagine (icona SVG) con `width`/`height` e `alt=""` corretto perché decorativa |

### Critici
- [x] Nessun `robots.txt` → `public/robots.txt` (questa PR)
- [x] Nessuna sitemap → `public/sitemap.xml` generata a ogni build dall'anagrafica (questa PR)
- [x] "Soft 404": ogni indirizzo rispondeva 200 con la home → vera pagina 404 (PR `fix/errori-header`)
- [x] Nessun canonical → statico sulle pagine informative, impostato dall'app su home e schede (questa PR)
- [ ] Contenuto solo via JavaScript su home e schede → fase 1, punti 1-3
- [ ] `<h1>` = logo su tutte le pagine → fase 1, punto 4

### Avvisi
- [ ] Title senza luogo e senza parole cercate (`index.html`: "QUI — dove c'è carburante, adesso")
- [ ] Nessun Open Graph: un link condiviso su WhatsApp, il canale principale durante una crisi, non ha anteprima
- [ ] Nessun dato strutturato (`GasStation`, `BreadcrumbList`, `WebSite`)
- [ ] Nessun manifest PWA, nonostante la CSP preveda `manifest-src`
- [ ] Redirect `www` → `quicarburanti.it` non ancora attivo (passo in `docs/procedure/rilascio.md`)

### Cosa va già bene
- Prestazioni da primo della classe: 18 KB alla prima visita, nessun blocco al rendering da terzi. I Core Web Vitals saranno verdi.
- URL puliti e stabili (`/d/3518`, `/come-funziona`), HTTPS con HSTS, una sola lingua dichiarata (`lang="it"`).
- Title e description unici su ogni pagina informativa.
- Nessun link interno rotto.

## 2. Chi cerca e cosa cerca

Non ho dati di volume: le priorità vanno verificate in **Google Search Console** dopo il lancio. I gruppi di ricerca attesi, in ordine di valore per QUI:

| Gruppo | Esempi | Pagina che risponde |
|---|---|---|
| Emergenza | "benzina Avellino", "distributori aperti Avellino", "dove trovo benzina", "sciopero benzinai distributori aperti Avellino" | Home |
| Comune | "distributore benzina Grottaminarda", "benzinaio Montoro" (92 comuni con impianti) | `/comune/<slug>` (fase 1) |
| Impianto e marchio | "Q8 Mercogliano", "Eni Ariano Irpino", "distributore via …" | `/d/<id>` |
| Autostrada | "area di servizio Irpinia Nord", "distributori A16 Avellino" | `/d/<id>` e una pagina A16 (fase 2) |
| Marchio QUI | "QUI carburanti", "quicarburanti" | Home |
| Informazioni | "come sapere se un distributore ha benzina" | `/come-funziona`, guide (fase 2) |

**Concorrenti nei risultati:** Osservaprezzi del MIMIT (prezzi ufficiali), siti di prezzi carburante, Google Maps e Waze, testate locali. Nessuno mostra la **disponibilità** in tempo reale: è il nostro elemento distintivo e va nei title.

**Opportunità da decidere (prodotto, non SEO):** il MIMIT pubblica anche i prezzi giornalieri (`prezzo_alle_8.csv`, stessa licenza IODL 2.0). Mostrarli porterebbe traffico costante fuori dalle crisi ("prezzo benzina Avellino"), che a sua volta aiuta a posizionarsi prima delle crisi. Cambia però il perimetro del progetto.

## 3. Fasi

### Fase 0 — fatto (PR `feat/seo` e `fix/errori-header`)
- `robots.txt`: tutto aperto tranne `/api/`, `/admin`, `/dati`; `/r/` resta aperto perché serve ai motori per disegnare le schede.
- Sitemap: 6 pagine più una scheda per impianto (230), `lastmod` = data dell'estrazione MIMIT. Generata da `scripts/build-seo.ts` a ogni build, quindi segue sempre l'anagrafica. Test in `scripts/sitemap.test.ts`.
- Canonical: statico sulle pagine informative; su home e schede lo imposta l'app (`setCanonical` in `src/client/main.ts`), perché `index.html` viene servito anche per `/d/<id>`.
- Vera pagina 404 con stato HTTP 404 e `noindex`.
- Lo staging ha `X-Robots-Tag: noindex` su tutto.

### Fase 1 — fondamenta tecniche (prima del lancio pubblico)
1. **Schede degli impianti in HTML statico.** In build, per ogni impianto, `public/d/<id>.html` con: `<h1>` "Marchio Nome", indirizzo, comune, carburanti disponibili all'impianto (dall'anagrafica, non lo stato), pulsante "Portami qui", link al comune, fonte "Anagrafica MIMIT, licenza IODL 2.0". `app.js` aggiunge sopra lo stato in tempo reale. Va tolta la riscrittura `/d/*` da `_redirects`; gli ID sconosciuti diventano 404 veri.
2. **Pagine dei comuni** `/comune/<slug>` (solo i 92 con almeno un impianto, per non creare pagine vuote): elenco degli impianti con link alle schede, mappa testuale degli indirizzi. Slug: minuscole, accenti tolti, spazi e apostrofi → `-` ("Sant'Angelo dei Lombardi" → `sant-angelo-dei-lombardi`).
3. **Home con contenuto statico** sopra l'app: `<h1>` "Distributori con carburante in provincia di Avellino", due righe su cosa fa QUI, indice dei comuni (link alle pagine del punto 2). È anche ciò che leggono i crawler delle IA.
4. **Titoli:** il logo diventa un elemento non titolo; il titolo della pagina diventa `<h1>`. Una sola `<h1>` per pagina.
5. **Title e description** (title ≤ 60 caratteri, description 140-160):
   - Home: `Distributori con carburante in provincia di Avellino — QUI`
   - Scheda: `Agip Eni Calaggio Sud, Vallata: c'è carburante? — QUI` · description: "Segnalazioni in tempo reale degli automobilisti per Agip Eni Calaggio Sud, Autostrada A16, Vallata. Gratis, senza account."
   - Comune: `Distributori a Grottaminarda: dove c'è carburante — QUI`
6. **Open Graph e Twitter Card** su ogni pagina, con un'immagine 1200×630 (logo e "dove c'è carburante, adesso", dal kit del logo). L'anteprima nei gruppi WhatsApp conta più di qualsiasi posizione su Google durante una crisi.
7. **Dati strutturati JSON-LD**, solo ciò che è vero e stabile:
   - home: `WebSite` e `WebApplication` (gratuita, senza registrazione);
   - schede: `GasStation` (nome, marchio, indirizzo, coordinate pubbliche dell'anagrafica) e `BreadcrumbList` (Home › Comune › Impianto);
   - comuni: `ItemList` degli impianti;
   - **mai** `AggregateRating` o recensioni: le segnalazioni non sono valutazioni, e Google penalizza le stelle autoassegnate.
8. **Manifest PWA** (`manifest.webmanifest`, nome, icone, `theme_color`): installabilità e coerenza del marchio.
9. **Redirect `www` → apex** (301) e "Always Use HTTPS" attivo su Cloudflare (passi del maintainer).
10. **Search Console e Bing Webmaster Tools**, verificati con un record TXT nel DNS: nessuno script sul sito. Invio della sitemap in entrambi. Attivare **Crawler Hints** su Cloudflare (*Caching → Configuration*): avvisa Bing e gli altri motori con IndexNow quando una pagina cambia, senza codice.

Ogni punto della fase 1 rispetta i budget esistenti (`npm run budget`): le schede statiche pesano poche centinaia di byte ciascuna e non toccano la prima vista.

### Fase 2 — contenuti (lancio e primo mese)
Solo contenuti che possiamo sostenere con fatti; niente testi riempitivi.
- **Guida pratica** "Carenza o sciopero dei distributori in Irpinia: cosa fare", con consigli verificabili (usare le segnalazioni recenti, non fare scorte, segnalare dal posto, non usare il telefono alla guida).
- **Pagina A16** con gli 8 impianti autostradali della provincia, in entrambe le direzioni.
- **`/come-funziona`** con domande e risposte in forma di FAQ (anche `FAQPage` in JSON-LD: Google oggi la mostra di rado, ma le IA la leggono bene).
- **Pagina "Novità"** o changelog pubblico, se il progetto evolve: contenuto fresco e link naturali.

### Fase 3 — fuori dal sito
- **Stampa locale:** un comunicato breve, con link, alle testate dell'Irpinia al lancio e all'inizio di ogni carenza. Sono i link più preziosi e quelli che portano traffico nel momento giusto.
- **Comuni, Pro Loco, associazioni di categoria, gruppi di automobilisti:** un link "dove trovare carburante durante le carenze".
- **Social:** i post già pronti nel canvas di design, sempre con il link.
- **GitHub:** il repository pubblico è già un link autorevole; il README rimanda al sito.
- **Google Business Profile:** non si applica, perché QUI non è un'attività con sede fisica.

### Fase 4 — visibilità nelle risposte delle IA
- Il contenuto statico della fase 1 è ciò che ChatGPT, Perplexity, Claude e Gemini possono leggere e citare.
- **Fatto:** `/llms.txt` (riassunto con i link e le regole per citare QUI, scritto a mano) e `/llms-full.txt` (testo di "Come funziona" e "Il progetto" più copertura e comuni dell'anagrafica, generato a ogni build da `scripts/build-seo.ts`). `/llm.txt`, nome non standard, rimanda con un 301 a `/llms.txt`. Nessuno dei due contiene stati in tempo reale.
- `robots.txt` oggi permette tutti i bot. **Decisione del maintainer:** si possono bloccare i bot che raccolgono dati per l'addestramento (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`) lasciando aperti quelli che cercano per rispondere (`OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`). Per un progetto di pubblica utilità tenerli tutti aperti è ragionevole.
- Frasi chiare e verificabili sulle pagine ("QUI mostra le segnalazioni degli automobilisti; non è una fonte ufficiale"): le IA tendono a riportarle così come sono.

### Fase 5 — misurare senza tracciare
- **Solo dati lato motore:** Search Console e Bing Webmaster Tools (impressioni, clic, posizione media, pagine indicizzate, Core Web Vitals reali dagli utenti di Chrome). Non serve nessuno script sul sito.
- **Mai** Google Analytics, Tag Manager, pixel o Cloudflare Web Analytics: violerebbero l'informativa e la CSP (`connect-src 'self'`).
- **Indicatori:** schede indicizzate su 230; impressioni per "benzina/distributore + comune"; posizione su "distributori aperti Avellino"; errori di scansione; tempo tra pubblicazione e indicizzazione di una scheda.

## 4. Durante una carenza
1. Verificare in Search Console che home e comuni siano indicizzati (lo si fa prima, ogni mese).
2. Pubblicare i post social con il link e inviare il comunicato alle testate locali.
3. Non cambiare URL né struttura durante la crisi: si perderebbe l'indicizzazione proprio quando serve.
4. Se lo staging fosse esposto per errore, il `noindex` lo tiene fuori dai risultati.

## 5. Cosa non faremo
- Nessuno strumento di tracciamento, nemmeno "solo per la SEO".
- Nessuno stato del carburante in HTML statico, title, description o dati strutturati.
- Nessuna pagina per comuni senza impianti (sarebbero pagine "doorway", penalizzate e inutili).
- Nessuna valutazione o recensione nei dati strutturati.
- Nessuna implicazione di ufficialità: ogni scheda cita la fonte (MIMIT, IODL 2.0) e ricorda che le informazioni vengono dagli utenti.
- Nessun testo scritto per i motori invece che per le persone (keyword stuffing).

## 6. La sitemap
- **Dove:** `https://quicarburanti.it/sitemap.xml`, indicata in `robots.txt`.
- **Cosa contiene:** le pagine `/`, `/come-funziona`, `/progetto`, `/privacy`, `/termini`, `/cookie` e una voce `/d/<id>` per ciascuno dei 230 impianti, con `lastmod` uguale alla data dell'anagrafica.
- **Come si aggiorna:** da sola. `npm run build` e ogni deploy eseguono `scripts/build-seo.ts`. Dopo `npm run import:mimit`, al deploy successivo la sitemap segue i nuovi impianti. Il file generato non è nel repository (`.gitignore`), come `app.js`.
- **Fase 1:** quando arriveranno le pagine dei comuni, si aggiungono in `scripts/sitemap.ts`.

## 7. Chi fa cosa
| Attività | Chi | Quando |
|---|---|---|
| Fase 1, punti 1-8 | Claude | prima del lancio |
| Redirect `www`, "Always Use HTTPS", Crawler Hints | maintainer (dashboard Cloudflare) | prima del lancio |
| Search Console e Bing Webmaster: verifica DNS e invio sitemap | maintainer | al primo deploy in produzione |
| Decisione sui bot delle IA | maintainer | prima del lancio |
| Decisione sui prezzi MIMIT | maintainer | dopo il lancio |
| Comunicato e contatti con la stampa locale | maintainer | al lancio e a ogni carenza |
