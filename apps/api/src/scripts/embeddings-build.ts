/**
 * Genera embeddings semánticos para la réplica local.
 *
 * Lee generated_images (solo la parte de texto), compone el texto a embedar,
 * llama a Ollama local (/api/embed) en lotes de 32 y guarda el vector en la
 * tabla aparte image_embeddings (que sobrevive al TRUNCATE de snapshot:prod).
 *
 * Es reanudable e idempotente: solo procesa ids sin embedding del modelo actual.
 *
 * Uso:
 *   DB_HOST=localhost DB_PORT=5433 DB_NAME=generated_images \
 *   DB_USER=vorael DB_PASSWORD=vorael123 EMBED_MODEL=bge-m3 \
 *   pnpm embeddings:build
 *
 * (Requiere: réplica local arriba y Ollama corriendo en EMBED_SERVER)
 */
import { Pool } from 'pg';
import type { ImageRow } from '../types';

function env(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing env ${name}`);
  return v;
}

const EMBED_MODEL = process.env.EMBED_MODEL || 'bge-m3';
const EMBED_SERVER = (process.env.EMBED_SERVER || 'http://127.0.0.1:11434').replace(/\/$/, '');
const BATCH = 32;
const MAX_PROMPT_CHARS = 2000;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'generated_images',
  user: process.env.DB_USER || 'vorael',
  password: process.env.DB_PASSWORD || 'vorael123',
  connectionTimeoutMillis: 10_000,
});

/**
 * Compone el texto a embedar para una fila. Función pura, testeable.
 * $1 = subject, luego metadatos (style·mood·use_case), tags y enhanced_prompt
 * truncado a MAX_PROMPT_CHARS.
 */
export function textToEmbed(row: {
  subject: string | null;
  tags: string[] | null;
  style: string | null;
  mood: string | null;
  use_case: string | null;
  enhanced_prompt: string | null;
}): string {
  const parts: string[] = [];
  if (row.subject) parts.push(row.subject);
  const meta = [row.style, row.mood, row.use_case].filter(Boolean).join(' · ');
  if (meta) parts.push(meta);
  if (row.tags && row.tags.length) parts.push('tags: ' + row.tags.join(', '));
  if (row.enhanced_prompt) parts.push(row.enhanced_prompt.slice(0, MAX_PROMPT_CHARS));
  return parts.join('\n');
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch(`${EMBED_SERVER}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { embeddings: number[][] };
  if (data.embeddings.length !== inputs.length) {
    throw new Error(`ollama devolvió ${data.embeddings.length} embeds para ${inputs.length} inputs`);
  }
  return data.embeddings;
}

async function main(): Promise<void> {
  // 1) Filas sin embedding del modelo actual.
  const { rows } = await pool.query<Pick<ImageRow, 'id' | 'subject' | 'tags' | 'style' | 'mood' | 'use_case' | 'enhanced_prompt'>>(
    `SELECT g.id, g.subject, g.tags, g.style, g.mood, g.use_case, g.enhanced_prompt
     FROM generated_images g
     LEFT JOIN image_embeddings e ON e.id = g.id AND e.model = $1
     WHERE e.id IS NULL
     ORDER BY g.created_at ASC, g.id ASC`,
    [EMBED_MODEL],
  );
  const total = rows.length;
  console.log(`[embeddings] model=${EMBED_MODEL} dims=? — pendientes: ${total}`);
  if (total === 0) {
    console.log('[embeddings] nada que hacer — todas las filas ya tienen embedding con este modelo');
    await pool.end();
    return;
  }

  // 2) Embeds por lotes + INSERT upsert.
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const texts = chunk.map((r) => textToEmbed(r));
    let vectors: number[][];
    try {
      vectors = await embedBatch(texts);
    } catch (err) {
      console.error(`[embeddings] fallo en lote ${i}-${i + chunk.length}: ${(err as Error).message}`);
      console.error('[embeddings] reanudable — revisa Ollama y re-ejecuta');
      await pool.end();
      process.exit(1);
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < chunk.length; j++) {
      const b = j * 3;
      placeholders.push(`($${b + 1},$${b + 2},$${b + 3})`);
      values.push(chunk[j].id, vectors[j], EMBED_MODEL);
    }
    await pool.query(
      `INSERT INTO image_embeddings (id, embedding, model)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model,
         updated_at = now()`,
      values,
    );

    done += chunk.length;
    if (done % 500 === 0 || done === total) {
      console.log(`[embeddings] ${done}/${total} (${((done / total) * 100).toFixed(1)}%)`);
    }
  }

  // 3) Verificación.
  const c = await pool.query(
    `SELECT COUNT(*)::int AS embedded FROM image_embeddings WHERE model = $1`,
    [EMBED_MODEL],
  );
  const dims = await pool.query(
    `SELECT array_length(embedding, 1)::int AS dims FROM image_embeddings WHERE model = $1 LIMIT 1`,
    [EMBED_MODEL],
  );
  console.log(`[embeddings] hecho — ${c.rows[0].embedded} embeddings (dims=${dims.rows[0]?.dims ?? '?'})`);

  await pool.end();
}

main().catch((err) => {
  console.error('[embeddings] failed:', err.message);
  process.exit(1);
});