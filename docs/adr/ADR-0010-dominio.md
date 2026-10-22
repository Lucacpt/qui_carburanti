# ADR-0010: Dominio `qui-carburanti.it` invece del sottodominio `workers.dev`

**Status:** Proposed (in attesa di conferma del maintainer)
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
Il maintainer ha proposto un sottodominio Cloudflare (`*.workers.dev`) per contenere i costi, con il nome `qui-carburanti`. Il servizio ha bisogno di: cache in lettura, regole WAF anti-abuso, un indirizzo email di contatto (GDPR art. 13, DSA artt. 11-12) e un link ufficiale riconoscibile contro i cloni.

## Decision
Registrare **`qui-carburanti.it`** (~10 €/anno), gestirne il DNS su Cloudflare (zona Free) e servire il Worker come *Custom Domain*. Email `contatti@` e `privacy@` tramite Cloudflare Email Routing.

## Options Considered

### Option A: Dominio proprio (raccomandata)
| Dimension | Assessment |
|---|---|
| Complexity | Bassa |
| Cost | ~10 €/anno |
| Scalability | Cache API, WAF e Under Attack Mode disponibili |
| Team familiarity | Alta |

**Pros:** email del progetto separata da quella personale e aziendale; un nome ufficiale da comunicare; WHOIS .it riservato per le persone fisiche.
**Cons:** rinnovo annuale da ricordare; registrazione da completare (con un registrar che supporta .it).

### Option B: `qui-carburanti.<account>.workers.dev`
| Dimension | Assessment |
|---|---|
| Complexity | Nulla |
| Cost | 0 € |
| Scalability | Probabilmente senza Cache API e senza regole WAF: tutte le letture arrivano al DO. Per una provincia regge |
| Team familiarity | — |

**Pros:** subito disponibile.
**Cons:** chiunque può creare un sottodominio simile (cloni); l'URL espone il nome dell'account; nessuna email di progetto; Cloudflare stesso sconsiglia workers.dev per la produzione.

## Trade-off Analysis
Il costo del dominio è trascurabile rispetto al piano Paid già accettato. I benefici riguardano direttamente due rischi del registro: L10 (separare l'identità personale) e P8 (cloni).

## Consequences
- Il codice non cambia: il Worker funziona su entrambi. Si può partire su workers.dev e migrare in giornata.
- Da rivedere: valutare anche `qui-carburanti.com` per difendersi dal typosquatting.

## Action Items
1. [ ] Verificare la disponibilità e registrare il dominio.
2. [ ] Spostare i nameserver su Cloudflare e aggiungere il Custom Domain al Worker.
3. [ ] Configurare Email Routing → casella personale **non aziendale**.
