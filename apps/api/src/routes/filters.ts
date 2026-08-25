import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db';

export const filtersRouter = Router();

// GET /api/filters — unique values for style, mood, use_case
filtersRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [styles, moods, useCases] = await Promise.all([
      pool.query(
        `SELECT style AS value, COUNT(*)::int AS count
         FROM generated_images
         WHERE style IS NOT NULL AND style <> ''
         GROUP BY style ORDER BY count DESC, style ASC`,
      ),
      pool.query(
        `SELECT mood AS value, COUNT(*)::int AS count
         FROM generated_images
         WHERE mood IS NOT NULL AND mood <> ''
         GROUP BY mood ORDER BY count DESC, mood ASC`,
      ),
      pool.query(
        `SELECT use_case AS value, COUNT(*)::int AS count
         FROM generated_images
         WHERE use_case IS NOT NULL AND use_case <> ''
         GROUP BY use_case ORDER BY count DESC, use_case ASC`,
      ),
    ]);
    res.json({
      styles: styles.rows,
      moods: moods.rows,
      useCases: useCases.rows,
    });
  } catch (err) {
    next(err);
  }
});
