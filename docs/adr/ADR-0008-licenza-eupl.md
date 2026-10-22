# ADR-0008: Licenza del codice EUPL-1.2, dati aggregati CC BY 4.0

**Status:** Accepted (2026-10-22: scelta del maintainer **EUPL-1.2**, che sostituisce la proposta iniziale AGPL-3.0)
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
Il progetto deve essere open source e pubblico. La promessa di privacy vale solo se chiunque gestisca un'istanza pubblica non può aggiungere tracciamento di nascosto.

## Decision
- Codice: **EUPL-1.2** (`SPDX-License-Identifier: EUPL-1.2`). Chi offre un fork come servizio web deve pubblicarne i sorgenti.
- Dati aggregati pubblicati da QUI: **CC BY 4.0**.
- Dati di terzi: attribuzione MIMIT (IODL 2.0) e OSM (ODbL) rispettata.

## Options Considered

### Option A: AGPL-3.0 (proposta iniziale)
**Pros:** protegge gli utenti dai fork "con tracciamento"; coerente con il principio di trasparenza.
**Cons:** alcune aziende ed enti evitano l'AGPL, quindi l'adozione istituzionale può essere più difficile.

### Option B: MIT
**Pros:** massima adozione. **Cons:** un fork può chiudere il codice e tracciare gli utenti con lo stesso nome e la stessa grafica.

### Option C: EUPL-1.2 (scelta)
**Pros:** licenza UE, copyleft di rete, compatibile con l'AGPL; molto adatta se un ente pubblico vuole riusare. **Cons:** meno conosciuta dagli sviluppatori.

## Trade-off Analysis
Per un'app che chiede fiducia sulla privacy, il copyleft di rete è una garanzia per gli utenti, non un vincolo per gli sviluppatori.

## Consequences
- Più facile: argomentare "non possiamo tracciarvi, e nemmeno chi ci copia".
- Più difficile: alcuni sviluppatori non conoscono la EUPL. Il README spiega in 3 righe cosa comporta.
- Il nome e il logo "QUI" restano separati dalla licenza del codice: va scritta una *trademark policy* breve, così un fork malevolo non può spacciarsi per QUI.

## Revisione v0.3 (2026-10-22): perché EUPL-1.2
Il maintainer è un privato in Italia e intende presentare QUI a Prefettura e Protezione Civile. Motivi della scelta:
- testo ufficiale in italiano, con pari valore legale;
- legge e foro dello Stato UE del licenziante (Italia), art. 15;
- copyleft anche per l'uso via rete, come l'AGPL; l'AGPL è nell'elenco delle licenze compatibili;
- licenza raccomandata per il riuso nella PA (CAD art. 69, linee guida AgID).
Le dipendenze previste (Leaflet BSD-2, ALTCHA MIT, protomaps BSD) sono compatibili con entrambe.

## Action Items
1. [ ] `LICENSE` con il testo EUPL-1.2 (versione italiana e inglese) e header SPDX nei file.
2. [ ] `TRADEMARK.md` con la policy d'uso di nome e icona.
