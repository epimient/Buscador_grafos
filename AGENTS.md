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
- `exif.test.ts` — metadata embedding (requires exiftool)
- `metadata.test.ts` — metadata roundtrip (requires exiftool)

98 tests total. Run with `pnpm test` from root or `npx vitest run` from `apps/api/`.

## Key files

- `apps/api/src/graph.ts` — Graph engine, GraphStore singleton, exportSnapshot
- `apps/api/src/metadata.ts` — ExifTool wrapper (embed + readImageMetadata)
- `apps/api/src/db.ts` — pg pool + mock-aware query()
- `apps/api/src/mockData.ts` — 30 test images with TEST_URL/TEST_KEY helpers
- `apps/api/.ExifTool_config` — Custom XMP namespace definition
- `apps/web/src/pages/Graph.tsx` — Sigma.js graph visualization
- `apps/web/src/services/api.ts` — Axios instance + fetchGraph + downloadImage

## Environment

`apps/api/.env` is committed with `DB_MOCK=true` — safe for local dev. `apps/api/.env.production.example` shows the template for real credentials. Never commit real S3/DB passwords.
