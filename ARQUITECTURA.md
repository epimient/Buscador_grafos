# VORAEL — Arquitectura

Banco de imágenes generadas por IA de la Corporación Universitaria Americana.
Es un catálogo de **solo lectura**: no genera imágenes ni las sube. Lee una
tabla de Postgres que otro proceso (un flujo de n8n) ya llenó, y sirve los
archivos que viven en DigitalOcean Spaces.

En producción se sirve como sub-ruta: **https://n8n.americana.edu.co/vorael/**

Para los pasos de despliegue, ver [DEPLOY.md](DEPLOY.md). Este documento explica
**cómo funciona y a dónde se conecta**.

---

## 1. Panorama

```
                    ┌──────────────────────────────────────────────┐
   Navegador ───────┤  Nginx · n8n.americana.edu.co  (HTTPS 443)   │
        │           └───┬─────────────────────────┬────────────────┘
        │               │                         │
        │       /vorael/*  (estáticos)     /vorael/api/*  (proxy_pass)
        │               │                         │
        │               ▼                         ▼
        │      /var/www/html/vorael/dist    127.0.0.1:3001
        │       SPA React + Vite            API Express (systemd)
        │                                          │
        │                                   ┌──────┴───────┐
        │                                   ▼              ▼
        │                              PostgreSQL     DigitalOcean
        │                          generated_images   Spaces (S3)
        │                                              bucket n8ns3
        │                                                   │
        └───────────────────────────────────────────────────┘
              las miniaturas se cargan directo desde Spaces
                    (s3_url, no pasan por Nginx)
```

Dos piezas propias, dos servicios externos:

| Pieza | Qué es | Puerto / Ruta |
|---|---|---|
| `apps/web` | SPA React 18 + Vite + Tailwind | estáticos bajo `/vorael/` |
| `apps/api` | API Express + TypeScript | `127.0.0.1:3001`, expuesto en `/vorael/api/` |
| PostgreSQL | tabla `generated_images` (metadatos) | `DB_PORT=9913` |
| DigitalOcean Spaces | los archivos de imagen | `sfo3.digitaloceanspaces.com`, bucket `n8ns3` |

Todo entra por el **mismo origen**, así que el navegador nunca hace una petición
cross-origin y CORS no interviene en producción.

---

## 2. A dónde se conecta

### 2.1 PostgreSQL — de dónde salen los datos

El API abre un pool `pg` (máx. 10 conexiones) en [db.ts](apps/api/src/db.ts) y
consulta **una sola tabla**: `generated_images`. VORAEL nunca escribe en ella.

Columnas que el código espera ([types.ts](apps/api/src/types.ts)):

| Columna | Tipo | Uso en la app |
|---|---|---|
| `id` | uuid / text | clave, ruta `/image/:id` |
| `s3_key` | text | clave del objeto en Spaces; la usa la descarga |
| `s3_url` | text | URL pública; es la que carga el `<img>` del grid |
| `original_prompt` | text | se muestra y se busca (ILIKE) |
| `enhanced_prompt` | text | se muestra y se busca (ILIKE) |
| `tags` | `text[]` | chips, `/tags`, `/tag/:tag`, puntaje de búsqueda |
| `style` | text | filtro y faceta |
| `subject` | text | título de la tarjeta; se busca (ILIKE) |
| `mood` | text | filtro y faceta |
| `color_palette` | `text[]` | se muestra en el detalle |
| `use_case` | text | filtro y faceta |
| `filename` | text | nombre sugerido al descargar |
| `created_at` | timestamp | orden por defecto (`DESC`) |

`tags` y `color_palette` deben ser **arrays de Postgres**, no strings: las
consultas usan operadores de array (`&&`, `UNNEST`, `cardinality`).

> `s3_url` tiene que ser `https://`. Si es `http://`, el navegador bloquea el
> contenido mixto en una página servida por HTTPS y el grid sale vacío.

### 2.2 DigitalOcean Spaces — de dónde salen los archivos

Se accede por dos caminos distintos, a propósito:

- **Ver (grid y detalle)** — el `<img>` apunta a `s3_url` directo. No pasa por
  Nginx ni por el API: menos carga en el servidor y cacheo del CDN de Spaces.
- **Descargar** — `GET /api/images/:id/download` sí pasa por el API: baja el
  objeto con `s3_key`, lo reconvierte con `sharp` al formato pedido (WebP
  lossless / PNG sin compresión / JPG al 100 %) y lo devuelve con
  `Content-Disposition: attachment`. Por eso las credenciales de Spaces solo las
  necesita el backend.

[s3.ts](apps/api/src/s3.ts) normaliza `S3_ENDPOINT`: si alguien lo configura con
el bucket como prefijo (`n8ns3.sfo3...`) lo recorta, porque el SDK ya añade el
bucket como subdominio y saldría `n8ns3.n8ns3.sfo3...`.

Hay un helper `presignDownload()` para URLs firmadas que **hoy no usa ninguna
ruta**; queda disponible si en algún momento se quiere delegar la descarga a
Spaces en vez de proxearla.

### 2.3 Quién llena la base

Fuera de este repositorio. El dominio (`n8n.americana.edu.co`) y el bucket
(`n8ns3`) apuntan a un flujo de **n8n** que genera las imágenes, las sube a
Spaces y escribe la fila en `generated_images`. VORAEL es solo el escaparate: si
el flujo se detiene, la galería sigue funcionando pero deja de crecer.

---

## 3. El API

Express 4 + TypeScript (CommonJS). Punto de entrada
[index.ts](apps/api/src/index.ts). Todas las rutas devuelven JSON y van montadas
bajo `/api`.

| Método y ruta | Qué devuelve |
|---|---|
| `GET /api/health` | `{ ok: true, ts }` — sonda de vida |
| `GET /api/images` | listado paginado. Query: `page`, `limit` (máx. 100, def. 24), `style`, `mood`, `use_case` |
| `GET /api/images/:id` | una imagen completa, o 404 |
| `GET /api/images/:id/download` | el archivo convertido. Query: `format=webp\|png\|jpg` (def. `webp`) |
| `GET /api/images/:id/related` | relacionadas por tags/estilo. Query: `limit` (máx. 24, def. 8) |
| `GET /api/search` | búsqueda con puntaje. Query: `q`, `page`, `limit` |
| `GET /api/tags` | tags únicos con conteo. Query: `limit` (máx. 500, def. 200) |
| `GET /api/tags/:tag/images` | imágenes con ese tag, paginado |
| `GET /api/filters` | facetas: `styles`, `moods`, `useCases`, cada una con conteo |
| `GET /api/stats` | total + top 10 estilos, top 10 moods, top 20 tags |

Forma de las respuestas paginadas:

```json
{ "items": [], "page": 1, "limit": 24, "total": 1234, "hasMore": true }
```

`/api/search` añade `q`; `/api/tags/:tag/images` añade `tag`.

### 3.1 Cómo puntúa la búsqueda

[search.ts](apps/api/src/routes/search.ts) no usa `tsvector`: parte la consulta
en términos y suma un puntaje por fila.

| Coincidencia | Puntos |
|---|---|
| cada tag que solapa (`tags && terms`) | 3 |
| `subject ILIKE %q%` | 2 |
| `original_prompt ILIKE %q%` | 1 |
| `enhanced_prompt ILIKE %q%` | 1 |

Ordena por `score DESC, created_at DESC`. Los ILIKE con comodín inicial no usan
índice: si la tabla crece mucho, aquí es donde conviene pasar a búsqueda de
texto completo o a un índice `pg_trgm`.

`/api/images/:id/related` puntúa parecido: tags que solapan + 1 si comparte
estilo, excluyendo la imagen de origen.

### 3.2 Notas de implementación

- **Errores** — cada ruta hace `next(err)` y un handler central responde 500 con
  `{ error }`. Una ruta sin match devuelve 404 con `{ error, path }`.
- **`trust proxy`** — activado, para que `req.ip` y `req.protocol` reflejen las
  cabeceras `X-Forwarded-*` que pone Nginx.
- **Config tolerante** — [config.ts](apps/api/src/config.ts) *avisa* pero no
  aborta si falta una variable. El proceso arranca y `/api/health` responde
  aunque Postgres esté mal configurado; el fallo aparece al pedir datos. Útil
  para diagnosticar, pero conviene mirar el log al arrancar.
- **`limit`/`offset` interpolados** — van directo al SQL, no como parámetros.
  Son seguros porque pasan por `Number()` + `Math.min/max` antes. Los valores de
  usuario (`style`, `mood`, `q`, `tag`, `id`) sí van parametrizados.

---

## 4. El front

React 18 + Vite 5 + TypeScript + Tailwind 3. Datos con TanStack Query,
animaciones con Framer Motion, iconos con lucide-react.

### 4.1 Rutas

Definidas en [App.tsx](apps/web/src/App.tsx), todas dentro de un `Layout` común
(header + footer):

| Ruta | Página | Qué hace |
|---|---|---|
| `/` | `Gallery` | grid con scroll infinito + panel de filtros; los filtros viven en la query string |
| `/search?q=…` | `Search` | resultados puntuados, scroll infinito |
| `/image/:id` | `ImageDetail` | imagen grande, prompts, paleta, tags, descarga con selector de formato, relacionadas |
| `/tags` | `Tags` | todos los tags como chips |
| `/tag/:tag` | `TagPage` | grid filtrado por un tag |
| `/stats` | `Stats` | totales y rankings |
| `*` | `NotFound` | 404 del cliente |

`BrowserRouter` arranca con `basename=/vorael` (desde `VITE_BASE_PATH`), así que
en el código los enlaces se escriben sin el prefijo (`/tags`, no
`/vorael/tags`).

### 4.2 Cómo se piden los datos

[services/api.ts](apps/web/src/services/api.ts) crea una instancia de axios cuyo
`baseURL` sale de `VITE_API_URL`, con timeout de 20 s y un interceptor que
loguea los fallos en consola. Encima van los hooks:

- [useImages.ts](apps/web/src/hooks/useImages.ts) — `useInfiniteQuery` para
  galería, búsqueda y tag; `useQuery` para detalle y relacionadas.
- [useFilters.ts](apps/web/src/hooks/useFilters.ts) — facetas, tags y stats, con
  `staleTime` de 5 min (cambian poco).
- [useInfiniteScroll.ts](apps/web/src/hooks/useInfiniteScroll.ts) — un
  `IntersectionObserver` con `rootMargin: 600px` que pide la página siguiente
  antes de llegar al final. El callback se lee por ref para no recrear el
  observer en cada render, que dispararía fetches de más.
- [useDebounce.ts](apps/web/src/hooks/useDebounce.ts) — 300 ms en el buscador,
  para no navegar en cada tecla.

Defaults de TanStack Query en [main.tsx](apps/web/src/main.tsx): `staleTime`
30 s, `gcTime` 5 min, sin refetch al enfocar la ventana, 1 reintento.

### 4.3 La sub-ruta `/vorael/` toca cuatro sitios

Es el detalle que más rompe si se cambia. `VITE_BASE_PATH` alimenta:

1. `vite.config.ts` → `base`, el prefijo de los assets compilados.
2. `main.tsx` → `basename` del `BrowserRouter`.
3. `deploy/nginx-vorael.conf` → los bloques `location`.
4. `index.html` → el `href` del favicon, que está **escrito a mano** como
   `/vorael/favicon.svg`. Si cambia la sub-ruta, hay que editarlo aparte.

[vite.config.ts](apps/web/vite.config.ts) incluye además un plugin propio
(`redirectBasePath`) que redirige `/vorael` → `/vorael/` en dev y en
`vite preview`, porque Vite sirve el `index.html` solo en la forma con barra
final. En producción ese mismo trabajo lo hace el
`location = /vorael { return 301 /vorael/; }` de Nginx.

### 4.4 Diseño

Tema oscuro fijo (`color-scheme: dark`), definido en
[tailwind.config.js](apps/web/tailwind.config.js): paleta `canvas` (fondos),
`accent` (violeta `#7c5cff`), `ink` (texto), sombras `glow`/`card` y un fondo de
degradados radiales. Tipografías desde Google Fonts: Syne (display), DM Sans
(texto), JetBrains Mono (prompts). Las clases reutilizables (`.chip`,
`.btn-primary`, `.btn-ghost`, `.skeleton`, `.glass`) están en
[index.css](apps/web/src/index.css).

---

## 5. Desarrollo local

Requiere **Node ≥ 20** y **pnpm 11**. Es un monorepo pnpm (`apps/*`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm dev
```

Rellenar `apps/api/.env` con las credenciales reales de Postgres y Spaces antes
de arrancar. `pnpm dev` levanta el API en `:3001` y el front en `:5173`.

Abrir **http://localhost:5173/vorael/** — con la sub-ruta, que es la `base` de
Vite.

| Comando | Qué hace |
|---|---|
| `pnpm dev` | ambas apps en paralelo |
| `pnpm dev:api` / `pnpm dev:web` | una sola |
| `pnpm build` | compila las dos |
| `pnpm release` | empaqueta `release/*.tar.gz` para subir al servidor |

En dev, `VITE_API_URL` se deja **vacío**: axios pide rutas relativas (`/api/...`)
y el proxy de Vite las manda a `localhost:3001`. Al ser mismo origen no hay
CORS, y da igual en qué puerto acabe el dev server.

---

## 6. Variables de entorno

Nunca hay un `.env` real en este repositorio. Los `.env.example` son la
plantilla; los valores reales se rellenan a mano en cada máquina y en el
servidor.

### `apps/api/.env` — [plantilla](apps/api/.env.example) · [producción](apps/api/.env.production.example)

| Variable | Def. | Para qué |
|---|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | — / `5432` | conexión a Postgres |
| `DB_SSL` | `false` | `true` fuerza TLS con `rejectUnauthorized: false` |
| `S3_ENDPOINT` | — | host de **región** de Spaces, sin el bucket delante |
| `S3_BUCKET` `S3_ACCESS_KEY` `S3_SECRET_KEY` | — | bucket y credenciales |
| `S3_REGION` | `us-east-1` | en producción, `sfo3` |
| `PORT` | `3001` | puerto de Express |
| `HOST` | `127.0.0.1` | **dejar en loopback** detrás de Nginx |
| `CORS_ORIGIN` | `*` | lista separada por comas; en producción el dominio |

### `apps/web/.env` — [plantilla](apps/web/.env.example)

| Variable | Dev | Producción |
|---|---|---|
| `VITE_API_URL` | vacío (usa el proxy de Vite) | `/vorael` |
| `VITE_BASE_PATH` | `/vorael/` | `/vorael/` |
| `VITE_DEV_API_PROXY` | `http://localhost:3001` | — |

`apps/web/.env.production` **sí está en el repositorio**: no tiene secretos,
solo la ruta relativa que necesita el build de producción.

---

## 7. Estructura del repositorio

```
vorael/
├── ARQUITECTURA.md          este documento
├── DEPLOY.md                despliegue paso a paso
├── package.json             scripts del monorepo
├── pnpm-workspace.yaml      workspaces: apps/*
├── apps/
│   ├── api/                 Express + Postgres + S3
│   │   └── src/
│   │       ├── index.ts     app, middleware, montaje de rutas
│   │       ├── config.ts    lectura de .env
│   │       ├── db.ts        pool de pg
│   │       ├── s3.ts        cliente de Spaces + presign
│   │       ├── types.ts     forma de la fila
│   │       └── routes/      images · search · tags · filters · stats
│   └── web/                 SPA React
│       └── src/
│           ├── main.tsx     providers y BrowserRouter
│           ├── App.tsx      rutas
│           ├── pages/       una por ruta
│           ├── components/  layout · features · ui
│           ├── hooks/       datos, scroll infinito, debounce
│           ├── services/    cliente axios
│           └── types/       tipos compartidos con el API
└── deploy/
    ├── nginx-vorael.conf    bloques location para pegar en el server
    ├── vorael-api.service   unidad systemd
    └── build-release.sh     empaquetado de release
```

---

## 8. Cosas a tener en cuenta

- **La descarga usa `fetch` sin prefijo.** En
  [ImageDetail.tsx:46](apps/web/src/pages/ImageDetail.tsx) la descarga llama a
  `fetch('/api/images/...')` en crudo, saltándose el `baseURL` de axios. En dev
  funciona por el proxy de Vite; en producción pide `/api/images/...` en la raíz
  del dominio en vez de `/vorael/api/...`, ruta que Nginx no proxea. Debería
  usar el mismo `baseURL` que el resto del cliente.
- **`lib/utils.ts` tiene un `useDebounce` que no hace nada** (devuelve el valor
  tal cual). El real está en `hooks/useDebounce.ts`. No importar el de `lib`.
- **`sharp` trae binarios nativos por plataforma.** No se puede copiar el
  `node_modules` de Windows al servidor Linux; hay que instalar allí.
- **Cambiar la sub-ruta** implica los cuatro sitios de §4.3, no solo el `.env`.
- **El puerto 3001 no debe abrirse en el firewall.** `HOST=127.0.0.1` y todo
  entra por Nginx.
