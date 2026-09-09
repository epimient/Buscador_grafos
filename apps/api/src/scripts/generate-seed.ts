/**
 * Generador de seed sintético — VORAEL.
 *
 * Persiste `COUNT` filas generadas por `generateDataset` en Postgres con
 * upsert idempotente. Los ids `gen-*` no colisionan con los datos existentes.
 *
 * Uso:
 *   DB_MOCK=false pnpm seed:generate              → siembra 1000 filas
 *   DB_MOCK=false pnpm seed:generate:clear        → borra gen-* y re-siembra
 *
 * Opciones por env:
 *   GEN_COUNT=2000 pnpm seed:generate             → volumen configurable
 *   GEN_SEED=7     pnpm seed:generate             → semilla distinta
 *   GEN_NO_IMAGES=1 pnpm seed:generate            → refs sintéticas (sin leer disco)
 */
import { Pool } from 'pg';
import { readdir } from 'fs/promises';
import { extname, join } from 'path';
import { generateDataset, type AssetRef } from '../seed/engine';
import type { ImageRow } from '../types';

async function buildAssetRefs(): Promise<AssetRef[]> {
  if (process.env.GEN_NO_IMAGES === '1') return [];

  const dirs = [
    join(__dirname, '../../test-images-real'),
    join(__dirname, '../../test-images'),
  ];

  for (const dir of dirs) {
    try {
      const files = await readdir(dir);
      const refs: AssetRef[] = files
        .filter((f) => /\.(webp|png|jpe?g)$/i.test(extname(f)))
        .map((f) => ({
          s3_key: `${dir.split('/').pop()}/${f}`,
          s3_url: `http://localhost:3001/${dir.split('/').pop()}/${f}`,
        }));
      if (refs.length > 0) return refs;
    } catch {
      // sigue con el siguiente dir
    }
  }
  return [];
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'generated_images',
  user: process.env.DB_USER || 'vorael',
  password: process.env.DB_PASSWORD || 'vorael123',
});

async function upsertRow(pool: Pool, row: ImageRow): Promise<void> {
  await pool.query(
    `INSERT INTO generated_images
       (id, s3_key, s3_url, original_prompt, enhanced_prompt,
        tags, style, subject, mood, color_palette, use_case, filename, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       s3_key = EXCLUDED.s3_key,
       s3_url = EXCLUDED.s3_url,
       original_prompt = EXCLUDED.original_prompt,
       enhanced_prompt = EXCLUDED.enhanced_prompt,
       tags = EXCLUDED.tags,
       style = EXCLUDED.style,
       subject = EXCLUDED.subject,
       mood = EXCLUDED.mood,
       color_palette = EXCLUDED.color_palette,
       use_case = EXCLUDED.use_case,
       filename = EXCLUDED.filename,
       created_at = EXCLUDED.created_at`,
    [
      row.id,
      row.s3_key,
      row.s3_url,
      row.original_prompt,
      row.enhanced_prompt,
      row.tags,
      row.style,
      row.subject,
      row.mood,
      row.color_palette,
      row.use_case,
      row.filename,
      row.created_at,
    ],
  );
}

async function main() {
  const count = Number(process.env.GEN_COUNT || '1000');
  const seed = Number(process.env.GEN_SEED || '42');
  const shouldClear = process.argv.includes('--clear');

  console.log('[gen] conectando a postgres...');
  console.log(`[gen] count=${count} seed=${seed} clear=${shouldClear}`);

  if (shouldClear) {
    const { rowCount } = await pool.query(`DELETE FROM generated_images WHERE id LIKE 'gen-%'`);
    console.log(`[gen] borradas ${rowCount ?? 0} filas gen-*`);
  }

  const assets = await buildAssetRefs();
  console.log(`[gen] ${assets.length} assets de imagen disponibles`);

  const rows = generateDataset(count, { seed, assets });
  console.log(`[gen] dataset generado (${rows.length} filas)`);

  for (let i = 0; i < rows.length; i++) {
    await upsertRow(pool, rows[i]);
    if ((i + 1) % 100 === 0) console.log(`[gen] ${i + 1}/${rows.length}`);
  }

  const result = await pool.query('SELECT COUNT(*)::int AS total FROM generated_images');
  console.log(`[gen] listo — ${result.rows[0].total} filas en generated_images`);
  await pool.end();
}

main().catch((err) => {
  console.error('[gen] failed:', err.message);
  process.exit(1);
});