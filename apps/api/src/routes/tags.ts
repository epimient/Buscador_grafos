import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { graphStore, tagsList as graphTagsList, tagImages as graphTagImages } from '../graph';
import { config } from '../config';

export const tagsRouter = Router();

// GET /api/tags — list unique tags with counts, ordered by count DESC.
tagsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));

    if (config.graph.engine === 'graph' && graphStore.ready) {
      const snap = graphStore.snapshot!;
      const result = graphTagsList(snap, limit);
      res.json(result);
      return;
    }

    // Fallback SQL
    const { rows } = await query(
      `
      SELECT tag, COUNT(*)::int AS count
      FROM (
        SELECT UNNEST(tags) AS tag FROM generated_images WHERE tags IS NOT NULL
      ) t
      WHERE tag IS NOT NULL AND tag <> ''
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT $1
      `,
      [limit],
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/tag/:tag — images filtered by tag (single)
tagsRouter.get('/:tag/images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tag = String(req.params.tag);
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 24)));

    if (config.graph.engine === 'graph' && graphStore.ready) {
      const snap = graphStore.snapshot!;
      const result = graphTagImages(snap, tag, { page, limit });
      res.json(result);
      return;
    }

    // Fallback SQL
    const offset = (page - 1) * limit;
    const countSql = `SELECT COUNT(*)::int AS total FROM generated_images WHERE tags && ARRAY[$1]::text[]`;
    const dataSql = `
      SELECT id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
             mood, color_palette, use_case, filename, created_at
      FROM generated_images
      WHERE tags && ARRAY[$1]::text[]
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [countRes, dataRes] = await Promise.all([
      query(countSql, [tag]),
      query(dataSql, [tag]),
    ]);
    const total = countRes.rows[0].total as number;
    res.json({
      items: dataRes.rows,
      page,
      limit,
      total,
      hasMore: offset + dataRes.rows.length < total,
      tag,
    });
  } catch (err) {
    next(err);
  }
});
