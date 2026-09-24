import { Router, Request, Response, NextFunction } from 'express';
import { graphStore } from '../graph';

export const graphRouter = Router();

// GET /api/graph?types=image,tag,style&limit=200&center=<id>&hops=1
// GET /api/graph?ids=id1,id2,id3&hops=1  → subgrafo inducido por la búsqueda
graphRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!graphStore.ready) {
      res.json({ nodes: [], edges: [] });
      return;
    }

    const typesRaw = typeof req.query.types === 'string' ? req.query.types : '';
    const types = typesRaw
      ? typesRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
    const center = typeof req.query.center === 'string' ? req.query.center : undefined;
    const hops = Math.min(3, Math.max(1, Number(req.query.hops ?? 1)));
    const ids = typeof req.query.ids === 'string'
      ? req.query.ids.split(',').map((id) => id.trim()).filter(Boolean)
      : undefined;

    const result = graphStore.exportGraph({ types, limit, center, hops, ids });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
