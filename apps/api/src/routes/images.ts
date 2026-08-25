import { Router, Request, Response, NextFunction } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { pool } from '../db';
import { s3 } from '../s3';
import { config } from '../config';

export const imagesRouter = Router();

const SELECT_COLS = `
  id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
  mood, color_palette, use_case, filename, created_at
`;

// GET /api/images?page=1&limit=24&style=...&mood=...&use_case=...
imagesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 24)));
    const offset = (page - 1) * limit;

    const style = typeof req.query.style === 'string' ? req.query.style : undefined;
    const mood = typeof req.query.mood === 'string' ? req.query.mood : undefined;
    const useCase = typeof req.query.use_case === 'string' ? req.query.use_case : undefined;

    const where: string[] = [];
    const params: unknown[] = [];

    if (style) {
      params.push(style);
      where.push(`style = $${params.length}`);
    }
    if (mood) {
      params.push(mood);
      where.push(`mood = $${params.length}`);
    }
    if (useCase) {
      params.push(useCase);
      where.push(`use_case = $${params.length}`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM generated_images ${whereSql}`;
    const dataSql = `
      SELECT ${SELECT_COLS}
      FROM generated_images
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [countRes, dataRes] = await Promise.all([
      pool.query(countSql, params),
      pool.query(dataSql, params),
    ]);

    const total = countRes.rows[0].total as number;
    res.json({
      items: dataRes.rows,
      page,
      limit,
      total,
      hasMore: offset + dataRes.rows.length < total,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/images/:id — id is a UUID (or any string PG can cast to the column type)
imagesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLS} FROM generated_images WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

type DownloadFormat = 'webp' | 'png' | 'jpg';
const VALID_FORMATS = new Set<string>(['webp', 'png', 'jpg']);

// GET /api/images/:id/download?format=webp|png|jpg
imagesRouter.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    const raw = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : '';
    const format: DownloadFormat = VALID_FORMATS.has(raw) ? (raw as DownloadFormat) : 'webp';

    const { rows } = await pool.query(
      'SELECT s3_key, filename FROM generated_images WHERE id = $1',
      [id],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    const { s3_key, filename } = rows[0] as { s3_key: string; filename: string | null };
    if (!s3_key) {
      res.status(500).json({ error: 'Image has no S3 key' });
      return;
    }

    const obj = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: s3_key }));
    if (!obj.Body) throw new Error('Empty S3 response body');

    const chunks: Buffer[] = [];
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const original = Buffer.concat(chunks);

    let converted: Buffer;
    let mimeType: string;
    let ext: string;

    if (format === 'png') {
      converted = await sharp(original).png({ compressionLevel: 0 }).toBuffer();
      mimeType = 'image/png';
      ext = 'png';
    } else if (format === 'jpg') {
      converted = await sharp(original).jpeg({ quality: 100 }).toBuffer();
      mimeType = 'image/jpeg';
      ext = 'jpg';
    } else {
      converted = await sharp(original).webp({ quality: 100, lossless: true }).toBuffer();
      mimeType = 'image/webp';
      ext = 'webp';
    }

    const baseName = (filename ?? `image-${id}`).replace(/\.\w+$/, '');
    const downloadName = `${baseName}.${ext}`.replace(/"/g, '');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.send(converted);
  } catch (err) {
    next(err);
  }
});

// GET /api/images/:id/related — by overlapping tags or same style
imagesRouter.get('/:id/related', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    const limit = Math.min(24, Math.max(1, Number(req.query.limit ?? 8)));

    const baseRes = await pool.query(
      'SELECT tags, style FROM generated_images WHERE id = $1',
      [id],
    );
    if (baseRes.rows.length === 0) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    const { tags, style } = baseRes.rows[0] as { tags: string[] | null; style: string | null };

    // Score: number of overlapping tags + 1 if same style. Exclude the source image.
    const { rows } = await pool.query(
      `
      SELECT ${SELECT_COLS},
             (
               COALESCE(cardinality(ARRAY(SELECT UNNEST(tags) INTERSECT SELECT UNNEST($1::text[]))), 0)
               + CASE WHEN style = $2 THEN 1 ELSE 0 END
             ) AS score
      FROM generated_images
      WHERE id::text <> $3
        AND (tags && $1::text[] OR style = $2)
      ORDER BY score DESC, created_at DESC
      LIMIT $4
      `,
      [tags ?? [], style, String(id), limit],
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});
