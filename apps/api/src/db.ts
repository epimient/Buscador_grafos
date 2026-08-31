import { Pool, QueryResult, QueryConfig } from 'pg';
import { config } from './config';

type QueryParams = string | QueryConfig;

let _pool: Pool | null = null;

if (!config.mock) {
  _pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  _pool.on('error', (err) => {
    console.error('[pg] unexpected pool error', err);
  });
}

/** Real Postgres pool. Null in mock mode. */
export const pool = _pool!;

/** Mock-aware query: returns mock data when DB_MOCK=true, real pool otherwise. */
export async function query(sql: string, params?: unknown[]): Promise<QueryResult> {
  if (config.mock) {
    return mockQuery(sql, params);
  }
  return pool.query(sql, params);
}

export async function pingDb(): Promise<void> {
  if (config.mock) {
    console.log('[db] mock mode — ping skipped');
    return;
  }
  const res = await pool.query('SELECT 1 as ok');
  if (!res.rows[0]?.ok) throw new Error('DB ping failed');
}

// ── Mock query engine ────────────────────────────────────────────────────────

import { MOCK_IMAGES, MOCK_TOTAL } from './mockData';
import type { ImageRow } from './types';

function matchWhere(sql: string, params?: unknown[]): ImageRow[] {
  let rows = [...MOCK_IMAGES];

  // style = $N
  const styleMatch = sql.match(/style\s*=\s*\$(\d+)/i);
  if (styleMatch && params) {
    const val = params[Number(styleMatch[1]) - 1] as string;
    rows = rows.filter((r) => r.style === val);
  }

  // mood = $N
  const moodMatch = sql.match(/mood\s*=\s*\$(\d+)/i);
  if (moodMatch && params) {
    const val = params[Number(moodMatch[1]) - 1] as string;
    rows = rows.filter((r) => r.mood === val);
  }

  // use_case = $N
  const ucMatch = sql.match(/use_case\s*=\s*\$(\d+)/i);
  if (ucMatch && params) {
    const val = params[Number(ucMatch[1]) - 1] as string;
    rows = rows.filter((r) => r.use_case === val);
  }

  // id = $N
  const idMatch = sql.match(/id\s*=\s*\$(\d+)/i);
  if (idMatch && params) {
    const val = params[Number(idMatch[1]) - 1] as string;
    rows = rows.filter((r) => r.id === val);
  }

  // tags && ARRAY[$N]::text[]  (single tag)
  const tagArrayMatch = sql.match(/tags\s*&&\s*ARRAY\[\$\d+\]::text\[\]/i);
  if (tagArrayMatch && params) {
    const paramIdx = Number(tagArrayMatch[0].match(/\$(\d+)/)![1]) - 1;
    const tag = params[paramIdx] as string;
    rows = rows.filter((r) => r.tags?.includes(tag));
  }

  return rows;
}

function buildItems(rows: ImageRow[], sql: string, _params?: unknown[]): ImageRow[] {
  const cols = [...rows];

  // ORDER BY created_at DESC, id DESC
  if (sql.includes('ORDER BY')) {
    cols.sort((a: any, b: any) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return (b.id ?? '').localeCompare(a.id ?? '');
    });
  }

  return cols;
}

function paginate(items: ImageRow[], sql: string): { items: ImageRow[]; total: number } {
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  const offsetMatch = sql.match(/OFFSET\s+(\d+)/i);
  const limit = limitMatch ? Number(limitMatch[1]) : items.length;
  const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
  };
}

async function mockQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
  const lower = sql.replace(/\s+/g, ' ').trim();

  // SELECT 1 as ok (ping)
  if (lower.includes('select 1')) {
    return { rows: [{ ok: true }], rowCount: 1 } as QueryResult;
  }

  // COUNT(*) for stats
  if (lower.includes('count(*)::int as total') && lower.includes('from generated_images') && !lower.includes('where')) {
    return { rows: [{ total: MOCK_TOTAL }], rowCount: 1 } as QueryResult;
  }

  // COUNT(*) with where
  if (lower.includes('count(*)::int as total') && lower.includes('where')) {
    const matched = matchWhere(lower, params);
    return { rows: [{ total: matched.length }], rowCount: 1 } as QueryResult;
  }

  // UNNEST tags for tag listing
  if (lower.includes('unnest(tags)')) {
    const tagCounts = new Map<string, number>();
    for (const img of MOCK_IMAGES) {
      if (!img.tags) continue;
      for (const t of img.tags) {
        if (t) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const items = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    const limitMatch = lower.match(/limit\s+(\d+)/i);
    const limited = limitMatch ? items.slice(0, Number(limitMatch[1])) : items;
    return { rows: limited, rowCount: limited.length } as QueryResult;
  }

  // style/mood/use_case facet queries (GROUP BY)
  if (lower.match(/group by (style|mood|use_case)/i)) {
    const dim = lower.match(/group by (\w+)/i)![1] as keyof ImageRow;
    const counts = new Map<string, number>();
    for (const img of MOCK_IMAGES) {
      const val = img[dim] as string | null;
      if (val) counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    const items = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return { rows: items, rowCount: items.length } as QueryResult;
  }

  // SELECT id (related fallback or similar)
  if (lower.startsWith('select id') || lower.startsWith('select tags')) {
    const matched = matchWhere(lower, params);
    return { rows: matched, rowCount: matched.length } as QueryResult;
  }

  // General SELECT with WHERE
  if (lower.includes('where')) {
    const matched = matchWhere(lower, params);
    const built = buildItems(matched, lower, params);
    const { items, total } = paginate(built, lower);
    return { rows: items, rowCount: items.length, command: 'SELECT' } as QueryResult;
  }

  // General SELECT without WHERE (listing)
  const built = buildItems([...MOCK_IMAGES], lower, params);
  const { items, total } = paginate(built, lower);
  return { rows: items, rowCount: items.length, command: 'SELECT' } as QueryResult;
}
