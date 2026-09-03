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
 * Se construye completo al arrancar. Un timer periódico (GRAPH_REFRESH_MS) compara
 * un watermark barato (MAX(created_at), COUNT). Si cambió, reconstruye completo y
 * reemplaza atómicamente (nunca se ve un grafo a medias). Si falla, conserva el
 * último snapshot válido.
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
  /** Índice de texto por imagen: tokens de subject/original/enhanced. */
  textIndex: Map<string, Token[]>;
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
 * considerando plurales mínimos.
 */
function tokenMatches(term: Token, referenceTokens: Token[]): boolean {
  const refSet = new Set(referenceTokens);
  for (const variant of pluralVariants(term)) {
    if (refSet.has(variant)) return true;
  }
  return false;
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
  const graph = new Graph({ type: 'undirected' });
  const byId = new Map<string, ImageRow>();
  const tagIndex = new Map<string, Set<string>>();
  const styleIndex = new Map<string, Set<string>>();
  const moodIndex = new Map<string, Set<string>>();
  const useCaseIndex = new Map<string, Set<string>>();
  const colorIndex = new Map<string, Set<string>>();
  const textIndex = new Map<string, Token[]>();

  // Conteo para stats y co-ocurrencia.
  const tagCounts = new Map<string, number>();
  const styleCounts = new Map<string, number>();
  const moodCounts = new Map<string, number>();
  const useCaseCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();

  // Co-ocurrencia de tags: tagA → tagB → weight.
  const coOccurrence = new Map<string, Map<string, number>>();

  for (const row of rows) {
    byId.set(row.id, row);

    // Nodo Image.
    graph.addNode(row.id, { type: 'Image' });

    // Tags.
    if (row.tags) {
      for (const tag of row.tags) {
        if (!tag || tag === '') continue;
        const key = TAG + tag;

        // Nodo Tag.
        if (!graph.hasNode(key)) graph.addNode(key, { type: 'Tag', name: tag });
        graph.mergeUndirectedEdge(row.id, key, { type: 'TAGGED_WITH' });

        // Índice.
        let set = tagIndex.get(tag);
        if (!set) { set = new Set(); tagIndex.set(tag, set); }
        set.add(row.id);

        // Conteo.
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }

      // Co-ocurrencia.
      for (let i = 0; i < row.tags.length; i++) {
        for (let j = i + 1; j < row.tags.length; j++) {
          const a = row.tags[i];
          const b = row.tags[j];
          if (!a || !b || a === '' || b === '') continue;
          let mapA = coOccurrence.get(a);
          if (!mapA) { mapA = new Map(); coOccurrence.set(a, mapA); }
          mapA.set(b, (mapA.get(b) ?? 0) + 1);
          let mapB = coOccurrence.get(b);
          if (!mapB) { mapB = new Map(); coOccurrence.set(b, mapB); }
          mapB.set(a, (mapB.get(a) ?? 0) + 1);
        }
      }
    }

    // Style.
    if (row.style) {
      const key = STYLE + row.style;
      if (!graph.hasNode(key)) graph.addNode(key, { type: 'Style', name: row.style });
      graph.mergeUndirectedEdge(row.id, key, { type: 'HAS_STYLE' });
      let set = styleIndex.get(row.style);
      if (!set) { set = new Set(); styleIndex.set(row.style, set); }
      set.add(row.id);
      styleCounts.set(row.style, (styleCounts.get(row.style) ?? 0) + 1);
    }

    // Mood.
    if (row.mood) {
      const key = MOOD + row.mood;
      if (!graph.hasNode(key)) graph.addNode(key, { type: 'Mood', name: row.mood });
      graph.mergeUndirectedEdge(row.id, key, { type: 'HAS_MOOD' });
      let set = moodIndex.get(row.mood);
      if (!set) { set = new Set(); moodIndex.set(row.mood, set); }
      set.add(row.id);
      moodCounts.set(row.mood, (moodCounts.get(row.mood) ?? 0) + 1);
    }

    // Use case.
    if (row.use_case) {
      const key = USE_CASE + row.use_case;
      if (!graph.hasNode(key)) graph.addNode(key, { type: 'UseCase', name: row.use_case });
      graph.mergeUndirectedEdge(row.id, key, { type: 'FOR_USE_CASE' });
      let set = useCaseIndex.get(row.use_case);
      if (!set) { set = new Set(); useCaseIndex.set(row.use_case, set); }
      set.add(row.id);
      useCaseCounts.set(row.use_case, (useCaseCounts.get(row.use_case) ?? 0) + 1);
    }

    // Colors (paleta completa).
    if (row.color_palette) {
      for (const hex of row.color_palette) {
        if (!hex || hex === '') continue;
        const key = COLOR + hex;
        if (!graph.hasNode(key)) graph.addNode(key, { type: 'Color', hex });
        graph.mergeUndirectedEdge(row.id, key, { type: 'HAS_COLOR' });
        let set = colorIndex.get(hex);
        if (!set) { set = new Set(); colorIndex.set(hex, set); }
        set.add(row.id);
        colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
      }
    }

    // Texto tokenizado para search.
    const tokens: Token[] = [];
    if (row.subject) tokens.push(...tokenize(row.subject));
    if (row.original_prompt) tokens.push(...tokenize(row.original_prompt));
    if (row.enhanced_prompt) tokens.push(...tokenize(row.enhanced_prompt));
    textIndex.set(row.id, tokens);
  }

  // Aristas de co-ocurrencia entre tags.
  for (const [tagA, partners] of coOccurrence) {
    for (const [tagB, weight] of partners) {
      const keyA = TAG + tagA;
      const keyB = TAG + tagB;
      if (graph.hasNode(keyA) && graph.hasNode(keyB)) {
        graph.mergeUndirectedEdge(keyA, keyB, { type: 'CO_OCCURS_WITH', weight });
      }
    }
  }

  // Lista ordenada (created_at DESC, id DESC).
  const orderedIds = rows
    .slice()
    .sort((a, b) => {
      const aTime = String(a.created_at);
      const bTime = String(b.created_at);
      const cmp = bTime.localeCompare(aTime);
      return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
    })
    .map((r) => r.id);

  // Nodos ordenados por grado (para export sin center, evita O(n log n) por request).
  const topByDegree = graph.nodes()
    .map((n) => ({ id: n, degree: graph.degree(n) }))
    .sort((a, b) => b.degree - a.degree)
    .map((n) => n.id);

  // Stats.
  const tagStats = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  const styleStats = [...styleCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const moodStats = [...moodCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const useCaseStats = [...useCaseCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    graph,
    byId,
    tagIndex,
    styleIndex,
    moodIndex,
    useCaseIndex,
    colorIndex,
    textIndex,
    coWeights: coOccurrence,
    orderedIds,
    topByDegree,
    stats: {
      total: rows.length,
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
 * Búsqueda por token-match: cada término de la query debe aparecer como palabra
 * completa (con plural mínimo) en subject, original_prompt o enhanced_prompt,
 * O como tag exacto. Puntaje replicado: tags×3, subject+2, prompts+1.
 */
export function search(
  snap: GraphSnapshot,
  q: string,
  opts: { page?: number; limit?: number } = {},
): SearchResult & { page: number; limit: number; hasMore: boolean } {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 24));
  const offset = (page - 1) * limit;

  if (!q.trim()) {
    return { items: [], total: 0, page, limit, hasMore: false };
  }

  const terms = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Calcular score para cada imagen.
  const scored: { id: string; score: number }[] = [];

  for (const [id, row] of snap.byId) {
    let score = 0;

    // Tags overlap (cada tag que matchea = 3).
    if (row.tags) {
      for (const term of terms) {
        if (row.tags.some((t) => pluralVariants(term).includes(t))) {
          score += 3;
        }
      }
    }

    // Subject token-match (= 2).
    if (row.subject) {
      const subjTokens = tokenize(row.subject);
      if (terms.every((term) => tokenMatches(term, subjTokens))) {
        score += 2;
      }
    }

    // Original prompt token-match (= 1).
    if (row.original_prompt) {
      const origTokens = tokenize(row.original_prompt);
      if (terms.every((term) => tokenMatches(term, origTokens))) {
        score += 1;
      }
    }

    // Enhanced prompt token-match (= 1).
    if (row.enhanced_prompt) {
      const enhTokens = tokenize(row.enhanced_prompt);
      if (terms.every((term) => tokenMatches(term, enhTokens))) {
        score += 1;
      }
    }

    if (score > 0) scored.push({ id, score });
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

  const total = scored.length;
  const slice = scored.slice(offset, offset + limit);
  const items = slice.map((s) => snap.byId.get(s.id)!);

  return {
    items,
    total,
    page,
    limit,
    hasMore: offset + items.length < total,
  };
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

export class GraphStore {
  private _snapshot: GraphSnapshot | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _ready = false;

  get snapshot(): GraphSnapshot | null { return this._snapshot; }
  get ready(): boolean { return this._ready; }

  /** Carga el snapshot desde filas (pura, sin I/O). */
  load(rows: ImageRow[]): void {
    this._snapshot = buildGraph(rows);
    this._ready = true;
    console.log(
      `[graph] loaded ${rows.length} images, ${this._snapshot.graph.order} nodes, ${this._snapshot.graph.size} edges`,
    );
  }

  /** Inicia el timer de refresh periódico. */
  startRefresh(
    fetchFn: () => Promise<ImageRow[]>,
    intervalMs: number,
  ): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(async () => {
      try {
        const rows = await fetchFn();
        this.load(rows);
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
 * Fetch completo de generated_images desde Postgres.
 * Se usa para la carga inicial y el refresh periódico.
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
            mood, color_palette, use_case, filename, created_at
     FROM generated_images`,
  );
  return rows as ImageRow[];
}
