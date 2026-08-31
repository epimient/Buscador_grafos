import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { graphStore, stats as graphStats } from '../graph';
import { config } from '../config';

export const statsRouter = Router();

// GET /api/stats — totals + top styles, moods, tags
statsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (config.graph.engine === 'graph' && graphStore.ready) {
      const snap = graphStore.snapshot!;
      const result = graphStats(snap);
      res.json(result);
      return;
    }

    // Fallback SQL
    const [totalRes, styles, moods, tags] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total FROM generated_images`),
      query(
        `SELECT style AS value, COUNT(*)::int AS count
         FROM generated_images
         WHERE style IS NOT NULL AND style <> ''
         GROUP BY style ORDER BY count DESC LIMIT 10`,
      ),
      query(
        `SELECT mood AS value, COUNT(*)::int AS count
         FROM generated_images
         WHERE mood IS NOT NULL AND mood <> ''
         GROUP BY mood ORDER BY count DESC LIMIT 10`,
      ),
      query(
        `SELECT tag AS value, COUNT(*)::int AS count
         FROM (SELECT UNNEST(tags) AS tag FROM generated_images WHERE tags IS NOT NULL) t
         WHERE tag IS NOT NULL AND tag <> ''
         GROUP BY tag ORDER BY count DESC LIMIT 20`,
      ),
    ]);
    res.json({
      total: totalRes.rows[0].total as number,
      topStyles: styles.rows,
      topMoods: moods.rows,
      topTags: tags.rows,
    });
  } catch (err) {
    next(err);
  }
});
