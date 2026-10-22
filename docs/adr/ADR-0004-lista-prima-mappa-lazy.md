# ADR-0004: Lista come vista principale, mappa Leaflet su richiesta con tile self-hosted

**Status:** Accepted (mappa rimandata alla Fase 2, fuori dall'MVP)
**Date:** 2026-10-22
**Deciders:** Luca (maintainer)

## Context
Obiettivi: banda minima e privacy. Una mappa raster pesa 300-600 KB per vista. I tile di openstreetmap.org non si possono usare per un'app con picchi di traffico (OSMF Tile Usage Policy). Inoltre ogni tile richiesto a un terzo rivela IP e zona di interesse.

## Decision
1. La vista principale è una **lista** ordinata per stato e distanza.
2. **Leaflet** (richiesto) si carica *dinamicamente* solo al tocco su "Mappa".
3. Tile **vettoriali PMTiles** (basemap Protomaps, dati OSM) dell'estratto regionale, ospitati su **R2** e letti con range request; renderer `protomaps-leaflet`.

## Options Considered

### Option A: Lista + Leaflet lazy + PMTiles su R2 (scelta)
| Dimension | Assessment |
|---|---|
| Complexity | Media (estratto mensile) |
| Cost | Pochi centesimi/mese su R2 |
| Scalability | Alta |
| Team familiarity | Media |

**Pros:** nessuna terza parte; tile vettoriali più leggeri; funziona anche offline se messi in cache.
**Cons:** `protomaps-leaflet` aggiunge peso al bundle lazy; stile cartografico da curare.

### Option B: Leaflet + provider di tile raster (MapTiler, Stadia...)
**Pros:** setup immediato. **Cons:** terza parte che vede gli IP; quote gratuite che si esauriscono nei picchi; la CSP va aperta.

### Option C: MapLibre GL
**Pros:** rendering vettoriale nativo. **Cons:** circa 200 KB+ gz, il doppio di Leaflet; richiede WebGL (problemi sui telefoni vecchi).

## Trade-off Analysis
La lista risolve da sola circa il 90% del bisogno. La mappa serve all'orientamento, quindi può costare di più purché resti *opzionale* e *first-party*.

## Consequences
- Più facile: rispettare il budget di 100 KB; nessun banner privacy per la mappa.
- Più difficile: pipeline di estrazione dei tile (GitHub Action manuale).
- Da rivedere: con Leaflet 2.x stabile, valutare l'aggiornamento.

## Action Items
1. [ ] Script `pmtiles extract` con il bounding box della regione.
2. [ ] Attribuzione "© OpenStreetMap contributors, Protomaps" sulla mappa.
