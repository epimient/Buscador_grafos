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
- **Graph engine**: `SEARCH_ENGINE=graph` (default) uses in-memory Graphology. `SEARCH_ENGINE=sql` falls back to PostgreSQL. Graph refreshes every 60s via atomic swap.
- **Tests require no external services** — they use `mockData.ts` and `test/fixtures/images.ts`. No DB, no S3, no exiftool needed.
- **ExifTool**: optional. `METADATA_EMBED=exiftool` enables metadata embedding in downloads. Config in `apps/api/.ExifTool_config` defines custom XMP namespace `XMP-vorael:*`. If exiftool is missing, degrades silently.
- **sigma.js node types**: Do NOT pass custom types (`tag`, `style`, `mood`, etc.) to sigma's graph. Sigma only recognizes built-in types (`circle`, `square`, etc.). Use color for visual differentiation instead.
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
- `graph-endpoint.test.ts` — GET /api/graph endpoint
- `related.test.ts` — related images via graph similarity
- `tags.test.ts` — tag listing and tag-images endpoint
- `facets.test.ts` — filters and stats endpoints
- `exif.test.ts` — metadata embedding (requires exiftool)
- `metadata.test.ts` — metadata roundtrip (requires exiftool)

110 tests total (2 fallos conocidos en `metadata.test.ts` si exiftool no está configurado). Run with `pnpm test` from root or `npx vitest run` from `apps/api/`.

## Key files

- `apps/api/src/graph.ts` — Graph engine, GraphStore singleton, exportSnapshot
- `apps/api/src/metadata.ts` — ExifTool wrapper (embed + readImageMetadata)
- `apps/api/src/db.ts` — pg pool + mock-aware query()
- `apps/api/src/mockData.ts` — 30 test images with TEST_URL/TEST_KEY helpers
- `apps/api/.ExifTool_config` — Custom XMP namespace definition
- `apps/web/src/pages/Graph.tsx` — Sigma.js graph visualization
- `apps/web/src/services/api.ts` — Axios instance + fetchGraph + downloadImage

## Environment

- `apps/api/.env` is **gitignored** and NOT tracked (only `.env.example`/`.env.production.example` are tracked). Never commit real S3/DB passwords.
- `DB_MOCK=true` (default) → uses `mockData.ts` (30 images) + `test-images/` (10 .webp placeholders). No DB, no S3 needed.
- `DB_MOCK=false` → requires a running PostgreSQL. Local dev uses Docker: `sudo docker compose up -d` (port **5433**, user/pass `vorael`/`vorael123`). Schema in `deploy/init.sql`; seed with `pnpm seed:db`.
- `SEARCH_ENGINE=graph` (default) → in-memory Graphology, refreshes every 60s. `SEARCH_ENGINE=sql` → falls back to PostgreSQL queries.
- `apps/api/.env.production.example` shows the template for real credentials.
- `test-images-real/` contains real images downloaded from S3 (for local simulation). These are large (~45MB) and untracked.
