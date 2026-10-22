# ADR-0002: Stato vivo in Durable Objects SQLite, uno per provincia

**Status:** Accepted (MVP: una sola ProvinceDO `AV`)
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
Ogni segnalazione deve: verificare l'anti-replay, aggiornare i contatori anti-abuso, deduplicare e ricalcolare lo stato in modo **atomico**. Con uno storage eventualmente consistente, due segnalazioni simultanee possono superare entrambe i limiti.

## Decision
Un **Durable Object con backend SQLite per provincia** (`idFromName("LC")`), con `locationHint: "weur"`. Un **KeyDO** singleton gestisce la chiave HMAC giornaliera.

## Options Considered

### Option A: Durable Objects SQLite per provincia (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Media |
| Cost | Incluso nel piano. Il free tier copre anche lo storage SQLite |
| Scalability | Un DO regge centinaia di richieste/s: per una provincia basta e avanza |
| Team familiarity | Bassa: va studiato |

**Pros:** single-threaded, quindi niente race condition; SQL; alarm integrati per la purge a 8 h; dati in UE.
**Cons:** API specifica di Cloudflare; il debug locale richiede Miniflare.

### Option B: D1 (SQLite serverless)
**Pros:** SQL familiare, console web. **Cons:** le scritture concorrenti da più Worker richiedono transazioni con più round-trip; latenza più alta per le operazioni read-modify-write; purge da gestire con cron.

### Option C: Workers KV
**Cons:** eventualmente consistente (fino a ~60 s), quindi inadatto a contatori e anti-replay. **Scartata.** Resta utile solo per dati statici.

## Trade-off Analysis
Lo sharding per provincia rispecchia il modo in cui l'utente consuma i dati (vicinanza) e limita l'impatto di un attacco: una provincia sotto attacco non rallenta le altre. Il rischio di *hot shard* (una grande città) è accettabile: un DO gestisce un ordine di grandezza in più del traffico di scrittura previsto.

## Consequences
- Più facile: logica anti-abuso corretta "gratis" grazie alla serializzazione.
- Più difficile: query trasversali tra province (stats globali = fan-out su N DO).
- Da rivedere: se una provincia supera ~200 scritture/s, shard per comune.

## Action Items
1. [ ] Prototipo ProvinceDO con schema SDD §5.3 e test vitest-pool-workers.
2. [ ] Misurare la latenza p95 di `POST /api/report` sotto carico simulato.
