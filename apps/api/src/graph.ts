/**
 * Motor de búsqueda por grafos — VORAEL.
 *
 * Carga la tabla `generated_images` en memoria al arrancar, construye un grafo
 * con Graphology y mantiene índices invertidos para búsqueda, recomendaciones y
 * facets (tags, filters, stats).
 *
 * ## Arquitectura
 *
 * - **Grafo** (Graphology): nodos `Image`, `Tag`, `Style`, `Mood`, `UseCase`,
 *   `Color`; aristas no dirigidas entre Image y sus dimensiones; arista
 *   `CO_OCCURS_WITH` entre Tags que comparten imágenes.
 * - **Índices invertidos** (`Map<dim, Set<id>>`): acceso rápido por valor de
 *   dimensión.
 * - **Índice de texto** por imagen (minúsculas, tokenizado): para token-match.
 * - **Lista ordenada**: `(created_at DESC, id DESC)` para paginado determinista.
 *
 * ## Sincronización
 *
 * Se construye completo al arrancar. Un timer periódico (GRAPH_REFRESH_MS) hace un
 * refresh incremental: consulta solo las filas nuevas (watermark keyset sobre
 * `(created_at, id)`) y las aplica mutando las estructuras en sitio (applyDelta).
 * Cada GRAPH_FULL_RELOAD_MS se hace un rebuild completo con el watermark fresco
 * para detectar updates/deletes de filas antiguas. Si una pasada falla, se
 * conserva el último snapshot válido. El applyDelta es síncrono dentro del timer
 * (sin awaits entre la lectura y la escritura), así que las rutas nunca observan
 * un grafo a medias.
 */
import Graph from 'graphology';
import type { ImageRow } from './types';

// ── Tipos de apoyo ──────────────────────────────────────────────────────────

/** Token normalizado (minúscula, frontera de palabra). */
type Token = string;

/** Snapshot inmutable que sirven las rutas. */
export interface GraphSnapshot {
  /** Grafo completo (para traversal de co-ocurrencia). */
  graph: Graph;
  /** Mapa id → fila completa. */
  byId: Map<string, ImageRow>;
  /** Índice invertido por dimensión: `tagIndex.get('cat')` → Set de ids. */
  tagIndex: Map<string, Set<string>>;
  styleIndex: Map<string, Set<string>>;
  moodIndex: Map<string, Set<string>>;
  useCaseIndex: Map<string, Set<string>>;
  colorIndex: Map<string, Set<string>>;
  /** Índice de texto por imagen: tokens precomputados por campo (Sets rápidos). */
  textIndex: Map<string, TextTokens>;
  /** Pesos de co-ocurrencia entre tags: `tagA → tagB → weight`. */
  coWeights: Map<string, Map<string, number>>;
  /** Lista global ordenada `created_at DESC, id DESC`. */
  orderedIds: string[];
  /** Nodos ordenados por grado (descendente) — usado por export sin center. */
  topByDegree: string[];
  /** Estadísticas rápidas. */
  stats: {
    total: number;
    styles: { value: string; count: number }[];
    moods: { value: string; count: number }[];
    tags: { tag: string; count: number }[];
    useCases: { value: string; count: number }[];
  };
  /** Timestamp de construcción. */
  builtAt: Date;
  /** Tiempo de construcción en ms. */
  buildMs: number;
}

// ── Utilidades de tokenización ──────────────────────────────────────────────

/**
 * Normaliza un string: minúsculas, quita acentos ligeros, fragmenta en tokens
 * por separadores no alfanuméricos.
 */
function tokenize(text: string): Token[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Genera variantes de plural mínimo:
 * - "gatos" → ["gato", "gatos"]  (retira 's')
 * - "gato" → ["gato", "gatos"]   (agrega 's')
 * - "categorías" → ["categoria", "categorias"]  (retira 'es' y 's')
 * Solo trabaja con tokens de al menos 3 chars.
 */
function pluralVariants(token: Token): Token[] {
  const variants = new Set<Token>([token]);
  if (token.length < 3) return [...variants];

  // Retira trailing 's'/'es' (backward: plural → singular)
  if (token.endsWith('s') && !token.endsWith('es')) {
    variants.add(token.slice(0, -1));
  } else if (token.endsWith('es') && token.length > 4) {
    variants.add(token.slice(0, -2));
  }

  // Agrega trailing 's' (forward: singular → plural)
  if (!token.endsWith('s')) {
    variants.add(token + 's');
  }

  return [...variants];
}

/**
 * Verifica si un token coincide con un conjunto de tokens de referencia,
 * considerando plurales mínimos. Recibe Set para evitar reconstruirlo por término.
 */
function tokenMatches(term: Token, referenceTokens: Set<Token>): boolean {
  for (const variant of pluralVariants(term)) {
    if (referenceTokens.has(variant)) return true;
  }
  return false;
}

/** Tokens precomputados por imagen/config para search (pesos por campo). */
export interface TextTokens {
  subject: Set<Token>;
  original: Set<Token>;
  enhanced: Set<Token>;
}

// ── Construcción del grafo ──────────────────────────────────────────────────

/** Prefijos para las keys de nodos de metadatos (evita colisiones con ids). */
const TAG = 'tag:';
const STYLE = 'style:';
const MOOD = 'mood:';
const USE_CASE = 'ucase:';
const COLOR = 'color:';

/**
 * Construye un snapshot completo a partir de filas de la BD.
 * Función pura — sin I/O. Se puede testear sin Postgres.
 */
export function buildGraph(rows: ImageRow[]): GraphSnapshot {
  const t0 = Date.now();
  const builder: SnapshotBuilder = {
    graph: new Graph({ type: 'undirected' }),
    byId: new Map(),
    tagIndex: new Map(),
    styleIndex: new Map(),
    moodIndex: new Map(),
    useCaseIndex: new Map(),
    colorIndex: new Map(),
    textIndex: new Map(),
    coWeights: new Map(),
  };

  for (const row of rows) {
    addRowToBuilder(builder, row);
  }

  // Aristas de co-ocurrencia entre tags.
  rebuildCoOccurrenceEdges(builder);

  return finalizeSnapshot(builder, t0);
}

// ── Construcción incremental (compartida por buildGraph y applyDelta) ───────

/**
 * Estructuras mutables que se llenan fila a fila. Es la parte "viva" del
 * snapshot; las derivadas (orderedIds, topByDegree, stats) se recalculan con
 * finalizeSnapshot. GraphSnapshot es este builder + las derivadas.
 */
interface SnapshotBuilder {
  graph: Graph;
  byId: Map<string, ImageRow>;
  tagIndex: Map<string, Set<string>>;
  styleIndex: Map<string, Set<string>>;
  moodIndex: Map<string, Set<string>>;
  useCaseIndex: Map<string, Set<string>>;
  colorIndex: Map<string, Set<string>>;
  textIndex: Map<string, TextTokens>;
  coWeights: Map<string, Map<string, number>>;
}

/** Aplica una fila a las estructuras mutables (nodo, índices, co-ocurrencias). */
function addRowToBuilder(b: SnapshotBuilder, row: ImageRow): void {
  b.byId.set(row.id, row);

  // Nodo Image.
  b.graph.addNode(row.id, { type: 'Image' });

  // Tags.
  if (row.tags) {
    for (const tag of row.tags) {
      if (!tag || tag === '') continue;
      const key = TAG + tag;

      // Nodo Tag.
      if (!b.graph.hasNode(key)) b.graph.addNode(key, { type: 'Tag', name: tag });
      b.graph.mergeUndirectedEdge(row.id, key, { type: 'TAGGED_WITH' });

      // Índice.
      let set = b.tagIndex.get(tag);
      if (!set) { set = new Set(); b.tagIndex.set(tag, set); }
      set.add(row.id);
    }

    // Co-ocurrencia.
    for (let i = 0; i < row.tags.length; i++) {
      for (let j = i + 1; j < row.tags.length; j++) {
        const tagA = row.tags[i];
        const tagB = row.tags[j];
        if (!tagA || !tagB || tagA === '' || tagB === '') continue;
        let mapA = b.coWeights.get(tagA);
        if (!mapA) { mapA = new Map(); b.coWeights.set(tagA, mapA); }
        mapA.set(tagB, (mapA.get(tagB) ?? 0) + 1);
        let mapB = b.coWeights.get(tagB);
        if (!mapB) { mapB = new Map(); b.coWeights.set(tagB, mapB); }
        mapB.set(tagA, (mapB.get(tagA) ?? 0) + 1);
      }
    }
  }

  // Style.
  if (row.style) {
    const key = STYLE + row.style;
    if (!b.graph.hasNode(key)) b.graph.addNode(key, { type: 'Style', name: row.style });
    b.graph.mergeUndirectedEdge(row.id, key, { type: 'HAS_STYLE' });
    let set = b.styleIndex.get(row.style);
    if (!set) { set = new Set(); b.styleIndex.set(row.style, set); }
    set.add(row.id);
  }

  // Mood.
  if (row.mood) {
    const key = MOOD + row.mood;
    if (!b.graph.hasNode(key)) b.graph.addNode(key, { type: 'Mood', name: row.mood });
    b.graph.mergeUndirectedEdge(row.id, key, { type: 'HAS_MOOD' });
    let set = b.moodIndex.get(row.mood);
    if (!set) { set = new Set(); b.moodIndex.set(row.mood, set); }
    set.add(row.id);
  }

  // Use case.
  if (row.use_case) {
    const key = USE_CASE + row.use_case;
    if (!b.graph.hasNode(key)) b.graph.addNode(key, { type: 'UseCase', name: row.use_case });
    b.graph.mergeUndirectedEdge(row.id, key, { type: 'FOR_USE_CASE' });
    let set = b.useCaseIndex.get(row.use_case);
    if (!set) { set = new Set(); b.useCaseIndex.set(row.use_case, set); }
    set.add(row.id);
  }

  // Colors (paleta completa).
  if (row.color_palette) {
    for (const hex of row.color_palette) {
      if (!hex || hex === '') continue;
      const key = COLOR + hex;
      if (!b.graph.hasNode(key)) b.graph.addNode(key, { type: 'Color', hex });
      b.graph.mergeUndirectedEdge(row.id, key, { type: 'HAS_COLOR' });
      let set = b.colorIndex.get(hex);
      if (!set) { set = new Set(); b.colorIndex.set(hex, set); }
      set.add(row.id);
    }
  }

  // Texto tokenizado por campo para search (Sets precomputados, sin re-tokenizar).
  b.textIndex.set(row.id, {
    subject: new Set(row.subject ? tokenize(row.subject) : []),
    original: new Set(row.original_prompt ? tokenize(row.original_prompt) : []),
    enhanced: new Set(row.enhanced_prompt ? tokenize(row.enhanced_prompt) : []),
  });
}

/** (Re)crea las aristas CO_OCCURS_WITH a partir de los pesos acumulados. */
function rebuildCoOccurrenceEdges(b: SnapshotBuilder): void {
  for (const [tagA, partners] of b.coWeights) {
    for (const [tagB, weight] of partners) {
      const keyA = TAG + tagA;
      const keyB = TAG + tagB;
      if (b.graph.hasNode(keyA) && b.graph.hasNode(keyB)) {
        b.graph.mergeUndirectedEdge(keyA, keyB, { type: 'CO_OCCURS_WITH', weight });
      }
    }
  }
}

/**
 * Calcula las estructuras derivadas (orderedIds, topByDegree, stats) a partir
 * del builder y devuelve el snapshot final, listo para que las rutas lo lean.
 */
function finalizeSnapshot(b: SnapshotBuilder, t0: number): GraphSnapshot {
  // Lista ordenada (created_at DESC, id DESC).
  const orderedIds = [...b.byId.values()]
    .sort((a, b) => {
      const aTime = String(a.created_at);
      const bTime = String(b.created_at);
      const cmp = bTime.localeCompare(aTime);
      return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
    })
    .map((r) => r.id);

  // Nodos ordenados por grado (para export sin center, evita O(n log n) por request).
  const topByDegree = b.graph.nodes()
    .map((n) => ({ id: n, degree: b.graph.degree(n) }))
    .sort((a, b) => b.degree - a.degree)
    .map((n) => n.id);

  // Stats.
  const tagStats = [...b.tagIndex.entries()]
    .map(([tag, ids]) => ({ tag, count: ids.size }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  const styleStats = [...b.styleIndex.entries()]
    .map(([value, ids]) => ({ value, count: ids.size }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const moodStats = [...b.moodIndex.entries()]
    .map(([value, ids]) => ({ value, count: ids.size }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const useCaseStats = [...b.useCaseIndex.entries()]
    .map(([value, ids]) => ({ value, count: ids.size }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    graph: b.graph,
    byId: b.byId,
    tagIndex: b.tagIndex,
    styleIndex: b.styleIndex,
    moodIndex: b.moodIndex,
    useCaseIndex: b.useCaseIndex,
    colorIndex: b.colorIndex,
    textIndex: b.textIndex,
    coWeights: b.coWeights,
    orderedIds,
    topByDegree,
    stats: {
      total: b.byId.size,
      styles: styleStats,
      moods: moodStats,
      tags: tagStats,
      useCases: useCaseStats,
    },
    builtAt: new Date(),
    buildMs: Date.now() - t0,
  };
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

export interface SearchResult {
  items: ImageRow[];
  total: number;
}

/**
 * Búsqueda por token-match con ranking por cobertura.
 *
 * Cada término de la query se compara como palabra completa (con plural mínimo)
 * contra tags, subject, original_prompt y enhanced_prompt. El score suma por
 * término encontrado (tags tienen más peso que el texto) y el resultado se
 * ordena por score DESC.
 *
 * Para queries cortas (1-3 términos) basta con que UN término coincida (comporta
 * OR, como el SQL original). Para párrafos/queries largas se exige un porcentaje
 * mínimo de términos coincidentes (coverage), de modo que solo vuelven imágenes
 * realmente relevantes y no cualquier imagen que comparta una palabra suelta.
 */
export function search(
  snap: GraphSnapshot,
  q: string,
  opts: { page?: number; limit?: number } = {},
): SearchResult & { page: number; limit: number; hasMore: boolean } {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 24));
  const offset = (page - 1) * limit;

  const scored = scoreSearch(snap, q);
  const total = scored.total;
  const slice = scored.ids.slice(offset, offset + limit);
  const items = slice.map((id) => snap.byId.get(id)!).filter(Boolean);

  return {
    items,
    total,
    page,
    limit,
    hasMore: offset + items.length < total,
  };
}

export interface ScoredSearch {
  /** Ids rankeados (score DESC, created_at DESC, id DESC), ya filtrados por minMatched. */
  ids: string[];
  total: number;
}

/**
 * Igual que `search` pero devuelve solo el ranking de ids, sin paginar.
 * Sirve como input para el modo hybrid (RRF fusiona ranking léxico + semántico).
 */
export function scoreSearch(
  snap: GraphSnapshot,
  q: string,
  _opts: { page?: number; limit?: number } = {},
): ScoredSearch {
  if (!q.trim()) {
    return { ids: [], total: 0 };
  }

  // Términos únicos (en minúsculas), para que una palabra repetida no domine.
  const terms = [
    ...new Set(
      q
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ];

  // Cobertura mínima: queries cortas → cualquier match; párrafos → ≥ 50%.
  const minMatched = terms.length <= 3 ? 1 : Math.ceil(terms.length * 0.5);

  // Calcular score por cobertura para cada imagen.
  // Los tokens por campo vienen precomputados en textIndex (Sets), así que no
  // hay que re-tokenizar ni reconstruir Sets por request.
  const scored: { id: string; score: number; matched: number }[] = [];

  for (const [id, toks] of snap.textIndex) {
    let score = 0;
    let matched = 0;

    for (const term of terms) {
      let termScore = 0;

      // Tags: coincidencia de palabra completa (con plural mínimo), peso alto.
      const row = snap.byId.get(id)!;
      if (row.tags?.some((t) => pluralVariants(term).includes(t))) {
        termScore += 4;
      }

      // Texto: token-match sobre subject/prompt precomputado, peso menor.
      if (tokenMatches(term, toks.subject)) termScore += 2;
      if (tokenMatches(term, toks.original)) termScore += 1;
      if (tokenMatches(term, toks.enhanced)) termScore += 1;

      // Un término cuenta como un match aunque coincida en varios campos.
      if (termScore > 0) {
        matched++;
        score += termScore;
      }
    }

    if (matched >= minMatched) scored.push({ id, score, matched });
  }

  // Orden: score DESC, created_at DESC, id DESC.
  scored.sort((a, b) => {
    const cmp = b.score - a.score;
    if (cmp !== 0) return cmp;
    const rowA = snap.byId.get(a.id)!;
    const rowB = snap.byId.get(b.id)!;
    const cmpDate = String(rowB.created_at).localeCompare(String(rowA.created_at));
    if (cmpDate !== 0) return cmpDate;
    return b.id.localeCompare(a.id);
  });

  return { ids: scored.map((s) => s.id), total: scored.length };
}

// ── Related ─────────────────────────────────────────────────────────────────

export interface RelatedResult {
  items: ImageRow[];
}

/**
 * Imágenes relacionadas por similitud multihop:
 * 1. Intersección de vecinos en el grafo (Jaccard simplificado).
 * 2. Bonus por CO_OCCURS_WITH entre tags.
 */
export function related(
  snap: GraphSnapshot,
  id: string,
  limit: number = 8,
): RelatedResult {
  const baseRow = snap.byId.get(id);
  if (!baseRow) return { items: [] };

  // Vecinos del nodo Image: tags + style + mood + use_case + color.
  const baseNeighbors = new Set<string>();
  for (const n of snap.graph.neighbors(id)) {
    baseNeighbors.add(n);
  }

  // Scores de similitud.
  const scores = new Map<string, number>();

  for (const candidateId of snap.byId.keys()) {
    if (candidateId === id) continue;
    const candRow = snap.byId.get(candidateId)!;

    // Vecinos del candidato.
    const candNeighbors = new Set<string>();
    for (const n of snap.graph.neighbors(candidateId)) {
      candNeighbors.add(n);
    }

    // Intersección de vecinos compartidos (Jaccard-like).
    let shared = 0;
    for (const n of baseNeighbors) {
      if (candNeighbors.has(n)) shared++;
    }

    // Bonus por tags co-occurrentes fuertes (peso > 0).
    if (baseRow.tags && candRow.tags) {
      for (const tagA of baseRow.tags) {
        for (const tagB of candRow.tags) {
          if (tagA === tagB) continue;
          const weightA = snap.coWeights.get(tagA)?.get(tagB);
          const weightB = snap.coWeights.get(tagB)?.get(tagA);
          const weight = weightA ?? weightB ?? 0;
          if (weight > 0) shared += weight * 0.5;
        }
      }
    }

    if (shared > 0) scores.set(candidateId, shared);
  }

  // Ordenar por score DESC, created_at DESC.
  const sorted = [...scores.entries()]
    .sort((a, b) => {
      const cmp = b[1] - a[1];
      if (cmp !== 0) return cmp;
      const rowA = snap.byId.get(a[0])!;
      const rowB = snap.byId.get(b[0])!;
      return String(rowB.created_at).localeCompare(String(rowA.created_at));
    })
    .slice(0, limit)
    .map(([cid]) => snap.byId.get(cid)!);

  return { items: sorted };
}

// ── Tags ────────────────────────────────────────────────────────────────────

/**
 * Lista de tags con conteo, ordenados por count DESC, tag ASC.
 */
export function tagsList(
  snap: GraphSnapshot,
  limit: number = 200,
): { items: { tag: string; count: number }[] } {
  return { items: snap.stats.tags.slice(0, limit) };
}

/**
 * Imágenes filtradas por tag, paginadas.
 */
export function tagImages(
  snap: GraphSnapshot,
  tag: string,
  opts: { page?: number; limit?: number } = {},
): SearchResult & { page: number; limit: number; hasMore: boolean; tag: string } {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 24));
  const offset = (page - 1) * limit;

  const ids = snap.tagIndex.get(tag) ?? new Set();

  // Filtrar y ordenar por created_at DESC, id DESC.
  const sorted = [...ids]
    .map((cid) => snap.byId.get(cid)!)
    .filter(Boolean)
    .sort((a, b) => {
      const cmp = String(b.created_at).localeCompare(String(a.created_at));
      if (cmp !== 0) return cmp;
      return b.id.localeCompare(a.id);
    });

  const total = sorted.length;
  const items = sorted.slice(offset, offset + limit);

  return { items, total, page, limit, hasMore: offset + items.length < total, tag };
}

// ── Filters / Facets ────────────────────────────────────────────────────────

export interface FiltersResult {
  styles: { value: string; count: number }[];
  moods: { value: string; count: number }[];
  useCases: { value: string; count: number }[];
}

export function filters(snap: GraphSnapshot): FiltersResult {
  return {
    styles: snap.stats.styles,
    moods: snap.stats.moods,
    useCases: snap.stats.useCases,
  };
}

export interface StatsResult {
  total: number;
  topStyles: { value: string; count: number }[];
  topMoods: { value: string; count: number }[];
  topTags: { tag: string; count: number }[];
}

export function stats(snap: GraphSnapshot): StatsResult {
  return {
    total: snap.stats.total,
    topStyles: snap.stats.styles.slice(0, 10),
    topMoods: snap.stats.moods.slice(0, 10),
    topTags: snap.stats.tags.slice(0, 20),
  };
}

// ── Graph export (para /api/graph) ───────────────────────────────────────────

export interface GraphNode {
  id: string;
  type: 'image' | 'tag' | 'style' | 'mood' | 'useCase' | 'color';
  label: string;
  size: number;
  color: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface GraphExport {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_COLORS: Record<string, string> = {
  image: '#6366f1',   // indigo
  tag: '#f59e0b',     // amber
  style: '#22c55e',   // green
  mood: '#a855f7',    // purple
  useCase: '#06b6d4', // cyan
  color: '#6b7280',   // gray
};

function nodeTypeFromKey(key: string): GraphNode['type'] | null {
  if (key.startsWith(TAG)) return 'tag';
  if (key.startsWith(STYLE)) return 'style';
  if (key.startsWith(MOOD)) return 'mood';
  if (key.startsWith(USE_CASE)) return 'useCase';
  if (key.startsWith(COLOR)) return 'color';
  // Si es un id de imagen (no tiene prefijo de metadatos).
  return null; // es un nodo Image
}

function nodeLabelFromKey(key: string): string {
  for (const prefix of [TAG, STYLE, MOOD, USE_CASE, COLOR]) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return key;
}

function exportSnapshot(
  snap: GraphSnapshot,
  opts: { types?: string[]; limit?: number; center?: string; hops?: number },
): GraphExport {
  const allowedTypes = new Set(opts.types ?? ['image', 'tag', 'style', 'mood', 'useCase', 'color']);
  const limit = opts.limit ?? 200;
  const hops = opts.hops ?? 1;

  // Si hay center, hacer ego-graph.
  let nodeIds: Set<string>;
  if (opts.center && snap.graph.hasNode(opts.center)) {
    nodeIds = new Set<string>();
    nodeIds.add(opts.center);
    let frontier = new Set([opts.center]);
    for (let h = 0; h < hops; h++) {
      const next = new Set<string>();
      for (const nid of frontier) {
        for (const neighbor of snap.graph.neighbors(nid)) {
          if (!nodeIds.has(neighbor)) {
            nodeIds.add(neighbor);
            next.add(neighbor);
          }
        }
      }
      frontier = next;
    }
  } else {
    // Sin center: usar precomputed topByDegree (O(1) vs O(n log n)).
    nodeIds = new Set(snap.topByDegree.slice(0, limit));
  }

  // Construir nodos.
  const nodes: GraphNode[] = [];
  for (const nid of nodeIds) {
    const attrs = snap.graph.getNodeAttributes(nid);
    const type: GraphNode['type'] = attrs.type === 'Image' ? 'image'
      : attrs.type === 'Tag' ? 'tag'
      : attrs.type === 'Style' ? 'style'
      : attrs.type === 'Mood' ? 'mood'
      : attrs.type === 'UseCase' ? 'useCase'
      : 'color';

    if (!allowedTypes.has(type)) continue;

    const label = type === 'image'
      ? (snap.byId.get(nid)?.subject ?? nid)
      : (attrs.name ?? attrs.hex ?? nid);

    const size = type === 'tag'
      ? (snap.tagIndex.get(label)?.size ?? 1)
      : Math.max(1, snap.graph.degree(nid));

    nodes.push({
      id: nid,
      type,
      label,
      size: Math.min(20, Math.max(1, size)),
      color: NODE_COLORS[type],
    });
  }

  // Construir aristas.
  const edges: GraphEdge[] = [];
  const nodeSet = new Set(nodes.map((n) => n.id));
  for (const eid of snap.graph.edges()) {
    const [a, b] = snap.graph.extremities(eid);
    if (!nodeSet.has(a) || !nodeSet.has(b)) continue;
    const attrs = snap.graph.getEdgeAttributes(eid);
    edges.push({
      source: a,
      target: b,
      type: attrs.type ?? 'unknown',
      weight: attrs.weight ?? 1,
    });
  }

  return { nodes, edges };
}

// ── Store (manejo de snapshot + refresh) ────────────────────────────────────

/**
 * Watermark keyset: la última fila aplicada (created_at, id). El refresh
 * incremental consulta filas estrictamente mayores a este punto.
 */
export interface Watermark {
  created_at: string;
  id: string;
}

/**
 * Normaliza created_at para comparación de watermark. Si ya es string
 * (producido por to_char con .US, o fixtures ISO), se conserva tal cual para
 * no truncar microsegundos. Si es Date (pg sin to_char), se convierte a ISO.
 */
function created_at_string(v: string | Date): string {
  return typeof v === 'string' ? v : v.toISOString();
}

/** Calcula el watermark máximo a partir de las filas aplicadas. */
export function computeWatermark(rows: ImageRow[]): Watermark | null {
  if (rows.length === 0) return null;
  let max: Watermark | null = null;
  for (const row of rows) {
    const ts = created_at_string(row.created_at);
    if (!max || ts > max.created_at || (ts === max.created_at && row.id > max.id)) {
      max = { created_at: ts, id: row.id };
    }
  }
  return max;
}

/**
 * Aplica filas nuevas a un snapshot existente, mutando sus estructuras in situ
 * (por eso debe ejecutarse de forma síncrona, sin awaits entre escrituras).
 *
 * Solo maneja adiciones (append-only): las filas deben corresponder a ids que
 * aún no existen en el snapshot. Updates/deletes de filas antiguas los detecta
 * el rebuild completo periódico (GRAPH_FULL_RELOAD_MS).
 */
export function applyDelta(snap: GraphSnapshot, newRows: ImageRow[]): void {
  const t0 = Date.now();
  let added = 0;

  for (const row of newRows) {
    if (snap.byId.has(row.id)) continue; // ya existe; el rebuild la reconciliaría
    addRowToBuilder(snap, row);
    added++;
  }

  if (added === 0) return;

  // Recrear aristas CO_OCCURS_WITH con los pesos ya actualizados.
  rebuildCoOccurrenceEdges(snap);

  // Recalcular derivadas (ahora que el builder está completo).
  const next = finalizeSnapshot(snap, t0);
  snap.orderedIds = next.orderedIds;
  snap.topByDegree = next.topByDegree;
  snap.stats = next.stats;
  snap.builtAt = next.builtAt;
  snap.buildMs = next.buildMs;
}

export class GraphStore {
  private _snapshot: GraphSnapshot | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _ready = false;
  private _watermark: Watermark | null = null;
  private _lastFullReload = 0;

  get snapshot(): GraphSnapshot | null { return this._snapshot; }
  get ready(): boolean { return this._ready; }
  get watermark(): Watermark | null { return this._watermark; }

  /** Carga el snapshot desde filas (pura, sin I/O). */
  load(rows: ImageRow[]): void {
    this._snapshot = buildGraph(rows);
    this._watermark = computeWatermark(rows);
    this._ready = true;
    this._lastFullReload = Date.now();
    console.log(
      `[graph] loaded ${rows.length} images, ${this._snapshot.graph.order} nodes, ${this._snapshot.graph.size} edges`,
    );
  }

  /**
   * Inicia el timer de refresh periódico.
   *
   * Cada tick decide: si pasó fullReloadMs (o aún no hay watermark), hace un
   * fetch completo + rebuild; si no, hace un fetch incremental (delta) y lo
   * aplica mutando el snapshot actual.
   */
  startRefresh(
    fetchAllFn: () => Promise<ImageRow[]>,
    fetchDeltaFn: (wm: Watermark) => Promise<ImageRow[]>,
    intervalMs: number,
    fullReloadMs: number,
  ): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(async () => {
      try {
        const needFull = !this._watermark || Date.now() - this._lastFullReload >= fullReloadMs;
        if (needFull) {
          const rows = await fetchAllFn();
          this.load(rows);
        } else {
          const rows = await fetchDeltaFn(this._watermark!);
          if (rows.length > 0) {
            applyDelta(this._snapshot!, rows);
            this._watermark = computeWatermark(rows) ?? this._watermark;
            console.log(`[graph] delta +${rows.length} refreshed (buildMs ${this._snapshot?.buildMs}ms)`);
          }
        }
      } catch (err) {
        console.error('[graph] refresh failed:', err);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Serializa el grafo para el endpoint /api/graph. */
  exportGraph(opts: { types?: string[]; limit?: number; center?: string; hops?: number } = {}): GraphExport {
    if (!this._snapshot) return { nodes: [], edges: [] };
    return exportSnapshot(this._snapshot, opts);
  }
}

// ── Singleton global ────────────────────────────────────────────────────────

/**
 * Instancia singleton del store. Las rutas la importan para leer el snapshot.
 */
export const graphStore = new GraphStore();

/**
 * Normaliza filas de Postgres: pg devuelve timestamptz como `Date` (1ms de
 * precisión), pero el watermark y los ordenamientos necesitan el valor exacto
 * con microsegundos. Se selecciona `created_at` ya casteado a texto ISO UTC
 * (`to_char` con .US) para no perder precisión en la frontera JS. Este helper
 * solo defiende contra objetos Date residuales (mock/fixtures no aplican).
 */
function normalizeRows(rows: ImageRow[]): ImageRow[] {
  return rows.map((r) => {
    const ts = r.created_at as unknown;
    return typeof ts !== 'string'
      ? { ...r, created_at: (ts as Date).toISOString() }
      : r;
  });
}

/**
 * Fetch completo de generated_images desde Postgres.
 * Se usa para la carga inicial y el rebuild periódico (GRAPH_FULL_RELOAD_MS).
 */
export async function fetchAllRows(): Promise<ImageRow[]> {
  const { config } = await import('./config');
  if (config.mock) {
    const { MOCK_IMAGES } = await import('./mockData');
    return MOCK_IMAGES;
  }
  const { pool } = await import('./db');
  const { rows } = await pool.query(
    `SELECT id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
            mood, color_palette, use_case, filename,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM generated_images`,
  );
  return normalizeRows(rows as unknown as ImageRow[]);
}

/**
 * Fetch incremental: filas estrictamente mayores al watermark (created_at, id).
 * En mock mode devuelve [] porque los datos son estáticos.
 */
export async function fetchDeltaRows(wm: Watermark): Promise<ImageRow[]> {
  const { config } = await import('./config');
  if (config.mock) return [];
  const { pool } = await import('./db');
  const { rows } = await pool.query(
    `SELECT id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
            mood, color_palette, use_case, filename,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM generated_images
     WHERE (created_at, id::text) > ($1::timestamptz, $2::text)
     ORDER BY created_at ASC, id ASC`,
    [wm.created_at, wm.id],
  );
  return normalizeRows(rows as unknown as ImageRow[]);
}
