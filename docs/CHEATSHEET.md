# VORAEL — Cheatsheet del API

## Ruta rápida

```
vorael/
├── apps/api/src/
│   ├── index.ts              ← Entry point: Express, middleware, rutas
│   ├── config.ts             ← Lee .env, exporta config.*
│   ├── db.ts                 ← Pool PostgreSQL + mock-aware query()
│   ├── s3.ts                 ← Cliente DigitalOcean Spaces (S3)
│   ├── graph.ts              ← Motor de grafos (Graphology, in-memory)
│   ├── metadata.ts           ← ExifTool: embed + readImageMetadata
│   ├── mockData.ts           ← 30 imágenes mock (MOCK_IMAGES)
│   ├── types.ts              ← ImageRow y tipos compartidos
│   ├── routes/
│   │   ├── images.ts         ← /api/images, /api/images/:id, /download, /related
│   │   ├── search.ts         ← /api/search?q=... (token-match + scoring)
│   │   ├── tags.ts           ← /api/tags, /api/tags/:tag/images
│   │   ├── filters.ts        ← /api/filters (estilos, moods, usos)
│   │   ├── stats.ts          ← /api/stats (totales y rankings)
│   │   └── graph.ts          ← /api/graph (nodos + aristas para sigma.js)
│   └── scripts/
│       ├── seed-db.ts        ← Carga 30 mock images a PostgreSQL
│       ├── simulate-local.ts ← Descarga de S3 + embed + DB local
│       ├── backfill.ts       ← Reescribe archivos en S3 con metadatos
│       ├── export-portable.ts← Exporta imágenes con metadatos a disco
│       └── scanner.ts        ← Reconstruye grafo desde archivos
```

## Endpoints — tabla rápida

| Ruta | Qué hace | Archivo |
|---|---|---|
| `GET /api/health` | Estado del sistema | `index.ts:31` |
| `GET /api/images` | Grid paginado (page, limit, style, mood, use_case) | `routes/images.ts` |
| `GET /api/images/:id` | Detalle de una imagen | `routes/images.ts` |
| `GET /api/images/:id/download` | Descarga (format=webp\|png\|jpg, embed metadatos) | `routes/images.ts` |
| `GET /api/images/:id/related` | Imágenes relacionadas (vecinos compartidos en grafo) | `routes/images.ts` |
| `GET /api/search?q=...` | Búsqueda por token-match + scoring (tags×3, subject×2, prompts×1) | `routes/search.ts` |
| `GET /api/tags` | Todos los tags con conteo | `routes/tags.ts` |
| `GET /api/tags/:tag/images` | Imágenes por tag específico | `routes/tags.ts` |
| `GET /api/filters` | Estilos, moods y usos disponibles | `routes/filters.ts` |
| `GET /api/stats` | Totales, top estilos, top moods, top tags | `routes/stats.ts` |
| `GET /api/graph` | Grafo completo (types, limit, center, hops) para sigma.js | `routes/graph.ts` |

## Flujo del motor de búsqueda

```mermaid
flowchart TD
    A[Request] --> B[search.ts]
    B --> C[graph.ts]
    C --> D{SEARCH_ENGINE?}
    D -->|graph| E[grafo in-memory Graphology]
    E --> E1["tokenize + dedupe términos"]
    E1 --> E2["token-match palabra completa online tags/subject/prompt"]
    E2 --> E3["scoring por término: tags x4, subject x2, prompts x1"]
    E3 --> E4["filtro cobertura: >=50% en párrafos, OR si <=3 términos"]
    E4 --> E5["ordenar score DESC, created_at DESC, id DESC"]
    D -->|sql| F[fallback PostgreSQL]
    F --> F1["ILIKE, UNNEST tags, cardinality INTERSECT"]
```

> **Cómo busca**: cada palabra vale puntos según donde aparezca (tag +4, subject +2, prompt +1). Un término puede coincidir en varios campos y cuenta como un match. En queries de 1-3 términos basta un match (OR); en párrafos se exige ≥50% de los términos únicos.

## Flujo de descarga con metadatos

```mermaid
flowchart TD
    A["GET /api/images/:id/download?format=webp"] --> B["1. Busca imagen en DB graph store o PostgreSQL"]
    B --> C["2. Baja archivo de S3 o test-images/ en mock mode"]
    C --> D["3. Sharp convierte a formato solicitado"]
    D --> E{"METADATA_EMBED=exiftool?"}
    E -->|si| F["4. ExifTool incrusta metadatos"]
    F --> F1["EXIF: ImageDescription, Artist"]
    F --> F2["IPTC: Keywords tags"]
    F --> F3["XMP: Subject, Title"]
    F --> F4["XMP-vorael: id, style, mood, useCase, palette, fileName, createdAt"]
    E -->|no| G["5. Devuelve binario con Content-Disposition"]
    F1 --> G
    F2 --> G
    F3 --> G
    F4 --> G
```

## Motor de grafos — nodos y aristas

```mermaid
flowchart LR
    I[image] -->|TAGGED_WITH| T[tag]
    I -->|HAS_STYLE| S[style]
    I -->|HAS_MOOD| M[mood]
    I -->|HAS_USECASE| U[useCase]
    I -->|HAS_COLOR| C[color]
    T1[tag] -->|CO_OCCURS_WITH peso=frecuencia| T2[tag]
```

## Modos de operación

| Variable | Valor | Qué pasa |
|---|---|---|
| `DB_MOCK=true` | Mock | 30 imágenes de `mockData.ts`, 10 .webp en `test-images/`. Sin DB, sin S3 |
| `DB_MOCK=false` | Real | PostgreSQL + S3. Requiere Docker o DB real |
| `SEARCH_ENGINE=graph` | Grafo | In-memory Graphology, refresh cada 60s |
| `SEARCH_ENGINE=sql` | SQL | Fallback PostgreSQL directo |
| `METADATA_EMBED=exiftool` | Embed | Incrusta EXIF/IPTC/XMP en descargas |
| `METADATA_EMBED=none` | No embed | Sin metadatos en archivos |

## Desarrollo local

```bash
# 1. Postgres Docker (puerto 5433)
sudo docker compose up -d

# 2. Cargar datos mock a PostgreSQL
cd apps/api && pnpm seed:db

# 3. Arrancar API + web
cd ../.. && pnpm dev

# URLs
# Galería:  http://localhost:5173/vorael/
# Grafo:    http://localhost:5173/vorael/graph
# Search:   http://localhost:5173/vorael/search?q=cat
# Tags:     http://localhost:5173/vorael/tags
# Stats:    http://localhost:5173/vorael/stats
```

## Tests

```bash
pnpm test                    # 94 tests (excluye metadata.test.ts)
npx vitest run               # todos (96/98, 2 fallos pre-existente en metadata)
npx vitest run test/routes.test.ts   # un archivo específico
```

## Variables de entorno — las más usadas

| Variable | Defecto | Descripción |
|---|---|---|
| `DB_MOCK` | `false` | Modo mock (sin DB/S3) |
| `SEARCH_ENGINE` | `graph` | Motor: `graph` o `sql` |
| `METADATA_EMBED` | `none` | `exiftool` o `none` |
| `DB_HOST` / `DB_PORT` | — / `5432` | PostgreSQL. Docker local: `localhost:5433` |
| `S3_ENDPOINT` | — | `https://sfo3.digitaloceanspaces.com` |
| `PORT` | `3001` | Puerto Express |
| `HOST` | `127.0.0.1` | Loopback (no exponer) |
