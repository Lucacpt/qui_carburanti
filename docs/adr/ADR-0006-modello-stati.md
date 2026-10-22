# ADR-0006: Modello a 4 stati per (distributore, carburante) con pesi e decadimento

**Status:** Accepted, con revisione v0.3 (vedi in fondo)
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
Il modello originale a 3 stati confonde "nessuna informazione" con "esaurito", usa l'etichetta "probabilmente esaurito" per conferme recenti e consente a una sola segnalazione negativa di colorare di rosso un distributore.

## Decision
Quattro stati (● Disponibile, ▲ Da verificare, ✕ Segnalato esaurito, ○ Nessuna informazione) calcolati per carburante, con l'algoritmo in [SDD §8](../02-SDD.md#8-algoritmo-di-stato-dominio): pesi `near`=1,0 / `remote`=0,5, cap 1,0 per prefisso IP, soglia verde 2,0, soglia rossa 2,0 con almeno 1 assenza sul posto (rivisto in v0.3). Più un indicatore di affidabilità a 3 livelli (ibrido A + C, v0.3).

## Options Considered

### Option A: 4 stati pesati (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Media, testabile come funzione pura |
| Cost | — |
| Scalability | O(segnalazioni in 8 h per distributore) |
| Team familiarity | Alta |

**Pros:** onesto sull'incertezza; resistente a un singolo attaccante; distingue i carburanti.
**Cons:** più difficile da spiegare.

### Option B: 3 stati (originale)
**Cons:** vedi Context. **Scartata.**

### Option C: Punteggio continuo con decadimento esponenziale (0-100%)
**Pros:** elegante, più espressivo. **Cons:** un "73%" non dice niente a chi guida; il colore va comunque discretizzato. Si può usare *internamente* in futuro.

### Option D: Ibrido A + C (proposta del maintainer, v0.3)
Gli stati discreti di A restano. In più, un **punteggio continuo** calcolato con il decadimento esponenziale di C.
Vedi "Revisione v0.3": è **accettato come indicatore di affidabilità a 3 livelli**, non come percentuale.

## Trade-off Analysis
In un contesto di crisi la semplicità di lettura conta più della precisione statistica. Quattro stati con forma e testo, più l'età dell'ultima conferma, bastano e restano accessibili ai daltonici.

## Consequences
- Più facile: difendere legalmente le etichette ("segnalato", non "è").
- Più difficile: con pochi utenti molti distributori restano ambra o grigi.
- Da rivedere: pesi e soglie dopo i primi dati reali, tramite un nuovo ADR.

## Revisione v0.3 (2026-10-22)
Su richiesta del maintainer ("alzare la soglia per evitare falsi esauriti"):
- `RED_MIN_UNOPPOSED` eliminato: il rosso richiede **sempre** peso di assenze ≥ 2,0 **e** almeno 1 assenza con `near = true`. In pratica servono almeno 2 persone da reti diverse, di cui una sul posto.
- Una singola assenza porta ad **ambra "Segnalata assenza, da verificare"**.
- `FRESH` (45') diventa configurabile a runtime e viene calibrato con la metrica "durata del verde" dopo 48 h di dati.
- Il modello ora copre 5 carburanti: Benzina, Gasolio, GPL, Metano, HVO.

### Ibrido A + C: perché un indicatore a livelli e non una percentuale
*Proposta del maintainer: "E se unissimo A e C, indicando la percentuale come probabilità di presenza?"*

L'idea di un punteggio continuo è buona, ma **mostrarlo come "probabilità"** pone tre problemi:
1. **Non è una probabilità.** Lo diventerebbe solo se fosse *calibrato* contro la realtà, ma non conosciamo la verità sul campo: sappiamo solo cosa segnalano le persone. Un "82%" comunica una precisione che non abbiamo.
2. **Rischio legale (L1):** un numero sembra una misura. "Presenza: 12%" su un distributore pieno è un'affermazione più forte e più contestabile di "▲ Da verificare".
3. **Leggibilità alla guida:** un colore, una forma e un'età si leggono in un secondo, una percentuale va interpretata.

**Proposta accettata nell'ibrido:**
- `score ∈ [0,1]` calcolato *internamente*: somma pesata delle segnalazioni con decadimento esponenziale (presenze +, assenze −), poi funzione logistica.
- Usi: (a) **ordinamento secondario** tra distributori verdi a distanza simile; (b) **indicatore di affidabilità a 3 livelli** accanto allo stato (▮▮▮ alta / ▮▮▯ media / ▮▯▯ bassa), con testo per l'accessibilità.
- **Fase 2:** dopo qualche giorno di dati possiamo misurare la *calibrazione empirica* ("quante volte un verde con score 0,8 è stato confermato dalla segnalazione successiva?"). Solo se i numeri tengono si può valutare una percentuale vera.

## Action Items
1. [ ] Implementare `computeState()` in `domain/` con tabella di test.
2. [ ] Pagina "Come funziona" con l'algoritmo in parole semplici.
