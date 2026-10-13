# VORAEL WEB — SPA React+Vite servida por Nginx bajo /vorael/.
# Contexto de build = RAÍZ del monorepo (pnpm workspace).
#
#   docker build -f apps/web/Dockerfile .
#
# .env.production se incluye a propósito: define VITE_API_URL=/vorael, que el
# bundle usa para pedir /vorael/api/... (proxeado por deploy/nginx-docker.conf).
FROM node:22-slim AS builder

RUN npm install -g pnpm@11.3.0
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web...

COPY apps/web apps/web
RUN pnpm --filter web build

FROM nginx:1.27-alpine AS runner

COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html/vorael/

EXPOSE 5173
