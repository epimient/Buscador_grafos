import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db';

export const statsRouter = Router();

// GET /api/stats — totals + top styles, moods, tags
statsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalRes, styles, moods, tags] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM generated_images`),
      pool.query(
        `SELECT style AS value, COUNT(*)::int AS count
         FROM generated_images
         WHERE style IS NOT NULL AND style <> ''
         GROUP BY style ORDER BY count DESC LIMIT 10`,
      ),
      pool.query(
        `SELECT mood AS value, COUNT(*)::int AS count
         FROM generated_images
         WHERE mood IS NOT NULL AND mood <> ''
         GROUP BY mood ORDER BY count DESC LIMIT 10`,
      ),
      pool.query(
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
