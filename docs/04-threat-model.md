# QUI — Threat model e piano dell'attaccante

> 2026-10-22 · Metodo: asset → avversari → **piano d'attacco dal punto di vista dell'attaccante** → difese → rischio residuo. Più tabella STRIDE.
> Va aggiornato a ogni modifica architetturale. Documento pubblico: la sicurezza di QUI non si basa sulla segretezza del design.

## 1. Asset da proteggere
| ID | Asset | Perché conta |
|---|---|---|
| A1 | **Integrità degli stati** | Uno stato falso manda persone a vuoto (verde falso) o danneggia un gestore (rosso falso) |
| A2 | **Anonimato dei segnalatori** | Nessuno deve poter dire "quella persona era lì a quell'ora" |
| A3 | **Disponibilità** | Il servizio serve proprio durante i picchi |
| A4 | **Integrità del codice servito** | Un JS malevolo potrebbe rubare la posizione GPS a migliaia di utenti |
| A5 | **Reputazione e fiducia** | Senza fiducia la comunità smette di segnalare |
| A6 | **Account dei maintainer** (GitHub, Cloudflare, dominio) | Chiave di tutto il resto |

## 2. Confini di fiducia
```
[Browser utente] ══(1)══▶ [Edge Cloudflare: Worker]──(2)──▶[DO / R2]
       ▲                          ▲
       │(5) codice JS             │(3) deploy
[CDN asset statici]◀──────[GitHub Actions]◀──(4)── [Dipendenze npm / Actions di terzi]
[MIMIT CSV] ──(6)──▶ [Cron]
```
(1) Input non fidato · (2) Fidato · (3) Segreti di deploy · (4) Supply chain · (5) Integrità del codice · (6) Dato esterno non fidato.

## 3. Avversari
| ID | Profilo | Risorse | Motivazione |
|---|---|---|---|
| T1 | **Burlone / troll** | 1 telefono, 1 ora | Divertimento, caos |
| T2 | **Gestore concorrente** | Pochi dispositivi, rete di conoscenti | Dirottare clienti: rivale in rosso, sé stesso in verde |
| T3 | **Gruppo coordinato** (chat Telegram, 20-200 persone) | Molti IP reali, persone vere | Politica, panico, "boicottaggio" |
| T4 | **Operatore di botnet / proxy residenziali** | Migliaia di IP, GPU | DoS, ricatto, test di capacità |
| T5 | **De-anonimizzatore** (stalker, datore di lavoro, autorità senza mandato) | Accesso fisico, osservazione, richieste legali | Sapere chi ha segnalato |
| T6 | **Attaccante supply chain** | Compromissione di un pacchetto npm o di un'action | Iniettare codice in molte app contemporaneamente |
| T7 | **Clonatore / phisher** | Dominio simile, APK falso | Malware, furto di dati, truffa "donazioni" |
| T8 | **Insider / account takeover** | Credenziali di un maintainer | Qualsiasi cosa |
| T9 | **Attaccante legale** | Avvocato, diffida | Rimozione di informazioni vere ma scomode, intimidazione (SLAPP) |

---

## 4. Piani d'attacco (prospettiva dell'attaccante)

### P1 — "Spegnere" un distributore concorrente (T2) → A1
**Obiettivo:** distributore X in ✕ rosso per tutto il pomeriggio.
1. *Ricognizione:* legge il codice open source e scopre le soglie (v0.3.1: rosso = peso di assenze ≥ 3,0 con almeno 1 `near`, quindi da almeno 3 prefissi diversi).
2. *Esecuzione semplice:* dal telefono segnala "Non c'è" con `near=true` (il flag è falsificabile). **Dalla v0.3 ottiene solo ambra "assenza da verificare"**, non più il rosso.
3. *Esecuzione robusta:* attiva e disattiva la modalità aereo per ottenere un nuovo IP CGNAT, cancella `localStorage` (nuovo token), risolve il PoW e ripete. Con 2 prefissi diversi supera anche le conferme recenti, se queste valgono meno di 2,0.
4. *Mantenimento:* ripete ogni 40 minuti.

**Difese:**
- D1.1 Con conferme recenti, una singola assenza produce "▲ contrastante", non rosso.
- D1.2 Rilevamento raffica (SDD §8.1): più di 4 assenze da prefissi diversi in 5' su un distributore verde → PoW ×4 + notifica.
- D1.3 Storico 8 h visibile nel dettaglio: un pattern "verde, verde, verde, rosso improvviso" è riconoscibile.
- D1.4 **Notice & action del gestore** + congelamento manuale con nota.
- D1.5 Etichetta "*Segnalato* esaurito da 3 persone – ultima segnalazione 3 min fa" invece di "Esaurito" (ADR-0011 E).
- D1.6 *(v0.3.2)* **Rosso in verifica:** se le assenze arrivano tutte in 10', per 10' si mostra ambra e i maintainer vengono avvisati. L'attacco con la modalità aereo (3 IP in 2 minuti) diventa visibile prima di produrre danni (ADR-0011 C).
- D1.7 *(v0.3.2)* **Scadenza del rosso** dopo 90' senza nuove assenze: per mantenere un falso rosso l'attaccante deve ripetere l'attacco ogni ora e mezza, esponendosi ogni volta (ADR-0011 B).
- D1.8 *(v0.3.2)* **Registro anonimo dei cambi di stato:** permette di ricostruire un attacco e di rispondere al gestore con i dati (ADR-0011 D).

**Rischio residuo: MEDIO-BASSO (v0.3).** Serve un attaccante con almeno 2 IP diversi e un nuovo token per ciascuno (passo 3): l'attacco "da un tocco" non esiste più. **Accettato** e mitigato dalla visibilità.

### P2 — Verde falso per attirare clienti (T2, T1) → A1
Simmetrico a P1. È **più dannoso** per gli utenti: si fanno chilometri inutili.
**Difese:** verde solo con ≥ 3,0 da almeno 3 prefissi diversi (`CAP_PREFIX`, v0.3.1); decadimento dopo 45'; chi arriva sul posto e trova vuoto segnala "Non c'è", e lo stato passa a contrastante.
**Rischio residuo: MEDIO.**

### P3 — Brigading coordinato (T3) → A1, A5
**Obiettivo:** tutta una zona in rosso per creare panico ("non c'è più benzina in tutta la provincia").
1. Crea un canale Telegram con lo script: "Segnalate NON C'È su questi 30 distributori".
2. 100 persone reali, IP reali, PoW reali.

**Difese:** nessuna difesa tecnica è completa: sono persone vere. Mitigazioni: rilevamento anomalie a livello di provincia (più di N distributori che passano da verde a rosso in 10'), allerta ai maintainer, **modalità sola lettura** con banner "Rilevate segnalazioni anomale, dati sospesi". Comunicazione pubblica trasparente.
**Rischio residuo: ALTO.** È il limite strutturale dell'anonimato (trilemma: anonimato, nessuna registrazione, resistenza Sybil). **Va accettato consapevolmente**: vedi domande e rischio legale L4.

### P4 — Sybil automatizzato con proxy residenziali (T4) → A1, A3
1. Noleggia proxy residenziali italiani (decine di migliaia di IP).
2. Risolve i PoW su GPU (ALTCHA usa SHA-256: un GPU risolve milioni di sfide).
3. Inonda di segnalazioni casuali o mirate.

**Difese:** PoW adattivo; verifica `CF-IPCountry` (solo IT, filtro economico); RateLimit per `pkey`; **escalation a Turnstile** (ADR-0005, opzione C) come livello di emergenza; sola lettura.
**Rischio residuo: MEDIO-ALTO** sotto attacco mirato, **BASSO** come probabilità (costa denaro e il guadagno per l'attaccante è scarso).

### P5 — DoS da costo / esaurimento quota (T4, T1) → A3
1. Flood di `POST /api/report` con PoW non valido → il Worker scarta, ma ogni richiesta conta come invocazione.
2. Flood di `GET /api/s/*` → servito dalla cache.
3. Flood di `GET /api/challenge`.

**Difese:** regola WAF di rate limiting su `/api/*` per IP; piano Paid con **avviso di spesa**; verifica del PoW (una sola HMAC, economica) *prima* di contattare il DO; body massimo di 1 KB; "Under Attack Mode" Cloudflare come pulsante d'emergenza.
**Rischio residuo: BASSO** (Cloudflare assorbe i DoS volumetrici).

### P6 — Scoprire chi ha segnalato (T5) → A2
| Vettore | Difesa | Residuo |
|---|---|---|
| Richiesta legale ai maintainer: "dateci gli IP delle segnalazioni del 22/10" | **Non li abbiamo**: HMAC con chiave distrutta. Segnalazioni cancellate dopo 8 h | Molto basso |
| Richiesta legale a Cloudflare (log di edge) | Logpush disattivato. Dipende comunque dalla retention di Cloudflare, **fuori dal nostro controllo** e indicato nell'informativa | Basso-medio |
| Correlazione temporale: l'osservatore vede una persona al distributore e un aggiornamento dello stato 10 secondi dopo | Età in bucket da 5', snapshot ogni 30 s, conteggi e non timestamp | Basso |
| Accesso al telefono della vittima | Nessuno storico locale delle segnalazioni, solo un contatore. Il token si ruota ogni giorno | Basso |
| Tile o geocoder di terze parti che vedono la posizione | Non ci sono terze parti (ADR-0004, ADR-0007) e la CSP lo impone | Molto basso |

### P7 — Compromissione della supply chain (T6) → A4 (lo scenario peggiore)
**Obiettivo:** servire JS che invia la posizione GPS a un server esterno.
1. Compromette una dipendenza npm *di build* (esbuild, wrangler, vitest...) o una GitHub Action di terzi. Precedente reale: `tj-actions/changed-files`, marzo 2025.
2. Durante la CI esfiltra `CLOUDFLARE_API_TOKEN` oppure inietta codice nel bundle.
3. Deploya.

**Difese:**
- `connect-src 'self'` nella CSP: anche un JS malevolo **non può inviare dati a domini terzi**. L'attaccante dovrebbe modificare anche gli header nel Worker, il che è possibile se controlla il deploy. Il sistema regge solo combinando questa con le altre difese.
- Action pinnate per **SHA**; `harden-runner` con egress in allowlist; `npm ci --ignore-scripts`; lockfile; Dependabot con review; dipendenze *runtime* client = 0 (+ Leaflet lazy).
- Token Cloudflare **solo** nell'environment `production`, con **approvazione manuale obbligatoria** di un secondo maintainer.
- Build riproducibile + **attestazione di provenienza** + hash del bundle in `/trasparenza`: chiunque può verificare che il JS servito corrisponda al tag.

**Rischio residuo: BASSO-MEDIO.**

### P8 — Clone malevolo (T7) → A5
"QUI – App ufficiale.apk" distribuita su WhatsApp durante la crisi, con malware, oppure un dominio `qui-carburante.it` con raccolta di "donazioni".
**Difese:** comunicare chiaramente "**QUI non ha app da scaricare: è solo un sito, eccolo**"; trademark policy; monitoraggio dei domini simili; nessuna richiesta di denaro, mai, oppure solo tramite un canale ufficiale unico.
**Rischio residuo: MEDIO.** Non si controlla, ma si comunica.

### P9 — Iniezione e parsing (T1, T4) → A1, A4
XSS tramite campi testo (non ce ne sono), CSV MIMIT malevolo o corrotto (difesa: validazione e fallback), JSON bomb (difesa: body ≤ 1 KB, schema rigido), ReDoS nella ricerca locale (difesa: nessuna regex costruita dall'input), prototype pollution (difesa: parsing in oggetti con schema, nessun merge profondo).
**Rischio residuo: BASSO.**

### P10 — Takeover degli account dei maintainer (T8) → A6
Phishing sul login GitHub o Cloudflare, oppure session hijacking.
**Difese:** **chiavi hardware FIDO2** obbligatorie, account Cloudflare dedicato, branch protection con review obbligatoria, CODEOWNERS, commit firmati, nessun maintainer singolo può fare deploy in produzione.
**Rischio residuo: BASSO** con 2 maintainer, **MEDIO** se resta 1 solo maintainer.

### P11 — Pressione legale (T9) → A5
Diffida da una catena di distributori: "rimuovete le informazioni sui nostri impianti". Oppure molte richieste GDPR pretestuose.
**Difese:** procedura di notice & action documentata; art. 11 GDPR (non conserviamo dati che permettano di identificare l'interessato); contatto con un legale pronto.

---

## 5. STRIDE
| Categoria | Minaccia | Difesa principale |
|---|---|---|
| **S**poofing | `near` falso, token falsi, IP ruotati | Pesi, cap per prefisso, PoW, stato contrastante |
| **T**ampering | Codice servito modificato, CSV MIMIT alterato | Provenance, CSP, review, validazione del CSV |
| **R**epudiation | "Non ho fatto io quel deploy" | Audit log GitHub e Cloudflare, deploy solo da CI |
| **I**nformation disclosure | De-anonimizzazione, log con IP | HMAC + chiave distrutta, nessun log, CSP |
| **D**enial of service | Flood API, esaurimento quota | Cache, WAF, Paid, sola lettura |
| **E**levation of privilege | Accesso a `/admin` | Cloudflare Access + verifica JWT, FIDO2 |

## 6. Abuse case da trasformare in test automatici
1. Una sola `pkey` con 50 token diversi → lo stato **non** diventa verde.
2. Una sola assenza `near` dopo 3 conferme recenti da prefissi diversi → **ambra contrastante**, non rosso.
3. Riuso della stessa firma PoW → seconda segnalazione scartata.
4. Body con `lat`/`lon` → 400.
5. Nessuna risposta del Worker è priva della CSP.
6. Dopo 8 h e 1 minuto (orologio finto) → la tabella `reports` è vuota.
7. Dopo la rotazione della chiave → la stessa coppia (IP, token) produce una `rkey` diversa.
8. CSV MIMIT con il 50% di righe in meno → l'import viene rifiutato e resta la versione precedente.

## 7. Esercizio red team consigliato prima del lancio
Mezza giornata con 2-3 persone che provano P1, P2 e P5 su staging, con un premio simbolico. Si documentano i risultati in `docs/redteam-AAAA-MM-GG.md` e si correggono le soglie.
