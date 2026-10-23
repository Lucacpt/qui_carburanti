# ADR-0013: Area admin dietro Cloudflare Access, con verifica nel Worker

**Status:** Accepted
**Date:** 2026-10-24
**Deciders:** Luca (maintainer)

## Context
La procedura di contestazione (ADR-0011) promette di intervenire entro 4 ore durante l'emergenza: vedere gli avvisi "rosso in verifica", congelare un distributore con una nota, sospendere le segnalazioni in caso di attacco. Finora mancava uno strumento per farlo senza toccare il database a mano.

Vincoli: un solo maintainer, nessun account per gli utenti, nessun dato personale in più, budget nullo.

## Decision
- **Pagina** `/admin` (bundle separato `admin.js`, 3,4 KB) e **API** `/api/admin/overview`, `/api/admin/history`, `/api/admin/action`.
- **Accesso:** Cloudflare Access (Zero Trust, gratis fino a 50 utenti) davanti a `/admin` e `/api/admin`, con login via email o GitHub e verifica in due passaggi.
- **Difesa in profondità:** il Worker verifica a ogni richiesta il token `Cf-Access-Jwt-Assertion`: firma RS256 con le chiavi del team, emittente, audience, scadenza ed email ammessa (`src/worker/access.ts`). Senza configurazione l'area resta chiusa (503).
- **CSRF:** le azioni accettano solo `application/json` con `Origin` uguale al sito.
- **Configurazione:** `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` e `ADMIN_EMAILS` come secret del Worker. L'email dell'admin non entra nel repository; un test lo verifica.
- **Sviluppo locale:** `ADMIN_DEV=1` in `.dev.vars` apre l'area solo su `localhost` e solo con `DO_JURISDICTION=none`. Un test vieta `ADMIN_DEV` nella configurazione di deploy.
- **Registro delle azioni** (`admin_log`, 180 giorni): congelamenti, sblocchi, sola lettura, stato delle contestazioni. Serve a rendere conto delle decisioni (DSA art. 17, procedura contestazioni).
- **Notifiche email: rimandate.** L'invio da Worker (`send_email`) richiede Cloudflare Email Routing, che sostituirebbe i record MX di Aruba. Per ora la scheda del browser mostra il numero di avvisi nel titolo e si aggiorna ogni minuto.

## Options Considered

### Option A: Access + verifica JWT nel Worker (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Media (verifica JWT con WebCrypto, testata) |
| Cost | Nessuno |
| Scalability | Fino a 50 admin |
| Team familiarity | Media |

**Pros:** login robusto senza gestire password; doppia barriera; nessun dato utente esposto.
**Cons:** dipende dalla corretta configurazione di Access; senza email gli avvisi si vedono solo aprendo la pagina.

### Option B: Password o token statico nel Worker
**Cons:** un segreto da custodire e ruotare, nessuna verifica in due passaggi, rischio di attacchi a forza bruta. Scartata.

### Option C: Modifiche manuali al database (Wrangler/console)
**Cons:** lento proprio quando serve rapidità, nessun registro delle azioni, facile sbagliare. Scartata.

## Consequences
- Più facile: rispettare i tempi della procedura di contestazione; dimostrare cosa è stato deciso e quando.
- Più difficile: senza configurare Access l'area non funziona in produzione. È voluto.
- Da rivedere: notifiche (email tramite un sottodominio con Email Routing, oppure push) e statistiche con grafici.

## Action Items
1. [x] `access.ts`, `admin-input.ts`, `admin.ts`, metodi admin nel Durable Object, con test
2. [x] Pagina `/admin` verificata in emulazione mobile; CSRF e chiusura senza configurazione provate in locale
3. [ ] Configurare Cloudflare Access e i tre secret
4. [ ] Notifiche degli avvisi
