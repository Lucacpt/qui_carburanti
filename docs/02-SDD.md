# QUI — Software Design Document (SDD)

> Versione 0.3 (decisioni del maintainer, vedi [07-report-v0.3.md](07-report-v0.3.md)) · 2026-10-22 · Stato: **Approvato per l'MVP**
> Requisiti: [01-RAD.md](01-RAD.md) · Decisioni: [adr/](adr/) · Minacce: [04-threat-model.md](04-threat-model.md)

## 1. Obiettivi di design (in ordine)
1. **Privacy per architettura**: i dati che non raccogliamo non possono trapelare.
2. **Banda minima**: lista ≤ 100 KB alla prima visita, poche centinaia di byte agli aggiornamenti.
3. **Robustezza ai picchi**: il costo di lettura non cresce con il numero di utenti.
4. **Semplicità operativa**: un solo deploy, zero server da gestire, poche dipendenze.
5. **Portabilità**: logica di dominio in TypeScript puro, isolata dalle API Cloudflare.

## 2. Architettura

```
                         ┌────────────────────────── Cloudflare edge ───────────────────────────┐
 ┌──────────────┐  HTTPS │  ┌─────────────────────────────────────────────────────────────┐     │
 │  Browser     │───────────▶│ Worker "qui" (fetch handler)                                │     │
 │  PWA         │◀───────────│  ├─ Static Assets  (/, /app.js, /r/<prov>.<hash>.json)      │     │
 │              │        │  │  ├─ GET  /api/s/:prov     → Cache API (30 s) → ProvinceDO   │     │
 │ • lista      │        │  │  ├─ GET  /api/challenge   → PoW HMAC firmato (stateless)    │     │
 │ • ricerca    │        │  │  ├─ POST /api/report      → validazione → ProvinceDO        │     │
 │   locale     │        │  │  ├─ POST /api/contest     → ProvinceDO + email maintainer   │     │
 │ • geoloc.    │        │  │  └─ /admin/*  (dietro Cloudflare Access)                    │     │
 │   SOLO       │        │  └───────────┬──────────────────────────┬───────────────────────┘     │
 │   locale     │        │              │                          │                             │
 │ • PoW worker │        │   ┌──────────▼─────────┐     ┌──────────▼────────┐   ┌──────────────┐ │
 └──────┬───────┘        │   │ ProvinceDO (×N)    │     │ KeyDO (singleton) │   │ RateLimit    │ │
        │ (solo su       │   │ SQLite: reports,   │     │ chiave HMAC del   │   │ binding      │ │
        │  richiesta)    │   │ abuse, stats       │     │ giorno, ruotata   │   │ (per prefisso│ │
        │                │   │ alarm 30-60 s      │     │ e distrutta       │   │  IP anonimo) │ │
        │                │   └────────────────────┘     └───────────────────┘   └──────────────┘ │
        │                │   ┌────────────────────┐     ┌──────────────────────────────────────┐ │
        └──── tiles ────────▶│ R2: regione.pmtiles│     │ Cron giornaliero: scarica anagrafica │ │
                         │   │ (range request)    │     │ MIMIT → valida → genera r/<prov>.json│ │
                         │   └────────────────────┘     │ → R2 + aggiorna ID nei ProvinceDO    │ │
                         │                              └──────────────────────────────────────┘ │
                         └───────────────────────────────────────────────────────────────────────┘
   Navigatore esterno ◀── link con SOLA destinazione (Google/Apple Maps, geo:, Waze)
```

## 3. Decomposizione in sottosistemi

| Sottosistema | Responsabilità | Tecnologia |
|---|---|---|
| **client/** | UI, ricerca locale, geolocalizzazione locale, solver PoW in Web Worker, service worker | TypeScript vanilla, esbuild. Nessun framework |
| **domain/** | Algoritmo di stato, regole anti-abuso, formati dati. **Puro, senza I/O** | TypeScript, testato al 90%+ |
| **worker/** | Routing HTTP, validazione schema, header di sicurezza, cache | Cloudflare Workers |
| **worker/do/ProvinceDO** | Stato autorevole di una provincia: segnalazioni, contatori, snapshot | Durable Object SQLite |
| **worker/do/KeyDO** | Generazione e rotazione della chiave HMAC giornaliera | Durable Object |
| **pipeline/registry** | Import MIMIT → anagrafica compatta per provincia | Cron Trigger + R2 |
| **pipeline/tiles** | Estratto PMTiles regionale (manuale, mensile) | `pmtiles` CLI, GitHub Action manuale |

**Regola di dipendenza:** `client → domain ← worker`. `domain/` non importa mai API Cloudflare né DOM, quindi si testa ovunque e si può migrare.

## 4. Mappatura hardware e software
- **Client:** qualsiasi browser mobile moderno (vedi NFR-C1).
- **Edge:** Cloudflare Workers, piano Paid consigliato (ADR-0001). Durable Objects con `locationHint: "weur"` per tenere i dati in UE.
- **Storage:** DO SQLite (stato vivo), R2 (anagrafiche e tile), Static Assets (shell).

## 5. Dati persistenti

### 5.1 Anagrafica (statica, pubblica)
File `r/<PROV>.<hash8>.json`, servito con `Cache-Control: public, max-age=31536000, immutable`, più un `r/manifest.json` (max-age=300) che punta agli hash correnti.

```jsonc
{
  "v": 1, "prov": "LC", "src": "MIMIT IODL 2.0", "date": "2026-10-22",
  "brands": ["Agip Eni", "Q8", "IP", "Tamoil", "Pompe Bianche", ...],
  // [idImpianto, latE5, lonE5, brandIdx, nome, indirizzo, comune, fuelsBitmask]
  "st": [[12345, 4585312, 939411, 0, "ENI VIA ROMA", "VIA ROMA 1", "LECCO", 3], ...]
}
```
- Coordinate come interi ×10⁵ (precisione ~1 m, meno byte).
- `fuelsBitmask`: carburanti venduti, ricavati dal file prezzi MIMIT. Bit 0 benzina `B`, 1 gasolio `G`, 2 GPL `L`, 3 metano `M`, 4 HVO `H`. Mappatura delle descrizioni commerciali nel report v0.3 §5.1. Gli impianti senza prezzi comunicati ricevono `B|G` di default.
- Misurato su AV (2026-10-21): 230 impianti, 18 bandiere, **7,6 KB brotli**.
- Gazetteer comuni: `r/comuni-<REG>.<hash>.json`, `[nome, latE5, lonE5]`.

### 5.2 Snapshot stati (dinamico, pubblico)
`GET /api/s/LC` → `ETag`, `Cache-Control: public, max-age=30, stale-while-revalidate=60`

```jsonc
{
  "v": 1, "t": 1761130200,          // ora server (epoch s), arrotondata al minuto
  "ro": false,                      // modalità sola lettura attiva?
  // solo coppie con stato ≠ grigio (v0.3.2: aggiunta la colonna "assenze").
  // [idImpianto, fuel, stato, conferme, assenze, etàMin(bucket 5'), flags, affidabilità, coda, limite]
  "s": [[12345, "B", 3, 4, 0, 5, 0, 3, 2, 0], [12345, "G", 1, 0, 3, 15, 0, 2, 0, 0]],
  // impianti congelati con la nota attribuita (procedura contestazioni)
  "fz": [[12345, "Il gestore segnala: rifornimento alle 14:20"]]
}
```
- Stato: `0` grigio, `1` rosso, `2` ambra, `3` verde. Flag: `1` congelato dal maintainer, `2` contrastante, `4` assenza da verificare, `8` rosso in verifica, `16` rosso scaduto (ADR-0011).
- Affidabilità (ADR-0006, ibrido): `1` bassa, `2` media, `3` alta, ricavata dallo `score` interno.
- Coda: `0` sconosciuta, `1` nessuna, `2` breve (< 15'), `3` lunga (> 15'). Limite: `0` sconosciuto/no, `1` sì.
- **Età in bucket da 5 minuti**: i timestamp esatti permetterebbero di correlare una segnalazione con una persona vista sul posto.

### 5.3 ProvinceDO — schema SQLite
```sql
CREATE TABLE stations (           -- solo ID validi per questa provincia (dal cron)
  id INTEGER PRIMARY KEY,
  frozen_state INTEGER, frozen_until INTEGER, frozen_note TEXT
);
CREATE TABLE reports (            -- TTL 8 h, purgato dall'alarm
  station INTEGER NOT NULL, fuel TEXT NOT NULL,
  has INTEGER NOT NULL,           -- 1 presente, 0 assente
  near INTEGER NOT NULL,          -- flag dichiarato dal client
  ts INTEGER NOT NULL,            -- ora server, mai del client
  rkey BLOB NOT NULL,             -- HMAC(K_giorno, prefisso ‖ token)  16 byte
  pkey BLOB NOT NULL              -- HMAC(K_giorno, prefisso)          16 byte
);
CREATE INDEX reports_sft ON reports(station, fuel, ts);
CREATE TABLE abuse (              -- TTL 24 h
  rkey BLOB PRIMARY KEY, level INTEGER NOT NULL, until INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE pow_used (sig TEXT PRIMARY KEY, expires INTEGER NOT NULL);   -- anti-replay
CREATE TABLE stats_hourly (       -- aggregati anonimi, conservati 90 giorni
  hour INTEGER, fuel TEXT, pos INTEGER, neg INTEGER, dropped INTEGER,
  PRIMARY KEY (hour, fuel)
);
CREATE TABLE contests (           -- notice & action DSA; email facoltativa, cancellata a 30 gg
  id INTEGER PRIMARY KEY, station INTEGER, fuel TEXT, reason TEXT, contact TEXT,
  ts INTEGER, status TEXT
);
CREATE TABLE config (k TEXT PRIMARY KEY, v TEXT);  -- read_only, pow_difficulty, ...
CREATE TABLE transitions (        -- ADR-0011 D: registro anonimo dei cambi di stato, conservato 30 giorni
  station INTEGER NOT NULL, fuel TEXT NOT NULL,
  ts INTEGER NOT NULL,            -- arrotondato al minuto
  from_state INTEGER, to_state INTEGER NOT NULL, flags INTEGER NOT NULL,
  confirmations INTEGER NOT NULL, absences INTEGER NOT NULL,
  cause TEXT NOT NULL             -- report | hold | ttl | window | fresh | time | freeze
);                                -- NESSUNA rkey/pkey: non contiene dati personali
```

### 5.4 Cosa NON è salvato da nessuna parte
IP in chiaro · coordinate dell'utente · user-agent · fingerprint · referrer · timestamp delle segnalazioni oltre le 8 h · qualunque identificativo stabile oltre le 24 h.

## 6. Controllo accessi e sicurezza

### 6.1 Identità anonima di segnalazione
```
prefisso   = IPv4 ? ip/32 : ip/64                  (da CF-Connecting-IP, solo in memoria)
token      = 128 bit casuali generati dal client, in localStorage, ruotati a mezzanotte locale
K_giorno   = 32 byte casuali da KeyDO (ruotati 00:00 UTC; la chiave precedente viene SOVRASCRITTA)
rkey       = trunc16(HMAC-SHA256(K_giorno, "r" ‖ prefisso ‖ token))
pkey       = trunc16(HMAC-SHA256(K_giorno, "p" ‖ prefisso))
```
- Senza `K_giorno` gli hash non sono invertibili, nemmeno con forza bruta sullo spazio IPv4.
- La chiave viene distrutta, quindi dopo 24 h nemmeno i maintainer possono ricollegare due giorni diversi (*forward secrecy*).
- L'IP resta comunque un **dato pseudonimo** ai sensi del GDPR finché la chiave esiste: lo trattiamo come dato personale (vedi rischi legali).

### 6.2 Proof-of-Work
- `GET /api/challenge?p=LC` restituisce una sfida in formato ALTCHA: `salt` contiene `p`, `expires` (+5 min) e la difficoltà. È firmata con HMAC e il server non conserva stato.
- La difficoltà parte bassa (circa 0,5-1 s su un telefono medio). Può essere alzata **per distributore** o **globalmente** via `config`.
- Il client la risolve in un Web Worker, avviato in anticipo quando l'utente apre il dettaglio di un distributore. Così il tocco "Segnala" sembra istantaneo.
- Anti-replay: la firma della sfida viene salvata in `pow_used` fino alla scadenza.

### 6.3 Header di sicurezza (tutte le risposte)
```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self';
  base-uri 'none'; form-action 'self'; frame-ancestors 'none';
  require-trusted-types-for 'script'
Permissions-Policy: geolocation=(self), camera=(), microphone=(), interest-cohort=()
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
```
`connect-src 'self'` è il **garante tecnico** della privacy: anche un bug non può inviare dati a terzi dal browser.

### 6.4 Area amministrativa
`/admin/*` sta dietro **Cloudflare Access** (Zero Trust, gratuito fino a 50 utenti): login con chiave hardware per i maintainer. Il Worker verifica anche il JWT `Cf-Access-Jwt-Assertion` (difesa in profondità).

## 7. Flusso di controllo globale

### 7.1 Segnalazione
```
Client                     Worker                         ProvinceDO
  │ GET /api/challenge?p=LC  │                                 │
  │─────────────────────────▶│ firma sfida (stateless)         │
  │◀─────────────────────────│                                 │
  │ [Web Worker risolve PoW] │                                 │
  │ POST /api/report         │                                 │
  │ {p,id,f,h,n,tk,pow}      │                                 │
  │─────────────────────────▶│ 1 schema strict (no extra field)│
  │                          │ 2 verifica firma+scadenza PoW   │
  │                          │ 3 RateLimit(pkey) globale       │
  │                          │ 4 calcola rkey,pkey (K_giorno)  │
  │                          │ 5 inoltra {id,f,h,n,rkey,pkey,  │
  │                          │   powSig} ─────────────────────▶│ a read_only? → scarta
  │                          │                                 │ b id ∈ stations? altrimenti 400
  │                          │                                 │ c powSig già usata? → scarta
  │                          │                                 │ d abuse(rkey) in timeout? → scarta
  │                          │                                 │ e dedupe/regole → INSERT o scarta
  │                          │                                 │ f marca "dirty", stats++
  │                          │◀──────── {state} ───────────────│
  │◀── 202 {ok:true,state} ──│  (sempre 202 se schema e PoW sono validi: lo scarto è silenzioso)
```

### 7.2 Lettura
Client → `GET /api/s/LC` (`If-None-Match`) → Worker → Cache API. Se HIT: 200 o 304. Se MISS: `ProvinceDO.snapshot()`, poi `cache.put` con TTL 30 s.
Il DO tiene lo snapshot in memoria e lo ricalcola solo se "dirty" o se è scaduta una finestra temporale (alarm ogni 60 s finché ci sono segnalazioni attive).

### 7.3 Import anagrafica (cron giornaliero, 09:30 Europe/Rome)
1. Download di `anagrafica_impianti_attivi.csv` e `prezzo_alle_8.csv` (separatore `|` dal 10/02/2026; supportiamo anche `;` per sicurezza). **La prima riga è `Estrazione del AAAA-MM-GG`** e va saltata, ma usata per verificare che il file non sia vecchio. L'intestazione è sulla seconda riga. *Nell'MVP l'import gira in CI e produce un asset statico; il cron arriva al giorno 4-5.*
2. Validazione: numero di righe in un intervallo atteso (±10% rispetto a ieri), coordinate nel bounding box della regione, ID interi. **Se la validazione fallisce, si tiene la versione precedente** e si apre un alert (issue GitHub via API).
3. Generazione dei file per provincia, upload su R2 con hash nel nome, aggiornamento del manifest.
4. Invio a ogni ProvinceDO della lista ID valida. Gli impianti chiusi vengono rimossi e le loro segnalazioni purgate.

## 8. Algoritmo di stato (dominio)

Parametri (default in `domain/config.ts`; `FRESH` e le soglie sono sovrascrivibili a runtime dalla tabella `config`, senza redeploy):
```
FRESH      = 45 min        WINDOW   = 8 h
W_NEAR     = 1.0           W_REMOTE = 0.25    (v0.3.1: 4 segnalazioni remote = 1 sul posto)
CAP_PREFIX = 1.0           // contributo massimo di un singolo prefisso IP a uno stato
GREEN_MIN  = 3.0           RED_MIN  = 3.0   + almeno 1 assenza near   (v0.3.1: +1 persona; v0.3: niente più rosso "non contrastato")
QUEUE_WINDOW = 30 min      // finestra di aggregazione di coda e limite
```

Pseudocodice per una coppia (distributore, carburante):
```
R ← segnalazioni ultime 8 h, tenendo per ogni rkey solo l'ULTIMA
se R vuoto                                     → GRIGIO
lastPos ← ts massimo tra le presenze (o null)    lastNeg ← ts massimo tra le assenze (o null)
neg     ← assenze con ts > lastPos (tutte se lastPos = null)
pos45   ← presenze con ts > lastNeg e ts > now − FRESH        // v0.3.2 (A): simmetria
wasGreen← pesoConCap(presenze fresche, anche precedenti alle assenze) ≥ GREEN_MIN
negW    ← pesoConCap(neg)        // Σ pesi, con il contributo di ogni pkey limitato a CAP_PREFIX
posW45  ← pesoConCap(pos45)

se negW ≥ RED_MIN e ∃ assenza near in neg:
    se now − max(neg.ts) > RED_TTL                                   → AMBRA (rosso scaduto, flag 16)   // B
    se now − min(neg.ts) < RED_HOLD                                  → AMBRA (rosso in verifica, flag 8) // C
    altrimenti                                                       → ROSSO
se posW45 ≥ GREEN_MIN                                                → VERDE (conferme = |pos45|)
se negW > 0                                                          → AMBRA (wasGreen ? contrastante, flag 2 : assenza da verificare, flag 4)
altrimenti (lastPos ≠ null garantito)                                → AMBRA (da verificare, età = now − lastPos)
```
Parametri aggiunti in v0.3.2 (ADR-0011): `RED_HOLD = 10 min`, `RED_TTL = 90 min`. Il risultato include anche `absences` e `lastAbsenceMs` per le etichette (`src/domain/labels.ts`).
Override: se `stations.frozen_until > now` → stato congelato, flag `1`.

**Affidabilità (v0.3.3, regole del maintainer, `src/domain/reliability.ts`):** **alta** se negli ultimi 10 minuti ci sono almeno 4 persone (reti diverse) di cui almeno 2 sul posto; **media** per ogni altro verde o rosso pieno (es. 3 persone, l'ultima 40 minuti fa); **bassa** per qualsiasi ambra. L'affidabilità **non cambia lo stato**: serve per l'indicatore e come ordinamento secondario. Lo `StateResult` espone per questo le `evidence` (ora, posto, rete delle segnalazioni che giustificano lo stato), che non vengono mai pubblicate.

**Coda e limite:** il valore più recente confermato da ≥ 2 `pkey` diverse in `QUEUE_WINDOW`, altrimenti l'ultimo valore segnalato con l'etichetta "1 segnalazione".

**Calibrazione:** a ogni passaggio VERDE → (prima assenza) il DO registra in `stats_hourly` la durata del verde in minuti, aggregata come istogramma. Serve a tarare `FRESH`.

**Ordinamento lato client (default confermato):** per stato (verde, ambra, grigio, rosso), poi per distanza; a parità di distanza (±300 m) per score. Con l'opzione "più confermati": verde ordinato per `conferme45` decrescente, poi per distanza.

### 8.1 Regole anti-abuso (in ProvinceDO)
| Regola | Effetto |
|---|---|
| Stessa `rkey`, stesso (distributore, carburante), entro 45' | conta solo l'ultima (dedupe naturale dell'algoritmo) |
| Più di 3 segnalazioni dalla stessa `rkey` sullo stesso distributore in 45' | `abuse.level++`, timeout di `2^level` minuti (massimo 24 h) |
| Più di 20 segnalazioni/ora dalla stessa `rkey` (su distributori diversi) | `abuse.level++`: un'auto non visita 20 distributori in un'ora |
| Più di 120 segnalazioni/ora per `pkey` (RateLimit binding, globale) | scarto silenzioso. Soglia alta per via del CGNAT |
| Raffica: un distributore entra in "rosso in verifica" (flag 8, tutte le assenze negli ultimi 10') | difficoltà PoW ×4 su quel distributore per 1 h + **notifica immediata ai maintainer**, che in 10 minuti possono congelarlo (ADR-0011 C) |

## 9. Interfacce (API)

| Metodo | Path | Body / risposta | Note |
|---|---|---|---|
| GET | `/api/challenge?p=XX` | → `{algorithm, challenge, salt, maxnumber, signature}` | rate-limited |
| POST | `/api/report` | `{p:"AV", id:12345, f:"B"\|"G"\|"L"\|"M"\|"H", h:0\|1, n:0\|1, q?:1\|2\|3, lim?:0\|1, tk:"<b64 16B>", pow:"<b64>"}` → `202 {ok, st}` | body ≤ 1 KB, campi extra ⇒ 400. `q`/`lim` sono facoltativi e ammessi solo con `h:1` |
| POST | `/api/push/subscribe` | `{p, ids:[≤20], f, sub:{endpoint, keys}, pow}` → `202 {expires}` | Giorno 4-5, ADR-0009. Scadenza 48 h |
| POST | `/api/push/unsubscribe` | `{endpoint}` → `204` | |
| GET | `/api/s/:prov` | → snapshot §5.2 | ETag, cache 30 s |
| POST | `/api/contest` | `{p, id, f, reason: enum, contact?: string ≤ 120}` → `202` | PoW obbligatorio |
| GET | `/r/manifest.json`, `/r/*.json` | anagrafiche | statiche |
| GET | `/.well-known/security.txt` | — | |
| * | `/admin/*` | freeze, read-only, difficoltà PoW, gestione contestazioni | Cloudflare Access |

**Deep link di navigazione** (client, con sola destinazione):
- iOS: `https://maps.apple.com/?daddr={lat},{lon}&dirflg=d`
- Android/altro: `https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=driving`
- "Altre app": `geo:{lat},{lon}?q={lat},{lon}({nome})` (OsmAnd, Organic Maps, Waze su Android)
- Il link si apre in una nuova scheda: QUI non vede né registra che cosa è stato scelto.

## 10. Design del client

### 10.1 Budget di banda (verificato in CI)
| Risorsa | Budget (brotli) | Caching |
|---|---|---|
| `index.html` + CSS inline critico | 6 KB | no-cache + ETag |
| `app.<hash>.js` | 20 KB | immutable |
| `pow.<hash>.js` (Web Worker) | 3 KB | immutable |
| `sw.js` | 2 KB | no-cache |
| Anagrafica provincia | 40 KB | immutable (cambia hash ogni giorno solo se cambia il contenuto) |
| Snapshot | 10 KB, 304 ≈ 0,3 KB | 30 s |
| *Lazy:* Leaflet + protomaps-leaflet | ~90 KB | immutable |
| *Lazy:* tile vettoriali per vista | ~30-80 KB | immutable |

### 10.1-bis Implementazione MVP (v0.3.3)
- `src/client/` in TypeScript senza framework, compilato con esbuild in `public/app.js` (≈ 6,7 KB brotli) e `public/pow.js` (Web Worker del PoW). La build parte da sola con `wrangler dev`/`deploy`.
- DOM costruito solo con `createElement`/`textContent` (Trusted Types): nessun `innerHTML`. Gli unici script caricabili da codice sono nella policy di `src/client/tt.ts`.
- Navigatore: l'utente sceglie l'app (Google Maps, Apple Mappe, `geo:`) e il telefono la ricorda. Nessuna lettura dello user agent.
- Verificato in emulazione mobile (390 px) con DevTools Protocol: niente scorrimento orizzontale, nessun errore né avviso CSP/Trusted Types in console.
- **Service worker rimandato** alle notifiche push (giorno 4-5): durante i rilasci rapidi una cache aggressiva mostrerebbe versioni vecchie.

### 10.2 Service worker
- **Precache:** shell, JS e icone (versione legata all'hash della build).
- **Anagrafica:** stale-while-revalidate.
- **Snapshot:** network-first con timeout di 3 s, poi cache con banner "Dati di X min fa".
- **Segnalazioni offline:** accodate in IndexedDB e inviate al ritorno della rete **solo se hanno meno di 10 minuti** (con PoW nuovo), altrimenti scartate. Una segnalazione vecchia è un dato falso.

### 10.3 Geolocalizzazione
- Solo dopo un tocco su "Usa la mia posizione". Mai al caricamento.
- `enableHighAccuracy: false` per la lista (più veloce, consuma meno batteria). `true` solo per il controllo `near`.
- La posizione vive solo in memoria e non viene salvata nemmeno in `localStorage`.

## 11. Condizioni limite
| Situazione | Comportamento |
|---|---|
| Primo avvio senza rete | Shell dalla cache, se mai visitata. Altrimenti pagina d'errore statica di 1 KB |
| MIMIT non raggiungibile o file corrotto | Si mantiene l'anagrafica precedente, alert ai maintainer |
| ProvinceDO in errore | Il Worker serve l'ultimo snapshot in cache (stale-if-error), le segnalazioni rispondono 503 con retry |
| Attacco in corso | `read_only=true` dall'admin: lettura ok, segnalazioni rifiutate con un messaggio chiaro |
| Rotazione chiave (00:00 UTC) | Le segnalazioni a cavallo contano come segnalatori diversi. Effetto trascurabile, accettato |
| Fine crisi | Flag globale `archived`: banner "Servizio sospeso", snapshot congelato, dataset aggregato pubblicato |

## 12. CI/CD (design; implementazione dopo la creazione della repo)

```
PR ──▶ ci.yml ──────────────────────────────────────────────────────────────────┐
       ├ lint + format (Biome)      ├ typecheck (tsc --noEmit)                  │
       ├ unit test domain (Vitest, coverage ≥ 90%)                              │
       ├ integration test worker (@cloudflare/vitest-pool-workers, DO reali)    │
       ├ privacy-guard: test che lo schema rifiuta lat/lon, grep vietati        │
       │  (console.log su header IP, fetch verso domini esterni, document.cookie)│
       ├ bundle-budget (script Node + zlib brotli, fallisce oltre budget)       │
       ├ dependency-review + npm audit (high)                                   │
       ├ CodeQL (JS/TS)              ├ gitleaks (segreti)                       │
       └ preview deploy su worker "qui-staging" (solo PR dallo stesso repo)     │
main ─▶ deploy-staging.yml ──▶ smoke test e2e (Playwright, 1 scenario)          │
tag v* ▶ release.yml ── environment "production" (approvazione manuale) ──▶    │
       build riproducibile → attestazione provenance (SLSA) → wrangler deploy   │
       → hash del bundle pubblicato nella release e mostrato in /trasparenza    │
cron ──▶ scorecard.yml (OpenSSF) · dependabot (settimanale, raggruppato)        │
```
- **Tutte le action pinnate per SHA**, `permissions: {}` di default e `step-security/harden-runner` per limitare l'egress.
- `npm ci --ignore-scripts`: niente script postinstall dalle dipendenze.
- Token Cloudflare con scope minimo (*Workers Scripts:Edit* su un solo account), salvato **solo** nell'environment `production`/`staging`, mai nelle variabili del repo.
- **Staging separato** (`qui-staging`, con DO e R2 propri): le *preview version* dei Workers condividono i binding con la produzione e scriverebbero dati reali.

## 13. Osservabilità senza tracciamento
- Workers Logs **disattivati** in produzione, oppure attivi con sampling e *senza* header. Logpush disattivato.
- Metriche: `stats_hourly` per DO, esposte in `/api/stats` (pubblico, aggregato).
- Alert: errori 5xx > 1% (Workers Analytics, che non contiene IP), cron fallito, raffiche sospette (§8.1). Canale: email dei maintainer tramite Cloudflare Email Routing.

## 14. Strategia di test
| Livello | Cosa | Strumento |
|---|---|---|
| Unit | Algoritmo di stato: tabella di casi (ogni transizione del §3.4.4 del RAD), pesi, cap prefisso, confini 45'/8 h | Vitest |
| Property | "Una sola `pkey` non cambia mai uno stato da grigio a verde", "lo stato è monotono rispetto all'aggiunta di presenze" | fast-check |
| Integration | Logica del DO (`ProvinceStore`) su SQLite reale: dedupe, timeout progressivo, purge 8 h, anti-replay PoW, registro anonimo, congelamento | Vitest + `node:sqlite` (stesso motore dei DO). `vitest-pool-workers` 0.23 supporta solo Vitest 4: da adottare quando supporterà Vitest 5 |
| Smoke E2E | Worker + DO + asset nel runtime Cloudflare locale (`wrangler dev`): PoW, rifiuto coordinate, snapshot/ETag/304, contestazioni | `scripts/smoke.ts`, job `smoke` in CI |
| Privacy | Nessuna colonna o log contiene IP; lo schema rifiuta coordinate; CSP presente su ogni risposta | Vitest |
| E2E | Cerca → dettaglio → segnala → stato aggiornato | Playwright (1-2 scenari, in staging) |
| Abuso | Script di carico che simula Sybil da 1 IP con N token: lo stato non deve diventare verde | k6 o script Node, manuale prima del lancio |
| Budget | Dimensioni brotli dei bundle | script Node in CI |
