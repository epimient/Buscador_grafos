/**
 * Snapshot one-time de producción → Postgres local.
 *
 * Copia TODA la tabla generated_images desde una BD "fuente" (producción a
 * través del túnel SSH) hacia la BD local Docker (comúnmente :5433). Al terminar
 * deja la DB local con una réplica exacta, para poder probar el grafo offline
 * contra el volumen real (53k filas) sin depender del túnel.
 *
 * Uso:
 *   SOURCE_DB_HOST=localhost \
 *   SOURCE_DB_PORT=9913 \
 *   SOURCE_DB_NAME=generated_images \
 *   SOURCE_DB_USER=vorael_ing_diana \
 *   SOURCE_DB_PASSWORD='...' \
 *   SOURCE_DB_SSL=false \
 *   DB_HOST=localhost DB_PORT=5433 DB_NAME=generated_images \
 *   DB_USER=vorael DB_PASSWORD=vorael123 \
 *   pnpm snapshot:prod
 *
 * (Requiere el túnel SSH abierto: ssh -i ~/.ssh/tunel_9913 -N -L 9913:localhost:9913 ... ;
 *  y el Docker local arriba: sudo docker compose up -d)
 */
import { Pool } from 'pg';
import type { ImageRow } from '../types';

function env(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing env ${name}`);
  return v;
}

const sourcePool = new Pool({
  host: env('SOURCE_DB_HOST'),
  port: Number(env('SOURCE_DB_PORT')),
  database: env('SOURCE_DB_NAME'),
  user: env('SOURCE_DB_USER'),
  password: env('SOURCE_DB_PASSWORD'),
  ssl: process.env.SOURCE_DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 15_000,
  // La SELECT completa de 53k filas con prompts tarda minutos por el túnel.
  statement_timeout: 300_000,
});

const targetPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'generated_images',
  user: process.env.DB_USER || 'vorael',
  password: process.env.DB_PASSWORD || 'vorael123',
  connectionTimeoutMillis: 10_000,
});

const CHUNK = 1000;

async function ensureSchema(target: Pool): Promise<void> {
  await target.query(`
    CREATE TABLE IF NOT EXISTS generated_images (
      id text PRIMARY KEY,
      s3_key text NOT NULL,
      s3_url text NOT NULL,
      original_prompt text,
      enhanced_prompt text,
      tags text[],
      style text,
      subject text,
      mood text,
      color_palette text[],
      use_case text,
      filename text,
      created_at timestamptz NOT NULL
    );
  `);
  await target.query('CREATE INDEX IF NOT EXISTS idx_gi_style ON generated_images(style)');
  await target.query('CREATE INDEX IF NOT EXISTS idx_gi_mood ON generated_images(mood)');
  await target.query('CREATE INDEX IF NOT EXISTS idx_gi_use_case ON generated_images(use_case)');
  await target.query('CREATE INDEX IF NOT EXISTS idx_gi_created_at ON generated_images(created_at DESC)');
  // Embeddings semánticos: tabla aparte (el TRUNCATE de generated_images no la toca).
  await target.query(`
    CREATE TABLE IF NOT EXISTS image_embeddings (
      id text PRIMARY KEY REFERENCES generated_images(id) ON DELETE CASCADE,
      embedding real[] NOT NULL,
      model text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function insertChunk(pool: Pool, rows: ImageRow[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const base = i * 13;
    placeholders.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},` +
        `$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13})`,
    );
    values.push(
      r.id,
      r.s3_key,
      r.s3_url,
      r.original_prompt,
      r.enhanced_prompt,
      r.tags,
      r.style,
      r.subject,
      r.mood,
      r.color_palette,
      r.use_case,
      r.filename,
      r.created_at,
    );
  }
  await pool.query(
    `INSERT INTO generated_images
       (id, s3_key, s3_url, original_prompt, enhanced_prompt,
        tags, style, subject, mood, color_palette, use_case, filename, created_at)
     VALUES ${placeholders.join(',')}`,
    values,
  );
}

async function main() {
  const dest = `${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5433'}`;
  console.log(`[snapshot] source  ${env('SOURCE_DB_HOST')}:${env('SOURCE_DB_PORT')}`);
  console.log(`[snapshot] target  ${dest}`);

  // 1) Leer todas las filas de la fuente (una sola SELECT grande).
  const { rows } = await sourcePool.query<ImageRow>(
    `SELECT id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
            mood, color_palette, use_case, filename, created_at
     FROM generated_images
     ORDER BY created_at ASC, id ASC`,
  );
  console.log(`[snapshot] fetched ${rows.length} rows from source`);

  // 2) Esquema + TRUNCATE + re-inserción en chunks en el destino.
  await ensureSchema(targetPool);
  await targetPool.query('TRUNCATE generated_images');

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await insertChunk(targetPool, chunk);
    if ((i / CHUNK) % 25 === 0) console.log(`[snapshot] inserted ${i + chunk.length}/${rows.length}`);
  }

  // 3) Verificación.
  const count = await targetPool.query('SELECT COUNT(*)::int AS total FROM generated_images');
  const sample = await targetPool.query(
    `SELECT style, COUNT(*)::int AS c FROM generated_images GROUP BY style ORDER BY c DESC LIMIT 3`,
  );
  console.log(`[snapshot] done — local has ${count.rows[0].total} rows`);
  console.log('[snapshot] top styles:', JSON.stringify(sample.rows));

  await sourcePool.end();
  await targetPool.end();
}

main().catch((err) => {
  console.error('[snapshot] failed:', err.message);
  process.exit(1);
});