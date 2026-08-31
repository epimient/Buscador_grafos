/**
 * Export portable — genera una carpeta con imágenes enriquecidas con metadatos.
 *
 * Solo LECTURA de S3: descarga cada imagen, incrusta los metadatos de Postgres
 * (o del mock) con exiftool, y guarda en un directorio local. Sin PutObject.
 *
 * Uso:
 *   npx ts-node --transpile-only src/scripts/export-portable.ts [--out ./export-vorael]
 *
 * Requiere exiftool instalado (libimage-exiftool-perl).
 * Si exiftool no está, exporta sin metadatos (degradación silenciosa).
 */
import { mkdir, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { config } from '../config';
import { s3 } from '../s3';
import { pool } from '../db';
import { embedMetadata, checkExiftool } from '../metadata';
import type { ImageRow } from '../types';

const OUTPUT_DIR = join(process.cwd(), 'export-vorael');

interface ExportOpts {
  outDir: string;
}

// ── Fetch desde S3 + Postgres ────────────────────────────────────────────────

async function fetchAllFromDb(): Promise<ImageRow[]> {
  const { rows } = await pool.query(
    `SELECT id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
            mood, color_palette, use_case, filename, created_at
     FROM generated_images ORDER BY created_at DESC, id DESC`,
  );
  return rows as ImageRow[];
}

async function downloadFromS3(key: string): Promise<Buffer | null> {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    if (!obj.Body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    console.error(`  [S3] error downloading ${key}: ${(err as Error).message}`);
    return null;
  }
}

// ── Export logic ─────────────────────────────────────────────────────────────

async function exportOne(
  row: ImageRow,
  outDir: string,
  useExiftool: boolean,
): Promise<{ ok: boolean; file: string }> {
  const ext = (row.filename?.match(/\.(\w+)$/)?.[1] ?? 'webp').toLowerCase();
  const safeName = (row.filename ?? `${row.id}.${ext}`).replace(/[/\\?%*:|"<>]/g, '_');
  const outFile = join(outDir, safeName);

  const original = await downloadFromS3(row.s3_key);
  if (!original) return { ok: false, file: safeName };

  let converted: Buffer;
  try {
    if (ext === 'png') {
      converted = await sharp(original).png({ compressionLevel: 0 }).toBuffer();
    } else if (ext === 'jpg' || ext === 'jpeg') {
      converted = await sharp(original).jpeg({ quality: 100 }).toBuffer();
    } else {
      converted = await sharp(original).webp({ quality: 100, lossless: true }).toBuffer();
    }
  } catch {
    // Si sharp falla, guarda el original.
    converted = original;
  }

  if (useExiftool) {
    const { buffer: enriched } = await embedMetadata({
      buffer: converted,
      ext,
      description: row.enhanced_prompt ?? row.original_prompt,
      subject: row.subject,
      tags: row.tags,
      id: row.id,
      style: row.style,
      mood: row.mood,
      useCase: row.use_case,
      colorPalette: row.color_palette,
      fileName: row.filename,
      createdAt: row.created_at,
    });
    converted = enriched;
  }

  await writeFile(outFile, converted);
  return { ok: true, file: safeName };
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx !== -1 ? args[outIdx + 1] : OUTPUT_DIR;

  console.log('=== VORAEL — Export Portable ===');
  console.log(`  Output: ${outDir}`);

  // Check exiftool.
  const hasExiftool = await checkExiftool();
  if (hasExiftool) {
    console.log('  Exiftool: OK (metadatos XMP-vorael se incrustarán)');
  } else {
    console.warn('  Exiftool: NO INSTALADO (exportación sin metadatos)');
  }

  // Fetch rows.
  console.log('  Cargando imágenes desde Postgres...');
  const rows = await fetchAllFromDb();
  console.log(`  ${rows.length} imágenes encontradas.`);

  // Create output dir.
  await mkdir(outDir, { recursive: true });

  // Export.
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    process.stdout.write(`  [${i + 1}/${rows.length}] ${row.filename ?? row.id} ... `);
    const result = await exportOne(row, outDir, hasExiftool);
    if (result.ok) {
      ok++;
      console.log('OK →', result.file);
    } else {
      fail++;
      console.log('FAIL');
    }
  }

  console.log(`\n=== Listo: ${ok} exportadas, ${fail} fallidas ===`);
  console.log(`  Carpeta: ${outDir}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
