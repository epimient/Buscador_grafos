import { Router, Request, Response, NextFunction } from 'express';
import { graphStore, scoreSearch } from '../graph';
import { config } from '../config';

export const searchRouter = Router();

// Cache del índice semántico (in-memory). Se carga perezosamente en el primer
// request en modo semantic/hybrid y se mantiene mientras el proceso viva.
let semIndexCache: import('../embeddings').SemanticIndex | null = null;

// GET /api/search?q=...&page=1&limit=24&mode=hybrid
searchRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 24)));
    const mode =
      typeof req.query.mode === 'string' &&
      ['lexical', 'semantic', 'hybrid'].includes(req.query.mode)
        ? req.query.mode
        : config.semantic.mode;

    if (!q) {
      res.json({ items: [], page, limit, total: 0, hasMore: false, q });
      return;
    }

    if (config.graph.engine === 'graph' && graphStore.ready) {
      const snap = graphStore.snapshot!;
      const lexical = scoreSearch(snap, q);

      let rankedIds = lexical.ids;

      // Modo hybrid/semantic requieren el índice y Ollama; si cualquiera falla
      // o el índice está vacío, degradamos a lexical sin romper la request.
      if (mode !== 'lexical') {
        const { loadSemanticIndex, embedQuery, searchSemantic, rrfFuse } =
          await import('../embeddings');
        if (!semIndexCache) semIndexCache = await loadSemanticIndex();
        const qVec = await embedQuery(q);

        if (semIndexCache && semIndexCache.dim > 0 && qVec) {
          const semantic = searchSemantic(semIndexCache, qVec, 100);
          if (mode === 'semantic') {
            rankedIds = semantic.map((s) => s.id);
          } else {
            rankedIds = rrfFuse(
              lexical.ids.map((id) => ({ id })),
              semantic.map((s) => ({ id: s.id })),
            ).map((r) => r.id);
          }
        }
      }

      const total = mode === 'semantic' ? rankedIds.length : lexical.total;
      const offset = (page - 1) * limit;
      const slice = rankedIds.slice(offset, offset + limit);
      const items = slice.map((id) => snap.byId.get(id)!).filter(Boolean);

      res.json({
        items,
        page,
        limit,
        total,
        hasMore: offset + items.length < total,
        q,
        mode,
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
      mode,
    });
  } catch (err) {
    next(err);
  }
});