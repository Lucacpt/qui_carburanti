<p align="center"><img src="public/icon.svg" width="112" alt="Icona di QUI: una mano che indica una X"></p>

# QUI — dove c'è carburante, adesso

**QUI** ([quicarburanti.it](https://quicarburanti.it)) è una web app leggera e anonima che, durante una carenza di carburante, mostra quali distributori vicini **hanno carburante in questo momento**. Le informazioni arrivano dalle segnalazioni di chi c'è appena stato.

> 🚧 **Beta, in sviluppo.** Si parte dalla provincia di Avellino. Le informazioni provengono dagli utenti e **non sono verificate**: QUI non è una fonte ufficiale.

## Come funziona, in breve
1. Apri il sito e tocca **«Vicino a me»**: la posizione resta sul telefono.
2. Guarda lo stato del carburante che ti serve:

   | Stato | Significato |
   |---|---|
   | ● **Disponibile** | conferme sufficienti negli ultimi 45 minuti: almeno 3 persone sul posto (da remoto ognuna vale un quarto) |
   | ▲ **Da verificare** | segnalazioni contrastanti o non ancora confermate |
   | ✕ **Segnalato esaurito** | più persone, almeno una sul posto, ne hanno segnalato l'assenza |
   | ○ **Nessuna informazione** | nessuno ha segnalato nelle ultime 8 ore |

3. Sei al distributore? Tocca **«C'è»** o **«Non c'è»**: chi segnala sul posto conta di più. Le regole complete, comprese le tutele per i gestori, sono in [`/come-funziona`](public/come-funziona.html) e nell'[ADR-0011](docs/adr/ADR-0011-tutele-gestori.md).

## Principi
- **Privacy per architettura:** nessun account, nessun cookie di tracciamento, nessuna pubblicità. Il server non riceve mai la posizione GPS e non salva l'indirizzo IP. Le segnalazioni si cancellano da sole dopo 8 ore e il database resta in data center nell'UE.
- **Banda minima:** la prima visita pesa circa 18 KB compressi e funziona anche con poco campo.
- **Accessibile:** stati riconoscibili da colore, forma e parola insieme; pulsanti grandi; contrasti verificati.
- **Comunità:** chi trova carburante lo segnala con un tocco, per tutti.
- **Trasparenza:** codice aperto, decisioni documentate, nessuna richiesta di denaro.

> ⚠️ **QUI non ha app da scaricare e non chiede mai soldi.** Diffida di APK, "app ufficiali" o raccolte fondi a nome di QUI.

## Una nota personale
**Questo progetto è stato scritto con l'intelligenza artificiale.** Analisi, documentazione e gran parte del codice sono nati lavorando insieme a un assistente IA (Claude di Anthropic, tramite Claude Code). Le scelte finali le ho prese io, ma voglio che sia chiaro a chiunque legga il codice.

La maggior parte dei miei repository è privata: questo è uno dei pochi pubblici. L'ho reso pubblico perché **non considero il mio codice qualcosa di assoluto o definitivo**, e perché un progetto che chiede fiducia alla comunità deve poter essere controllato da tutti.

**Ogni consiglio, critica o correzione è ben accetto: sono disposto a imparare.** Apri pure una [issue](https://github.com/Lucacpt/qui_carburanti/issues) o una pull request, anche solo per dirmi cosa faresti diversamente.

## Stack

| Livello | Tecnologia | Perché |
|---|---|---|
| Hosting e API | **Cloudflare Workers** + Static Assets (piano Paid) | Pagine statiche servite gratis dalla rete; il Worker gestisce solo `/api/*` |
| Dati | **Durable Objects** con SQLite, uno per provincia, in giurisdizione **UE** | Segnalazioni serializzate senza doppi conteggi; residenza dei dati garantita ([ADR-0012](docs/adr/ADR-0012-residenza-dati-ue.md)) |
| Anti-abuso | Proof-of-work in formato ALTCHA (WebCrypto, senza dipendenze), HMAC con chiave giornaliera, Rate Limiting di Cloudflare | Nessun fingerprinting, nessun CAPTCHA di terzi ([ADR-0005](docs/adr/ADR-0005-anti-abuso-senza-fingerprint.md)) |
| Client | **TypeScript** senza framework, compilato con **esbuild** | Circa 7,5 KB compressi; DOM costruito solo con API sicure (Trusted Types) |
| Linguaggio | TypeScript 7 con `erasableSyntaxOnly`; Node.js 24 esegue i `.ts` direttamente | Nessun passo di build per script e test |
| Qualità | **Vitest** (con `node:sqlite`, lo stesso motore dei Durable Objects), **Biome** per lint e formattazione | La logica del database si testa senza Cloudflare |
| CI/CD | **GitHub Actions** con Actions bloccate per SHA, harden-runner, **CodeQL**, dependency review, **Dependabot** con 7 giorni di attesa | Catena di fornitura difesa; `main` protetto, solo PR |
| Dati esterni | Anagrafica impianti del **MIMIT** (licenza IODL 2.0); coordinate dei comuni da **Wikidata** (CC0) | Elenco ufficiale dei distributori; distributori più vicini anche ai comuni che non ne hanno |

Versioni bloccate in [`package.json`](package.json): TypeScript 7.0.2, Wrangler 4.151.0, Vitest 5.0.5, Biome 2.5.15, esbuild 0.28.2.

### Architettura
```
telefono ──HTTPS──▶ Cloudflare (rete UE più vicina)
                     ├─ /, /d/<id>, /privacy… ─▶ Static Assets (HTML, CSS, JS, anagrafica)
                     └─ /api/* ─▶ Worker ─┬─▶ ProvinceDO "AV" (SQLite, giurisdizione UE)
                                          └─▶ KeyDO (chiave HMAC del giorno, cancellata a mezzanotte)
```
Il dettaglio è nel [Software Design Document](docs/02-SDD.md).

## Provarlo in locale
Requisiti: Node.js 24 (con npm 11, incluso in Node 24). Non serve un account Cloudflare.

```sh
npm ci --ignore-scripts          # installa senza eseguire script delle dipendenze
cp .dev.vars.example .dev.vars   # segreti di sviluppo (il file è ignorato da git)
npm run import:mimit             # aggiorna l'anagrafica MIMIT della provincia di Avellino
npm run dev                      # avvia QUI su http://localhost:8787
npm test                         # test unitari
npm run smoke                    # con `npm run dev` attivo: prova le API end-to-end
```

| Comando | Cosa controlla |
|---|---|
| `npm run lint` · `npm run typecheck` | Stile e tipi (tre configurazioni: Node, Worker, client) |
| `npm run privacy-guard` | Che nel codice non compaiano cookie, fingerprinting, richieste a terzi o coordinate inviate al server |
| `npm run budget` | Il peso compresso di ogni file e della prima visita |
| `npm run legal-check` | I segnaposto ancora da compilare nei documenti legali (con `--strict` blocca il rilascio) |

Alcuni test proteggono promesse fatte agli utenti: se un tempo di conservazione cambia nel codice ma non nell'informativa, o se un ambiente di deploy perde il vincolo UE, la CI fallisce ([`scripts/legal-pages.test.ts`](scripts/legal-pages.test.ts), [`scripts/region-policy.test.ts`](scripts/region-policy.test.ts)).

Vuoi accedere all'ambiente di prova o aiutarci a testare? Apri una [issue](https://github.com/Lucacpt/qui_carburanti/issues).

## Stato del progetto
- [x] Backend: segnalazioni, stati, anti-abuso, contestazioni dei gestori, residenza UE
- [x] Interfaccia: lista, ricerca, scheda, segnalazione, «Portami qui», pagina «I tuoi dati»
- [x] Informativa privacy, termini d'uso, pagina cookie, registro dei trattamenti (bozze in revisione legale)
- [x] Nuova icona
- [ ] Nuovo design dell'interfaccia (contrasti, «Annulla» entro 5 secondi, tema scuro)
- [x] Dashboard di amministrazione: avvisi, contestazioni, congelamenti, sola lettura, storico ([ADR-0013](docs/adr/ADR-0013-area-admin.md))
- [x] Pipeline di rilascio con ambiente di prova ([procedura](docs/procedure/rilascio.md))
- [ ] Notifiche push

## Documentazione
Tutto il design è in [`docs/`](docs/README.md). Per orientarsi conviene partire dal [report v0.3](docs/07-report-v0.3.md).

| | |
|---|---|
| Strategia | [docs/00-strategia.md](docs/00-strategia.md) |
| Requisiti (RAD) | [docs/01-RAD.md](docs/01-RAD.md) |
| Design (SDD) | [docs/02-SDD.md](docs/02-SDD.md) |
| Threat model | [docs/04-threat-model.md](docs/04-threat-model.md) |
| Decisioni (ADR) | [docs/adr/](docs/adr/) |
| Contestazioni dei gestori | [docs/procedure/contestazioni.md](docs/procedure/contestazioni.md) |
| Privacy e registro dei trattamenti | [public/privacy.html](public/privacy.html) · [docs/legale/registro-trattamenti.md](docs/legale/registro-trattamenti.md) |

## Licenza
Codice: [EUPL-1.2](LICENSE) ([testo ufficiale in italiano](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32017D0863)).
Cosa comporta: puoi usare, studiare, modificare e ridistribuire il codice. Se distribuisci o **offri come servizio web** una versione modificata, devi renderne pubblico il codice sotto la stessa licenza (o una compatibile).

Dati: anagrafica impianti © MIMIT, licenza IODL 2.0; coordinate dei comuni: Wikidata, CC0. Nome e icona "QUI": vedi [TRADEMARK.md](TRADEMARK.md).

## Sicurezza
Hai trovato una vulnerabilità? Leggi [SECURITY.md](SECURITY.md) e **non aprire una issue pubblica**.
