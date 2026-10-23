# Documentazione di QUI

> **Partire da qui:** [07-report-v0.3.md](07-report-v0.3.md) riassume le decisioni prese e il piano operativo attuale.

| Documento | Contenuto |
|---|---|
| [00-strategia.md](00-strategia.md) | Visione, principi, cooperazione senza account, lancio, metriche, costi |
| [01-RAD.md](01-RAD.md) | Requisiti funzionali e non funzionali, scenari, casi d'uso, modelli |
| [02-SDD.md](02-SDD.md) | Architettura, dati, API, algoritmo di stato, client, CI/CD, test |
| [03-iterazione-1.md](03-iterazione-1.md) | Specifica originale → critica → scelte riviste |
| [04-threat-model.md](04-threat-model.md) | Avversari, piani d'attacco, difese, rischio residuo, STRIDE |
| 05 — rischi legali | Documento riservato del maintainer, non pubblicato nel repository |
| [06-domande.md](06-domande.md) | Domande aperte, con le risposte del maintainer |
| [07-report-v0.3.md](07-report-v0.3.md) | **Report v0.3**: decisioni, MVP in 72 h, GitHub, domande residue |
| [adr/](adr/) | Architecture Decision Records |

## ADR
| # | Decisione | Stato |
|---|---|---|
| [0001](adr/ADR-0001-piattaforma-cloudflare.md) | Workers + Static Assets, piano Paid | Accepted |
| [0002](adr/ADR-0002-storage-durable-objects.md) | Durable Objects SQLite per provincia | Accepted |
| [0003](adr/ADR-0003-anagrafica-mimit.md) | Anagrafica MIMIT come registro | Accepted |
| [0004](adr/ADR-0004-lista-prima-mappa-lazy.md) | Lista prima, mappa Leaflet lazy (Fase 2) | Accepted |
| [0005](adr/ADR-0005-anti-abuso-senza-fingerprint.md) | Anti-abuso senza fingerprint, avviso just-in-time | Accepted |
| [0006](adr/ADR-0006-modello-stati.md) | 4 stati per carburante + affidabilità a 3 livelli | Accepted (rev. v0.3) |
| [0007](adr/ADR-0007-ricerca-locale.md) | Ricerca locale, nessun geocoder | Accepted |
| [0008](adr/ADR-0008-licenza-eupl.md) | EUPL-1.2 per il codice | Accepted |
| [0009](adr/ADR-0009-notifiche-push.md) | Push senza GPS continuo, scadenza 48 h | Accepted (giorno 4-5) |
| [0010](adr/ADR-0010-dominio.md) | Dominio `quicarburanti.it` | Accepted |
| [0011](adr/ADR-0011-tutele-gestori.md) | Tutele per gestori e maintainer (rosso in verifica, scadenza, registro, etichette) | Accepted |
| [0012](adr/ADR-0012-residenza-dati-ue.md) | Residenza UE: giurisdizione dei DO fail-closed, autoverifica, politica regionale come test | Accepted |
| [0013](adr/ADR-0013-area-admin.md) | Area admin dietro Cloudflare Access, con verifica del JWT nel Worker | Accepted |

## Procedure
- [Segnalare un errore o contestare un'informazione](procedure/contestazioni.md)

## Documenti legali
- Pagine pubbliche: [informativa privacy](../public/privacy.html), [termini d'uso](../public/termini.html), [cookie](../public/cookie.html)
- [Registro dei trattamenti](legale/registro-trattamenti.md), con valutazione del legittimo interesse, verifica DPIA e procedura per le violazioni dei dati
- Coerenza con il codice: `scripts/legal-pages.test.ts`. Segnaposto da compilare prima del rilascio: `npm run legal-check`
