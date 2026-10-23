# ADR-0012: Residenza dei dati nell'UE con la giurisdizione dei Durable Objects

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Luca (maintainer)

## Context
L'informativa privacy (§5) afferma che il database di QUI si trova in data center Cloudflare nell'UE. Il maintainer ha chiesto di fissare in configurazione i vincoli di regione per i binding e i "target regionali UE".

Dalla documentazione di Cloudflare (verificata il 2026-10-23):
- **Durable Objects:** la giurisdizione `eu` garantisce che l'oggetto *esegua e salvi dati* solo nell'UE. Si imposta **solo nel codice** (`namespace.jurisdiction("eu")`). I binding `durable_objects` in wrangler non hanno un campo `jurisdiction`: c'è solo per `r2_buckets`. I *location hint* (per esempio `weur`) sono best effort.
- **Placement del Worker** (`"placement": { "region": "gcp:europe-west1" }`): sposta l'esecuzione del fetch handler verso il data center più vicino alla regione indicata. È un'ottimizzazione, **non una garanzia di residenza**. La documentazione non indica disponibilità per piano né l'elenco dei codici accettati.
- **Regional Services** (TLS decifrato e traffico elaborato solo in data center UE): add-on **Enterprise**, configurato per hostname e non in wrangler.
- **Formato:** Cloudflare raccomanda `wrangler.jsonc` per i nuovi progetti; alcune funzioni nuove di Wrangler saranno disponibili solo con la configurazione JSON.

Rischio scoperto: le `vars` di wrangler non si ereditano tra ambienti. Un nuovo `env.staging` senza `DO_JURISDICTION` avrebbe creato oggetti **fuori dall'UE senza alcun errore**, perché il codice trattava "assente" come "nessuna giurisdizione".

## Decision
1. **Giurisdizione `eu` fail-closed** (`src/worker/jurisdiction.ts`): `located()` accetta solo `"eu"`, oppure `"none"` esplicito per lo sviluppo locale. Se la variabile manca o ha un altro valore, il Worker si ferma.
2. **Autoverifica dei Durable Objects:** `ProvinceDO` e `KeyDO` controllano `ctx.id.jurisdiction` nel costruttore. Un oggetto creato fuori dall'UE, per esempio da un `get` che salta `located()`, si rifiuta di funzionare.
3. **Politica regionale come test** (`scripts/region-policy.test.ts`): per la produzione e per ogni `env.*` richiede `DO_JURISDICTION = "eu"`; vieta archivi senza garanzia UE verificabile (KV, D1, Queues, Analytics Engine, Vectorize, Hyperdrive, Workflows) e bucket R2 senza `jurisdiction: "eu"`; vieta log persistenti.
4. **Nessun placement per regione**, per ora.
5. **Si resta su `wrangler.jsonc`.**

## Options Considered

### Option A: Giurisdizione nel codice + autoverifica + test della configurazione (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Bassa (un modulo, due test) |
| Cost | Nessuno |
| Scalability | Invariata |
| Team familiarity | Alta |

**Pros:** è l'unico vincolo con garanzia contrattuale disponibile sul piano Paid; tre difese indipendenti (variabile, oggetto, CI).
**Cons:** in locale non si può provare: workerd non supporta le giurisdizioni. La prima verifica reale è lo smoke test sullo staging.

### Option B: Placement del Worker in una regione UE
| Dimension | Assessment |
|---|---|
| Complexity | Bassa |
| Cost | Da verificare (disponibilità per piano non documentata) |
| Scalability | Un salto in più per chi non è vicino alla regione scelta |
| Team familiarity | Bassa |

**Pros:** il codice del Worker tenderebbe a girare nell'UE anche per chi si collega da fuori.
**Cons:** è best effort; non cambia dove arriva la richiesta e dove si decifra HTTPS (il data center d'ingresso vede comunque l'IP); per chi è in Italia il Worker gira già in Italia; i codici di regione non sono confermati.

### Option C: Regional Services (Data Localization Suite)
**Pros:** unica garanzia che HTTPS sia decifrato ed elaborato solo nell'UE.
**Cons:** add-on Enterprise, sproporzionato per un progetto senza fini di lucro.

### Option D: Passare a `wrangler.toml`
**Pros:** nessuno di sostanza: i due formati sono equivalenti.
**Cons:** va contro la raccomandazione di Cloudflare e chiude l'accesso alle funzioni nuove di Wrangler, disponibili solo con la configurazione JSON.

## Trade-off Analysis
Il rischio reale per la promessa dell'informativa non è *dove gira il Worker* (per gli utenti italiani: in Italia) ma *dove finiscono i dati salvati*. Quel punto è coperto da una garanzia contrattuale (la giurisdizione), resa robusta contro gli errori di configurazione. Il placement aggiungerebbe un'incertezza (disponibilità, codici) senza una garanzia in cambio.

## Consequences
- Più facile: aggiungere ambienti (`env.staging`) senza il rischio di dati fuori dall'UE; capire dal file di configurazione dove stanno i dati.
- Più difficile: aggiungere un archivio nuovo richiede prima di aggiornare la politica (è voluto).
- Da rivedere: il placement per regione, se Cloudflare ne documenta disponibilità e codici. Andrebbe provato sullo staging leggendo l'intestazione `cf-placement`.

## Action Items
1. [x] `src/worker/jurisdiction.ts` con test
2. [x] Autoverifica in `ProvinceDO` e `KeyDO`
3. [x] `scripts/region-policy.test.ts`
4. [ ] Pipeline di rilascio: deploy prima sullo staging (con `DO_JURISDICTION = "eu"`), poi smoke test, poi produzione. È la prima prova reale della giurisdizione.
