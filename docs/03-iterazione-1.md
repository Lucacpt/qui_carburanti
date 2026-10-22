# QUI — Iterazione 1: critica della v1 e revisione

> 2026-10-22 · La **v1** è la specifica originale applicata alla lettera. La **v2** è ciò che è finito in RAD e SDD.
> Questo documento serve a capire *perché* il progetto è diverso da come era stato descritto all'inizio.

## Metodo
Per ogni scelta della v1 ci siamo chiesti:
1. Funziona nel caso reale (coda al distributore, 3G, CGNAT, utente non tecnico)?
2. Rispetta la privacy *per architettura*?
3. Resiste a un attaccante con 1 ora e 0 €?
4. Espone lo sviluppatore a rischi legali?

---

## Decisione 1 — Identificazione del distributore
| | |
|---|---|
| **v1** | Un distributore "entra nella lista" quando almeno 2 segnalazioni GPS cadono entro 30 m l'una dall'altra |
| **Problemi** | (a) In città il GPS ha errori di 5-50 m e un piazzale è largo 40-80 m: due persone allo stesso distributore possono stare a più di 30 m. (b) Due distributori vicini, per esempio sui due lati di una statale, si fondono in uno. (c) La segnalazione "via indirizzo" non ha coordinate GPS, quindi la regola non si può applicare. (d) Bisogna mandare le coordinate dell'utente al server, il che contraddice la privacy-first. (e) Il primo giorno la lista è vuota |
| **v2** | **Anagrafica MIMIT** come registro: ogni segnalazione punta a un `idImpianto`. La prossimità è un flag calcolato *sul telefono* (`near: true` se entro circa 150 m). Il server non vede coordinate |
| **Costo** | Dipendiamo da un file "sperimentale" MIMIT: serve un parser robusto e una cache dell'ultima versione valida. Il flag `near` è falsificabile, ma lo era anche il GPS grezzo |

## Decisione 2 — Modello degli stati
| | |
|---|---|
| **v1** | Verde = più segnalazioni (45'); arancione "probabilmente esaurito" = meno segnalazioni o 45'-8 h; rosso "Esaurito" = nessuna segnalazione in 8 h **oppure** una segnalazione di assenza |
| **Problemi** | (a) **"Nessuna informazione" diventa "Esaurito".** All'avvio il 100% dei distributori sarebbe rosso: falso, allarmante e potenzialmente lesivo per i gestori (vedi rischi legali L1, L3). (b) Una conferma di 5 minuti fa finisce sotto "probabilmente esaurito": l'etichetta dice il contrario del dato. (c) "Meno segnalazioni" non ha una soglia assoluta. (d) **Una sola segnalazione negativa porta a rosso**: con un tocco chiunque può "spegnere" un distributore concorrente. (e) Lo stato è unico per distributore, mentre spesso manca solo un carburante. (f) L'arancione dello stato si confonde con l'arancione del marchio QUI |
| **v2** | 4 stati per (distributore, carburante): **● Disponibile**, **▲ Da verificare** (ambra, non arancione), **✕ Segnalato esaurito**, **○ Nessuna informazione**. Per il rosso servono ≥ 2 assenze distinte, oppure 1 assenza senza conferme nei 45' precedenti. Con conferme recenti, un'assenza isolata dà "▲ Contrastante" |
| **Costo** | Più logica da testare. Va spiegato all'utente: pagina "Come funziona" |

## Decisione 3 — Anti-spam: IP e fingerprint
| | |
|---|---|
| **v1** | Più di 3 segnalazioni dallo stesso IP **o fingerprint** sullo stesso distributore → timeout progressivo |
| **Problemi** | (a) **Fingerprinting = accesso a informazioni sul terminale** (art. 5(3) ePrivacy, art. 122 Codice Privacy, Linee guida EDPB 2/2023). Servirebbe il consenso, cioè un cookie banner, cioè l'opposto della privacy-first. (b) **CGNAT:** gli operatori mobili italiani fanno condividere lo stesso IPv4 a centinaia di utenti. In coda allo stesso distributore, con lo stesso operatore, *gli utenti legittimi* hanno lo stesso IP: la regola punirebbe proprio il caso d'uso principale. (c) Un fingerprint si resetta con la modalità incognito, quindi blocca gli onesti e non gli attaccanti. (d) Rispondere "sei in timeout" insegna all'attaccante dove sta la soglia |
| **v2** | (1) **PoW invisibile** (stile ALTCHA, self-hosted) per ogni segnalazione: costa circa 1 s a un utente e molto a chi ne invia 10.000. (2) `reporterKey = HMAC(K_giorno, prefisso IP ‖ token effimero)`: il token è casuale, generato dal client e ruotato ogni giorno (è un "cookie di sicurezza" esente da consenso secondo il WP29 Op. 04/2012; da validare con un legale). (3) **Deduplica silenziosa:** dalla stessa chiave conta 1 segnalazione per distributore e carburante ogni 45', le altre ricevono "Grazie" ma non hanno effetto. (4) **Timeout progressivo** per chiave (2^n minuti) e **tetto per prefisso IP** (/24 IPv4, /56 IPv6) alto, tarato sul CGNAT, per limitare il contributo di un singolo prefisso allo stato di un distributore. (5) Modalità d'emergenza: PoW più difficile per un singolo distributore o globalmente |
| **Costo** | Il PoW consuma un po' di batteria sui telefoni vecchi (difficoltà adattiva). Il token effimero è falsificabile: è un limitatore di velocità, non un'identità |

## Decisione 4 — Mappe e tile
| | |
|---|---|
| **v1** | Mappa Leaflet come interfaccia principale, presumibilmente con tile OpenStreetMap |
| **Problemi** | (a) **Banda:** una vista con 12-20 tile raster pesa 300-600 KB, 10-50 volte la lista. (b) **La OSMF Tile Usage Policy vieta l'uso dei tile di openstreetmap.org a un'app con picchi di traffico**: il servizio verrebbe bloccato proprio durante la crisi. (c) **Privacy:** ogni tile rivela al provider l'IP dell'utente e la zona che sta guardando, cioè quasi la sua posizione |
| **v2** | **Prima la lista.** Mappa Leaflet caricata *solo su richiesta*, con **tile vettoriali PMTiles self-hosted su R2** (estratto della sola regione, renderer `protomaps-leaflet`). Nessuna richiesta a terze parti |
| **Costo** | Generare e caricare l'estratto PMTiles (una volta al mese). Circa 100-300 MB su R2 |

## Decisione 5 — Ricerca per indirizzo
| | |
|---|---|
| **v1** | Barra di ricerca su indirizzo, implicitamente con un geocoder (Nominatim o Google) |
| **Problemi** | (a) Nominatim pubblico non è pensato per un'app con molti utenti e richiede caching e proxy. (b) **Mandare l'indirizzo di casa dell'utente a un terzo** contraddice la privacy-first. (c) Ogni ricerca costa una richiesta di rete |
| **v2** | **Ricerca locale:** l'anagrafica di provincia contiene già indirizzo e comune di ogni distributore. A questa si aggiunge un piccolo gazetteer dei comuni con i centroidi (dati ISTAT). Si cerca "Lecco" o "via Roma Lecco" **senza rete** |
| **Costo** | Non si può cercare un indirizzo arbitrario ("via dei Mille 12") se non contiene un distributore. Si risolve con il comune + "Usa posizione". Accettabile per il caso d'uso |

## Decisione 6 — Piattaforma Cloudflare
| | |
|---|---|
| **v1** | Cloudflare Pages |
| **Problemi** | Pages va bene per lo statico, ma servono anche Durable Objects, cron e alarm. Cloudflare oggi indica **Workers + Static Assets** come strada consigliata per i progetti nuovi. Con Pages servirebbe un secondo Worker separato per DO e cron. Il **piano Free** ha limiti giornalieri (100k richieste/giorno) e al superamento **va in errore**: durante un picco di crisi il servizio cadrebbe nel momento di massimo bisogno |
| **v2** | **Workers + Static Assets**: un solo deploy, gli asset statici sono gratuiti e illimitati. **Piano Workers Paid (5 USD/mese)** consigliato prima del lancio pubblico. Gli snapshot di lettura sono cachati sulla CDN, quindi pochissime invocazioni |
| **Costo** | 5 USD/mese. Se si vuole restare su Pages per scelta, è fattibile (vedi ADR-0001, opzione B) |

## Decisione 7 — Percorso di lettura
| | |
|---|---|
| **v1** | Implicitamente: ogni client interroga un'API |
| **Problemi** | 10.000 utenti con polling ogni 60 s fanno 600.000 richieste l'ora: quota esaurita e costi |
| **v2** | **Snapshot per provincia**: un file JSON di pochi KB rigenerato al massimo ogni 30 s, con `Cache-Control: public, max-age=30` ed `ETag`. Il client usa `If-None-Match` e polling solo a pagina visibile. Il carico sull'origine è indipendente dal numero di utenti |
| **Costo** | Latenza di aggiornamento di 30-90 s. Accettabile: lo stato cambia nell'arco di minuti |

## Decisione 8 — Coordinate al server
| | |
|---|---|
| **v1** | Le segnalazioni GPS inviano le coordinate dell'utente |
| **Problemi** | Dato di localizzazione = dato personale delicato. In caso di breccia, richiesta dell'autorità o insider malevolo, ci sarebbe un registro di "chi era dove e quando" |
| **v2** | Il client invia **solo** `near: true/false`. Ciò che non si raccoglie non può essere rubato, sequestrato o abusato |

---

## Cosa resta debole nella v2 (onestà)

1. **Attacco Sybil non risolvibile.** Senza identità, un gruppo coordinato (per esempio 20 persone su Telegram) può falsare lo stato di un distributore. Lo mitighiamo (stato "contrastante", storico visibile, congelamento manuale), ma **non lo impediamo**. È un *trilemma*: anonimato, nessuna registrazione, resistenza Sybil. Se ne possono avere due su tre.
2. **Cold start.** Nei primi giorni la maggior parte dei distributori sarà grigia. La strategia di lancio (media locali, Comuni, locandine) è *parte del prodotto*, non un'aggiunta.
3. **Effetto stampede.** Quando un distributore diventa verde, tutti ci vanno e si svuota in fretta. Possibile mitigazione futura: segnalare anche la coda ("coda lunga / corta") per distribuire la domanda.
4. **Ritardo informativo.** Uno stato "verde da 40 minuti" in piena crisi può essere già falso. Mostrare sempre l'età ("ultima conferma 38 min fa") è più onesto di un colore.
5. **Dipendenza da un singolo fornitore (Cloudflare).** Mitigata da codice standard (Web API) e da un percorso di migrazione documentato.
