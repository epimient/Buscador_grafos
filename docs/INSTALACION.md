# Instalación — replicar VORAEL en otra computadora

Guía para levantar VORAEL completo desde cero en otra máquina, con datos
ficticios o conectado a la **producción real**.

> **¿Hace falta tener un modelo de IA corriendo?** **No.** Es 100% opcional.
> VORAEL funciona sin Ollama ni ningún modelo: la búsqueda por defecto es
> **léxica** (por palabras) y todo lo demás (grid, filtros, tags, descargas)
> anda igual. El modelo (`bge-m3` en Ollama) solo se usa para la búsqueda
> **semántica/híbrida**; si no está, la app **degrada sola a léxico** sin
> romperse. Detalle en la [§5](#5-búsqueda-semántica-ollama--opcional).

---

## 0. Cómo está armado (para ubicarte)

| Pieza | Qué es | ¿Obligatoria? |
|---|---|---|
| `apps/web` | SPA React (Vite) | sí |
| `apps/api` | API Express + grafo en memoria | sí |
| **PostgreSQL** | tabla `generated_images` (metadatos) | sí, para datos reales (o `DB_MOCK=true`) |
| **DigitalOcean Spaces** | bucket S3 `n8ns3` (las imágenes) | sí, para ver imágenes reales |
| **Ollama + `bge-m3`** | modelo de embeddings | **no** (solo búsqueda semántica) |
| **exiftool** | incrustar metadatos en descargas | **no** |

El API es **de solo lectura**: nunca escribe en la base. Quien la llena es un
flujo **n8n** externo a este repositorio.

---

## 1. Requisitos

- **Node ≥ 20** (probado con 20/22/24).
- **pnpm 11.3.0** (el repo lo fija; `corepack enable` lo instala solo).
- **Git**.
- **Docker + Docker Compose** — para Postgres local y el stack completo.
  (Opcional si vas a apuntar a una base que ya existe.)
- *(Opcional)* **Ollama** — solo para búsqueda semántica/híbrida.
- *(Opcional)* **exiftool** — solo para incrustar metadatos en descargas.

---

## 2. Clonar e instalar dependencias

```bash
git clone <URL-del-repo> vorael
cd vorael
corepack enable        # deja disponible pnpm 11.3.0 (lo pide packageManager)
pnpm install
```

---

## 3. Elegí cómo vas a levantar los datos

Cuatro caminos, de menos a más realista. Todos arrancan igual salvo las
variables de entorno.

| Camino | Qué necesita | Sirve para |
|---|---|---|
| **A. Todo mock** | nada (0 servicios, 0 IA) | probar la app al toque |
| **B. Stack Docker** | Docker | demo completa con datos de prueba |
| **C. Réplica de producción** | túnel SSH + Docker | probar contra los 53k registros reales, offline |
| **D. Directo a producción** | credenciales reales | operar/dev contra la base real |

---

## 4. Comandos por camino

### A. Sin nada externo (modo mock) — el más rápido

Usa `mockData.ts` (30 imágenes) y `test-images/`; **no toca Postgres, S3 ni
Ollama**. Es la forma de ver la app funcionando en 1 minuto.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Editá `apps/api/.env` y agregá esta línea (sin ella el API intenta conectarse a
una Postgres real, porque `DB_MOCK` por defecto es `false`):

```dotenv
DB_MOCK=true
```

Luego:

```bash
pnpm dev        # API en :3001 + web en :5173
```

Abrí **http://localhost:5173/vorael/** (ojo con la barra final: es la `base` de
Vite y el `basename` del router).

### B. Stack completo en Docker (Postgres + API + web)

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Rellená `apps/api/.env`:

```dotenv
DB_MOCK=false
DB_HOST=localhost
DB_PORT=5433
DB_NAME=generated_images
DB_USER=vorael
DB_PASSWORD=vorael123
S3_ENDPOINT=https://sfo3.digitaloceanspaces.com
S3_BUCKET=n8ns3
S3_ACCESS_KEY=<tu-access-key>
S3_SECRET_KEY=<tu-secret-key>
S3_REGION=sfo3
CORS_ORIGIN=http://localhost:5173
SEARCH_ENGINE=graph
```

Levantá todo:

```bash
sudo docker compose up -d --build
sudo docker compose logs -f api     # ver el boot del grafo (~17s)
```

- Web: **http://localhost:5173/vorael/**
- API: **http://127.0.0.1:3001/api/health**

Cargar datos de prueba (30 imágenes):

```bash
sudo docker compose up -d postgres
pnpm --filter api seed:db
```

O generar 1000 filas sintéticas (`gen-*`):

```bash
pnpm seed:generate           # DB_MOCK=false
pnpm seed:generate:clear     # borra gen-* y re-siembra
```

> **Nota de red:** `api` y `web` usan `network_mode: host` a propósito, para
> alcanzar el Ollama del host en `127.0.0.1:11434`. Con red bridge normal el
> contenedor no vería Ollama y la búsqueda semántica degradaría a léxica en
> silencio.

### C. Réplica de producción local (los 53k reales, offline)

Necesitás el túnel SSH a la base de producción. Primero abrí el túnel en otra
terminal:

```bash
ssh -i ~/.ssh/<clave-tunel> -N -L 9913:localhost:9913 <usuario>@<host-produccion>
```

(La clave del túnel **no** está en el repo; es por máquina.)

Con el túnel abierto y el Postgres local arriba (`sudo docker compose up -d postgres`),
copiá toda la tabla `generated_images` a tu base local:

```bash
SOURCE_DB_HOST=localhost SOURCE_DB_PORT=9913 SOURCE_DB_NAME=generated_images \
SOURCE_DB_USER=<usuario-prod> SOURCE_DB_PASSWORD='<pass-prod>' SOURCE_DB_SSL=false \
DB_HOST=localhost DB_PORT=5433 DB_NAME=generated_images \
DB_USER=vorael DB_PASSWORD=vorael123 \
pnpm --filter api snapshot:prod
```

Queda una réplica exacta (~53k filas) en el Postgres local. Después arrancá con
`pnpm dev` (opción B) apuntando a `DB_PORT=5433` y probá el grafo sin depender
del túnel.

### D. Directo a producción (sin réplica)

Es lo mismo que B/C pero con `apps/api/.env` apuntando a la base real (por el
túnel en `9913`, o al host real si lo tenés) y las credenciales reales de
Spaces. Usá `apps/api/.env.production.example` como plantilla.

> El API es **solo lectura**, así que no puede corromper datos de producción.

---

## 5. Búsqueda semántica (Ollama) — opcional

Sin esto, `SEARCH_MODE` queda en `lexical` (default) y todo funciona. Si querés
semántica/híbrida:

**1. Instalar Ollama** (ver el sitio oficial) y descargar el modelo:

```bash
ollama pull bge-m3        # ~1.2 GB, 1024 dimensiones
```

**2. Construir el índice de embeddings** (lee el texto de `generated_images` y
escribe la tabla `image_embeddings`; es reanudable):

```bash
DB_HOST=localhost DB_PORT=5433 DB_NAME=generated_images DB_USER=vorael \
DB_PASSWORD=vorael123 EMBED_MODEL=bge-m3 EMBED_SERVER=http://127.0.0.1:11434 \
pnpm --filter api embeddings:build
```

**3. Activar el modo** en `apps/api/.env`:

```dotenv
SEARCH_MODE=hybrid        # lexical | semantic | hybrid
EMBED_MODEL=bge-m3
EMBED_SERVER=http://127.0.0.1:11434
EMBED_DIM=1024            # debe coincidir con el modelo
SEMANTIC_MIN_SCORE=0.65
```

> Alternativa: `nomic-embed-text` (768 dims) → ajustar `EMBED_MODEL` y
> `EMBED_DIM=768`.
>
> Si Ollama está caído o falta la tabla `image_embeddings`, la app **no se
> rompe**: cae a léxico y sigue andando.

---

## 6. Conectar a producción real — resumen de variables

Todo vive en `apps/api/.env` (nunca se sube al repo). Plantilla:
`apps/api/.env.production.example`.

| Variable | Qué es | Valor de producción (referencia) |
|---|---|---|
| `DB_HOST` / `DB_PORT` | Postgres de datos | `localhost` / `9913` (por túnel SSH) |
| `DB_NAME` | base | `generated_images` |
| `DB_USER` / `DB_PASSWORD` | credenciales | *las de producción* |
| `DB_SSL` | TLS | `false` (túnel) o `true` según host |
| `S3_ENDPOINT` / `S3_REGION` | Spaces | `https://sfo3.digitaloceanspaces.com` / `sfo3` |
| `S3_BUCKET` | bucket | `n8ns3` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | credenciales Spaces | *las de producción* |
| `HOST` | bind del API | `127.0.0.1` (no exponer a Internet) |
| `CORS_ORIGIN` | origen permitido | `https://n8n.americana.edu.co` |

Y en `apps/web`:

| Variable | Dev | Producción |
|---|---|---|
| `VITE_API_URL` | vacío (usa proxy de Vite) | `/vorael` |
| `VITE_BASE_PATH` | `/vorael/` | `/vorael/` |

> **Secretos:** ningún `.env` real está en el repo. Los `.env.example` tienen
> los valores sensibles en blanco. `apps/api/.env` está en `.gitignore` y se
> rellena a mano en cada máquina/servidor.

---

## 7. Tests

No necesitan base, S3, Ollama ni exiftool:

```bash
pnpm test            # 152 tests (Vitest)
pnpm test:watch
pnpm test:coverage
```

---

## 8. La sub-ruta `/vorael/`

Está **hardcodeada en 4 lugares**: `apps/web/vite.config.ts` (`base`),
`apps/web/src/main.tsx` (`BrowserRouter basename`),
`deploy/nginx-vorael.conf` (`location`) e `index.html` (favicon). Si cambiás
uno, cambiá los otros tres o la app rompe.

---

## 9. Desplegar en un servidor

Ver **[DEPLOY.md](../DEPLOY.md)**: compilar, estructura de directorios, Nginx,
servicio systemd, exiftool y verificación. Para una demo portátil alcanza con el
stack Docker de la §4-B.

---

## 10. Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `EADDRINUSE :3001` / `:5173` | ya hay algo en ese puerto: el stack Docker y `pnpm dev` **no conviven**. Bajá uno. |
| El API loguea `[config] Missing env: DB_HOST…` | no estás en mock: poné `DB_MOCK=true` o rellená las variables. |
| El híbrido/semántico no devuelve nada o "no encuentra" | Ollama no corre, o falta `image_embeddings` → construí el índice (§5). Degrada a léxico. |
| Semántico funciona en el host pero no en Docker | el contenedor no ve `127.0.0.1:11434`. Es la razón de `network_mode: host`. |
| Imágenes no cargan | el grid usa `s3_url` directo de Spaces; revisá las claves S3 y que la URL sea `https`. |
| `/vorael` (sin barra) da 404 | entrá a `/vorael/` (con barra). |
