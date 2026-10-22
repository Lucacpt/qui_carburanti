# ADR-0001: Piattaforma: Cloudflare Workers + Static Assets (piano Paid)

**Status:** Accepted (2026-10-22: Workers + piano Paid confermati; account Cloudflare personale con 2FA e token con scope minimo; dominio in ADR-0010)
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
La richiesta originale è Cloudflare Pages. Il sistema però serve anche: stato condiviso fortemente consistente (contatori, deduplica), job periodici (alarm e cron) e un'area admin. Durante una crisi il traffico può moltiplicarsi per 100 in un'ora. Il piano Free dei Workers ha un limite di 100.000 richieste/giorno; oltre il limite le operazioni **falliscono**, invece di essere fatturate.

## Decision
Un unico **Worker con Static Assets**, Durable Objects e Cron Triggers, sul **piano Workers Paid (5 USD/mese)** prima del lancio pubblico.

## Options Considered

### Option A: Workers + Static Assets (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Bassa: un solo `wrangler.jsonc`, un solo deploy |
| Cost | 5 USD/mese (Paid). Asset statici gratuiti e illimitati |
| Scalability | Alta. Le letture passano dalla cache |
| Team familiarity | Media |

**Pros:** strada consigliata oggi da Cloudflare per i progetti nuovi; DO, cron e asset nello stesso progetto; versioni e rollback nativi.
**Cons:** alcune funzioni di Pages (middleware, redirect `_redirects` nativi) vanno reimplementate nel Worker.

### Option B: Pages + Pages Functions + Worker separato per DO e cron
| Dimension | Assessment |
|---|---|
| Complexity | Media: due progetti, binding tra servizi |
| Cost | Uguale |
| Scalability | Uguale |
| Team familiarity | Media |

**Pros:** rispetta la richiesta originale; preview automatiche per branch.
**Cons:** due unità da deployare e versionare insieme; i DO devono comunque vivere in un Worker.

### Option C: Pages statico + backend esterno (Supabase/Postgres)
**Pros:** SQL completo, dashboard. **Cons:** terza parte in più che riceve gli IP, latenza, costo, un'altra superficie d'attacco. **Scartata** per la privacy.

## Trade-off Analysis
B è fattibile ma introduce coordinamento tra due deploy senza alcun vantaggio funzionale. Il piano Paid è la vera decisione: sul Free, il giorno in cui l'app "funziona" (va virale) è anche il giorno in cui smette di funzionare.

## Consequences
- Più facile: deploy atomico, rollback con un comando, un solo set di segreti.
- Più difficile: dipendenza da Cloudflare (mitigata isolando `domain/`).
- Da rivedere: se il traffico supera i 10 M richieste/mese, servire gli snapshot da un bucket R2 pubblico con dominio personalizzato, così le letture non invocano il Worker.

## Action Items
1. [ ] Creare un account Cloudflare dedicato al progetto (non personale), con 2FA a chiave hardware.
2. [ ] Attivare Workers Paid e un avviso di spesa.
3. [ ] Registrare il dominio e configurarlo su Cloudflare.
