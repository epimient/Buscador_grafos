# VORAEL — Guía completa para la reunión

> **Banco de imágenes generadas por IA**
> Corporación Universitaria Americana
> https://n8n.americana.edu.co/vorael/

---

## ¿Qué es VORAEL?

VORAEL es un **catálogo de imágenes generadas por inteligencia artificial** para la Corporación Universitaria Americana. Piensen en él como un **Pinterest interno**: las imágenes las genera un proceso automático (n8n), las guarda en la nube, y VORAEL las muestra en una galería bonita donde se pueden buscar, filtrar y descargar.

**Lo que VORAEL NO hace:**
- No genera imágenes (eso lo hace n8n)
- No sube imágenes (eso también lo hace n8n)
- No edita imágenes

**Lo que VORAEL SÍ hace:**
- Muestra las imágenes en una galería con filtros
- Permite buscar por palabras clave
- Muestra relaciones entre imágenes (qué tags tienen en común)
- Descarga las imágenes en diferentes formatos
- Incrusta metadatos en cada imagen descargada
- Muestra un grafo visual de conexiones (como un mapa de relaciones)

---

## El equipo técnico (stack tecnológico)

Piensen en el sistema como una casa con varias habitaciones:

### 🏠 La casa completa

```
┌─────────────────────────────────────────────────────────────┐
│                    USUARIOS (navegadores)                    │
│                         │                                    │
│                    ┌────▼────┐                               │
│                    │  Nginx  │  ← El portero (recibe todas   │
│                    │ (HTTPS) │    las peticiones)            │
│                    └────┬────┘                               │
│                    ┌────┴────────────────┐                   │
│                    │                     │                   │
│              ┌─────▼─────┐        ┌──────▼──────┐           │
│              │  Galería  │        │   API       │           │
│              │  (React)  │        │  (Express)  │           │
│              │  ★ Visual │        │  ★ Lógica   │           │
│              └───────────┘        └──────┬──────┘           │
│                                          │                   │
│                                   ┌──────┴──────┐           │
│                                   │             │           │
│                              ┌────▼───┐   ┌─────▼────┐      │
│                              │PostgreSQL│  │ DigitalOcean│    │
│                              │(datos)   │  │ Spaces (S3)│    │
│                              └─────────┘  └──────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 🧩 Cada pieza explicada

| Pieza | Qué es en palabras simples | Ejemplo cotidiano |
|---|---|---|
| **Nginx** | El portero de la edificio. Recibe todas las peticiones de internet y las redirige al lugar correcto. | Como la recepcionista que dice "su cita es en el piso 3" |
| **React (SPA)** | La interfaz visual que ve el usuario. Es una "Single Page Application": todo se carga una vez y luego solo cambia el contenido. | Como Gmail: cargas la página y todo se mueve sin recargar |
| **Express (API)** | El cerebro del sistema. Recibe peticiones, consulta datos, y devuelve respuestas en JSON. | Como un mesero: toma tu pedido, va a la cocina, y te trae la comida |
| **PostgreSQL** | La base de datos. Guarda toda la información de las imágenes en tablas organizadas. | Como una hoja de Excel gigante con columnas: nombre, tags, estilo, etc. |
| **DigitalOcean Spaces** | Almacenamiento en la nube (como Google Drive pero para programadores). Aquí viven los archivos de imagen. | Como un Dropbox pero para el sistema |
| **Sharp** | Una librería que convierte imágenes. Convierte PNG → WebP, redimensiona, optimiza. | Como Photoshop pero automático y rápido |
| **ExifTool** | Un programa que lee y escribe metadatos en imágenes. Los metadatos son "notas pegadas" al archivo. | Como escribir en la espalda de una foto: "tomada en Paris, 2024" |
| **Graphology** | Una librería para manejar grafos (nodos conectados con líneas). Usa para buscar relaciones. | Como un mapa del metro: estaciones (nodos) conectadas por líneas (aristas) |
| **Sigma.js** | Una librería para dibujar grafos en pantalla con gráficos 3D rápidos (WebGL). | Como Google Maps pero para mostrar relaciones entre cosas |
| **TanStack Query** | Maneja cómo el frontend pide datos al backend y los.cachea. | Como un bibliotecario que recuerda los últimos libros que pediste |

---

## Flujo de datos: ¿Cómo funciona todo?

### Flujo 1: Llega una imagen nueva

```
1. n8n (externo) genera una imagen con IA
         │
         ▼
2. n8n sube la imagen a DigitalOcean Spaces (S3)
         │
         ▼
3. n8n escribe los datos en PostgreSQL:
   - id: "img-001"
   - s3_key: "images/img-001.webp"
   - tags: ["cat", "sunset", "nature"]
   - style: "Photorealistic"
   - mood: "Calm"
   - subject: "Gato al atardecer"
   - enhanced_prompt: "Un gato naranja dormido en un tejado al atardecer..."
         │
         ▼
4. VORAEL detecta el cambio (cada 60 segundos)
         │
         ▼
5. Actualiza su grafo en memoria con la nueva imagen
         │
         ▼
6. El usuario ya puede verla, buscarla, y descargarla
```

### Flujo 2: El usuario busca "gato"

```
1. Usuario escribe "gato" en el buscador
         │
         ▼
2. Frontend envía: GET /api/search?q=gato
         │
         ▼
3. API busca en el grafo en memoria:
   - ¿Qué imágenes tienen el tag "cat"?
   - ¿Qué imágenes tienen "gato" en el subject?
   - ¿Qué imágenes tienen "gato" en los prompts?
         │
         ▼
4. Calcula un puntaje por relevancia:
   - Tag "cat" coincide: +3 puntos
   - Subject contiene "gato": +2 puntos
   - Prompt contiene "gato": +1 punto
         │
         ▼
5. Devuelve las imágenes ordenadas por puntaje
         │
         ▼
6. Frontend muestra los resultados
```

### Flujo 3: El usuario descarga una imagen

```
1. Usuario hace click en "Descargar como WebP"
         │
         ▼
2. Frontend envía: GET /api/images/img-001/download?format=webp
         │
         ▼
3. API hace:
   a. Busca la imagen en PostgreSQL (obtiene s3_key)
   b. Baja el archivo de DigitalOcean Spaces
   c. Convierte con Sharp a WebP lossless
   d. Incrusta metadatos con ExifTool:
      - EXIF:Artist = "Corporación Universitaria Americana - VORAEL"
      - EXIF:ImageDescription = "Un gato naranja dormido..."
      - IPTC:Keywords = "cat, sunset, nature"
      - XMP:Subject = "Gato al atardecer"
      - XMP-vorael:id = "img-001"
      - XMP-vorael:style = "Photorealistic"
      - XMP-vorael:mood = "Calm"
      - XMP-vorael:palette = "#FFD700, #FF6B35"
         │
         ▼
4. Devuelve el archivo modificado al navegador
         │
         ▼
5. Navegador descarga el archivo con metadatos incluidos
```

### Flujo 4: El grafo visual (la red de conexiones)

```
1. Usuario abre /vorael/graph
         │
         ▼
2. Frontend pide: GET /api/graph?limit=200
         │
         ▼
3. API serializa el grafo en memoria:
   - 76 nodos (imágenes, tags, estilos, moods, colores)
   - 175 aristas (conexiones entre ellos)
         │
         ▼
4. Frontend recibe { nodes: [...], edges: [...] }
         │
         ▼
5. Graphology crea el grafo en memoria del navegador
         │
         ▼
6. Se aplica un layout force-directed (50 iteraciones):
   - Los nodos se repelen entre sí (como imanes)
   - Los nodos conectados se atraen (como resortes)
   - Todo se centra en medio
         │
         ▼
7. Sigma.js dibuja todo con WebGL (gráfico 3D rápido)
         │
         ▼
8. El usuario ve la red de conexiones
```

---

## El sistema de metadatos incrustados

### ¿Qué son los metadatos?

Los metadatos son **información oculta que viaja dentro del archivo de imagen**. No se ve en la foto, pero cualquier programa puede leerla.

**Analogía:** Es como escribir en la espalda de una fotografía impresa:
- "Tomada en Paris, 2024"
- "Fotógrafo: Juan Pérez"
- "Evento: Boda de María"

En las imágenes digitales, esto se guarda en cabeceras especiales (EXIF, IPTC, XMP).

### ¿Por qué incrustar metadatos?

Cuando un usuario descarga una imagen de VORAEL, esa imagen lleva todos sus datos consigo. Si la comparte por WhatsApp, la sube a Instagram, o la guarda en su computadora, **la información no se pierde**.

### Los tres tipos de metadatos que usamos

| Tipo | Qué guarda | Ejemplo | ¿Quién lo lee? |
|---|---|---|---|
| **EXIF** | Datos técnicos y descripción | Artista, descripción, fecha | Cualquier programa de fotos |
| **IPTC** | Palabras clave y categoría | Tags: "cat, sunset, nature" | Adobe Bridge, Lightroom |
| **XMP** | Datos estructurados | Subject, título | Photoshop, ExifTool |

### Nuestro namespace personalizado: XMP-vorael

Además de los campos estándar, creamos un "espacio de nombres" propio llamado `XMP-vorael`. Es como crear una sección personalizada en la etiqueta de la imagen:

```
┌─────────────────────────────────────────┐
│  METADATOS DE LA IMAGEN                 │
│                                         │
│  ═══ Campos estándar (cualquiera ve) ═══│
│  Artista: "Corporación Americana"       │
│  Descripción: "Un gato al atardecer"    │
│  Tags: cat, sunset, nature              │
│  Subject: "Gato al atardecer"           │
│                                         │
│  ═══ Campos VORAEL (nuestro namespace) ══│
│  vorael:id = "img-001"                  │
│  vorael:style = "Photorealistic"        │
│  vorael:mood = "Calm"                   │
│  vorael:useCase = "Wallpaper"           │
│  vorael:palette = "#FFD700, #FF6B35"    │
│  vorael:fileName = "cat-sunset.webp"    │
│  vorael:createdAt = "2026-01-15"        │
└─────────────────────────────────────────┘
```

### ¿Qué pasa si ExifTool no está instalado?

**No pasa nada.** El sistema detecta si ExifTool existe al arrancar. Si no está:
- Las imágenes se sirven sin metadatos (pero se ven igual)
- Ningún error aparece en pantalla
- El usuario no se entera

Es como un coche híbrido: si se acaba la batería eléctrica, funciona con gasolina.

---

## El motor de búsqueda por grafos

### ¿Qué es un grafo?

Un grafo es una estructura de datos que muestra **relaciones entre cosas**.

**Ejemplo cotidiano:** Facebook
- Tú eres un **nodo** (punto)
- Tu amigo Pedro es otro **nodo**
- La línea que los conecta es una **arista** (relación: "amigos")

En VORAEL:
- Cada imagen es un nodo
- Cada tag es un nodo
- Cada estilo es un nodo
- Las líneas muestran qué tags tiene cada imagen

### Visualmente

```
                    ┌─────────┐
                    │ cat     │
                    │ (tag)   │
                    └────┬────┘
                         │
              TAGGED_WITH│TAGGED_WITH
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐     ┌─────▼─────┐    ┌─────▼─────┐
   │ img-001 │     │  img-009  │    │  img-030  │
   │ (foto)  │     │ (foto)    │    │ (foto)    │
   └────┬────┘     └─────┬─────┘    └───────────┘
        │                │
   HAS_STYLE        HAS_STYLE
        │                │
   ┌────▼────┐     ┌─────▼─────┐
   │ Photo   │     │ 3D Render │
   │ (style) │     │ (style)   │
   └─────────┘     └───────────┘
```

### ¿Cómo se construye?

Cuando arranca el API, lee todas las imágenes de PostgreSQL y crea:

1. **Un nodo por cada imagen** (ej: `img-001`)
2. **Un nodo por cada tag** (ej: `tag:cat`)
3. **Un nodo por cada estilo** (ej: `style:Photorealistic`)
4. **Un nodo por cada mood** (ej: `mood:Calm`)
5. **Un nodo por cada color** (ej: `color:#FFD700`)
6. **Líneas conectando** cada imagen con sus tags, estilos, moods y colores
7. **Líneas entre tags** que aparecen juntos (co-ocurrencia)

### ¿Cómo se busca?

Cuando buscas "cat sunset", el sistema:

1. Tokeniza: `["cat", "sunset"]`
2. Para cada imagen, verifica:
   - ¿Tiene el tag "cat"? → +3 puntos
   - ¿Tiene el tag "sunset"? → +3 puntos
   - ¿"cat" aparece en el subject? → +2 puntos
   - ¿"sunset" aparece en el subject? → +2 puntos
   - ¿Aparece en los prompts? → +1 punto cada vez
3. Ordena por puntaje total
4. Devuelve las más relevantes

### ¿Qué es "related" (imágenes relacionadas)?

Cuando ves una imagen y haces click en "Ver relacionadas", el sistema:

1. Busca los vecinos directos de esa imagen en el grafo
2. Para cada otra imagen, cuenta cuántos vecinos comparten
3. Cuantos más vecinos compartan, más similares son
4. Si dos tags aparecen juntos muchas veces, suma puntos extra
5. Devuelve las top 8 más parecidas

---

## La vista de grafo interactivo

### ¿Qué muestra?

Una **red visual** donde puedes ver:
- Cada imagen como un punto morado
- Cada tag como un punto ámbar
- Cada estilo como un punto verde
- Cada mood como un punto púrpura
- Cada caso de uso como un punto cian
- Cada color como un punto gris

Las líneas muestran las conexiones.

### ¿Cómo funciona?

1. **Sigma.js** dibuja todo usando **WebGL** (la misma tecnología de los videojuegos 3D)
2. Los nodos se posicionan automáticamente con un **algoritmo force-directed**:
   - Los nodos se repelen (como imanes del mismo polo)
   - Los nodos conectados se atraen (como resortes)
   - Todo se centra en el medio
3. Puedes **hacer click** en cualquier nodo:
   - Si es una imagen → te lleva al detalle
   - Si es un tag → te lleva a la galería de ese tag
   - Si es un estilo/mood → resalta sus conexiones
4. Puedes **filtrar** por tipo con los botones de arriba

### Ejemplo de interacción

```
1. Abres /vorael/graph
2. Ves 76 nodos y 175 aristas
3. Haces click en "tag:cat"
4. Se resaltan todas las imágenes que tienen "cat"
5. Ves que img-001, img-009, img-030 están conectadas
6. Haces click en img-001
7. Te lleva al detalle de esa imagen
```

---

## El algoritmo de búsqueda (explicado paso a paso)

### ¿Cómo busca VORAEL?

Cuando escribes "gato atardecer" en el buscador, VORAEL no hace una búsqueda tonta como `ILIKE '%gato%'` (que pegaba en "categoría"). Usa un algoritmo más inteligente que combina varias técnicas.

### Paso 1: Tokenizar (separar en palabras)

El sistema separa tu búsqueda en palabras individuales:

```
"gato atardecer" → ["gato", "atardecer"]
```

Es como si un bibliotecario leyera tu pedido y dijera: "OK, necesito libros que tengan 'gato' Y también tengan 'atardecer'".

### Paso 2: Buscar palabra completa (Token-Match)

Cada palabra debe aparecer como **palabra completa**, no como parte de otra palabra:

```
✅ "gato" matchea: "gato", "gatos" (plural mínimo)
❌ "gato" NO matchea: "categoría", "agusete", "dátiles"

✅ "atardecer" matchea: "atardecer", "atardeceres"
❌ "atardecer" NO matchea: "despertar", "madrugada"
```

**Analogía:** Es como buscar en Google. Si buscas "gato", Google no te muestra resultados de "categoría" ni "agusete". Busca la palabra exacta.

### Paso 3: Calcular el puntaje (Scoring)

No todas las coincidencias valen lo mismo. Una imagen que tiene "gato" como **tag** es más relevante que una donde "gato" aparece solo en la descripción larga.

```
┌─────────────────────────────────────────────────────────┐
│  SISTEMA DE PUNTAJE                                     │
│                                                         │
│  Tag "gato" coincide        → +3 puntos  (¡muy bien!)  │
│  Subject contiene "gato"    → +2 puntos  (bien)         │
│  Prompt contiene "gato"     → +1 punto   (ok)           │
│                                                         │
│  Total = suma de todos los puntos                       │
└─────────────────────────────────────────────────────────┘
```

**Ejemplo real:**

```
Query: "gato atardecer"

Imagen 1: tags=[cat, sunset, nature], subject="Gato al atardecer"
  → tag "cat" coincide: +3
  → tag "sunset" coincide: +3
  → subject contiene "gato": +2
  → subject contiene "atardecer": +2
  → TOTAL: 10 puntos 🏆

Imagen 2: tags=[cat, library], subject="Gato en biblioteca"
  → tag "cat" coincide: +3
  → tag "sunset" NO coincide: +0
  → subject contiene "gato": +2
  → subject contiene "atardecer": +0
  → TOTAL: 5 puntos

Imagen 3: tags=[dog, park], subject="Perro en parque"
  → tag "cat" NO coincide: +0
  → tag "sunset" NO coincide: +0
  → subject contiene "gato": +0
  → subject contiene "atardecer": +0
  → TOTAL: 0 puntos
```

### Paso 4: Ordenar y devolver

Las imágenes se ordenan por puntaje (mayor a menor) y se devuelven las mejores.

```
1. Imagen 1 (10 pts) → ¡la más relevante!
2. Imagen 2 (5 pts)
3. Imagen 3 (0 pts) → no aparece en resultados
```

---

## Co-ocurrencia (cómo se encuentran imágenes similares)

### ¿Qué es co-ocurrencia?

Cuando dos tags aparecen **juntos** en muchas imágenes, tienen una relación fuerte. Esto se llama **análisis de co-ocurrencia**.

**Ejemplo cotidiano:** Netflix
- Si mucha gente que ve "Breaking Bad" también ve "Better Call Saul"
- Netflix aprende que esos dos shows están relacionados
- Cuando buscas uno, te muestra el otro

En VORAEL:
- Si "cat" y "sunset" aparecen juntos en 5 imágenes
- El sistema sabe que esas dos cosas están relacionadas
- Cuando ves una imagen con "cat", te muestra otras con "sunset"

### ¿Cómo se calcula?

```
IMG-001: tags = [cat, sunset, nature]
IMG-009: tags = [cat, cyberpunk, neon]
IMG-030: tags = [cat, library, books]
IMG-045: tags = [sunset, beach, ocean]

Co-ocurrencia:
  cat ↔ sunset: aparecen juntos en 1 imagen (IMG-001)
  cat ↔ cyberpunk: aparecen juntos en 1 imagen (IMG-009)
  cat ↔ library: aparecen juntos en 1 imagen (IMG-030)
  sunset ↔ beach: aparecen juntos en 1 imagen (IMG-045)
```

### ¿Cómo se usa para "imágenes relacionadas"?

Cuando haces click en "Ver relacionadas" de IMG-001:

1. **Busca vecinos directos** en el grafo (tags, style, mood, etc.)
2. **Cuenta cuántos vecinos comparten** con otras imágenes
3. **Calcula Jaccard similarity** (una fórmula matemática)
4. **Suma bonus** por co-ocurrencia fuerte

```
IMG-001 tiene vecinos: {cat, sunset, nature, Photorealistic, Calm}

IMG-009 tiene vecinos: {cat, cyberpunk, neon, 3D Render, Vibrant}
  → Vecinos compartidos: {cat}
  → Jaccard = 1/9 = 0.11

IMG-045 tiene vecinos: {sunset, beach, ocean, Photorealistic, Calm}
  → Vecinos compartidos: {sunset, Photorealistic, Calm}
  → Jaccard = 3/7 = 0.43  ← ¡Más parecida!
```

**Resultado:** IMG-045 aparece como "más relacionada" que IMG-009.

---

## Comparación con algoritmos estándar

### ¿Cómo se compara con Google/Elasticsearch?

| Concepto | VORAEL (nuestro) | Google/Elasticsearch |
|---|---|---|
| **Nombre del algoritmo** | Token-Match + Co-ocurrencia | BM25 + Inverted Index |
| **Búsqueda de texto** | Palabra completa, scoring fijo | TF-IDF, scoring dinámico |
| **Imágenes relacionadas** | Jaccard + co-ocurrencia | Collaborative filtering + embeddings |
| **Velocidad** | ~1ms (en memoria) | ~10ms (inverted index) |
| **Complejidad de implementación** | Baja (200 líneas) | Alta (miles de líneas) |
| **Para cuántos documentos** | 30 - 10,000 | 1,000 - 1,000,000,000 |

### ¿Por qué no usamos BM25 completo?

**BM25** (Best Matching 25) es el algoritmo que usa Google y Elasticsearch. Es más preciso pero más complejo:

```
BM25 pondera:
  - Frecuencia del término en el documento (TF)
  - Rareza del término en toda la colección (IDF)
  - Longitud del documento
  - Parámetros ajustables (k1, b)

Nuestro sistema pondera:
  - Tags: +3 puntos
  - Subject: +2 puntos
  - Prompts: +1 punto
```

**¿Por qué no lo usamos?** Para 30-1000 imágenes, la diferencia es mínima. BM25 brilla con millones de documentos.

### ¿Y los embeddings semánticos?

Los embeddings son la evolución natural de este sistema:

```
Token-Match (actual):
  "gato" = "gato" ✅
  "felino" = "gato" ❌ (no sabe que son lo mismo)

Embeddings semánticos:
  "gato" = [0.23, -0.45, ...]
  "felino" = [0.21, -0.42, ...]  (muy parecido!)
  Similitud: 0.94 → ¡son lo mismo!
```

**Para cuándo:** Cuando tengas > 1000 imágenes y quieras buscar por significado, no solo por palabras.

---

## Resumen del algoritmo

```
┌─────────────────────────────────────────────────────────┐
│  BÚSQUEDA EN VORAEL                                     │
│                                                         │
│  1. Tokenizar: "gato atardecer" → ["gato", "atardecer"]│
│                                                         │
│  2. Token-Match: cada palabra debe aparecer completa    │
│     ✅ "gato" matchea "gatos" (plural mínimo)          │
│     ❌ "gato" NO matchea "categoría" (subcadena)       │
│                                                         │
│  3. Scoring: calcular relevancia                        │
│     tags ×3 + subject ×2 + prompts ×1                  │
│                                                         │
│  4. Ordenar: mayor puntaje primero                      │
│                                                         │
│  5. Co-ocurrencia: encontrar imágenes similares         │
│     Si "cat" y "sunset" aparecen juntos → relacionados │
│                                                         │
│  6. Jaccard: calcular similitud entre conjuntos         │
│     Más vecinos compartidos = más parecida              │
└─────────────────────────────────────────────────────────┘
```

**En una frase:** VORAEL busca por palabras completas, las pondera por importancia, y usa co-ocurrencia para encontrar imágenes similares. Es como un mini-Google pero optimizado para un catálogo de imágenes.

---

## Variables de entorno (configuración)

Las variables de entorno son como los **interruptores de luz** del sistema. Pueden encender o apagar cosas.

### Variables principales

| Variable | ¿Qué controla? | Valor normal | Valor de prueba |
|---|---|---|---|
| `DB_MOCK` | ¿Usar base de datos real? | `false` | `true` (usa datos inventados) |
| `SEARCH_ENGINE` | Motor de búsqueda | `graph` | `sql` (fallback) |
| `METADATA_EMBED` | ¿Incrustar metadatos? | `exiftool` | `none` |
| `ALLOW_BACKFILL_WRITE` | ¿Permitir escribir en S3? | `false` | `true` |
| `GRAPH_REFRESH_MS` | Cada cuánto refresca el grafo | `60000` (1 min) | `60000` |

### Modo mock (pruebas)

Cuando `DB_MOCK=true`:
- No necesita PostgreSQL
- No necesita DigitalOcean Spaces
- Usa 30 imágenes inventadas en `mockData.ts`
- Usa 10 archivos placeholder en `test-images/`
- Todo funciona: búsqueda, filtros, descarga, grafo

**Para qué sirve:** Desarrollar y probar sin tener acceso al servidor real.

---

## Endpoints del API (qué puede pedir el frontend)

Un "endpoint" es una dirección web que el frontend puede visitar para obtener datos.

### Lista de endpoints

| Endpoint | ¿Qué devuelve? | Ejemplo de uso |
|---|---|---|
| `GET /api/health` | Estado del sistema | `{"ok": true, "ts": "2026-..."}` |
| `GET /api/images` | Lista de imágenes paginada | Galería principal |
| `GET /api/images/:id` | Una imagen específica | Detalle de imagen |
| `GET /api/images/:id/download` | Archivo de imagen | Botón de descarga |
| `GET /api/images/:id/related` | Imágenes similares | "Ver relacionadas" |
| `GET /api/search?q=gato` | Resultados de búsqueda | Buscador |
| `GET /api/tags` | Todos los tags con conteo | Página de tags |
| `GET /api/filters` | Estilos, moods, usos disponibles | Panel de filtros |
| `GET /api/stats` | Estadísticas generales | Página de stats |
| `GET /api/graph` | Grafo para visualización | Página de red |

### Ejemplo de respuesta

Cuando pides `GET /api/images?limit=2`:

```json
{
  "items": [
    {
      "id": "img-030",
      "s3_url": "https://n8ns3.sfo3.../img-030.webp",
      "subject": "Cat in library",
      "tags": ["cat", "library", "books", "cozy"],
      "style": "Oil Painting",
      "mood": "Calm",
      "created_at": "2026-01-15T10:30:00Z"
    },
    {
      "id": "img-029",
      "s3_url": "https://n8ns3.sfo3.../img-029.webp",
      "subject": "Cyberpunk cat",
      "tags": ["cat", "cyberpunk", "neon"],
      "style": "3D Render",
      "mood": "Vibrant",
      "created_at": "2026-01-14T08:15:00Z"
    }
  ],
  "page": 1,
  "limit": 2,
  "total": 30,
  "hasMore": true
}
```

---

## Scripts útiles

| Comando | ¿Qué hace? | ¿Cuándo usarlo? |
|---|---|---|
| `pnpm dev` | Arranca API + web en desarrollo | Cuando estás programando |
| `pnpm test` | Ejecuta los 98 tests | Para verificar que todo funciona |
| `pnpm build` | Compila para producción | Antes de subir al servidor |
| `pnpm export-portable` | Exporta imágenes con metadatos a carpeta local | Para tener copia local |
| `pnpm backfill` | Reescribe imágenes en S3 con metadatos | Para actualizar el S3 completo |
| `pnpm scan` | Reconstruye el grafo desde archivos | Si se pierde la DB |

---

## Preguntas frecuentes (FAQ)

### ¿Por qué hay 98 tests?

Los tests son como un **seguro de vida**. Cada vez que alguien cambia el código, los tests verifican que nada se rompió. Si un test falla, sabemos exactamente qué se rompió.

### ¿Por qué el grafo se refresca cada 60 segundos?

Porque si lo hiciéramos en cada petición, sería lento. En cambio, lo mantenemos en memoria y lo actualizamos periódicamente. Es como tener un mapa impreso en vez de dibujarlo en cada paso.

### ¿Qué pasa si PostgreSQL se cae?

El sistema sigue funcionando con el último grafo que tenía en memoria. Cuando PostgreSQL vuelva, el próximo refresh lo actualizará. Es como un avión con motor de repuesto.

### ¿Por qué se usa CommonJS y no ES Modules?

El API usa CommonJS porque `sharp` (la librería de imágenes) y otras dependencias nativas funcionan mejor con CommonJS. El frontend sí usa ES Modules (Vite).

### ¿Qué es "atomic swap"?

Cuando se refresca el grafo, no se modifica el viejo. Se construye uno nuevo completo y se reemplaza de golpe. Así nunca se ve un grafo a medias (mitad viejo, mitad nuevo).

### ¿Por qué no se puede cambiar la sub-ruta `/vorael/`?

Porque está hardcodeada en 4 lugares:
1. `vite.config.ts` (base del build)
2. `main.tsx` (basename del router)
3. `nginx-vorael.conf` (ubicación de archivos)
4. `index.html` (href del favicon)

Si cambia uno y no los otros, todo se rompe.

---

## Resumen ejecutivo (para la reunión)

### ¿Qué construimos?

Un **sistema completo** para mostrar, buscar y descargar imágenes generadas por IA, con:

1. **Galería visual** con filtros infinitos
2. **Búsqueda inteligente** que entiende tags, estilos y moods
3. **Descarga con metadatos** incrustados en cada imagen
4. **Grafo interactivo** que muestra relaciones entre imágenes
5. **98 tests** que garantizan que todo funciona

### ¿Qué tecnologías usamos?

- **Frontend:** React + Vite + Tailwind + Sigma.js
- **Backend:** Express + TypeScript + PostgreSQL
- **Almacenamiento:** DigitalOcean Spaces (S3)
- **Procesamiento:** Sharp (imágenes) + ExifTool (metadatos)
- **Motor de grafos:** Graphology (búsqueda + relaciones)

### ¿Qué falta para producción?

1. **S3 write permissions** — Confirmar que el API puede escribir en Spaces
2. **ExifTool en servidor** — Instalar en el VPS de producción
3. **Pruebas end-to-end** — Verificar en el servidor real

### ¿Cuánto tarda en cargarse?

- **Galería:** < 1 segundo (datos en caché)
- **Búsqueda:** < 100ms (grafo en memoria)
- **Descarga:** 1-3 segundos (convierte imagen + incrusta metadatos)
- **Grafo:** < 2 segundos (layout force-directed en cliente)

---

*Documento preparado para la reunión de la Corporación Universitaria Americana.*
*VORAEL — Banco de imágenes generadas por IA.*
