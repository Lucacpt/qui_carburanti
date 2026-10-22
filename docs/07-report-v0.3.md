# QUI — Report v0.3: decisioni, piano aggiornato e prossimi passi

> 2026-10-22 · Integra le risposte in [06-domande.md](06-domande.md), i tuoi commenti negli ADR 0005, 0006 e 0008, e i dati MIMIT reali (estrazione del 2026-10-21).
> Sostituisce, dove in conflitto, i documenti v0.2. Le modifiche sono già riportate in RAD, SDD e ADR.

## 1. Sintesi

1. **La risposta che cambia tutto è la n. 4: la carenza dovrebbe durare ancora circa una settimana.** Il piano "MVP in 2 settimane" arriverebbe a crisi finita. Nuovo piano: **MVP in 72 ore, solo provincia di Avellino**, poi incrementi giornalieri. Dopo la crisi QUI diventa un *kit pronto per la prossima*, da estendere a tutta la Campania.
2. **I dati reali sono dalla nostra parte.** In provincia di Avellino ci sono 230 distributori in 92 comuni (in media 2,5 per comune) e nessuno ha coordinate mancanti. L'anagrafica compatta pesa **7,6 KB brotli**, contro un budget previsto di 40 KB. L'intera Campania (2.115 impianti) peserebbe circa 70 KB.
3. **Rosso più prudente**, come hai chiesto: per lo stato "Segnalato esaurito" servono **sempre almeno 2 persone da reti diverse, di cui almeno una sul posto**.
4. **Coda e limite di erogazione** entrano nell'MVP come domande facoltative dopo la segnalazione. Sono la risposta all'effetto stampede, che hai deciso di accettare.
5. **Notifiche push: sì, e il GPS non deve restare acceso.** Ti propongo però di rilasciarle al **giorno 4-5**, non nelle prime 72 ore (vedi §3, T1).
6. **Infrastruttura e organizzazione:** Workers + piano Paid. Per il dominio ti consiglio di comprare `qui-carburanti.it` invece del sottodominio Cloudflare (§3, T2). Lavori come privato e unico maintainer: serve qualche protezione compensativa (§3, T4).
7. **I tuoi commenti negli ADR:** licenza **EUPL-1.2** adottata. Banner cookie: **no al consenso, sì a un avviso just-in-time** (§4.3). Percentuale di presenza: **sì al punteggio continuo, ma mostrato come affidabilità a 3 livelli** (§4.4).

## 2. Registro delle decisioni

| # | Tema | Tua risposta | Conseguenza | Dove |
|---|---|---|---|---|
| 1 | Coda / razionamento | Sì | Due campi facoltativi: coda (nessuna, < 15', > 15') e limite di erogazione (sì/no) | RAD FR-21, SDD §5.2, §9 |
| 2 | Web app o Telegram | Web: anche chi non ha Telegram | Confermato | — |
| 3 | Lancio | Gruppi e canali social | Kit di lancio social (§6) + richiamo a T3 | Strategia §6 |
| 4 | Durata della crisi | Circa 1 settimana | **MVP in 72 h**, taglio drastico del perimetro | Strategia §6, questo report §6 |
| 5 | Fonti ufficiali | Nessuna | QUI è l'unica fonte: più responsabilità (L4) | Rischi L4 |
| 6 | Stampede | Accettato, con indicazione della coda | Coda mostrata in lista e nel dettaglio | FR-21 |
| 7 | Anti-abuso v2 | Confermato | ADR-0005 → Accepted | ADR-0005 |
| 8 | Regione | Campania, si parte da Avellino | Una sola ProvinceDO (`AV`) nell'MVP, estensione a BN, CE, NA, SA dopo | SDD §4 |
| 9 | Carburanti | Benzina, Gasolio, GPL, Metano, HVO | 5 categorie, mappatura dalle descrizioni MIMIT (§5.1) | RAD FR-05, SDD §5.1 |
| 10 | Ordinamento | Verdi più vicini | Default confermato | RAD FR-04 |
| 11 | Etichette | Confermate | "Da verificare", "Segnalato esaurito" | ADR-0006 |
| 12 | Colore ambra | Sì | Ambra per lo stato, arancione riservato al marchio | Strategia §4.4 |
| 13 | Peso remoto 0,5 | Sì | Confermato | SDD §8 |
| 14 | Notifiche | Sì | ADR-0009 (push senza GPS continuo), rilascio al giorno 4-5 | ADR-0009 |
| 15 | Lingue | Solo IT | Stringhe comunque centralizzate per l'espansione | — |
| 16 | Gestori | Niente canale verificato, sì a contatto e contestazione | FR-13 confermato | RAD FR-13 |
| 17 | Soglia rosso | "Alzarla ancora di più" | `RED_MIN_UNOPPOSED` 1,0 → **2,0** + almeno 1 segnalazione sul posto | ADR-0006, SDD §8 |
| 18 | 45' / 8 h | Stima personale (coda di 30' + margine) | Parametri configurabili *senza redeploy* + metrica di calibrazione (§5.3) | SDD §8 |
| 19 | Raggio 150 m | OK + "come scelgo il distributore senza GPS?" | Risposta nel §4.2 | — |
| 20 | Pages o Workers | Workers | ADR-0001 → Accepted | ADR-0001 |
| 21 | Budget | Paid sì, dominio: sottodominio Cloudflare | **Da riconsiderare** (T2) | ADR-0010 |
| 22 | Nome | qui-carburanti.it | Il DNS non mostra record NS: probabilmente libero, da verificare con un registrar | ADR-0010 |
| 23 | Account Cloudflare | Solo quello privato | Accettabile con 2FA + token con scope minimo (§3, T4) | ADR-0001 |
| 24 | Mappa nella v1 | No | ADR-0004: mappa in Fase 2 | ADR-0004 |
| 25 | Esperienza | JS/TS sì, Workers no | Spiego i concetti Workers e DO man mano; scrivi tu la logica di dominio | §6 |
| 26 | Soggetto | Privato | L10 resta YELLOW: mitigazioni minime obbligatorie | Rischi L10 |
| 27 | Secondo maintainer | No, per ora | Protezioni "solo-dev" (§9) | Threat model P10 |
| 28 | Licenza | **EUPL-1.2** (commento nell'ADR) | ADR-0008 → Accepted, file rinominato `ADR-0008-licenza-eupl.md` | ADR-0008 |
| — | Banner cookie tecnici (commento nell'ADR-0005) | "Aggiungiamolo comunque?" | Nessun banner di consenso; token creato solo alla prima segnalazione + avviso una tantum | ADR-0005, §4.3 |
| — | Ibrido stati + percentuale (commento nell'ADR-0006) | "Uniamo A e C?" | Sì all'ibrido: score interno → ordinamento + affidabilità a 3 livelli, non percentuale | ADR-0006, §4.4 |
| 29 | Donazioni | Escluse | Scritto anche in pagina: "QUI non chiede mai soldi" (anti-truffa) | Threat P8 |
| 30 | Contatto istituzionale | Sì, ma chi? | Riferimenti nel §7.2 | — |
| 31 | GitHub | Account personale | OK. Repo pubblica sul tuo profilo | §9 |
| 32 | Creazione repo | La crei tu dal web | Istruzioni nel §9 | §9 |
| 33 | Protezioni | Sì | Ruleset pronti in `.github/rulesets/` | §9 |

## 3. Dove ti chiedo di riconsiderare

### T1 — Notifiche nella v1 con una crisi di una settimana
Le notifiche richiedono: service worker, manifest PWA, chiavi VAPID, cifratura del payload (RFC 8291) nel Worker, una tabella delle sottoscrizioni, l'invio sulle transizioni a verde, informativa aggiornata e test su iOS. Su iPhone funzionano **solo se l'utente aggiunge QUI alla schermata Home** (iOS ≥ 16.4), quindi raggiungono una minoranza degli utenti.
Sono 1-2 giorni di lavoro. Se entrano nelle prime 72 ore, rischiamo di andare online quando la crisi è quasi finita.
**Proposta:** MVP (giorno 3) senza push → **push al giorno 4-5**, se la crisi è ancora in corso. Il design è già pronto (ADR-0009), quindi non si perde nulla.

### T2 — Sottodominio `workers.dev` o dominio proprio
| | `qui-carburanti.<tuoaccount>.workers.dev` | `qui-carburanti.it` (~10 €/anno) |
|---|---|---|
| **Cache API** (lettura da CDN) | Probabilmente **non funziona** su workers.dev: la cache è a livello di zona. Ogni lettura arriverebbe al Durable Object | ✅ |
| **Regole WAF / rate limiting / "Under Attack"** | ❌ Richiedono una zona | ✅ |
| **Email `contatti@` / `privacy@`** (Email Routing, obbligatoria per DSA e GDPR) | ❌ Dovresti usare una tua email personale | ✅ Gratuito |
| **Anti-cloni** (threat model P8) | Chiunque può creare `qui-carburanti-xyz.workers.dev`: il link ufficiale non si distingue | ✅ Un solo nome da comunicare |
| **Privacy dello sviluppatore** | L'URL contiene il nome del tuo account Cloudflare | ✅ Per le persone fisiche il WHOIS .it è riservato di default |

Per una sola provincia, un DO regge tranquillamente tutte le letture, quindi **workers.dev funziona tecnicamente** per l'MVP. I motivi forti per il dominio sono **email, WAF e anti-cloni**. Raccomandazione: **compra il dominio oggi**. Registralo presso un registrar che supporta `.it` e punta i nameserver su Cloudflare (piano Free della zona). Se Cloudflare Registrar supporta `.it` nel tuo account, ancora meglio.

### T3 — Lancio solo tramite gruppi social
Nei gruppi social l'informazione corre veloce, e così i cloni e le smentite. Senza un link "certificato" da qualcuno di credibile, QUI è un link come tanti. **Proposta:** social **+ almeno 1 testata online locale + 1 Comune** (anche solo un post sulla pagina del Comune di Avellino). Preparo io il kit: messaggio breve, immagine di anteprima, locandina con QR e un testo per le testate.

### T4 — Privato, unico maintainer, nessun legale prima del lancio
È una configurazione accettabile **per una settimana di crisi**, a queste condizioni minime (non negoziabili, secondo me):
1. **2FA** su GitHub e Cloudflare (meglio una chiave hardware o una passkey) e token Cloudflare per la CI con scope *solo Workers* sul tuo account.
2. **Email dedicata** al progetto (`contatti@qui-carburanti.it`). **Non usare l'email aziendale**: collegherebbe la tua azienda al progetto (rischio L10).
3. Informativa, termini e pagina contatti online **dal giorno 1** (te le preparo io come bozza).
4. **Kill switch** (sola lettura) pronto e testato prima del lancio.
5. Etichetta **"Beta"** visibile + disclaimer "Informazioni degli utenti, non verificate. Non è una fonte ufficiale".
6. Consulto legale **entro la prima settimana di esercizio**, non necessariamente prima.

## 4. Risposte alle tue domande

### 4.1 "Con le notifiche serve il GPS sempre acceso?" — **No.**
- Il GPS si usa **una volta sola**, nel momento in cui attivi l'avviso: il telefono calcola *localmente* i distributori entro X km, oppure tu li scegli dalla lista o per comune.
- Al server arrivano solo: la **sottoscrizione push** (un URL opaco del servizio push di Google, Apple o Mozilla, più le chiavi), la **lista degli ID distributore** (massimo 20) e il **carburante**. **Nessuna coordinata.**
- Quando uno di quei distributori diventa verde, il server invia una notifica **cifrata end-to-end**: Google e Apple vedono che arriva una notifica, non il contenuto.
- La sottoscrizione **scade dopo 48 ore** e si rinnova con un tocco: in una crisi breve non accumuliamo dati.
- Dettagli in [ADR-0009](adr/ADR-0009-notifiche-push.md).

### 4.2 "Come segnala l'utente quel preciso distributore senza GPS?"
1. **Per comune.** Scrive "Ariano" o "Montoro" e vede i distributori di quel comune: in Irpinia sono in media 2-3 per comune. Ognuno mostra **bandiera, indirizzo e nome dell'impianto**, quindi si riconosce subito.
2. **Per indirizzo o bandiera:** "Eni via Roma", "Q8 Atripalda".
3. **Tramite QR code:** la locandina "Segnala QUI" per un distributore specifico porta a `/d/<id>`, la pagina di quel distributore, pronta per segnalare. È un ottimo strumento per bar e distributori stessi.
4. **"Recenti":** i distributori visti di recente, salvati solo sul telefono.
5. **"Sono qui" (facoltativo):** una sola lettura GPS al momento della segnalazione. Se il telefono risulta entro 150 m, la segnalazione vale 1,0 invece di 0,5. Il GPS non resta acceso.

Senza GPS la segnalazione vale **0,5** (regola della domanda 13): due persone senza GPS da reti diverse equivalgono a una persona sul posto.

### 4.3 "Aggiungiamo comunque un banner per i cookie, anche se tecnici?" — **Meglio di no, ma con trasparenza.**
- Per gli strumenti tecnici la legge chiede **solo l'informativa**, non il consenso (Linee guida cookie del Garante, giugno 2021). Un banner che *chiede il consenso* senza che serva è fuorviante: se l'utente rifiuta, o il rifiuto è finto, o l'anti-abuso si indebolisce.
- Abituare le persone a cliccare banner va contro lo spirito di QUI, e costa banda e attrito.
- **Soluzione migliore:**
  1. il token anti-spam **viene creato solo alla prima segnalazione**: chi consulta e basta non riceve **nulla** sul telefono;
  2. in quel momento compare un **avviso** mostrato una sola volta: *"Per evitare lo spam, QUI salva sul tuo telefono un codice casuale che cambia ogni giorno. Nessun cookie, nessun tracciamento. [Ho capito] · [Dettagli]"*;
  3. footer fisso: "QUI non usa cookie · Privacy".
- Se il legale preferisse comunque una scelta esplicita, l'opzione di riserva è il pulsante "Segnala senza codice" (solo IP + PoW, peso ridotto), così il rifiuto resta reale. Dettagli in ADR-0005.

### 4.4 "Uniamo stati e percentuale come probabilità di presenza?" — **Sì all'ibrido, no alla percentuale (per ora).**
- **Sì:** un punteggio continuo (somma pesata con decadimento esponenziale, poi funzione logistica) è utile, e lo usiamo per l'**ordinamento secondario** dei verdi e per un **indicatore di affidabilità a 3 livelli** (▮▮▮ / ▮▮▯ / ▮▯▯).
- **No alla percentuale:** sarebbe una probabilità solo se *calibrata* contro la realtà, che non conosciamo. Un "82%" promette una precisione che non abbiamo. Un numero sembra una misura, quindi aumenta il rischio L1 ("Presenza: 12%" su un distributore pieno). Alla guida, colore e forma si leggono in un secondo, una percentuale no.
- **In Fase 2** possiamo misurare la calibrazione empirica sui dati reali ("un verde con score 0,8 viene confermato 8 volte su 10?"). Se i numeri tengono, la percentuale diventa onesta e possiamo mostrarla. Dettagli in ADR-0006.

## 5. Modifiche al design (v0.2 → v0.3)

### 5.1 Carburanti: mappatura dalle descrizioni MIMIT
Il file prezzi contiene decine di descrizioni commerciali. In provincia di Avellino: Benzina, Gasolio, GPL, Metano, Hi-Q Diesel, Supreme Diesel, Blue Diesel, HVOlution, HiQ Perform+, Gasolio Premium, HVO, Gasolio speciale, Blue Super.

| Codice | Categoria | Regola (in ordine, la prima che corrisponde vince) | Impianti AV |
|---|---|---|---|
| `H` | HVO | `/hvo/i` (HVO, HVOlution, HVO100, Gasolio HVO, REHVO...) | 9 |
| `L` | GPL | `/gpl/i` | 39 |
| `M` | Metano | `/metano\|l-gnc\|gnc/i` (escluso GNL, per camion) | 8 |
| `G` | Gasolio | `/gasolio\|diesel/i` (incluse le versioni premium) | 193 |
| `B` | Benzina | `/benzina\|super\|perform/i` (incluse le versioni premium) | 191 |

*Conteggi verificati sul file prezzi del 2026-10-21. Tutte le descrizioni presenti in AV sono classificate.*

- Il dettaglio di un distributore mostra **solo i carburanti che vende** (`fuelsBitmask`). Per i ~30 impianti AV senza prezzi comunicati mostriamo Benzina e Gasolio di default.
- **Gasolio premium = gasolio:** in una carenza conta "posso fare gasolio", non la marca commerciale.

### 5.2 Coda e limite di erogazione
- Dopo "C'è benzina ✓" compaiono due domande **facoltative**, saltabili con un tocco: *Coda?* (Nessuna / Breve < 15' / Lunga > 15') e *Limite di erogazione?* (No / Sì).
- Aggregazione: valore più recente segnalato da almeno 2 `pkey` diverse negli ultimi 30', altrimenti l'ultimo con l'etichetta "1 segnalazione".
- Nella lista: "● Benzina · 4 conferme · ⏱ coda lunga · ⚠ limite". Costo in banda: 2 interi per voce dello snapshot.

### 5.3 Soglie (ADR-0006 rivisto)
```
FRESH = 45 min (configurabile a runtime)   WINDOW = 8 h
W_NEAR = 1.0   W_REMOTE = 0.5   CAP_PREFIX = 1.0
GREEN_MIN = 2.0
RED_MIN = 2.0  e  almeno 1 assenza con near = true        ← NUOVO (prima: 1,0 senza opposizione)
```
- Effetto: **una persona da sola non può mai rendere rosso un distributore**. Una singola assenza lo porta ad ambra con la scritta "Segnalata assenza, da verificare".
- Il prezzo: un distributore davvero vuoto resta ambra un po' più a lungo. Accettabile, perché l'ambra non promette carburante.
- **Calibrazione:** il DO registra in forma aggregata la "durata del verde", cioè i minuti tra il passaggio a verde e la prima assenza. Dopo 48 h di dati confrontiamo la mediana con i 45': se il verde dura in media 20', abbassiamo FRESH **senza redeploy** (tabella `config`).

### 5.4 Parser MIMIT: dettagli verificati sui file reali
- **La prima riga è `Estrazione del AAAA-MM-GG`**, l'intestazione è la seconda: va saltata e la data usata per controllare la freschezza del file.
- Separatore `|` confermato. Coordinate con il punto decimale.
- Nell'anagrafica nazionale ci sono 116 impianti senza coordinate valide (0 in AV): vanno scartati con un log.

### 5.5 Budget di banda aggiornato (AV)
| Risorsa | Prima | Ora |
|---|---|---|
| Anagrafica provincia | ≤ 40 KB | **7,6 KB** (misurato) |
| Prima vista completa (shell + anagrafica + snapshot) | ≤ 100 KB | **~35 KB** stimati |

### 5.6 Licenza: EUPL-1.2 (scelta)
Hai scelto la EUPL-1.2, che è anche la mia raccomandazione. Perché è adatta a un privato in Italia che vuole presentare QUI a Prefettura e Protezione Civile:
- testo **ufficiale in italiano**, con lo stesso valore legale delle altre lingue UE;
- **legge applicabile:** quella dello Stato UE del licenziante, cioè l'Italia, e foro italiano;
- copre anche l'uso **via rete** (SaaS), come l'AGPL, ed è compatibile con l'AGPL;
- è la licenza raccomandata per il riuso nella PA (CAD art. 69, linee guida AgID).

[ADR-0008](adr/ADR-0008-licenza-eupl.md) è ora Accepted. Il file `LICENSE` (testo italiano + inglese) arriverà con il primo commit.

## 6. Piano operativo

### MVP in 72 ore (provincia di Avellino)
| Giorno | Tu | Io |
|---|---|---|
| **0 (oggi)** | Crei la repo vuota (§9). Compri il dominio. Attivi Workers Paid e la 2FA | Scaffold del monorepo, CI minima (lint, typecheck, test, budget), script che genera `AV.json` da MIMIT (statico nell'MVP: il cron arriva dopo) |
| **1** | **Scrivi `computeState()`** in `domain/` (Learn by Doing, con i test già pronti) | Worker API, ProvinceDO, PoW, snapshot, spiegazione dei concetti DO |
| **2** | Revisione delle PR, prova su telefono reale | Client: lista, ricerca per comune, "Usa posizione", segnalazione, coda/limite, "Portami qui", pagina distributore `/d/<id>` |
| **3** | Lettura e approvazione dei testi legali, test del kill switch, **deploy di produzione** | Pagine Privacy, Termini, Contatti, Come funziona; kit di lancio (messaggio, QR, locandina) |
| **4-5** | Lancio sui social + testata locale + Comune | Notifiche push (ADR-0009), cron anagrafica, monitoraggio |
| **6-7** | Contatto con la Prefettura | Taratura delle soglie con i dati reali, eventuale estensione ad altre province |

**Fuori dall'MVP:** mappa, offline avanzato, statistiche pubbliche, staging separato (nell'MVP si usa `wrangler dev` in locale; lo staging arriva al giorno 4-5).

### Dopo la crisi
Modalità "archivio" con banner, pubblicazione del dataset aggregato, poi **"QUI Campania"**: tutte le province, mappa, staging, red team. Così la prossima carenza ci trova pronti.

## 7. Aggiornamenti legali e istituzionali

### 7.1 Delta del registro rischi
| ID | Cambiamento |
|---|---|
| L1 | ↓ Probabilità grazie alla nuova soglia del rosso (2 persone, 1 sul posto). Resta YELLOW (3×2=6) |
| L4 | Nessuna fonte ufficiale esiste, quindi QUI ha più visibilità e più responsabilità. Resta YELLOW (8). Kill switch e disclaimer **obbligatori dal giorno 1** |
| L10 | Privato confermato. Resta YELLOW (8). Mitigazioni del §3, T4. Rivalutare l'associazione dopo la crisi |
| **L14 (nuovo)** | Notifiche push: endpoint pseudonimo + lista di distributori (≈ zona di interesse). Base giuridica: servizio richiesto dall'utente (art. 6.1.b). Conservazione 48 h. Va citato nell'informativa (servizi push di Google, Apple, Mozilla). **2×2 = 4 GREEN** |
| **L15 (nuovo)** | Lancio rapido con meno test, quindi più probabilità di bug che producono stati errati. Mitigazioni: etichetta Beta, test sull'algoritmo obbligatori in CI, kill switch. **3×2 = 6 YELLOW** |

### 7.2 Contatto istituzionale: a chi scrivere
| Ente | Ufficio | Canale |
|---|---|---|
| **Prefettura di Avellino** (UTG) | **Ufficio di Gabinetto**: segue l'ordine pubblico e i rapporti con il territorio | PEC generale `protocollo.prefav@pec.interno.it`, oggetto "Alla c.a. Ufficio di Gabinetto". Indirizzo: Corso Vittorio Emanuele 4, Avellino, tel. 0825 7981. *Dati da un documento del 2024: verificali sul sito ufficiale della Prefettura prima dell'invio. Le PEC della PA spesso accettano solo messaggi da un'altra PEC* |
| Comune di Avellino | Protezione Civile comunale / Ufficio stampa | Sito istituzionale del Comune |
| Regione Campania | Protezione Civile regionale | Sito della Regione |

Posso prepararti la **lettera di presentazione** (1 pagina: cos'è QUI, cosa *non* è, come tutela la privacy, come gestiamo le contestazioni, come contattarti).

## 8. Threat model: delta
- **P8 (cloni):** con workers.dev il rischio sale a ALTO, con il dominio resta MEDIO. È un'altra ragione per T2.
- **P10 (account takeover):** con un solo maintainer resta MEDIO. Mitigazioni: 2FA forte, ruleset, environment `production` con approvazione manuale (che ti obbliga a un passaggio deliberato), token Cloudflare con scope minimo.
- **P12 (nuovo) — push come amplificatore:** un attaccante che riesce a creare un verde falso fa partire notifiche verso molte persone. Mitigazioni: push solo su verde con ≥ 2 prefissi (già richiesto), al massimo 1 notifica ogni 30' per sottoscrizione, nessuna notifica se lo stato è "contrastante".

## 9. GitHub: cosa fare adesso

**Tu, dal web (5 minuti):**
1. https://github.com/new → *Owner*: il tuo account · *Repository name*: `qui` · **Public** · **non** aggiungere README, .gitignore o licenza: la repo deve essere vuota.
2. Mandami l'URL. Io faccio `git init`, il primo commit (documentazione + scaffold) e il push. Git Credential Manager ti chiederà il login una volta.
3. Dopo il primo push, in *Settings*:
   - **Rules → Rulesets → New ruleset → Import a ruleset**: importa `.github/rulesets/main.json` e poi `.github/rulesets/tags.json` (già pronti nella cartella del progetto).
   - **Code security:** attiva *Dependabot alerts*, *Secret scanning* + *Push protection*, *Private vulnerability reporting*.
   - **Environments:** crea `production` con *Required reviewers* = tu e *Deployment branches and tags* = solo i tag `v*`.
   - **Secrets** (solo nell'environment `production`): `CLOUDFLARE_API_TOKEN` (template *Edit Cloudflare Workers*) e `CLOUDFLARE_ACCOUNT_ID`.

**Cosa fanno i ruleset (versione "solo-dev"):**
- Su `main` niente push diretti, niente force push, nessuna cancellazione e storia lineare. Ogni modifica passa da una PR con **CI verde obbligatoria** e merge in squash.
- **0 approvazioni richieste:** GitHub non permette di approvare le proprie PR. Lo porteremo a 1 quando arriverà un secondo maintainer.
- **Commit firmati:** non attivati subito per non bloccarti. Te li configuro (firma SSH, 2 minuti) e poi li rendiamo obbligatori.
- **Tag `v*`** protetti da cancellazione e riscrittura.
- **Attenzione:** il check obbligatorio si chiama `ci`. Esisterà dalla prima PR, che aggiunge il workflow.

## 10. Domande residue (solo 4)
1. **Compri `qui-carburanti.it`?** (Sì / No: si parte con workers.dev e si migra dopo.) si lo compro
2. **Notifiche al giorno 4-5 invece che nell'MVP:** Si va bene 
3. **Avviso just-in-time al posto del banner** (§4.3): ti convince? si va bene 
4. **Indicatore di affidabilità a 3 livelli al posto della percentuale** (§4.4): d'accordo? L'indicatore entra nell'MVP o al giorno 4-5? si va bene entra nell mvp
Aggiungiamo però una pagina in cui spieghiamo il progetto e il suo scopo che è a solo scopo informativo e non di lucro, che il codice è open source e che con una richiesta tutti possono provarlo e testarlo. Inseriamo il link alla pagina informativa nel footer del sito. 

> ✅ **Risolte (2026-10-22).** Conseguenze: ADR-0010 → Accepted; FR-23 (affidabilità) → MUST nell'MVP; FR-22 (push) → giorno 4-5; FR-24 (avviso just-in-time) confermato; **nuovo FR-25**: pagina `/progetto` linkata nel footer (scopo informativo, senza fini di lucro, codice aperto, come provarlo e testarlo).
