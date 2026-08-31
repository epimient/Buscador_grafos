import { Router, Request, Response, NextFunction } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { query } from '../db';
import { s3 } from '../s3';
import { config } from '../config';
import { graphStore, related as graphRelated } from '../graph';
import { embedMetadata } from '../metadata';

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
      query(countSql, params),
      query(dataSql, params),
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
    const { rows } = await query(
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

    const { rows } = await query(
      'SELECT s3_key, filename, original_prompt, enhanced_prompt, tags, subject, style, mood, use_case, color_palette, created_at FROM generated_images WHERE id = $1',
      [id],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    const row = rows[0] as {
      s3_key: string;
      filename: string | null;
      original_prompt: string | null;
      enhanced_prompt: string | null;
      tags: string[] | null;
      subject: string | null;
      style: string | null;
      mood: string | null;
      use_case: string | null;
      color_palette: string[] | null;
      created_at: string | null;
    };
    if (!row.s3_key) {
      res.status(500).json({ error: 'Image has no S3 key' });
      return;
    }

    let original: Buffer;

    if (config.mock) {
      const filePath = path.join(__dirname, '../../test-images', path.basename(row.s3_key));
      original = await readFile(filePath);
    } else {
      const obj = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: row.s3_key }));
      if (!obj.Body) throw new Error('Empty S3 response body');
      const chunks: Buffer[] = [];
      for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      original = Buffer.concat(chunks);
    }

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

    // Incrustar metadatos EXIF/IPTC si METADATA_EMBED=exiftool.
    if (config.metadata.embed === 'exiftool') {
      const { buffer: enriched } = await embedMetadata({
        buffer: converted,
        ext,
        description: row.enhanced_prompt ?? row.original_prompt,
        subject: row.subject,
        tags: row.tags,
        id,
        style: row.style,
        mood: row.mood,
        useCase: row.use_case,
        colorPalette: row.color_palette,
        fileName: row.filename,
        createdAt: row.created_at,
      });
      converted = enriched;
    }

    const baseName = (row.filename ?? `image-${id}`).replace(/\.\w+$/, '');
    const downloadName = `${baseName}.${ext}`.replace(/"/g, '');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.send(converted);
  } catch (err) {
    next(err);
  }
});

// GET /api/images/:id/related — by graph similarity (Jaccard + co-occurrence)
imagesRouter.get('/:id/related', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    const limit = Math.min(24, Math.max(1, Number(req.query.limit ?? 8)));

    if (config.graph.engine === 'graph' && graphStore.ready) {
      const snap = graphStore.snapshot!;
      const result = graphRelated(snap, id, limit);
      res.json({ items: result.items });
      return;
    }

    // Fallback SQL
    const baseRes = await query(
      'SELECT tags, style FROM generated_images WHERE id = $1',
      [id],
    );
    if (baseRes.rows.length === 0) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    const { tags, style } = baseRes.rows[0] as { tags: string[] | null; style: string | null };

    const { rows } = await query(
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
