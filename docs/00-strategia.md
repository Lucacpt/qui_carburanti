# QUI — Strategia di progetto

> Versione 0.2 (dopo iterazione 1) · 2026-10-22 · Stato: **Bozza da validare**

## 1. Il problema, detto onestamente

Durante una carenza di carburante le persone sprecano proprio la risorsa che scarseggia: girano da un distributore all'altro, fanno code inutili e si affidano a voci su WhatsApp. Oggi non esiste in tempo reale un'informazione pubblica su **chi ha carburante adesso**. Il MIMIT pubblica prezzi e anagrafica, non la disponibilità.

QUI vuole ridurre i chilometri a vuoto con un dato crowdsourced, anonimo e verificabile dalla comunità.

## 2. Cosa QUI *non* è

- **Non è una fonte ufficiale.** È un aggregatore di segnalazioni, che possono essere sbagliate.
- **Non è un social network.** Niente testo libero, commenti, foto o profili.
- **Non è un sistema anti-frode perfetto.** Senza registrazione nessun sistema impedisce del tutto a un attaccante determinato di creare identità false (attacco Sybil). Lo rendiamo costoso e visibile, non impossibile: vedi [04-threat-model.md](04-threat-model.md).

## 3. Principi guida (in ordine di priorità)

1. **Non nuocere.** Un falso "verde" manda le persone a vuoto, un falso "rosso" danneggia un gestore. Ogni stato mostra quanto è fresco e quanto è certo.
2. **Privacy per architettura, non per policy.** Non chiediamo fiducia: il server non riceve coordinate GPS, non salva IP in chiaro e conserva le segnalazioni grezze solo per 8 ore. Il codice è pubblico e verificabile.
3. **Banda minima.** Prima la lista, la mappa solo se richiesta. Obiettivo: prima vista utile **≤ 100 KB** trasferiti, aggiornamenti successivi di poche centinaia di byte.
4. **Attrito zero per chi segnala.** Un tocco, nessun captcha visibile, nessun account.
5. **Trasparenza radicale.** Codice open source (EUPL-1.2, ADR-0008), decisioni documentate come ADR, statistiche aggregate pubbliche, hash della build visibile nell'app.

## 4. Strategia di prodotto

### 4.1 Lista prima della mappa
Chi cerca carburante ha bisogno di una cosa sola: *"il distributore più vicino che ha benzina adesso, e come arrivarci"*. Una **lista ordinata** risponde con 5 KB, una mappa con 300 KB. La mappa Leaflet resta, ma si carica solo quando l'utente tocca "Mappa".

### 4.2 Anagrafica ufficiale come scheletro
Usiamo l'anagrafica MIMIT degli impianti attivi (licenza IODL 2.0, aggiornata ogni giorno). Così:
- ogni segnalazione punta a un **ID distributore**, non a coordinate grezze, e la regola dei "30 m" diventa superflua;
- la segnalazione via indirizzo diventa "cerco il distributore nella lista e lo seleziono";
- la mappa non è mai vuota, nemmeno il primo giorno (problema del *cold start*).

### 4.3 Stato per tipo di carburante
Durante le carenze capita spesso che il gasolio ci sia e la benzina no. Uno stato unico per distributore sarebbe fuorviante, quindi lo stato è per **(distributore, carburante)**.

### 4.4 Quattro stati, non tre
| Stato | Colore e forma | Significato |
|---|---|---|
| Disponibile | ● verde | ≥ 3 conferme indipendenti negli ultimi 45 min (v0.3.1) |
| Da verificare | ▲ ambra | 1 sola conferma recente, conferme tra 45 min e 8 h, oppure segnalazioni contrastanti |
| Segnalato esaurito | ✕ rosso | Segnalazioni di assenza più recenti delle conferme |
| Nessuna informazione | ○ grigio | Nessuna segnalazione nelle ultime 8 h |

Il motivo della modifica rispetto alla specifica iniziale ("nessuna segnalazione = Esaurito") è in [03-iterazione-1.md](03-iterazione-1.md).

## 5. Strategia di cooperazione (senza account)

Senza identità non si possono usare punti, classifiche o reputazione: sarebbero ingestibili e premierebbero chi falsifica. Puntiamo invece su **reciprocità, impatto visibile e frizione minima**.

| Leva | Implementazione | Costo privacy |
|---|---|---|
| **Richiesta contestuale** | Se l'utente è vicino a un distributore (calcolo *sul telefono*), QUI chiede: "Sei da *Eni Via Roma*? C'è benzina?" con due bottoni grandi | Nessuno: la posizione non lascia il dispositivo |
| **Impatto immediato** | Dopo la segnalazione: "Grazie! Con la tua conferma questo distributore è diventato verde." | Nessuno |
| **Memoria locale** | "Hai aiutato 7 volte questa settimana", salvato solo in `localStorage` e cancellabile | Nessuno: non lascia il dispositivo |
| **Reciprocità esplicita** | Slogan *"Hai trovato? Segnala. Qualcuno lo farà per te."* | Nessuno |
| **Condivisione nativa** | Web Share API: testo + link `/d/<id>` su WhatsApp e Telegram, dove la comunità esiste già | Nessuno |
| **Presenza fisica** | Locandina A4 stampabile con QR "Segnala QUI" da appendere in bar, distributori e uffici comunali | Nessuno |
| **Dati aperti** | Statistiche aggregate orarie per provincia, pubbliche e scaricabili: la comunità vede il proprio contributo | Nessuno (solo aggregati) |
| **Fiducia** | Pagina "Cosa sappiamo di te: niente. Ecco il codice." con link ai sorgenti e hash della build | — |

**Anti-pattern evitati:** classifiche, badge pubblici, notifiche push aggressive, *dark pattern* per spingere a segnalare.

## 6. Strategia di lancio

> **Aggiornamento v0.3:** la carenza dovrebbe durare circa un'altra settimana. Il piano qui sotto è sostituito dall'**MVP in 72 ore per la provincia di Avellino**, descritto nel [report v0.3, §6](07-report-v0.3.md#6-piano-operativo). Le fasi seguenti restano valide per l'espansione a tutta la Campania dopo la crisi.

1. **Fase 0, decisioni (≈ 3 giorni).** Risposte alle domande aperte ([06-domande.md](06-domande.md)), verifica del marchio, scelta del dominio, revisione legale minima.
2. **Fase 1, MVP regionale (≈ 2 settimane).** Lista, ricerca, segnalazione, navigazione, anti-abuso di base. Una sola regione.
3. **Fase 2, hardening (≈ 1 settimana).** Test di carico, test di abuso, mappa lazy, PWA offline, pagina privacy e termini.
4. **Fase 3, lancio comunitario.** Contatto con media locali, Comuni e associazioni di volontariato; locandine; canale Telegram *in sola lettura* per gli annunci.
5. **Fase 4, fine crisi.** Modalità sola lettura, pubblicazione del dataset aggregato, archiviazione. **Un'app di crisi deve avere un piano di spegnimento.**

> ⚠️ La carenza è **in corso**: i tempi contano più della perfezione. La Fase 1 è tagliata di proposito: niente mappa, push o storico. Solo lista e segnalazione.

## 7. Metriche di successo (misurate senza tracciare nessuno)

Contatori aggregati nel Durable Object, senza ID utente:
- segnalazioni per ora per provincia;
- percentuale di distributori con stato ≠ grigio;
- tempo mediano tra la prima segnalazione e lo stato verde (*time-to-confirmation*);
- percentuale di stati "contrastanti", come indicatore di abuso;
- byte medi per sessione, stimati dalle dimensioni degli asset e non dalle sessioni reali.

## 8. Sostenibilità e costi stimati

| Voce | Costo |
|---|---|
| Cloudflare Workers Paid (consigliato, vedi ADR-0001) | 5 USD/mese |
| Dominio | ~10-15 €/anno |
| R2 (tile PMTiles regionali + snapshot) | quasi sempre nel free tier |
| Tempo dei maintainer | volontario |

## 9. Governance

- Maintainer: Luca, più almeno **un secondo maintainer** con diritto di review: riduce il rischio *bus factor* e quello di un deploy malevolo da parte di un singolo.
- Ogni decisione architetturale si documenta come ADR in `docs/adr/`.
- Codice di condotta: Contributor Covenant 2.1.
- Segnalazioni di sicurezza: `SECURITY.md` + `/.well-known/security.txt`.
