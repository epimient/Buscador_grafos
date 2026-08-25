# Despliegue — https://n8n.americana.edu.co/vorael/

VORAEL se sirve como sub-ruta de un dominio que ya existe. Dos piezas:

| Pieza | Qué es | Dónde vive | Cómo se sirve |
|---|---|---|---|
| Web | SPA React compilada con Vite | `/var/www/html/vorael/dist/` | Nginx, archivos estáticos |
| API | Express + Postgres + S3 | `/var/www/html/vorael/api/` | Nginx → `proxy_pass` a `127.0.0.1:3001` |

Todo el tráfico entra por el mismo origen (`n8n.americana.edu.co`), así que el
navegador nunca hace una petición cross-origin y no hay CORS de por medio.

---

## 1. Compilar (en tu máquina)

```bash
pnpm build:web     # -> apps/web/dist
pnpm build:api     # -> apps/api/dist
```

El build de web usa `apps/web/.env.production`, que fija `base = /vorael/`: los
assets quedan referenciados como `/vorael/assets/...` y el router de React
arranca con `basename=/vorael`.

Alternativa: `pnpm release` empaqueta ambos en `release/*.tar.gz` para subir por
SCP en vez de arrastrar carpetas.

## 2. Estructura en el servidor

```
/var/www/html/vorael/
├── dist/          <- contenido de apps/web/dist (a esto apunta el alias)
│   ├── index.html
│   ├── favicon.svg
│   └── assets/
└── api/           <- hermana de dist/, NUNCA dentro
    ├── dist/      <- contenido de apps/api/dist
    ├── package.json
    └── .env
```

`api/` va fuera de `dist/` a propósito: Nginx sirve archivos desde `dist/`, así
que cualquier cosa ahí adentro es descargable por HTTP — incluido el `.env` con
las credenciales de Postgres y Spaces.

Qué copiar a cada sitio:

| Origen | Destino |
|---|---|
| contenido de `apps/web/dist/` | `/var/www/html/vorael/dist/` |
| contenido de `apps/api/dist/` | `/var/www/html/vorael/api/dist/` |
| `apps/api/package.json` | `/var/www/html/vorael/api/` |
| `apps/api/.env.production.example` → renombrar a `.env` | `/var/www/html/vorael/api/` |

No copiar `node_modules`: `sharp` trae binarios nativos por plataforma y los de
Windows no arrancan en Linux.

Al reemplazar el front, borrar antes `dist/*`: los assets llevan hash en el
nombre y los viejos solo acumulan basura.

```bash
sudo chown -R www-data:www-data /var/www/html/vorael
```

## 3. Configurar el API

Rellenar `/var/www/html/vorael/api/.env` con las credenciales reales de Postgres
y Spaces. Dejar `HOST=127.0.0.1` para que el puerto 3001 no quede expuesto.

Instalar dependencias **en el servidor** — `sharp` compila binarios nativos por
plataforma, así que no sirve copiar el `node_modules` de Windows:

```bash
sudo -u www-data npm install --omit=dev
```

Arrancar como servicio:

```bash
sudo cp deploy/vorael-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vorael-api
sudo systemctl status vorael-api
```

Comprobación local (antes de tocar Nginx):

```bash
curl -s http://127.0.0.1:3001/api/health
# {"ok":true,"ts":"..."}
```

## 4. Nginx

Pegar los bloques de [`deploy/nginx-vorael.conf`](deploy/nginx-vorael.conf)
dentro del `server { ... }` de `n8n.americana.edu.co`, y recargar:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Por qué no basta el bloque original

El bloque de partida era:

```nginx
location ^~ /vorael/ {
    alias /var/www/html/vorael/dist/;
    index index.html;
    error_page 404 = /vorael/index.html;
}
```

Sirve el SPA y el fallback de rutas correctamente, pero le faltan tres cosas:

1. **Se traga el API.** `^~ /vorael/` también matchea `/vorael/api/images`, que
   no existe en disco → 404 → `error_page` devuelve `index.html`. El front
   recibiría HTML donde espera JSON. Por eso se añade `location ^~ /vorael/api/`,
   que gana por ser el prefijo más largo.
2. **`/vorael` sin barra da 404.** Un prefijo `^~ /vorael/` no matchea `/vorael`.
   Se añade `location = /vorael { return 301 /vorael/; }`.
3. **Cache.** Sin cabeceras, el navegador puede reutilizar un `index.html` viejo
   que apunta a assets con hash ya borrados → pantalla en blanco tras redeploy.
   Se separan `assets/` (inmutable, 1 año) e `index.html` (`no-store`).

## 5. Verificar

```bash
curl -I  https://n8n.americana.edu.co/vorael          # 301 -> /vorael/
curl -sI https://n8n.americana.edu.co/vorael/         # 200 text/html
curl -sI https://n8n.americana.edu.co/vorael/assets/  # 404/403 (no listing)
curl -s  https://n8n.americana.edu.co/vorael/api/health
curl -s  "https://n8n.americana.edu.co/vorael/api/images?limit=1" | head -c 200
```

En el navegador, además:

- `https://n8n.americana.edu.co/vorael/search?q=azul` recarga sin 404 (fallback SPA).
- `https://n8n.americana.edu.co/vorael/image/<id>` recarga sin 404.
- El botón de descarga entrega el archivo (ruta `/api/images/:id/download`).

---

## Redeploy posterior

Solo cambió el front: `pnpm build:web`, vaciar `/var/www/html/vorael/dist/` y
copiar de nuevo el contenido de `apps/web/dist/`. Nginx no necesita recarga.

Cambió el API: `pnpm build:api`, reemplazar `/var/www/html/vorael/api/dist/` y
`sudo systemctl restart vorael-api`. Solo hace falta repetir
`npm install --omit=dev` si cambiaron las dependencias en `package.json`.

## Notas

- **Imágenes**: el grid carga `s3_url` directo desde DigitalOcean Spaces, no
  pasa por Nginx. Ese campo debe ser `https://` o el navegador bloqueará el
  contenido mixto en una página servida por HTTPS.
- **Puerto 3001**: el API escucha solo en `127.0.0.1` (`HOST` en `.env`). No
  hace falta abrirlo en el firewall.
- **Postgres**: `DB_HOST=localhost` con `DB_PORT=9913` asume que la base corre
  en el mismo servidor. Si no, apuntar al host real y revisar `DB_SSL`.
- **Credenciales**: `apps/api/.env` (el local) tiene claves reales de Spaces y
  Postgres. No incluirlo en el paquete ni en ningún repositorio; el release
  script solo copia `.env.production.example`.
