# VORAEL

Banco de imágenes generadas por IA — Corporación Universitaria Americana.

Catálogo web de solo lectura sobre un archivo de imágenes generadas por IA: grid
con scroll infinito, búsqueda por prompt/sujeto/tags, filtros por estilo, mood y
caso de uso, y descarga en WebP, PNG o JPG.

En producción: **https://n8n.americana.edu.co/vorael/**

## Cómo está armado

Monorepo pnpm con dos aplicaciones:

| | Stack | Rol |
|---|---|---|
| [`apps/web`](apps/web) | React 18 · Vite 5 · TypeScript · Tailwind · TanStack Query | SPA servida como estáticos bajo `/vorael/` |
| [`apps/api`](apps/api) | Express 4 · TypeScript · `pg` · AWS SDK v3 · `sharp` | API REST en `127.0.0.1:3001`, expuesta en `/vorael/api/` |

Se conecta a dos servicios externos:

- **PostgreSQL** — tabla `generated_images`, de donde salen todos los metadatos.
  VORAEL solo lee.
- **DigitalOcean Spaces** (S3, bucket `n8ns3`) — los archivos de imagen. El grid
  los carga directo desde Spaces; las descargas pasan por el API para
  reconvertirlas con `sharp`.

Quien llena la base es un flujo de **n8n** externo a este repositorio.

## Arrancar en local

Requiere Node ≥ 20 y pnpm 11.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Rellenar `apps/api/.env` con las credenciales de Postgres y Spaces, y arrancar:

```bash
pnpm dev
```

Abrir **http://localhost:5173/vorael/** — con la sub-ruta incluida, que es la
`base` de Vite.

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | API (`:3001`) y web (`:5173`) en paralelo |
| `pnpm dev:api` · `pnpm dev:web` | una sola app |
| `pnpm build` | compila ambas |
| `pnpm build:api` · `pnpm build:web` | compila una |
| `pnpm release` | empaqueta `release/vorael-{web,api}.tar.gz` |

## Documentación

- **[ARQUITECTURA.md](ARQUITECTURA.md)** — cómo funciona, a dónde se conecta,
  las rutas del API, el esquema de la tabla, las variables de entorno y los
  detalles de la sub-ruta `/vorael/`.
- **[DEPLOY.md](DEPLOY.md)** — despliegue paso a paso en el servidor: Nginx,
  systemd, estructura de directorios y verificación.

## Secretos

Ningún `.env` real está en el repositorio. Los `.env.example` son plantillas con
los valores sensibles en blanco; las credenciales reales se rellenan a mano en
cada máquina y en el servidor.
