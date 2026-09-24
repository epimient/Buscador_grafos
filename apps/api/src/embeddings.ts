/**
 * Motor de búsqueda semántica — VORAEL.
 *
 * - `SemanticIndex`: mapa id → vector (Float32Array), cargado en memoria desde
 *   la tabla `image_embeddings` (que sobrevive al TRUNCATE de snapshot:prod).
 * - `cosine()`: similitud coseno (ingenuo pero suficiente a 53k × dim 1024).
 * - `embedQuery()`: texto de consulta → vector vía Ollama local (/api/embed),
 *   con cache LRU y fail-open (devuelve null si Ollama no responde).
 * - `searchSemantic()`: top-k por coseno contra el índice.
 * - `rrfFuse()`: Reciprocal Rank Fusion para el modo hybrid.
 *
 * En modo mock (config.mock) el índice está vacío y el embedding se degrada a
 * lexical — el API sigue funcionando sin Ollama ni tabla.
 */
import { config } from './config';

export type SemanticIndex = {
  vectors: Map<string, Float32Array>;
  model: string;
  dim: number;
  builtAt: Date;
};

/** Cache LRU simple para el vector de la query. */
export class EmbeddingCache {
  private map = new Map<string, Float32Array>();
  constructor(private max = 512) {}

  get(key: string): Float32Array | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: Float32Array): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

export const embedCache = new EmbeddingCache();

/**
 * Carga el índice semántico desde la tabla `image_embeddings`.
 * En mock devuelve un índice vacío. Si la tabla no existe (replica vieja)
 * devuelve vacío también en vez de romper el arranque.
 */
export async function loadSemanticIndex(): Promise<SemanticIndex> {
  const { model } = config.semantic;
  if (config.mock) {
    return { vectors: new Map(), model, dim: 0, builtAt: new Date() };
  }

  const t0 = Date.now();
  try {
    const { query } = await import('./db');
    const res = await query(
      `SELECT id, embedding, model FROM image_embeddings WHERE model = $1`,
      [model],
    );
    const vectors = new Map<string, Float32Array>();
    let dim = 0;
    for (const row of res.rows) {
      const arr = Float32Array.from(row.embedding as number[]);
      dim = arr.length;
      vectors.set(row.id as string, arr);
    }
    if (config.semantic.dim > 0 && dim !== config.semantic.dim) {
      console.warn(
        `[semantic] las filas tienen dims=${dim} pero EMBED_DIM=${config.semantic.dim} — se usará ${dim}`,
      );
    }
    console.log(
      `[semantic] índice cargado: ${vectors.size} vectores (dims=${dim}, model=${model}) en ${Date.now() - t0}ms`,
    );
    return { vectors, model, dim, builtAt: new Date() };
  } catch (err) {
    console.warn(`[semantic] índice vacío (¿tabla inexistente?): ${(err as Error).message}`);
    return { vectors: new Map(), model, dim: 0, builtAt: new Date() };
  }
}

// ── Cache compartida del índice (warmup + refresh) ─────────────────────────
//
// warmSemanticIndex() se dispara en el boot para que el primer request en modo
// semantic/hybrid no pague la carga de 53k vectores (~21s > timeout del cliente).
// startSemanticRefresh() recarga el índice con la misma cadencia que el full
// reload del grafo (GRAPH_FULL_RELOAD_MS), para que los embeddings nuevos
// aparezcan sin reiniciar el proceso.

let sharedIndex: SemanticIndex | null = null;
let sharedLoading: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  try {
    sharedIndex = await loadSemanticIndex();
  } catch (err) {
    // loadSemanticIndex ya es fail-open; esto es puramente defensivo.
    console.warn(`[semantic] carga del índice falló: ${(err as Error).message}`);
  } finally {
    sharedLoading = null;
  }
}

/** Dispara la carga en segundo plano (no bloquea el boot). Idempotente. */
export function warmSemanticIndex(): void {
  if (sharedIndex || sharedLoading) return;
  sharedLoading = ensureLoaded();
}

/** Devuelve el índice compartido, cargándolo si todavía no se cargó. */
export async function getSemanticIndex(): Promise<SemanticIndex | null> {
  warmSemanticIndex();
  if (sharedLoading) await sharedLoading;
  return sharedIndex;
}

/**
 * Recarga periódica del índice. El timer queda desvinculado (unref) para que
 * no sostenga vivo el proceso en tests/CLI.
 */
export function startSemanticRefresh(intervalMs: number): NodeJS.Timeout {
  const timer = setInterval(() => {
    const t0 = Date.now();
    loadSemanticIndex()
      .then((idx) => {
        sharedIndex = idx;
        console.log(
          `[semantic] índice refrescado (${idx.vectors.size} vectores) en ${Date.now() - t0}ms`,
        );
      })
      .catch(() => {});
  }, Math.max(intervalMs, 10_000));
  timer.unref();
  return timer;
}

/** Similitud coseno entre dos vectores de igual longitud. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Commits el texto de la query a un vector vía Ollama. Fail-open: si Ollama no
 * responde (caído, modelo ausente), devuelve null y el caller degrada a lexical.
 */
export async function embedQuery(text: string): Promise<Float32Array | null> {
  const key = `${config.semantic.model}\u0000${text}`;
  const cached = embedCache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(`${config.semantic.server}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.semantic.model, input: [text] }),
    });
    if (!res.ok) throw new Error(`ollama http ${res.status}`);
    const data = (await res.json()) as { embeddings: number[][] };
    const vec = Float32Array.from(data.embeddings[0]);
    embedCache.set(key, vec);
    return vec;
  } catch (err) {
    console.warn(`[semantic] embedQuery falló (degradando a lexical): ${(err as Error).message}`);
    return null;
  }
}

/**
 * Top-k por similitud coseno. Devuelve ids ordenados desc + score.
 * `minScore` descarta resultados con coseno por debajo del umbral: el coseno
 * positivo fue demasiado laxo (cualquier par de puntos con ángulo < 90° entraba,
 * trayendo ruido como "juez"/"ventanilla"), así que solo sobreviven los matches
 * realmente relacionados. Default desde config.semantic.minScore (SEMANTIC_MIN_SCORE).
 */
export function searchSemantic(
  index: SemanticIndex,
  qVec: Float32Array,
  k: number = 100,
  minScore: number = config.semantic.minScore,
): { id: string; score: number }[] {
  const results: { id: string; score: number }[] = [];
  if (index.dim === 0 || qVec.length !== index.dim) return results;

  for (const [id, vec] of index.vectors) {
    const score = cosine(qVec, vec);
    if (score > minScore) results.push({ id, score });
  }

  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return results.slice(0, k);
}

export interface RankedResult {
  id: string;
  score: number;
  lexicalRank?: number;
  semanticRank?: number;
}

/**
 * Reciprocal Rank Fusion: combina los rankings léxico y semántico tomando la
 * unión de top-k de cada uno y sumando 1/(60+rank) por lista donde aparezca.
 * k = zona de confianza del RRF (60 es el clásico).
 */
export function rrfFuse(
  lexical: { id: string }[],
  semantic: { id: string }[],
  k: number = 60,
): RankedResult[] {
  const scoreMap = new Map<string, RankedResult>();
  const lexicalRank = new Map<string, number>();
  const semanticRank = new Map<string, number>();

  lexical.forEach((r, i) => lexicalRank.set(r.id, i + 1));
  semantic.forEach((r, i) => semanticRank.set(r.id, i + 1));

  const union = new Set<string>([...lexicalRank.keys(), ...semanticRank.keys()]);
  for (const id of union) {
    let score = 0;
    const lr = lexicalRank.get(id);
    const sr = semanticRank.get(id);
    if (lr) score += 1 / (k + lr);
    if (sr) score += 1 / (k + sr);
    scoreMap.set(id, {
      id,
      score,
      lexicalRank: lr,
      semanticRank: sr,
    });
  }

  return [...scoreMap.values()].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  );
}