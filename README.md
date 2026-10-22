<p align="center"><img src="assets/icon.svg" width="96" alt="QUI"></p>

# QUI — dove c'è carburante, adesso

**QUI** è una web app leggera e anonima che, durante una carenza di carburante, mostra quali distributori vicini **hanno carburante in questo momento**. Le informazioni arrivano dalle segnalazioni degli utenti.

> 🚧 **Beta, in sviluppo.** Si parte dalla provincia di Avellino. Le informazioni provengono dagli utenti e **non sono verificate**: QUI non è una fonte ufficiale.

## Principi
- **Privacy per architettura:** nessun account, nessun cookie, nessun tracciamento. Il server non riceve mai la tua posizione GPS e non conserva il tuo indirizzo IP.
- **Banda minima:** la prima visita pesa poche decine di KB e funziona anche con poco campo.
- **Comunità:** chi trova carburante lo segnala con un tocco, per tutti.
- **Trasparenza:** codice aperto, decisioni documentate, nessuna richiesta di denaro.

> ⚠️ **QUI non ha app da scaricare e non chiede mai soldi.** Diffida di APK, "app ufficiali" o raccolte fondi a nome di QUI.

## Una nota personale
**Questo progetto è stato scritto con l'intelligenza artificiale.** Analisi, documentazione e gran parte del codice sono nati lavorando insieme a un assistente IA (Claude di Anthropic, tramite Claude Code). Le scelte finali le ho prese io, ma voglio che sia chiaro a chiunque legga il codice.

La maggior parte dei miei repository è privata: questo è uno dei pochi pubblici. L'ho reso pubblico perché **non considero il mio codice qualcosa di assoluto o definitivo**, e perché un progetto che chiede fiducia alla comunità deve poter essere controllato da tutti.

**Ogni consiglio, critica o correzione è ben accetto: sono disposto a imparare.** Apri pure una [issue](https://github.com/Lucacpt/qui_carburanti/issues) o una pull request, anche solo per dirmi cosa faresti diversamente.

## Documentazione
Tutto il design è in [`docs/`](docs/README.md). Per orientarsi conviene partire dal [report v0.3](docs/07-report-v0.3.md).

| | |
|---|---|
| Strategia | [docs/00-strategia.md](docs/00-strategia.md) |
| Requisiti (RAD) | [docs/01-RAD.md](docs/01-RAD.md) |
| Design (SDD) | [docs/02-SDD.md](docs/02-SDD.md) |
| Threat model | [docs/04-threat-model.md](docs/04-threat-model.md) |
| Decisioni (ADR) | [docs/adr/](docs/adr/) |

## Stack
Cloudflare Workers + Static Assets · Durable Objects (SQLite) · TypeScript · nessun framework lato client · anagrafica impianti MIMIT.

## Provarlo in locale
Requisiti: Node.js 24 (con npm 11, incluso in Node 24).

```sh
npm ci --ignore-scripts      # installa senza eseguire script delle dipendenze
cp .dev.vars.example .dev.vars   # segreti di sviluppo (il file è ignorato da git)
npm run import:mimit         # aggiorna l'anagrafica MIMIT della provincia di Avellino
npm run dev                  # avvia QUI su http://localhost:8787 (nessun account Cloudflare necessario)
npm test                     # test unitari (dominio, PoW, logica del Durable Object su SQLite)
npm run smoke                # con `npm run dev` attivo: prova le API end-to-end
```

Altri comandi: `npm run lint`, `npm run typecheck`, `npm run privacy-guard` (cerca nel codice cookie, fingerprinting o richieste a terzi), `npm run budget` (peso degli asset).

Vuoi accedere all'ambiente di prova o aiutarci a testare? Apri una [issue](https://github.com/Lucacpt/qui_carburanti/issues).

## Licenza
Codice: [EUPL-1.2](LICENSE) ([testo ufficiale in italiano](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32017D0863)).
Cosa comporta: puoi usare, studiare, modificare e ridistribuire il codice. Se distribuisci o **offri come servizio web** una versione modificata, devi renderne pubblico il codice sotto la stessa licenza (o una compatibile).

Dati: anagrafica impianti © MIMIT, licenza IODL 2.0. Nome e icona "QUI": vedi [TRADEMARK.md](TRADEMARK.md).

## Sicurezza
Hai trovato una vulnerabilità? Leggi [SECURITY.md](SECURITY.md) e **non aprire una issue pubblica**.
