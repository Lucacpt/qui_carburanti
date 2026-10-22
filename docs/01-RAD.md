# QUI — Requirements Analysis Document (RAD)

> Versione 0.3 (decisioni del maintainer, vedi [07-report-v0.3.md](07-report-v0.3.md)) · 2026-10-22 · Stato: **Approvato per l'MVP (provincia di Avellino)**
> Struttura ispirata a Bruegge & Dutoit, *Object-Oriented Software Engineering*.

## 1. Introduzione

### 1.1 Scopo del sistema
QUI aiuta chi guida a trovare, durante una carenza di carburante, i distributori vicini che **hanno carburante in questo momento**. L'informazione arriva da segnalazioni anonime degli utenti.

### 1.2 Ambito
- **Dentro l'ambito:** web app mobile (PWA), segnalazioni anonime, calcolo dello stato, ricerca, navigazione verso app esterne, anti-abuso, pagine legali.
- **Fuori dall'ambito (v1):** app native, account utente, prezzi (esiste già l'Osservaprezzi MIMIT), commenti a testo libero, notifiche push, gestione delle code.

### 1.3 Obiettivi
| ID | Obiettivo | Misura |
|---|---|---|
| O1 | Ridurre i tentativi a vuoto | Più del 70% degli stati verdi confermati dalla segnalazione successiva |
| O2 | Funzionare con connessioni pessime | Prima vista utile ≤ 100 KB, interattiva in < 5 s su 3G lento |
| O3 | Non raccogliere dati personali oltre lo stretto necessario | Nessun IP in chiaro né coordinate GPS lato server (verificato da test in CI) |
| O4 | Resistere ad abusi opportunistici | Un singolo dispositivo non può cambiare lo stato di un distributore da solo |

### 1.4 Definizioni
| Termine | Definizione |
|---|---|
| **Distributore** | Impianto presente nell'anagrafica MIMIT, identificato da `idImpianto` |
| **Segnalazione** | Tupla `(idImpianto, carburante, presente/assente, vicino: sì/no, timestamp server)` |
| **Conferma** | Segnalazione di presenza |
| **Segnalatore distinto** | Chiave anonima `reporterKey` = HMAC(chiave giornaliera, prefisso IP ‖ token effimero). Non è reversibile e cambia ogni giorno |
| **Vicino** | Il client ha calcolato di trovarsi entro ~150 m dal distributore. **Non verificabile dal server** |
| **Snapshot** | File JSON compatto con gli stati correnti di una provincia, servito da CDN |
| **PoW** | Proof-of-Work: piccolo calcolo crittografico che il browser risolve prima di inviare una segnalazione |

### 1.5 Riferimenti
- MIMIT, *Carburanti – prezzi praticati e anagrafica degli impianti* (IODL 2.0): https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti
- OSMF Tile Usage Policy, Nominatim Usage Policy
- Reg. (UE) 2016/679 (GDPR); D.Lgs. 196/2003 art. 122; Reg. (UE) 2022/2065 (DSA)
- [02-SDD.md](02-SDD.md), [04-threat-model.md](04-threat-model.md), valutazione dei rischi legali (documento riservato del maintainer, non pubblicato)

## 2. Sistema attuale
Oggi non esiste un sistema. Le alternative usate sono:
- **Gruppi WhatsApp e Telegram:** veloci, ma il dato non è strutturato, la privacy è assente e circolano voci non verificate.
- **App prezzi carburante (MIMIT e app private):** mostrano prezzi e non disponibilità. Molte tracciano gli utenti.
- **Giri a vuoto:** consumano proprio il carburante che scarseggia.

## 3. Sistema proposto

### 3.1 Panoramica
Una PWA leggera, servita dall'edge Cloudflare. Mostra una lista di distributori ordinata per stato e distanza, con mappa opzionale. Chiunque può segnalare con un tocco. Il server aggrega le segnalazioni in stati con decadimento temporale.

### 3.2 Requisiti funzionali

| ID | Requisito | Priorità |
|---|---|---|
| **FR-01** | Mostrare la lista dei distributori vicini con stato per carburante, distanza, numero di conferme negli ultimi 45 min ed età dell'ultima conferma | MUST |
| **FR-02** | Ricerca per comune o indirizzo **eseguita localmente** sull'anagrafica scaricata, senza geocoder esterno | MUST |
| **FR-03** | Geolocalizzazione su richiesta esplicita (bottone), usata **solo sul dispositivo** per ordinare per distanza | MUST |
| **FR-04** | Ordinamento: per stato (verde, ambra, grigio, rosso), poi per distanza. Opzione "più confermati" | MUST |
| **FR-05** | Filtro per carburante: Benzina, Gasolio, GPL, Metano, HVO. Si mostrano solo i carburanti venduti dall'impianto | MUST |
| **FR-06** | "Portami qui": apertura del navigatore con destinazione impostata (Google Maps, Apple Maps o `geo:` URI). **Si invia solo la destinazione, mai l'origine** | MUST |
| **FR-07** | Segnalazione con un tocco: "C'è [carburante]" / "Non c'è [carburante]" | MUST |
| **FR-08** | Segnalazione da remoto: cerco il distributore per indirizzo e segnalo. Il flag `vicino=false` vale meno nel calcolo (vedi FR-09) | MUST |
| **FR-09** | Calcolo dello stato a 4 livelli (verde, ambra, rosso, grigio) per (distributore, carburante), con finestre di 45 min e 8 h. Algoritmo nel SDD §8 | MUST |
| **FR-10** | Anti-abuso: PoW invisibile, deduplica silenziosa delle segnalazioni ripetute, timeout progressivo per chiave anonima, limiti per prefisso IP | MUST |
| **FR-11** | Dettaglio distributore: cronologia delle ultime 8 h in fasce di 15 min (conteggi, non timestamp esatti) | SHOULD |
| **FR-12** | Condivisione via Web Share API con link `/d/<idImpianto>` | SHOULD |
| **FR-13** | Modulo "Contesta questa informazione" per gestori e utenti (notice & action, DSA art. 16), senza account; email facoltativa | MUST (legale) |
| **FR-14** | Offline: mostrare l'ultimo snapshot in cache con l'avviso "Dati di X minuti fa" | SHOULD |
| **FR-15** | Controlli di emergenza per i maintainer: sola lettura globale, congelamento di un distributore, aumento della difficoltà PoW | MUST |
| **FR-16** | Aggiornamento automatico giornaliero dell'anagrafica MIMIT (cron) | MUST |
| **FR-17** | Richiesta contestuale "Sei da X? C'è carburante?" quando il dispositivo è vicino a un distributore | SHOULD |
| **FR-18** | Mappa Leaflet caricata su richiesta, con tile self-hosted | COULD (Fase 2) |
| **FR-19** | Pagine: Privacy, Termini, Come funziona, Trasparenza (build hash, link al codice). Disclaimer "Beta, informazioni degli utenti, non è una fonte ufficiale" | MUST |
| **FR-20** | Statistiche aggregate pubbliche (CSV orario per provincia) | COULD |
| **FR-21** | Dopo una segnalazione di presenza, domande facoltative e saltabili: **coda** (nessuna / < 15' / > 15') e **limite di erogazione** (sì/no). Mostrate in lista e nel dettaglio | MUST (v0.3) |
| **FR-22** | Notifiche push "avvisami quando torna disponibile" su una lista di distributori, **senza GPS continuo**, con scadenza a 48 h (ADR-0009) | SHOULD (giorno 4-5) |
| **FR-23** | Indicatore di affidabilità a 3 livelli accanto allo stato (ADR-0006, ibrido) | MUST (MVP) |
| **FR-24** | Avviso informativo una tantum alla prima segnalazione (token anti-spam), nessun banner di consenso (ADR-0005) | MUST |
| **FR-25** | Pagina `/progetto`, linkata nel footer di ogni pagina: scopo del progetto, **solo informativo e senza fini di lucro**, codice open source (link alla repo), come provarlo in locale e come chiedere l'accesso all'ambiente di prova | MUST (MVP) |

### 3.3 Requisiti non funzionali

#### Usabilità e accessibilità
- **NFR-U1** WCAG 2.2 AA. **Il colore non è mai l'unico indicatore**: ogni stato ha forma (● ▲ ✕ ○) e testo. Circa l'8% degli uomini ha una forma di daltonismo rosso-verde.
- **NFR-U2** Bottoni di segnalazione ≥ 48×48 px, utilizzabili con una mano.
- **NFR-U3** Avviso "Non usare il telefono mentre guidi", con suggerimento di far segnalare il passeggero.
- **NFR-U4** Lingua italiana, testi a livello di lettura semplice. Struttura i18n pronta per l'inglese.

#### Prestazioni e banda
- **NFR-P1** App shell (HTML + CSS + JS) ≤ **30 KB** compressa (brotli). Budget verificato in CI.
- **NFR-P2** Anagrafica di provincia ≤ **40 KB** brotli, cache immutabile versionata.
- **NFR-P3** Snapshot stati di provincia ≤ **10 KB**. Aggiornamento con `If-None-Match`: il 304 pesa meno di 300 B.
- **NFR-P4** Polling ogni 90 s solo con la pagina visibile (Page Visibility API).
- **NFR-P5** Nessun font web: si usano i font di sistema. Icone SVG inline.
- **NFR-P6** Mappa e Leaflet caricati solo su richiesta.

#### Compatibilità
- **NFR-C1** iOS Safari ≥ 15, Chrome Android ≥ 90, Firefox Android ≥ 100, Samsung Internet ≥ 15. Codice ES2019, nessun polyfill pesante.
- **NFR-C2** Funziona anche senza installazione PWA. L'installazione è facoltativa.

#### Privacy (requisiti verificabili)
- **NFR-PR1** Il server **non riceve mai** coordinate GPS dell'utente. Test in CI: lo schema della API rifiuta campi `lat`/`lon`.
- **NFR-PR2** Nessun IP in chiaro persistito. Solo `HMAC(K_giorno, prefisso)`, con `K_giorno` casuale, ruotata ogni 24 h e distrutta.
- **NFR-PR3** Segnalazioni grezze cancellate dopo 8 h. Contatori anti-abuso cancellati dopo 24 h.
- **NFR-PR4** Nessun cookie, nessun analytics di terze parti, **nessuna richiesta verso domini terzi** (verificato da CSP `default-src 'self'`).
- **NFR-PR5** Nessun fingerprinting del browser.
- **NFR-PR6** Log applicativi senza IP né header identificativi. Logpush disattivato.

#### Affidabilità
- **NFR-R1** Disponibilità in lettura ≥ 99,5%. Con il backend in errore, il client mostra l'ultimo snapshot.
- **NFR-R2** Degrado controllato: in caso di attacco si passa alla modalità "sola lettura" senza redeploy (flag nel Durable Object).

#### Sicurezza
- **NFR-S1** CSP rigorosa, Trusted Types, SRI, HSTS e `Permissions-Policy` minima: `geolocation=(self)`, tutto il resto disabilitato.
- **NFR-S2** Nessun input a testo libero memorizzato o mostrato ad altri utenti.
- **NFR-S3** Supply chain: zero dipendenze runtime lato client oltre a Leaflet (lazy), action GitHub pinnate per SHA, deploy di produzione con approvazione manuale.

#### Legali
- **NFR-L1** Attribuzione MIMIT (IODL 2.0) e OpenStreetMap (ODbL) visibile.
- **NFR-L2** Informativa privacy (GDPR art. 13), termini d'uso, punto di contatto DSA (artt. 11-12) e procedura di notice & action (art. 16).
- **NFR-L3** Formulazioni prudenti: "*Segnalato* esaurito dagli utenti", mai "Esaurito" come fatto.

#### Supportabilità
- **NFR-M1** TypeScript ovunque, test unitari sull'algoritmo di stato con copertura ≥ 90%, ADR per ogni scelta.
- **NFR-M2** Ambiente locale con `wrangler dev`, senza account Cloudflare.

### 3.4 Modelli del sistema

#### 3.4.1 Scenari
**S1 — Marta cerca benzina (lettura).** Marta apre QUI su un Android con poco campo. In 3 s vede la lista: tocca "Usa la mia posizione" e la lista si riordina. Il primo risultato è "● IP Via Garibaldi – Benzina: 4 conferme, ultima 6 min fa – 1,2 km". Tocca "Portami qui" e si apre Google Maps con la destinazione.

**S2 — Paolo conferma (segnalazione vicino).** Paolo è al distributore e apre QUI. L'app (posizione calcolata sul telefono) chiede: "Sei da IP Via Garibaldi? C'è benzina?". Paolo tocca "Sì". In background il browser risolve il PoW (circa 1 s) e invia `{id, fuel:"B", has:true, near:true}`. L'app risponde: "Grazie! Hai confermato insieme ad altre 4 persone."

**S3 — Anna segnala da casa (segnalazione remota).** Anna ha visto un cartello "Gasolio esaurito". Cerca "Via Roma, Lecco", seleziona il distributore e segnala "Non c'è gasolio" con `near:false`.

**S4 — Spammer (abuso).** Un utente invia 10 segnalazioni "Non c'è" sullo stesso distributore. La prima conta, le altre ricevono comunque "Grazie" ma vengono scartate senza effetto. Dalla quarta richiesta parte il timeout progressivo per la sua `reporterKey`.

**S5 — Gestore contesta (notice & action).** Il gestore vede il suo impianto "Segnalato esaurito" ma ha appena ricevuto la cisterna. Usa "Contesta". I maintainer ricevono la notifica e possono congelare l'impianto con un messaggio ("Rifornimento confermato dal gestore alle 14:20").

#### 3.4.2 Casi d'uso
```
           ┌────────────────────── QUI ──────────────────────┐
 Utente ───┤ Cerca distributori ─── «include» ── Ordina      │
           │ Visualizza dettaglio                            │
           │ Naviga verso distributore ───► [App navigatore] │
           │ Segnala presenza/assenza ── «include» ── PoW    │
           │ Condividi                                       │
           │ Contesta informazione                           │
 Gestore ──┤ Contesta informazione                           │
 Maintainer┤ Attiva sola lettura / Congela / Regola PoW      │
 Cron ─────┤ Aggiorna anagrafica MIMIT                       │
           └─────────────────────────────────────────────────┘
```

#### 3.4.3 Modello a oggetti (dominio)
```
Distributore (idImpianto, gestore, bandiera, nome, indirizzo, comune, provincia, lat, lon)
   1 ──── * StatoCarburante (carburante, stato, conferme45, ultimaConferma, ultimaAssenza)
   1 ──── * Segnalazione (carburante, presente, vicino, ts, reporterKey)   [TTL 8 h]
ChiaveGiornaliera (giorno, segreto)                                        [TTL 48 h]
ContatoreAbuso (reporterKey | prefissoIP, conteggio, livelloTimeout, scadenza) [TTL 24 h]
```

#### 3.4.4 Modello dinamico: stato di (distributore, carburante)
```
          ┌────────── nessuna segnalazione 8h ──────────┐
          ▼                                              │
     [GRIGIO] ──1 conferma──► [AMBRA] ──≥2 conferme/45'──► [VERDE]
          │                      ▲  │                      │  │
          │                      │  └── assenze ≥2 ──┐    │  │
          └─assenza─► [ROSSO] ◄──┼───────────────────┘    │  │
                         ▲       └── nessuna conferma 45' ─┘  │
                         └──── assenza dopo le conferme ──────┘
     VERDE + assenza isolata recente ──► AMBRA "contrastante"
```

#### 3.4.5 Navigazione UI
```
[Home: barra ricerca + "Usa posizione" + filtro carburante + Lista]
   ├─► [Dettaglio distributore] ─► [Segnala] ─► [Grazie]
   │                             ├─► [Portami qui] → app esterna
   │                             └─► [Contesta]
   ├─► [Mappa] (lazy)
   └─► [Menu: Come funziona · Privacy · Termini · Trasparenza]
```

## 4. Glossario dei vincoli presi dalla specifica originale e modificati
Vedi [03-iterazione-1.md](03-iterazione-1.md) per la tracciabilità completa (originale → criticità → nuovo requisito).
