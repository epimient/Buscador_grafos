import { Router, Request, Response, NextFunction } from 'express';
import { graphStore, search as graphSearch } from '../graph';
import { config } from '../config';

export const searchRouter = Router();

// GET /api/search?q=...&page=1&limit=24
searchRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 24)));

    if (!q) {
      res.json({ items: [], page, limit, total: 0, hasMore: false, q });
      return;
    }

    if (config.graph.engine === 'graph' && graphStore.ready) {
      const snap = graphStore.snapshot!;
      const result = graphSearch(snap, q, { page, limit });
      res.json({
        items: result.items,
        page: result.page,
        limit: result.limit,
        total: result.total,
        hasMore: result.hasMore,
        q,
      });
      return;
    }

    // Fallback SQL
    const { query } = await import('../db');
    const offset = (page - 1) * limit;
    const terms = q
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const ilike = `%${q}%`;

    const where = `
      tags && $1::text[]
      OR subject ILIKE $2
      OR original_prompt ILIKE $2
      OR enhanced_prompt ILIKE $2
    `;

    const dataSql = `
      SELECT id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
             mood, color_palette, use_case, filename, created_at,
             (
               COALESCE(cardinality(ARRAY(SELECT UNNEST(tags) INTERSECT SELECT UNNEST($1::text[]))), 0) * 3
               + CASE WHEN subject ILIKE $2 THEN 2 ELSE 0 END
               + CASE WHEN original_prompt ILIKE $2 THEN 1 ELSE 0 END
               + CASE WHEN enhanced_prompt ILIKE $2 THEN 1 ELSE 0 END
             ) AS score
      FROM generated_images
      WHERE ${where}
      ORDER BY score DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countSql = `SELECT COUNT(*)::int AS total FROM generated_images WHERE ${where}`;

    const [countRes, dataRes] = await Promise.all([
      query(countSql, [terms, ilike]),
      query(dataSql, [terms, ilike]),
    ]);

    const total = countRes.rows[0].total as number;
    res.json({
      items: dataRes.rows,
      page,
      limit,
      total,
      hasMore: offset + dataRes.rows.length < total,
      q,
    });
  } catch (err) {
    next(err);
  }
});
