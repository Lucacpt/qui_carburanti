# ADR-0003: Registro distributori: anagrafica MIMIT invece del clustering GPS

**Status:** Accepted (verificato sui file reali del 2026-10-21: 230 impianti AV, 0 senza coordinate, 7,6 KB brotli)
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
La specifica originale identifica un distributore raggruppando segnalazioni GPS entro 30 m. Il metodo ha cinque difetti (vedi [03-iterazione-1.md](../03-iterazione-1.md), Decisione 1), tra cui l'obbligo di inviare coordinate al server e l'impossibilità di gestire le segnalazioni via indirizzo.

## Decision
Usare il dataset MIMIT *Carburanti – prezzi praticati e anagrafica degli impianti* (licenza **IODL 2.0**, aggiornamento giornaliero) come registro canonico. Ogni segnalazione referenzia `idImpianto`.

## Options Considered

### Option A: Anagrafica MIMIT (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Bassa: un CSV al giorno |
| Cost | Zero |
| Scalability | ~22.000 impianti in Italia; per regione poche migliaia |
| Team familiarity | Alta |

**Pros:** ufficiale e completa (i gestori sono obbligati a comunicare); include bandiera, indirizzo e coordinate; licenza che consente il riuso con attribuzione; il file prezzi indica anche quali carburanti vende ogni impianto.
**Cons:** etichettato "sperimentale"; coordinate a volte imprecise o mancanti; il formato è già cambiato una volta (separatore `|` dal 10/02/2026).

### Option B: OpenStreetMap `amenity=fuel`
**Pros:** coordinate spesso migliori. **Cons:** copertura disomogenea; licenza ODbL *share-alike* sul database derivato; nessun ID ufficiale.

### Option C: Clustering GPS da segnalazioni (originale)
**Cons:** vedi Context. **Scartata.**

## Trade-off Analysis
MIMIT vince su copertura e semplicità. Per le coordinate imprecise si prevede un futuro "suggerisci correzione posizione", oppure un arricchimento OSM tramite join per prossimità, documentando la licenza.

## Consequences
- Più facile: lista mai vuota, segnalazione via indirizzo banale, nessuna coordinata utente al server.
- Più difficile: parser robusto e validazione con fallback (SDD §7.3).
- Da rivedere: se MIMIT cambia formato o interrompe il servizio, attivare il fallback OSM.

## Action Items
1. [ ] Scrivere il parser con test su campioni reali (entrambi i separatori).
2. [ ] Testo di attribuzione: "Anagrafica impianti: MIMIT, licenza IODL 2.0".
