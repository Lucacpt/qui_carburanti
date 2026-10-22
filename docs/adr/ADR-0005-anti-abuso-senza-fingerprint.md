# ADR-0005: Anti-abuso senza fingerprinting: PoW, HMAC giornaliero, deduplica silenziosa

**Status:** Accepted
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
La specifica originale prevede un timeout progressivo per IP **o fingerprint** dopo più di 3 segnalazioni sullo stesso distributore. Il fingerprinting ricade nell'art. 5(3) della direttiva ePrivacy (art. 122 Codice Privacy; Linee guida EDPB 2/2023), quindi richiederebbe consenso e un banner. Gli IP mobili italiani sono spesso dietro **CGNAT** e condivisi da molti utenti legittimi.

## Decision
- **PoW invisibile** self-hosted (formato ALTCHA, licenza MIT) su ogni segnalazione.
- **Chiavi anonime** `rkey`/`pkey` = HMAC con chiave casuale giornaliera, distrutta alla rotazione.
- **Token effimero** generato dal client (128 bit, ruotato ogni giorno) come "cookie di sicurezza" strettamente necessario.
- **Deduplica e scarto silenziosi**, timeout progressivo per `rkey`, **cap di contributo per prefisso IP** nel calcolo dello stato.
- Nessun fingerprinting.

## Options Considered

### Option A: PoW + HMAC + token effimero (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Media |
| Cost | Zero (CPU del client) |
| Scalability | Alta |
| Team familiarity | Bassa |

**Pros:** nessun consenso necessario (da confermare con un legale); nessuna terza parte; costo marginale per l'attaccante.
**Cons:** non ferma un attaccante con molti IP e molta CPU.

### Option B: Fingerprinting + IP (originale)
**Cons:** consenso obbligatorio; inefficace contro la modalità incognito; punisce gli utenti in CGNAT. **Scartata.**

### Option C: Cloudflare Turnstile
**Pros:** efficace contro i bot, gratuito. **Cons:** script di terza parte che raccoglie segnali dal browser; va citato nell'informativa; CSP da aprire. **Tenuto come "livello di emergenza"** attivabile solo sotto attacco grave, con avviso nell'informativa.

### Option D: Privacy Pass / token ciechi
**Pros:** non collegabilità crittografica. **Cons:** complessità alta per un MVP di crisi. **Rimandata.**

## Trade-off Analysis
Lo scopo non è fermare ogni abuso (impossibile senza identità) ma: (1) impedire che un singolo dispositivo o IP cambi lo stato da solo; (2) rendere costoso l'abuso su larga scala; (3) renderlo **visibile** (stato "contrastante", storico). Lo scarto silenzioso toglie all'attaccante il segnale per tarare l'attacco.

## Consequences
- Più facile: nessun cookie banner; informativa breve e onesta.
- Più difficile: spiegare a un utente in CGNAT perché la sua conferma "non è bastata" (nella UI: "In attesa di un'altra conferma").
- Da rivedere: soglie dopo 1 settimana di dati reali.

## Revisione v0.3: banner per i cookie tecnici?
*Domanda del maintainer: "E se aggiungessimo comunque un banner di consenso, anche se i cookie sono solo tecnici?"*

**Risposta: niente banner di consenso, ma un avviso informativo "just-in-time".**
- Per gli strumenti tecnici o strettamente necessari la legge chiede **solo l'informativa**, non il consenso (art. 122 Codice Privacy; Linee guida cookie del Garante, 10 giugno 2021). Un banner che *chiede il consenso* per qualcosa che non lo richiede è fuorviante: se l'utente rifiuta, cosa succede? Senza token l'anti-abuso si indebolisce, e se lo usiamo comunque il "rifiuto" è finto.
- Abituare le persone a cliccare banner va contro lo spirito del progetto, e un banner in più costa banda e attrito.
- **Al suo posto:**
  1. **Il token nasce solo alla prima segnalazione**, non all'apertura della pagina: chi consulta e basta non riceve **nulla** sul telefono.
  2. Alla prima segnalazione compare un **avviso** (non una richiesta di consenso), mostrato una sola volta: *"Per evitare lo spam, QUI salva sul tuo telefono un codice casuale che cambia ogni giorno. Nessun cookie, nessun tracciamento. [Ho capito] · [Dettagli]"*.
  3. Nel footer: "QUI non usa cookie · Privacy".
- Se il legale consultato preferisce un meccanismo di scelta, l'opzione di riserva è "Segnala senza codice" (solo IP + PoW, con meno peso), così il rifiuto resta reale.

## Action Items
1. [ ] Parere legale breve sul token effimero come strumento "strettamente necessario".
2. [ ] Test di proprietà: "una sola `pkey` non porta mai uno stato a verde".
