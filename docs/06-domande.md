# QUI — Domande aperte (anche scomode)

> 2026-10-22 · Rispondere direttamente qui sotto ogni domanda. Le risposte diventano ADR o modifiche al RAD.
> Le domande segnate con 🔴 **bloccano** l'inizio dello sviluppo.
> ✅ **Risposte integrate** il 2026-10-22 in [07-report-v0.3.md](07-report-v0.3.md).

## A. Smontiamo la tesi

1. 🔴 **Il problema è davvero "dove c'è carburante"?** O è "quanto devo aspettare" o "quanto posso fare (razionamento)"? Se le stazioni hanno carburante ma con code di 2 ore e un limite di 20 €, il verde è fuorviante. Vuoi aggiungere almeno "coda: corta / lunga" e "limite di erogazione: sì / no"? si
2. **Perché una web app e non un bot Telegram?** Telegram è già installato, consuma meno banda e ha le notifiche push. Contro: Telegram vede tutto, quindi niente privacy, ed esclude chi non lo usa. Io resto sulla web app, ma la domanda va posta: **chi sono i tuoi utenti e dove sono già?** i miei utenti sono tutti anche coloro che non hanno telegram
3. **La comunità ci sarà?** Il crowdsourcing funziona sopra una massa critica. Quante persone pensi di raggiungere nella prima settimana, e attraverso quali canali (media locali, gruppi, Comuni)? Pensavo gruppi e canali social Senza un piano di lancio QUI resta grigia, e un'app grigia viene abbandonata in 24 ore.
4. **Quanto durerà la carenza?** Settimane o mesi? Se finisce tra 10 giorni, un MVP in 2 settimane arriva tardi: conviene tagliare ancora (solo lista + segnalazione, niente mappa, niente PWA). Si spera duri al massimo un' altra settimana 
5. **Esistono già fonti ufficiali?** Prefettura, Regione o le compagnie petrolifere pubblicano qualcosa sulla disponibilità? Se sì, possiamo integrarle (fonte "ufficiale" con un'icona diversa) invece di competere. Ad oggi non sono disponibili purtroppo 
6. **Il verde crea l'effetto stampede?** Se 500 persone vedono lo stesso distributore verde e ci vanno tutte, l'app peggiora la situazione. Accetti questo rischio nella v1 o vuoi mostrare anche "N persone stanno andando qui" (un contatore anonimo, che però è manipolabile)? accetto il rischio indicando la possibile coda
7. **"Più di 3 segnalazioni dallo stesso IP → timeout": cosa vuoi proteggere esattamente?** Il caso reale di 5 persone in coda, con lo stesso operatore e quindi lo stesso IP, che confermano tutte, verrebbe punito. Confermi che preferisci il design v2 (deduplica silenziosa + cap per prefisso)? si

## B. Prodotto

8. 🔴 **Quale regione?** Mi serve per il bounding box, l'estratto delle mappe, il gazetteer e la stima del numero di distributori. Regione Campania, avellino in partenza come provincia, poi espansione
9. 🔴 **Quali carburanti tracciamo?** Proposta: Benzina, Gasolio, GPL, Metano. Servono anche HVO, AdBlue o la ricarica elettrica? Tracciamo Benzina, Gasoloio, Gpl, Metano e HVO
10. **Ordinamento di default:** "verdi più vicini" (la mia proposta) o "più confermati" (la tua)? Per chi guida conta più 1 km con 2 conferme o 8 km con 10 conferme? verdi più vicini
11. **Etichette:** confermi il cambio da "Probabilmente esaurito" a "Da verificare" per l'ambra, e da "Esaurito" a "Segnalato esaurito"? si
12. **Colore del marchio vs colore di stato:** il marchio QUI è arancione, e lo stato "da verificare" non può esserlo. Va bene l'**ambra/giallo** per lo stato? va bene ambra
13. **Segnalazione da remoto (via indirizzo):** deve valere quanto quella fatta sul posto? Io propongo metà peso: chi non è lì sa meno. D'accordo? si
14. **Notifiche** ("avvisami quando un distributore vicino torna verde"): servono nella v1? Su iOS funzionano solo con la PWA installata e richiedono un endpoint push (un dato in più). Si, ma così facendo si presuppone il GPS sempre acceso ? si
15. **Lingue:** solo italiano o anche inglese (turisti, autotrasportatori stranieri)? solo italiano in partenza, poi espansione
16. **Gestori:** vuoi un canale "verificato" per i gestori (per esempio un codice consegnato di persona) per dichiarare "Rifornimento arrivato"? È potente ma va gestito. No ma implementiamo la possibilità di contatto e contestazione

## C. Algoritmo e soglie

17. **Una sola segnalazione "Non c'è" fatta sul posto, senza conferme negli ultimi 45 minuti, deve bastare per il rosso?** Oggi sì (`RED_MIN_UNOPPOSED = 1.0`). Alzarla a 1,5 richiederebbe due persone, quindi più sicuro ma più lento. Io direi di alzarla ancora di più per evitare falsi negativi 
18. **45 minuti e 8 ore:** da dove vengono questi numeri? Hai un'idea di quanto velocemente si svuota un distributore durante la carenza nella tua zona? Se si svuota in 20 minuti, 45 minuti di "verde" sono troppi. è una mia idea rapportata ad una percezione personale durante una coda di 30 minuti in cui ho considerato anche uno scarto
19. **Raggio "vicino":** 150 m ti sembra ragionevole? Le coordinate MIMIT a volte sbagliano di 100 m o più. Vanno bene, ma come fa l' utente a segnalre quel preciso distributore ? Anche senza GPS attivo 

## D. Tecnica e infrastruttura

20. 🔴 **Cloudflare Pages o Workers?** Consiglio Workers + Static Assets (ADR-0001). Ci sono motivi per cui vuoi proprio Pages (preview per branch, abitudine, un account già configurato)? workers va bene
21. 🔴 **Budget:** puoi sostenere 5 USD/mese per il piano Paid, più ~15 €/anno per il dominio? Sul piano Free il servizio cade proprio nei momenti di picco. si per il piano. per il dominio pensavo ad un subdomio cloudfare
22. **Dominio:** hai già un nome? (`qui.app`? `qui-carburante.it`? `dovequi.it`?) Il nome influisce anche sul rischio di cloni (threat model P8). Pensavo QUI-carburanti.it
23. **Account Cloudflare:** ne esiste già uno? Consiglio un account **dedicato** al progetto, separato da qualsiasi account aziendale, con 2FA a chiave hardware. Io ne ho uno privato e basta...
24. **Mappa nella v1?** Propongo di rimandarla alla Fase 2 per andare online prima. Accetti una v1 senza mappa? SI
25. **Livello di esperienza:** che familiarità hai con TypeScript, Cloudflare Workers e GitHub Actions? Cambia quanto spiego e quanto ti chiedo di scrivere tu. ho molta esperienza con lo sviluppo in generale e ho una certa familiarità con javascript/typescript e con i vari tool correlati ma non ho molta familiarità con cloudflare workers

## E. Legale e organizzazione

26. 🔴 **A nome di chi pubblichi QUI?** Tu come persona fisica, un'associazione, la tua azienda o un ente partner? (Vedi rischi legali L10. Sconsiglio l'azienda senza un parere.) Per ora sono solo io un privato, poi si vedrà
27. **Hai un secondo maintainer?** Con una sola persona non esiste la *review indipendente* dei deploy, che è una difesa chiave contro supply chain e account takeover. per ora sono solo io, poi si vedrà
28. **Licenza:** va bene l'AGPL-3.0 (ADR-0008)? Oppure la EUPL-1.2, se pensi di coinvolgere un Comune o la Regione? sono aperto a valutare entrambe
29. **Donazioni:** le escludiamo dalla v1? Fiscalmente e reputazionalmente sono un'incognita, e sono il primo bersaglio dei cloni truffa. Si le escludiamo
30. **Contatto istituzionale:** sei disposto a presentare QUI alla Prefettura o alla Protezione Civile locale prima del lancio? si ma dovrei prima capire chi è la persona di riferimento 

## F. GitHub e CI/CD

31. 🔴 **Utente o organizzazione GitHub?** Consiglio un'**organizzazione** dedicata (es. `qui-app`): separa il progetto dal tuo profilo personale e facilita l'aggiunta di maintainer. per ora va bene quello privato almeno lo uso anche come progetto personale
32. 🔴 **`gh` CLI non è installata** su questa macchina. Preferisci installarla (`winget install GitHub.cli`), così posso creare la repo da qui, oppure crei tu la repo vuota dal web e io configuro il resto? creo io la repo dal web 
33. **Protezioni:** posso attivare branch protection con review obbligatoria su `main`? Con un solo maintainer dovresti poter approvare le tue stesse PR, il che indebolisce la protezione (vedi domanda 27). inserisci le protezioni.
