import { Router, Request, Response, NextFunction } from 'express';
import { graphStore, scoreSearch } from '../graph';
import { config } from '../config';

export const searchRouter = Router();

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
      res.json({ items: [], page, limit, total: 0, hasMore: false, q, mode });
      return;
    }

    // En graph=1, además de los items devolvemos el subgrafo inducido por el
    // top-100 del ranking actual (lo que el frontend pinta con sigma). El
    // tamaño de cada nodo metadato = cuántas imágenes del set lo comparten.
    const wantGraph = req.query.graph === '1' || req.query.graph === 'true';

    if (config.graph.engine === 'graph' && graphStore.ready) {
      const snap = graphStore.snapshot!;
      const lexical = scoreSearch(snap, q);

      let rankedIds = lexical.ids;

      // Modo hybrid/semantic requieren el índice y Ollama; si cualquiera falla
      // o el índice está vacío, degradamos a lexical sin romper la request.
      if (mode !== 'lexical') {
        const { getSemanticIndex, embedQuery, searchSemantic, rrfFuse } =
          await import('../embeddings');
        const semIndex = await getSemanticIndex();
        const qVec = await embedQuery(q);

        if (semIndex && semIndex.dim > 0 && qVec) {
          // SEMANTIC_MIN_SCORE es un umbral anti-ruido SOLO para el feed
          // semántico del RRF (hybrid). En semantic puro no se aplica:
          // allí el usuario quiere los top-k directos, y con bge-m3 casi
          // ningún vector pasa 0.65 — filtrarlos dejaba la búsqueda vacía.
          const minScore = mode === 'hybrid' ? config.semantic.minScore : 0;
          const semantic = searchSemantic(semIndex, qVec, 100, minScore);
          if (mode === 'semantic') {
            rankedIds = semantic.map((s) => s.id);
          } else {
            // RRF se alimenta solo con los mejores de cada lado: el top-100
            // léxico (el resto es ruido de baja cobertura) + el top-100
            // semántico ya filtrado por SEMANTIC_MIN_SCORE.
            rankedIds = rrfFuse(
              lexical.ids.slice(0, 100).map((id) => ({ id })),
              semantic.map((s) => ({ id: s.id })),
            ).map((r) => r.id);
          }
        }
      }

      // En semantic/hybrid el ranking ya es el conjunto completo materializado
      // (RRF o top-k semántico), así que su longitud es el total real.
      const total = mode === 'lexical' ? lexical.total : rankedIds.length;
      const offset = (page - 1) * limit;
      const slice = rankedIds.slice(offset, offset + limit);
      const items = slice.map((id) => snap.byId.get(id)!).filter(Boolean);

      const graph = wantGraph
        ? graphStore.exportGraph({
            // El subgrafo de la búsqueda se arma sobre lo más relevante del
            // ranking; cosa de no dibujar los 12k de la query corta.
            ids: rankedIds.slice(0, 100),
            hops: 1,
            limit: 500,
          })
        : undefined;

      res.json({
        items,
        page,
        limit,
        total,
        hasMore: offset + items.length < total,
        q,
        mode,
        graph,
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