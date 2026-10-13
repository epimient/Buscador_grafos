# VORAEL API — Express (CommonJS) + TypeScript.
# Contexto de build = RAÍZ del monorepo (pnpm workspace).
#
#   docker build -f apps/api/Dockerfile .
#
# El .env NO viaja en la imagen: docker-compose lo inyecta con env_file.
FROM node:22-slim AS builder

RUN npm install -g pnpm@11.3.0
WORKDIR /repo

# Manifiestos primero → capa de installs cacheada ante cambios de src.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter api...

COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
RUN pnpm --filter api build

# Runner: solo deps de producción + dist compilado.
FROM node:22-slim AS runner

ENV NODE_ENV=production
RUN npm install -g pnpm@11.3.0
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter api... --prod

COPY --from=builder /repo/apps/api/dist apps/api/dist

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
