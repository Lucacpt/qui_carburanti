# Sicurezza

QUI gestisce segnalazioni anonime in una situazione di emergenza: una vulnerabilità può avere effetti reali sulle persone. Grazie se ci aiuti.

## Come segnalare una vulnerabilità
- Usa **[Private vulnerability reporting](https://github.com/Lucacpt/qui_carburanti/security/advisories/new)** di GitHub (scheda *Security* → *Report a vulnerability*).
- **Non aprire issue pubbliche** per problemi di sicurezza.
- Indica: descrizione, impatto, passi per riprodurre, eventuale proof of concept.

## Cosa aspettarti
- Conferma di ricezione entro **48 ore**.
- Per problemi critici (de-anonimizzazione degli utenti, esecuzione di codice, manipolazione massiva degli stati) attiviamo subito la modalità sola lettura, se serve.
- Riconoscimento pubblico nel changelog, se lo desideri.

## Ambito
Sono dentro l'ambito: il codice di questo repository e l'istanza ufficiale di QUI.
Sono fuori dall'ambito: attacchi DoS volumetrici, social engineering, test sulle istanze di terzi.

Il modello delle minacce è pubblico: [docs/04-threat-model.md](docs/04-threat-model.md).
