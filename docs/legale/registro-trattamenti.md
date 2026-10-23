# Registro dei trattamenti di QUI

> Art. 30 GDPR, con valutazione del legittimo interesse, verifica DPIA e procedura per le violazioni dei dati.
> **Versione 1 · 23 ottobre 2026** · documento pubblico, per trasparenza.
> ⚠️ Bozza in attesa di revisione legale. Non è una consulenza legale.

## 0. Titolare e premesse

| | |
|---|---|
| **Titolare** | [DA COMPILARE: nome e cognome], persona fisica |
| **Contatto** | privacy@quicarburanti.it |
| **DPO** | Non designato: nessun monitoraggio regolare e sistematico su larga scala e nessuna categoria particolare di dati (art. 37) |
| **Perché questo registro** | L'esenzione per chi ha meno di 250 dipendenti (art. 30, par. 5) non si applica, perché il trattamento non è occasionale |
| **Responsabile del trattamento** | Cloudflare, Inc. e affiliate, con il Data Processing Addendum accettato insieme ai termini del servizio (art. 28) |

I tempi di conservazione citati qui e nell'informativa coincidono con le costanti del codice. Lo verifica il test [`scripts/legal-pages.test.ts`](../../scripts/legal-pages.test.ts): se si cambia una costante senza aggiornare i testi, la CI fallisce.

## 1. Trattamenti

### T1 — Erogazione e protezione del sito
- **Finalità:** consegnare le pagine e i dati; difendere il servizio da attacchi.
- **Base giuridica:** legittimo interesse (art. 6.1.f), vedi §3.
- **Interessati:** chiunque visiti il sito.
- **Dati:** indirizzo IP e dati tecnici della richiesta (intestazioni HTTP).
- **Destinatari:** Cloudflare (responsabile).
- **Trasferimenti:** possibili verso gli USA (Cloudflare): Data Privacy Framework (Dec. (UE) 2023/1795) e clausole contrattuali tipo nel DPA.
- **Conservazione:** QUI non scrive log (`observability` disattivata, nessun `console.log` dei dati delle richieste). Per Cloudflare vale la sua informativa.

### T2 — Segnalazioni
- **Finalità:** calcolare lo stato dei distributori; impedire che una sola persona o rete determini lo stato.
- **Base giuridica:** legittimo interesse (art. 6.1.f), vedi §3.
- **Interessati:** chi invia una segnalazione.
- **Dati:** impianto, carburante, presenza o assenza, "sul posto" (booleano calcolato sul dispositivo), coda e limite facoltativi, ora; `rkey` = HMAC-SHA-256(chiave del giorno, prefisso IP ‖ token) e `pkey` = HMAC-SHA-256(chiave del giorno, prefisso IP), troncati a 128 bit. Prefisso: IPv4 intero, IPv6 /64. **L'IP non viene memorizzato.**
- **Destinatari:** Cloudflare (Durable Objects, giurisdizione UE).
- **Conservazione:** 8 ore (`DEFAULT_PARAMS.windowMs`), poi cancellazione automatica. La chiave del giorno viene cancellata a mezzanotte UTC. Le copie tecniche di Cloudflare (point-in-time recovery) restano fino a 30 giorni.
- **Note:** dati pseudonimizzati, quindi personali (cons. 26). Il token è casuale (128 bit), nasce sul dispositivo solo alla prima segnalazione del giorno e non è ricostruibile dal server.

### T3 — Anti-abuso
- **Finalità:** sicurezza del servizio (cons. 49).
- **Base giuridica:** legittimo interesse (art. 6.1.f).
- **Dati:** `rkey` con livello e scadenza del blocco; firme delle soluzioni del proof-of-work (non personali); contatore per rete del rate limiter di Cloudflare, con chiave `pkey`.
- **Conservazione:** contatori 24 ore dall'ultimo blocco (`ABUSE.keepMs`); firme PoW 5 minuti (`POW_TTL_MS`); rate limiter 60 secondi.
- **Decisioni automatizzate:** il blocco temporaneo è automatico ma non ha effetti giuridici né significativi (art. 22): impedisce solo di inviare segnalazioni, non di consultare.

### T4 — Contestazioni e segnalazioni di contenuti
- **Finalità:** correggere informazioni errate, tutelare i gestori, rispondere, documentare le decisioni.
- **Base giuridica:** legittimo interesse (art. 6.1.f); se applicabile il DSA, obbligo legale (art. 6.1.c; art. 16 Reg. (UE) 2022/2065).
- **Interessati:** gestori e chiunque contesti un'informazione.
- **Dati:** impianto, carburante, motivo (valore fisso, non testo libero), ora; contatto facoltativo (massimo 120 caratteri).
- **Conservazione:** contatto 30 giorni (`RETENTION.contactMs`, il campo viene azzerato); contestazione 180 giorni (`RETENTION.contestsMs`). Gli avvisi interni (`alerts`, senza contatto) durano 180 giorni (`RETENTION.alertsMs`).

### T5 — Corrispondenza
- **Finalità:** rispondere a utenti, gestori e autorità; gestire le richieste sui diritti (artt. 15-22).
- **Base giuridica:** obbligo legale (art. 6.1.c) per diritti e autorità; legittimo interesse (art. 6.1.f) negli altri casi.
- **Dati:** indirizzo email, contenuto, allegati.
- **Destinatari:** Cloudflare Email Routing (inoltro); fornitore della casella del titolare.
- **Conservazione:** 12 mesi dalla chiusura; più a lungo solo per la difesa in giudizio.

### T6 — Anagrafica degli impianti
- **Finalità:** identificare e mostrare i distributori.
- **Base giuridica:** legittimo interesse (art. 6.1.f) al riuso di dati aperti pubblicati dallo Stato (D.Lgs. 36/2006), vedi §3.
- **Interessati:** gestori, quando l'impianto è una ditta individuale e il nome identifica una persona.
- **Fonte:** MIMIT, licenza IODL 2.0 (art. 14: informativa pubblicata sul sito, §2.8, perché contattare ogni gestore richiederebbe uno sforzo sproporzionato, art. 14.5.b).
- **Dati:** id, nome dell'impianto, bandiera, indirizzo, comune, coordinate, carburanti.
- **Conservazione:** finché il MIMIT pubblica il dato; il file viene sostituito a ogni importazione.

### Dati non personali conservati
- `transitions`: cambi di stato per impianto, **senza** `rkey`/`pkey` (verificato da un test), 30 giorni.
- `stats_hourly`: totali per ora e carburante, 90 giorni.
- `current`, `frozen`: stato attuale e congelamenti (nota redatta dal titolare, massimo 3 ore).

### Archiviazione sul dispositivo (art. 122 Codice privacy)
Chiavi `localStorage` con prefisso `qui.` (elenco in `STORAGE_KEYS`, `src/client/local.ts`): `qui.token` (inviato solo con una segnalazione), `qui.notice`, `qui.maps`, `qui.helped`, `qui.fuel` (mai inviati). Sono strumenti tecnici, esenti da consenso: l'elenco pubblico è in `/cookie`. Un test verifica che la pagina e il codice coincidano.

## 2. Misure di sicurezza (art. 32)

- **Minimizzazione:** nessuna coordinata inviata (la guardia privacy in CI lo verifica); IP letto in un solo file (`src/worker/identity.ts`) e trasformato subito in HMAC.
- **Chiavi:** una chiave casuale per giorno, cancellata a mezzanotte UTC; nessuna chiave nel codice. `POW_SECRET` solo come secret di Cloudflare: senza secret il servizio si ferma.
- **Cancellazione:** automatica, nella manutenzione del Durable Object (alarm).
- **Trasporto:** HTTPS con HSTS (2 anni).
- **Browser:** CSP `default-src 'none'`, nessuno script di terzi, Trusted Types.
- **Accessi:** area amministrativa dietro Cloudflare Access con autenticazione a più fattori, solo per il titolare (da attivare prima del lancio).
- **Sviluppo:** branch `main` protetto, revisione tramite PR, CodeQL, dependency review, Actions bloccate per SHA, Dependabot con 7 giorni di attesa.
- **Resilienza:** point-in-time recovery di Cloudflare (30 giorni); modalità sola lettura per provincia.

## 3. Valutazione del legittimo interesse (LIA)

**Test 1 — Finalità legittima.** Durante una carenza di carburante sapere dove trovarlo riduce spostamenti inutili, code e tensioni. È un interesse del titolare (offrire il servizio), degli utenti e della collettività. Prevenire gli abusi è un interesse riconosciuto (cons. 49). Il riuso di dati aperti pubblici è previsto dall'ordinamento (D.Lgs. 36/2006).

**Test 2 — Necessità.** Senza un modo per distinguere chi segnala, una sola persona potrebbe fingere un consenso ("è esaurito") e danneggiare un gestore. Alternative valutate:
- un account: più invasivo, frena l'uso in emergenza;
- l'impronta del dispositivo: invasiva, richiede consenso, scartata (ADR-0005);
- solo l'IP: insufficiente con il CGNAT degli operatori mobili;
- **soluzione adottata:** IP più token effimero, trasformati in HMAC con chiave giornaliera, per 8 ore. È la misura meno invasiva tra quelle efficaci. Il proof-of-work aggiunge un costo per chi abusa senza raccogliere dati.

**Test 3 — Bilanciamento.**
- *Natura dei dati:* pseudonimi, non sensibili, nessuna posizione.
- *Aspettative ragionevoli:* chi usa un servizio anti-spam di segnalazioni si aspetta un controllo di frequenza; l'avviso alla prima segnalazione lo spiega prima dell'invio.
- *Impatto:* minimo. Nessuna profilazione, nessuna conseguenza oltre al blocco temporaneo delle segnalazioni, cancellazione entro 8 o 24 ore.
- *Garanzie aggiuntive:* codice pubblico; informativa a due livelli; pagina "I tuoi dati" con cancellazione in un tocco; diritto di opposizione esercitabile semplicemente non segnalando.
- *Gestori (T6):* il dato è già pubblico per legge; lo stato mostrato è sempre attribuito agli utenti e mai assertivo; c'è una procedura di contestazione con congelamento (ADR-0011).

**Conclusione:** l'interesse legittimo prevale, con le garanzie descritte. Da rivedere se cambiano dati raccolti o tempi.

## 4. Verifica sulla necessità di una DPIA (art. 35)

Criteri delle Linee guida WP248 rev.01 e dell'elenco del Garante (provv. n. 467 dell'11 ottobre 2018):

| Criterio | Presente? | Perché |
|---|---|---|
| Valutazione o punteggio di persone | No | Si valutano distributori, non persone |
| Decisioni automatizzate con effetti significativi | No | Il blocco anti-abuso non ha effetti significativi |
| Monitoraggio sistematico | No | Nessun tracciamento; codici che cambiano ogni giorno |
| Dati sensibili o altamente personali | No | |
| Larga scala | Forse, in emergenza | Molti utenti, ma dati pseudonimi che durano 8 ore |
| Incrocio di insiemi di dati | No | L'anagrafica MIMIT non riguarda chi segnala |
| Interessati vulnerabili | No | |
| Uso innovativo di tecnologie | No | Tecniche consolidate (HMAC, proof-of-work) |
| Impedire l'esercizio di un diritto o l'accesso a un servizio | No | La consultazione è sempre libera |
| Dati di localizzazione | No | La posizione non lascia il dispositivo |

**Esito:** al massimo un criterio, quindi la DPIA **non è obbligatoria**. **Da ripetere** prima di introdurre: notifiche push (endpoint e zona di interesse, ADR-0009); qualsiasi elaborazione della posizione lato server; nuove categorie di dati; espansione nazionale.

## 5. Procedura per le violazioni dei dati (artt. 33-34)

1. **Rilevare:** avvisi di Cloudflare, segnalazioni da SECURITY.md, anomalie nelle statistiche orarie.
2. **Contenere (subito):** sola lettura delle province coinvolte; rotazione di `POW_SECRET`; cancellazione della chiave del giorno (nuovi codici); revoca dei token di accesso (Cloudflare, GitHub).
3. **Valutare (entro 24 ore):** quali dati, quante persone, se identificabili. Con dati pseudonimi che durano 8 ore e una chiave giornaliera il rischio è di norma basso, ma va valutato caso per caso.
4. **Notificare:** al Garante **entro 72 ore** dalla scoperta, con la procedura telematica del Garante, salvo che sia improbabile un rischio per le persone (art. 33). Se il rischio è elevato, avviso ben visibile sul sito (art. 34.3.c), perché non abbiamo contatti.
5. **Documentare sempre**, anche quando non si notifica (art. 33.5): data, fatti, effetti, misure. Registro tenuto fuori dal repository pubblico.

## 6. Revisione

Va aggiornato a ogni nuova funzione che tocca dati personali, a ogni modifica dei tempi di conservazione (il test fallisce in quel caso) e comunque una volta l'anno.
