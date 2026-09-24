# AGENTS.md — VORAEL

## Quick commands

```bash
pnpm test                    # run all API tests (vitest)
pnpm test:watch              # vitest watch mode
pnpm test:coverage           # vitest with coverage
cd apps/api && npx vitest run test/routes.test.ts   # single test file
pnpm build                   # build both api + web
pnpm build:api               # tsc only
pnpm build:web               # tsc -b && vite build
pnpm lint                    # lint both packages
pnpm dev                     # dev both (api :3001, web :5173)
pnpm seed:generate           # sintetiza + siembra 1000 filas gen-* (DB_MOCK=false)
pnpm seed:generate:clear     # borra filas gen-* y re-siembra
```

## Architecture

Monorepo with pnpm workspaces. Two packages:

- **apps/api** — Express 4 + TypeScript (CommonJS). The API server.
- **apps/web** — React 18 + Vite 6 + TypeScript (ESM). SPA frontend.

Data comes from PostgreSQL (`generated_images` table) and DigitalOcean Spaces (S3). The API is read-only — it never writes to the DB. An external n8n flow populates the data.

## Critical conventions

- **API is CommonJS** (`"type": "commonjs"`). Web is ESM (`"type": "module"`). Do not mix import styles.
- **API entry guard**: `index.ts` only calls `app.listen` when `require.main === module`. When imported for tests, it exports `app` + `bootGraph()` without starting a server.
- **Mock mode**: set `DB_MOCK=true` in `apps/api/.env`. Uses `mockData.ts` (30 images) + `test-images/` (10 .webp placeholders). All routes work — DB and S3 are bypassed. This is the default for local dev and tests.
- **Graph engine**: `SEARCH_ENGINE=graph` (default) uses in-memory Graphology. `SEARCH_ENGINE=sql` falls back to PostgreSQL.
  - **Incremental refresh**: every `GRAPH_REFRESH_MS` (default 60000) the store fetches only rows newer than a watermark (keyset on `(created_at, id)`) and applies them in-memory (`applyDelta`). Every `GRAPH_FULL_RELOAD_MS` (default 600000) it does a full rebuild + refetch to reconcile (deltas can't detect deletes/edits).
  - **Precision warning**: `created_at` is read via `to_char(created_at AT TIME ZONE 'UTC', ... .US ...)` to keep microsecond precision. Do NOT round-trip through `new Date().toISOString()`, which truncates to ms and makes the watermark lag (each tick re-fetches the newest row forever). `computeWatermark` preserves strings as-is.
- **Tests require no external services** — they use `mockData.ts` and `test/fixtures/images.ts`. No DB, no S3, no exiftool needed.
- **ExifTool**: optional. `METADATA_EMBED=exiftool` enables metadata embedding in downloads. Config in `apps/api/.ExifTool_config` defines custom XMP namespace `XMP-vorael:*`. If exiftool is missing, degrades silently.
- **Semantic search**: `SEARCH_MODE=lexical` (default) | `semantic` | `hybrid`. Requires Ollama local (default `http://127.0.0.1:11434`, model `EMBED_MODEL` default `bge-m3`, dims 1024) and the `image_embeddings` table (id, embedding real[], model). Index lives in memory (`apps/api/src/embeddings.ts`, `loadSemanticIndex`). **Lifecycle**: `warmSemanticIndex()` precarga el índice en el boot (no-mock, modo ≠ lexical) porque la carga de 53k vectores tarda ~25s — no debe caer sobre el primer request (timeout del cliente). `startSemanticRefresh(GRAPH_FULL_RELOAD_MS)` lo recarga periódicamente para recoger embeddings nuevos sin reiniciar; el timer está `.unref()`. El frontend lee el default en `GET /api/health` (`search.mode`/`search.model`) y puede sobreescribirlo con `?mode=lexical|semantic|hybrid`. Query embedding is cached with LRU. Degrades to lexical if Ollama/table missing. Build embeddings with `pnpm embeddings:build` (resumable, batches of 32). **Precision warning**: the RAM index is Float32Array — do not mutate it in place; `cosine`/`searchSemantic`/`rrfFuse` are pure and tested in `test/embeddings.test.ts`.
- **Noise/quality controls (hybrid)**: `searchSemantic` filtra todo coseno `≤ SEMANTIC_MIN_SCORE` (default `0.65`, env `SEMANTIC_MIN_SCORE`) — coseno `= 0.25` era demasiado laxo: con 53k vectores densos quedaban ≥100 candidatos por encima de 0.50, así que el top-100 semántico no cambiaba y el ruido seguía entrando al RRF. 0.65 es el límite inferior del "plateau limpio" medido: la query larga cayó 193→100 con top-15 15/15 y "sala de control" 157→102. 0.62 ya reintroduce ruido (VR, ventanilla, sala de espera). **El umbral solo aplica al feed semántico del RRF (hybrid)**: en `mode=semantic` puro no se aplica (`minScore=0`, top-100 por coseno directo) porque bge-m3 casi no pasa de 0.65 y filtraba la búsqueda a ~5 resultados — routes/search.ts pasa `mode === 'hybrid' ? config.semantic.minScore : 0`. `scoreSearch` cuenta solo términos significativos: stopwords ES filtradas en `src/stopwords.ts` (`meaningfulTerms`); una "persona parada frente a una sala de control" = 4 términos (persona, parada, sala, control), `minMatched = floor(n×0.75)` (≤2 términos → 1). En hybrid el RRF solo recibe el **top-100 léxico** (`lexical.ids.slice(0,100)`) + top-100 semántico; `total` en hybrid = longitud del ranking fusionado (no la unión completa).
- **Web graph renderer**: `GraphCanvas.tsx` renders with **vis-network** (vis.js) — the same engine behind Graphify's `graph.html` viewer. Physics is Barnes-Hut (spring + repulsion), triggered by `data` change; the component rebuilds (destroy + recreate) per `data` swap. Node `color` comes from the API by type (graph.ts `NODE_COLORS`); click → highlight neighbors + navigate (image/tag) or callback. Do NOT pass custom shapes — vis-network only handles built-in shapes (`dot`, `box`, etc.).
- **Sub-route `/vorael/`**: hardcoded in 4 places — `vite.config.ts` (base), `main.tsx` (BrowserRouter basename), `deploy/nginx-vorael.conf` (location), `index.html` (favicon href). Changing one without the others breaks the app.

## Verification order

```
cd apps/api && npx tsc --noEmit && npx vitest run
cd apps/web && npx tsc --noEmit
```

Both must pass before committing.

## Test structure

Tests live in `apps/api/test/`:

- `routes.test.ts` — endpoint tests (supertest against Express app)
- `search.test.ts` — search engine behavior
- `graph.test.ts` — graph construction and querying
- `graph-endpoint.test.ts` — GET /api/graph endpoint (incluye subgrafo por `ids`)
- `related.test.ts` — related images via graph similarity
- `tags.test.ts` — tag listing and tag-images endpoint
- `facets.test.ts` — filters and stats endpoints
- `exif.test.ts` — metadata embedding (requires exiftool)
- `metadata.test.ts` — metadata roundtrip (requires exiftool)

120→nah, real count: 133 tests total, all passing (`metadata.test.ts`/`exif.test.ts` cubren el round-trip ExifTool si el binario y `.ExifTool_config` existen; degradan a fallback si no). Run with `pnpm test` from root or `npx vitest run` from `apps/api/`.

## Key files

- `apps/api/src/graph.ts` — Graph engine, GraphStore singleton, exportSnapshot
- `apps/api/src/embeddings.ts` — Semantic index (cosine, searchSemantic, RRF, LRU cache)
- `apps/api/src/scripts/embeddings-build.ts` — one-time build of image_embeddings (resumable)
- `apps/api/src/metadata.ts` — ExifTool wrapper (embed + readImageMetadata)
- `apps/api/src/db.ts` — pg pool + mock-aware query()
- `apps/api/src/mockData.ts` — 30 test images with TEST_URL/TEST_KEY helpers
- `apps/api/.ExifTool_config` — Custom XMP namespace definition
- `apps/web/src/pages/Graph.tsx` — Sigma.js graph visualization
- `apps/web/src/components/features/GraphCanvas.tsx` — render reutilizable con **vis-network** (el motor de graph.html de Graphify: Barnes-Hut + highlight de vecinos); lo usan GraphPage y el subgrafo de Search
- `GET /api/graph?ids=id1,id2,…` — subgrafo inducido por un conjunto de imágenes: nodos imagen + metadatos que comparten **2+ imágenes del set** (los compartidos por 1 sola se filtran, no "unen" nada). El `size` de un metadato = cuántas imágenes del set lo comparten. **Esto también optimiza el render**: una búsqueda de 100 imágenes con ~1070 metadatos crudos baja a ~220 nodos.
- `GET /api/search?graph=1` — devuelve el subgrafo del top-100 del ranking actual en `response.graph`. El frontend lo pide aparte del feed infinito (solo cuando el usuario abre el toggle "Ver grafo" en Search.tsx), para no arrastrar el grafo en cada página.
- `apps/web/src/services/api.ts` — Axios instance + fetchGraph + downloadImage

## Environment

- `apps/api/.env` is **gitignored** and NOT tracked (only `.env.example`/`.env.production.example` are tracked). Never commit real S3/DB passwords.
- `DB_MOCK=true` (default) → uses `mockData.ts` (30 images) + `test-images/` (10 .webp placeholders). No DB, no S3 needed.
- `DB_MOCK=false` → requires a running PostgreSQL. Local dev uses Docker: `sudo docker compose up -d` (port **5433**, user/pass `vorael`/`vorael123`). Schema in `deploy/init.sql`; seed with `pnpm seed:db`.
- `SEARCH_ENGINE=graph` (default) → in-memory Graphology, refreshes every 60s. `SEARCH_ENGINE=sql` → falls back to PostgreSQL queries.
- `apps/api/.env.production.example` shows the template for real credentials.
- `test-images-real/` contains real images downloaded from S3 (for local simulation). These are large (~45MB) and untracked.
