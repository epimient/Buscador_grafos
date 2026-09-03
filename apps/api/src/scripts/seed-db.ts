/**
 * Seed PostgreSQL with the 30 mock images from mockData.ts.
 * Usage:
 *   DB_MOCK=false pnpm seed:db
 * Requires a running Postgres (docker compose up -d).
 */
import { Pool } from 'pg';
import { MOCK_IMAGES } from '../mockData';
import type { ImageRow } from '../types';

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
  console.log(`[seed] connecting to ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5433'}`);

  for (const img of MOCK_IMAGES) {
    await upsertRow(pool, img);
    console.log(`[seed] upserted ${img.id}`);
  }

  const count = await pool.query('SELECT COUNT(*)::int AS total FROM generated_images');
  console.log(`[seed] done — ${count.rows[0].total} rows in generated_images`);

  await pool.end();
}

main().catch((err) => {
  console.error('[seed] failed:', err.message);
  process.exit(1);
});
