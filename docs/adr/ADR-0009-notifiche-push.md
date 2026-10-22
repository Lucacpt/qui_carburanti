# ADR-0009: Notifiche push senza GPS continuo, per lista di distributori, con scadenza a 48 ore

**Status:** Accepted (rilascio previsto al giorno 4-5, dopo l'MVP)
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
Gli utenti vogliono essere avvisati quando un distributore vicino torna disponibile. Vincoli: niente GPS sempre acceso, niente coordinate al server, banda minima e crisi breve. Su iOS il Web Push funziona solo con la PWA aggiunta alla schermata Home (iOS ≥ 16.4). Chrome e Safari richiedono che ogni push mostri una notifica visibile (`userVisibleOnly`), quindi non si possono usare push "silenziose" filtrate dal client.

## Decision
- L'utente attiva "Avvisami" su un singolo distributore, oppure su "i distributori entro X km": lista calcolata **sul telefono** con **una sola** lettura GPS, oppure scelta per comune.
- `POST /api/push/subscribe {p, ids[≤20], f, sub:{endpoint, keys}, pow}` → salvato nella ProvinceDO con **scadenza a 48 h**, rinnovabile con un tocco.
- Alla transizione → **VERDE** (non contrastante) di una coppia (id, f), il DO invia una notifica cifrata (RFC 8291 aes128gcm + VAPID RFC 8292, via WebCrypto) alle sottoscrizioni che la includono. Al massimo **1 notifica ogni 30'** per sottoscrizione.
- Endpoint scaduti o revocati (HTTP 404/410) → cancellati subito.

## Options Considered

### Option A: Sottoscrizione per lista di ID, scadenza 48 h (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Media (~1-2 giorni) |
| Cost | Trascurabile |
| Scalability | Alta: il fan-out è per provincia |
| Team familiarity | Bassa |

**Pros:** nessuna coordinata; dati minimi e a breve scadenza; notifiche solo quando servono.
**Cons:** il server conosce un insieme di distributori, cioè una zona di interesse approssimativa e pseudonima.

### Option B: Sottoscrizione per provincia + filtro sul client
**Cons:** non praticabile, perché i browser obbligano a mostrare ogni push e l'utente riceverebbe notifiche irrilevanti. **Scartata.**

### Option C: Sottoscrizione con posizione e raggio
**Cons:** coordinate al server, contro il principio 2. **Scartata.**

## Trade-off Analysis
La lista di ID è il compromesso minimo: rivela una zona larga qualche km, per 48 ore, legata a un endpoint opaco. È molto meno di una posizione e consente notifiche pertinenti.

## Consequences
- Più facile: un utente in attesa non deve tenere l'app aperta né aggiornare a mano (meno banda).
- Più difficile: informativa (servizi push di Google, Apple e Mozilla come destinatari dei metadati), test su iOS, gestione delle chiavi VAPID (segreto nel Worker).
- Da rivedere: se una notifica di verde falso genera abusi (threat model P12), alzare la soglia per le notifiche a ≥ 3 conferme.

## Action Items
1. [ ] Generare la coppia di chiavi VAPID e salvarla come secret del Worker.
2. [ ] Manifest PWA + service worker con gestore `push` e `notificationclick` → `/d/<id>`.
3. [ ] Testo nell'informativa (rischio L14).
