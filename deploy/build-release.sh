#!/usr/bin/env bash
# Empaqueta un release listo para subir al servidor.
#
#   bash deploy/build-release.sh
#
# Genera:
#   release/vorael-web.tar.gz   -> se descomprime en /var/www/html/vorael/dist/
#   release/vorael-api.tar.gz   -> se descomprime en /var/www/html/vorael/api/
#
# El .env del API NO se incluye a propósito: se crea una sola vez en el servidor.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/release"
STAGE="$OUT/.stage"

cd "$ROOT"

echo "==> Instalando dependencias"
pnpm install --frozen-lockfile

echo "==> Build web (base=/vorael/, mode=production)"
pnpm --filter web build

echo "==> Build api (tsc)"
pnpm --filter api build

rm -rf "$OUT"
mkdir -p "$STAGE/api"

echo "==> Empaquetando web"
tar -czf "$OUT/vorael-web.tar.gz" -C "$ROOT/apps/web/dist" .

echo "==> Empaquetando api"
# Solo el JS compilado y el manifiesto: las dependencias se instalan en el
# servidor porque `sharp` trae binarios nativos por plataforma.
cp -r "$ROOT/apps/api/dist" "$STAGE/api/dist"
cp "$ROOT/apps/api/package.json" "$STAGE/api/package.json"
cp "$ROOT/apps/api/.env.production.example" "$STAGE/api/.env.example"
tar -czf "$OUT/vorael-api.tar.gz" -C "$STAGE/api" .

rm -rf "$STAGE"

echo
echo "Listo:"
ls -lh "$OUT"
