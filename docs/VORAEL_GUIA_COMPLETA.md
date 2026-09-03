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

### La casa completa

```mermaid
flowchart TD
    U[USUARIOS<br/>navegadores] --> N[Nginx<br/>HTTPS]
    N --> R[Galeria<br/>React]
    N --> A[API<br/>Express]
    A --> PG[(PostgreSQL<br/>datos)]
    A --> S3[DigitalOcean<br/>Spaces S3]
```

### Cada pieza explicada

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

```mermaid
sequenceDiagram
    participant n8n
    participant S3 as DigitalOcean Spaces
    participant PG as PostgreSQL
    participant V as VORAEL
    participant U as Usuario

    n8n->>n8n: Genera imagen con IA
    n8n->>S3: Sube imagen
    n8n->>PG: Escribe datos (id, tags, style, mood, subject, prompt)
    V->>PG: Detecta cambio cada 60s
    V->>V: Actualiza grafo en memoria
    U->>V: Ve, busca y descarga imagen
```

### Flujo 2: El usuario busca "gato"

```mermaid
sequenceDiagram
    participant U as Usuario
    participant F as Frontend
    participant A as API
    participant G as Grafo en memoria

    U->>F: Escribe "gato"
    F->>A: GET /api/search?q=gato
    A->>G: Busca tag "cat", subject "gato", prompts "gato"
    G-->>A: Coincidencias
    A->>A: Calcula puntaje (tag +3, subject +2, prompt +1)
    A-->>F: Imagenes ordenadas por puntaje
    F-->>U: Muestra resultados
```

### Flujo 3: El usuario descarga una imagen

```mermaid
sequenceDiagram
    participant U as Usuario
    participant F as Frontend
    participant A as API
    participant PG as PostgreSQL
    participant S3 as DigitalOcean Spaces
    participant ST as Sharp
    participant ET as ExifTool

    U->>F: Click "Descargar como WebP"
    F->>A: GET /api/images/img-001/download?format=webp
    A->>PG: Busca imagen (obtiene s3_key)
    PG-->>A: s3_key
    A->>S3: Descarga archivo original
    S3-->>A: Archivo imagen
    A->>ST: Convierte a WebP lossless
    ST-->>A: Imagen convertida
    A->>ET: Incrusta metadatos (EXIF, IPTC, XMP, XMP-vorael)
    ET-->>A: Imagen con metadatos
    A-->>F: Archivo modificado
    F-->>U: Navegador descarga archivo
```

### Flujo 4: El grafo visual (la red de conexiones)

```mermaid
sequenceDiagram
    participant U as Usuario
    participant F as Frontend
    participant A as API
    participant M as Grafo en memoria
    participant GR as Graphology
    participant SI as Sigma.js

    U->>F: Abre /vorael/graph
    F->>A: GET /api/graph?limit=200
    A->>M: Serializa grafo (143 nodos, 507 aristas)
    M-->>A: nodes + edges
    A-->>F: JSON { nodes, edges }
    F->>GR: Crea grafo en memoria del navegador
    GR->>GR: Layout force-directed (50 iteraciones)
    GR->>SI: Grafo posicionado
    SI->>SI: Dibuja con WebGL (3D rapido)
    SI-->>U: Ve red de conexiones
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

```mermaid
flowchart LR
    subgraph IMAGEN["METADATOS DE LA IMAGEN"]
        subgraph ESTANDAR["Campos estandar (cualquiera ve)"]
            E1["Artista: Corporacion Americana"]
            E2["Descripcion: Un gato al atardecer"]
            E3["Tags: cat, sunset, nature"]
            E4["Subject: Gato al atardecer"]
        end
        subgraph VORAEL["Campos VORAEL (nuestro namespace)"]
            V1["vorael:id = img-001"]
            V2["vorael:style = Photorealistic"]
            V3["vorael:mood = Calm"]
            V4["vorael:useCase = Wallpaper"]
            V5["vorael:palette = #FFD700, #FF6B35"]
            V6["vorael:fileName = cat-sunset.webp"]
            V7["vorael:createdAt = 2026-01-15"]
        end
    end
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

```mermaid
flowchart TD
    CAT["cat (tag)"] -->|TAGGED_WITH| IMG1["img-001 (foto)"]
    CAT -->|TAGGED_WITH| IMG9["img-009 (foto)"]
    CAT -->|TAGGED_WITH| IMG30["img-030 (foto)"]
    IMG1 -->|HAS_STYLE| PHOTO["Photo (style)"]
    IMG9 -->|HAS_STYLE| RENDER["3D Render (style)"]
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
2. Ves 143 nodos y 507 aristas
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
[SÍ] "gato" matchea: "gato", "gatos" (plural mínimo)
[NO] "gato" NO matchea: "categoría", "agusete", "dátiles"

[SÍ] "atardecer" matchea: "atardecer", "atardeceres"
[NO] "atardecer" NO matchea: "despertar", "madrugada"
```

**Analogía:** Es como buscar en Google. Si buscas "gato", Google no te muestra resultados de "categoría" ni "agusete". Busca la palabra exacta.

### Paso 3: Calcular el puntaje (Scoring)

No todas las coincidencias valen lo mismo. Una imagen que tiene "gato" como **tag** es más relevante que una donde "gato" aparece solo en la descripción larga.

```mermaid
flowchart LR
    subgraph SISTEMA["SISTEMA DE PUNTAJE"]
        T["Tag coincide"] -->|+3 puntos| TOTAL["Total = suma"]
        S["Subject contiene"] -->|+2 puntos| TOTAL
        P["Prompt contiene"] -->|+1 punto| TOTAL
    end
```

**Ejemplo real:**

```
Query: "gato atardecer"

Imagen 1: tags=[cat, sunset, nature], subject="Gato al atardecer"
  → tag "cat" coincide: +3
  → tag "sunset" coincide: +3
  → subject contiene "gato": +2
  → subject contiene "atardecer": +2
  → TOTAL: 10 puntos [TOP]

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
  "gato" = "gato" [SÍ]
  "felino" = "gato" [NO] (no sabe que son lo mismo)

Embeddings semánticos:
  "gato" = [0.23, -0.45, ...]
  "felino" = [0.21, -0.42, ...]  (muy parecido!)
  Similitud: 0.94 → ¡son lo mismo!
```

**Para cuándo:** Cuando tengas > 1000 imágenes y quieras buscar por significado, no solo por palabras.

---

## Resumen del algoritmo

```mermaid
flowchart TD
    A["1. Tokenizar: gato atardecer -> gato, atardecer"] --> B["2. Token-Match: palabra completa"]
    B --> C["3. Scoring: tags x3 + subject x2 + prompts x1"]
    C --> D["4. Ordenar: mayor puntaje primero"]
    D --> E["5. Co-ocurrencia: tags que aparecen juntos"]
    E --> F["6. Jaccard: calcular similitud entre conjuntos"]
    F --> G["Resultado: imagenes ordenadas por relevancia"]
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

## Simulación de Entorno con Datos Reales (Novedad)

Para poder probar el sistema completo usando imágenes reales sin afectar el entorno de producción (S3), se implementó un sistema de **Simulación Local**.

### ¿Cómo funciona la simulación?

1. **Instalación de ExifTool:** Se instaló la dependencia nativa `libimage-exiftool-perl` en el servidor local para habilitar la incrustación física de metadatos.
2. **Descarga de imágenes reales:** Se creó un script (`apps/api/src/scripts/simulate-local.ts`) que descarga en modo "solo lectura" hasta 30 imágenes directamente desde el bucket S3 de producción.
3. **Incrustación de Metadatos:** El script inyecta los ricos metadatos de prueba (`mockData.ts`) directamente en el código binario de las imágenes descargadas (usando el namespace `XMP-vorael`).
4. **Almacenamiento Local y DB:** Las imágenes modificadas se guardan en la carpeta `apps/api/test-images-real/` y el API de Express se configuró para servir esta carpeta estáticamente.
5. **Actualización de PostgreSQL:** Finalmente, el script borra los registros antiguos en la base de datos de Docker y guarda los nuevos apuntando a las URL locales (`http://localhost:3001/test-images-real/...`).

### ¿Por qué el Grafo dibuja estas imágenes?

Con `DB_MOCK=false`, el motor de la aplicación **lee obligatoriamente de PostgreSQL**. Al haber actualizado la tabla `generated_images` en la base de datos Docker con nuestras imágenes reales descargadas y enriquecidas, el ciclo de auto-refresco del API (cada 60 segundos) detecta los nuevos datos. Automáticamente construye el grafo in-memory usando **Graphology** y el frontend (React/Sigma.js) dibuja la red interactiva con tus **fotos reales**.

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
