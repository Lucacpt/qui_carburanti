# Procedura di rilascio

> Come QUI arriva online. Workflow: [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml). Versione 1 · 2026-10-23.

## Come funziona
| Evento | Cosa succede |
|---|---|
| Pull request | `ci.yml`: lint, tipi, test, guardia privacy, budget, smoke test locale. Niente deploy |
| Merge su `main` | Deploy su **staging** (`staging.quicarburanti.it`), poi smoke test completo: segnalazioni, PoW, contestazioni |
| Tag `v*` (es. `v0.1.0`) | Staging e smoke test, poi **produzione** (`quicarburanti.it`) dopo la tua approvazione, poi smoke test in sola lettura |
| *Actions → Deploy → Run workflow* su `main` | Solo staging e smoke test: per rilanciarlo dopo aver sistemato la configurazione |

Lo staging è un Worker separato (`qui-staging`) con **Durable Objects propri**: i dati di prova non toccano la produzione. Non è indicizzato dai motori di ricerca (`X-Robots-Tag: noindex`). Le *preview URL* e `*.workers.dev` sono spente: userebbero gli stessi dati della produzione.

Il rilascio in produzione si ferma se:
- il tag non corrisponde a `version` in `package.json`;
- i documenti legali contengono ancora segnaposto `[DA COMPILARE…]` o avvisi di bozza (`npm run legal-check -- --strict`);
- lo staging o il suo smoke test falliscono.

## Configurazione una tantum

### 1. Cloudflare
1. *Workers & Pages → Plans*: **Workers Paid**.
2. *My Profile → API Tokens → Create Token*, modello **Edit Cloudflare Workers**:
   - *Account Resources*: solo il tuo account;
   - *Zone Resources*: solo `quicarburanti.it`.
   
   Copia il token **direttamente** nel passo 2: non salvarlo altrove e non incollarlo in chat.
3. Annota l'**Account ID**: si trova nella colonna di destra della pagina *Workers & Pages*. Non è un segreto.

### 2. GitHub: due environment
*Settings → Environments*, crea **`staging`** e **`production`**. In ognuno inserisci:
- *Environment secrets*: `CLOUDFLARE_API_TOKEN`, il token del passo 1.2;
- *Environment variables*: `CLOUDFLARE_ACCOUNT_ID`.

Poi limita chi può usarli:
| Environment | *Deployment branches and tags* | *Required reviewers* |
|---|---|---|
| `staging` | *Selected*: branch `main`, tag `v*` | nessuno |
| `production` | *Selected*: solo tag `v*` | tu (il deploy aspetta il tuo clic su *Approve*) |

Consigliato: *Settings → Rules → Rulesets → New tag ruleset* su `v*`, così solo tu puoi creare o cancellare tag di rilascio.

### 3. DNS
- I record A di Aruba su `quicarburanti.it` e `www` devono essere **eliminati** (fatto il 2026-10-23). Al primo deploy Cloudflare crea da solo i record e i certificati per `quicarburanti.it` e `staging.quicarburanti.it`.
- *SSL/TLS → Edge Certificates → **Always Use HTTPS***: attivo. Senza, un link senza `https://` (es. nella bio di Instagram, che lo apre in `http://`) carica il sito fuori da HTTPS, dove il browser spegne posizione e crittografia: segnalazioni "da remoto" e PoW che fallisce. L'app passa comunque a `https://` da sola (`src/client/secure.ts`), ma le pagine statiche no.
- **`www` → `quicarburanti.it`**, dopo il primo deploy in produzione:
  1. *DNS → Records → Add*: tipo `AAAA`, nome `www`, indirizzo `100::`, **Proxied**. L'indirizzo è finto: serve solo a far passare le richieste da Cloudflare.
  2. *Rules → Redirect Rules → Create from template → "Redirect from WWW to root"*, con codice 301.

### 4. Secret del Worker
| Secret | Chi lo imposta | Quando |
|---|---|---|
| `POW_SECRET` | **Nessuno**: `scripts/deploy.ts` lo genera al primo deploy di ogni ambiente e lo carica insieme al codice | automatico |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS` | Tu, da *Workers & Pages → qui → Settings → Variables and Secrets → Add → Secret* | dopo il primo deploy in produzione, quando Cloudflare Access è configurato ([ADR-0013](../adr/ADR-0013-area-admin.md)) |

Senza i tre secret di Access l'area admin resta **chiusa** (503). Sullo staging resta sempre chiusa: è voluto.

**Ruotare `POW_SECRET`:** eliminalo dalla dashboard e rifai il deploy, che ne genera uno nuovo. Le sfide aperte in quel momento (valide 5 minuti) vengono rifiutate e chi stava segnalando deve riprovare.

## Prima del lancio: la pagina d'attesa
Finché nell'environment `production` la variabile **`PUBLIC_LAUNCH`** non vale `1`, il deploy in produzione pubblica `public/presto.html` ("Arriviamo a brevissimo") al posto della lista. Vale per la home, per ogni scheda `/d/<id>` e per `/dati`. La pagina non è indicizzata.

Tutto il resto funziona già: API, area admin (`/admin`, con Cloudflare Access), pagine informative e legali, `robots.txt`, `llms.txt`. Così si possono configurare e provare l'area admin e i secret prima del lancio.

**Per lanciare:**
1. *Settings → Environments → production → Environment variables → Add variable*: nome `PUBLIC_LAUNCH`, valore `1`.
2. *Actions → Deploy*: apri l'ultimo rilascio (`v…`) e premi **Re-run jobs**. In alternativa, fai un nuovo tag di rilascio.
3. Dopo il lancio, invia la sitemap a Search Console e Bing Webmaster Tools (`docs/08-seo.md`): prima del lancio le schede mostrano la pagina d'attesa.
4. Aggiorna l'anteprima dei link già condivisi: nel [Debugger di condivisione di Facebook](https://developers.facebook.com/tools/debug/) inserisci `https://quicarburanti.it/` e premi *Scrape Again*, altrimenti Facebook e Instagram mostrano ancora "QUI arriva a brevissimo". WhatsApp non ha un comando equivalente: l'anteprima si aggiorna da sola, nel giro di qualche giorno.

Per tornare alla pagina d'attesa, ad esempio durante un problema serio, togli la variabile e rilancia il job.

## Rilasciare una versione
1. Con una PR aggiorna `version` in `package.json` (es. `0.1.0`), poi uniscila.
2. Dal tuo computer, su `main` aggiornato:
   ```sh
   git switch main && git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. *Actions → Deploy*: aspetta lo staging, poi approva **production**.
4. Lo smoke test in produzione è in **sola lettura**: controlla salute, intestazioni di sicurezza, sfida PoW, snapshot e chiusura dell'area admin, senza creare segnalazioni.

## Una volta l'anno
`public/.well-known/security.txt` ha una scadenza obbligatoria (`Expires`, RFC 9116). Un mese prima il test `scripts/security-txt.test.ts` fallisce: sposta la data avanti di un anno al massimo e rilascia.

## Tornare indietro
*Workers & Pages → qui → Deployments → Rollback* sulla versione precedente: è immediato. Il rollback riporta il **codice**, non i dati: le segnalazioni già ricevute restano.

Per bloccare subito le segnalazioni durante un attacco non serve un rollback: usa la **sola lettura** dall'area admin.

## Deploy dal proprio computer
Non c'è uno script `npm run deploy`, di proposito: un deploy dal portatile salterebbe test, staging e smoke test. In emergenza, con `npx wrangler login`:
- staging: `node scripts/deploy.ts staging`;
- produzione: `node scripts/deploy.ts production`.
