# ADR-0011: Tutele per i gestori e per il maintainer

**Status:** Accepted
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
Il maintainer vuole tutelare al massimo i distributori e sé stesso. Eseguendo scenari limite sull'algoritmo v0.3.1 sono emersi tre problemi:
1. **Verde resuscitato:** 3 conferme, poi 3 assenze (rosso), poi **un solo** "c'è" → **verde**. Le conferme vecchie, smentite dalle assenze, tornavano a contare.
2. **Rosso eterno:** un rosso restava tale fino a 8 ore anche se il distributore veniva rifornito e nessuno lo segnalava.
3. **Rosso lampo:** una sola persona che attiva e disattiva la modalità aereo (3 IP diversi) può produrre un rosso in circa 2 minuti.

Inoltre, dopo 8 ore non resta traccia di *perché* uno stato è stato mostrato, quindi il maintainer non può dimostrare la propria diligenza in caso di contestazione.

## Decision
| | Misura | Dove |
|---|---|---|
| **A** | **Simmetria:** le conferme contano solo se successive all'ultima assenza, come le assenze rispetto alle conferme. Dopo un rosso servono 3 conferme *nuove* per il verde | `computeState` |
| **B** | **Scadenza del rosso:** senza nuove assenze per 90 minuti, il rosso diventa ambra "Segnalato esaurito X fa, da verificare: potrebbe essere stato rifornito" | `computeState`, `redTtlMs` |
| **C** | **Rosso in verifica:** se tutte le assenze che compongono il rosso sono degli ultimi 10 minuti, si mostra ambra "Segnalazioni di assenza in verifica". Il DO notifica i maintainer e aumenta la difficoltà PoW su quel distributore | `computeState`, `redHoldMs`, ProvinceDO |
| **D** | **Registro anonimo dei cambi di stato** (30 giorni): distributore, carburante, minuto, stato, quante conferme e assenze, causa. **Nessun identificativo dei segnalatori** | ProvinceDO, tabella `transitions` (SDD §5.3) |
| **E** | **Etichette descrittive:** "Segnalato esaurito **da 3 persone** · ultima segnalazione 12 min fa", mai "Esaurito". Link "**Sei il gestore? Segnala un errore**" su ogni stato con assenze. Un test vieta le formulazioni assertive | `src/domain/labels.ts` |
| **F** | **Procedura pubblica per le contestazioni**, con tempi di risposta e azioni previste | [procedure/contestazioni.md](../procedure/contestazioni.md) |

## Options Considered

### Option A: Pacchetto completo A-F (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Bassa nel dominio (funzioni pure testate), media nel DO (registro, notifica) |
| Cost | Nessuno |
| Scalability | Il registro occupa poche righe per cambio di stato |
| Team familiarity | Alta |

**Pros:** chiude il caso del verde resuscitato; limita il danno nel tempo (90') e nella velocità (10'); fornisce prove di diligenza; offre un canale diretto ai gestori.
**Cons:** un rosso vero appare fino a 10 minuti dopo; un rosso vero sparisce dopo 90' se nessuno lo conferma.

### Option B: Solo A e B
**Pros:** nessun ritardo sui rossi veri. **Cons:** il "rosso lampo" resta possibile senza che i maintainer ne sappiano nulla.

### Option C: Gestori verificati (canale dedicato)
Scartata dal maintainer (domanda 16): richiede identificazione e gestione dei codici.

## Trade-off Analysis
Il principio è l'**asimmetria di prudenza**: deve essere difficile *accusare* (rosso) e facile *sospendere l'accusa* (ambra), ma uscire da un'accusa non deve mai significare automaticamente "disponibile" (verde). I ritardi introdotti (10') e le scadenze (90') penalizzano poco chi cerca carburante, perché l'ambra non promette nulla, e proteggono molto chi gestisce un impianto.

Sul piano legale conta dimostrare la **diligenza**, non l'infallibilità: regole pubbliche (questo ADR e il codice), etichette che riportano fatti, un canale di rettifica e la prova di come è nato ogni stato (D).

## Consequences
- Più facile: rispondere a una contestazione con dati ("alle 14:02 il distributore è passato a 'rosso in verifica' con 3 segnalazioni, alle 14:12 a rosso").
- Più difficile: spiegare agli utenti perché un rosso "non arriva subito". La pagina "Come funziona" lo spiega.
- Privacy: il registro D contiene orari al minuto dei cambi di stato. Non è pubblico, non contiene identificativi e viene cancellato dopo 30 giorni. Va citato nell'informativa.
- Da rivedere: 10' e 90' dopo i primi dati reali (sono parametri a runtime).

## Action Items
1. [x] A, B, C, E nel dominio, con test (70 test verdi).
2. [ ] D e la notifica di C nella ProvinceDO (prossima PR).
3. [ ] Link "Segnala un errore" nella UI → `POST /api/contest`.
4. [ ] Testo nell'informativa sul registro D.
