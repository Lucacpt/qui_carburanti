# ADR-0007: Ricerca locale sull'anagrafica invece di un geocoder remoto

**Status:** Accepted
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
Serve una barra di ricerca per indirizzo. I geocoder remoti (Nominatim pubblico, Google, Mapbox) ricevono l'indirizzo, spesso quello di casa, e l'IP dell'utente. Nominatim pubblico non è adatto a un'app con molti utenti.

## Decision
Ricerca **interamente sul client** su: (a) indirizzo, comune e bandiera dei distributori della provincia (già scaricati); (b) un gazetteer dei comuni della regione con centroidi (dati ISTAT).

## Options Considered

### Option A: Ricerca locale (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Bassa: normalizzazione e match per token |
| Cost | Zero, ~5-10 KB di gazetteer |
| Scalability | Infinita: nessuna richiesta di rete |
| Team familiarity | Alta |

**Pros:** privacy totale, funziona offline, istantanea.
**Cons:** non trova indirizzi arbitrari senza distributore.

### Option B: Nominatim self-hosted
**Cons:** un server da gestire (contro il principio 4 dell'SDD); RAM significativa.

### Option C: Geocoder commerciale
**Cons:** terza parte, costi, quote. **Scartata.**

## Trade-off Analysis
Chi cerca carburante cerca "vicino a [comune o zona]", non un civico preciso. Il comune più "Usa la mia posizione" copre il caso d'uso.

## Consequences
- Più facile: zero dipendenze esterne; CSP `connect-src 'self'` rispettata.
- Più difficile: gestire abbreviazioni e varianti ("V.LE", "VIALE", "S.S. 36").
- Da rivedere: aggiungere le frazioni ISTAT se gli utenti le cercano.

## Action Items
1. [ ] Normalizzatore di indirizzi con test sulle abbreviazioni MIMIT più comuni.
