/**
 * Benchmark: SQL vs Graph search engine.
 *
 * Requiere conexión a Postgres real (apps/api/.env).
 * Ejecutar: npx ts-node --transpile-only bench/compare.ts
 */
import { config } from '../src/config';
import { pool } from '../src/db';
import { buildGraph, search, related, tagsList, tagImages, filters, stats } from '../src/graph';
import type { ImageRow } from '../src/types';

async function fetchAllRows(): Promise<ImageRow[]> {
  const { rows } = await pool.query(
    `SELECT id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
            mood, color_palette, use_case, filename, created_at
     FROM generated_images`,
  );
  return rows as ImageRow[];
}

async function benchSqlSearch(q: string, iterations: number): Promise<number[]> {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const ilike = `%${q}%`;
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await pool.query(
      `
      SELECT id FROM generated_images
      WHERE tags && $1::text[]
        OR subject ILIKE $2
        OR original_prompt ILIKE $2
        OR enhanced_prompt ILIKE $2
      ORDER BY
        (COALESCE(cardinality(ARRAY(SELECT UNNEST(tags) INTERSECT SELECT UNNEST($1::text[]))), 0) * 3
         + CASE WHEN subject ILIKE $2 THEN 2 ELSE 0 END
         + CASE WHEN original_prompt ILIKE $2 THEN 1 ELSE 0 END
         + CASE WHEN enhanced_prompt ILIKE $2 THEN 1 ELSE 0 END) DESC,
        created_at DESC
      LIMIT 24
      `,
      [terms, ilike],
    );
    times.push(performance.now() - start);
  }
  return times;
}

async function benchSqlRelated(id: string, iterations: number): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await pool.query(
      `SELECT id FROM generated_images
       WHERE id::text <> $1
       ORDER BY
         (COALESCE(cardinality(ARRAY(SELECT UNNEST(tags) INTERSECT SELECT UNNEST(
           (SELECT tags FROM generated_images WHERE id = $1)::text[]
         ))), 0)) DESC,
         created_at DESC
       LIMIT 8`,
      [id],
    );
    times.push(performance.now() - start);
  }
  return times;
}

async function benchSqlTags(iterations: number): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await pool.query(
      `SELECT tag, COUNT(*)::int AS count
       FROM (SELECT UNNEST(tags) AS tag FROM generated_images WHERE tags IS NOT NULL) t
       WHERE tag IS NOT NULL AND tag <> ''
       GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 200`,
    );
    times.push(performance.now() - start);
  }
  return times;
}

function median(arr: number[]): number {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function main() {
  console.log('=== VORAEL Benchmark: SQL vs Graph ===\n');

  // 1. Cargar datos.
  console.log('Loading rows from Postgres...');
  const rows = await fetchAllRows();
  console.log(`  ${rows.length} rows loaded.\n`);

  // 2. Construir grafo.
  console.log('Building graph...');
  const gStart = performance.now();
  const snap = buildGraph(rows);
  const gTime = performance.now() - gStart;
  console.log(`  Graph built in ${gTime.toFixed(1)}ms`);
  console.log(`  Nodes: ${snap.graph.order}, Edges: ${snap.graph.size}`);
  console.log(`  Tags: ${snap.tagIndex.size}, Styles: ${snap.styleIndex.size}, Moods: ${snap.moodIndex.size}\n`);

  // 3. Benchmarks.
  const ITER = 20;
  const queries = ['cat', 'city', 'robot neon', 'sunset landscape'];

  console.log(`--- Search (${ITER} iterations each) ---`);
  for (const q of queries) {
    const sqlTimes = await benchSqlSearch(q, ITER);
    const graphTimes: number[] = [];
    for (let i = 0; i < ITER; i++) {
      const start = performance.now();
      search(snap, q, { limit: 24 });
      graphTimes.push(performance.now() - start);
    }
    console.log(`  "${q}": SQL median ${median(sqlTimes).toFixed(1)}ms | Graph median ${median(graphTimes).toFixed(1)}ms | speedup ${(median(sqlTimes) / median(graphTimes)).toFixed(1)}x`);
  }

  const firstId = rows[0]?.id;
  if (firstId) {
    console.log(`\n--- Related (${ITER} iterations) ---`);
    const sqlTimes = await benchSqlRelated(firstId, ITER);
    const graphTimes: number[] = [];
    for (let i = 0; i < ITER; i++) {
      const start = performance.now();
      related(snap, firstId, 8);
      graphTimes.push(performance.now() - start);
    }
    console.log(`  SQL median ${median(sqlTimes).toFixed(1)}ms | Graph median ${median(graphTimes).toFixed(1)}ms | speedup ${(median(sqlTimes) / median(graphTimes)).toFixed(1)}x`);
  }

  console.log(`\n--- Tags (${ITER} iterations) ---`);
  const sqlTimes = await benchSqlTags(ITER);
  const graphTimes: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const start = performance.now();
    tagsList(snap, 200);
    graphTimes.push(performance.now() - start);
  }
  console.log(`  SQL median ${median(sqlTimes).toFixed(1)}ms | Graph median ${median(graphTimes).toFixed(1)}ms | speedup ${(median(sqlTimes) / median(graphTimes)).toFixed(1)}x`);

  console.log(`\n--- Filters (graph only, instant) ---`);
  const fStart = performance.now();
  filters(snap);
  console.log(`  filters(): ${(performance.now() - fStart).toFixed(2)}ms`);

  const sStart = performance.now();
  stats(snap);
  console.log(`  stats(): ${(performance.now() - sStart).toFixed(2)}ms`);

  console.log('\n=== Done ===');
  await pool.end();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
