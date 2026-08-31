/**
 * Backfill S3 — reemplaza archivos en el bucket con versiones que llevan metadatos.
 *
 * Requiere permisos de ESCRITURA (PutObject) en el bucket.
 * Gated: solo corre si ALLOW_BACKFILL_WRITE=true y el probe PutObject tiene éxito.
 *
 * Uso:
 *   ALLOW_BACKFILL_WRITE=true npx ts-node --transpile-only src/scripts/backfill.ts
 *
 * Idempotente: mantiene un manifest con ETags procesados.
 * Solo re-procesa archivos nuevos o cambiados.
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { config } from '../config';
import { s3 } from '../s3';
import { pool } from '../db';
import { embedMetadata, checkExiftool } from '../metadata';
import type { ImageRow } from '../types';

const MANIFEST_PATH = join(__dirname, '../../.backfill-manifest.json');
const PROBE_KEY = '__backfill_probe__';
const BATCH_SIZE = 50;

// ── Manifest ─────────────────────────────────────────────────────────────────

interface Manifest {
  [key: string]: string; // s3_key → etag
}

async function loadManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function saveManifest(m: Manifest): Promise<void> {
  await writeFile(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

// ── S3 helpers ───────────────────────────────────────────────────────────────

async function probeWritePermission(): Promise<boolean> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: PROBE_KEY,
      Body: Buffer.from('probe'),
      ContentType: 'application/octet-stream',
    }));
    // Clean up probe key.
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: PROBE_KEY }));
    return true;
  } catch {
    return false;
  }
}

async function listAllKeys(): Promise<{ key: string; etag: string }[]> {
  const items: { key: string; etag: string }[] = [];
  let continuation: string | undefined;

  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: config.s3.bucket,
      MaxKeys: 1000,
      ContinuationToken: continuation,
    }));

    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith('/')) continue;
      items.push({ key: obj.Key, etag: obj.ETag ?? '' });
    }
    continuation = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuation);

  return items;
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
  } catch {
    return null;
  }
}

async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<boolean> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return true;
  } catch (err) {
    console.error(`  [PUT] failed ${key}: ${(err as Error).message}`);
    return false;
  }
}

// ── DB lookup ────────────────────────────────────────────────────────────────

async function findRowByKey(key: string): Promise<ImageRow | null> {
  const { rows } = await pool.query(
    `SELECT id, s3_key, s3_url, original_prompt, enhanced_prompt, tags, style, subject,
            mood, color_palette, use_case, filename, created_at
     FROM generated_images WHERE s3_key = $1 LIMIT 1`,
    [key],
  );
  return (rows[0] as ImageRow) ?? null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== VORAEL — S3 Backfill ===');

  // Gate: write permission.
  if (config.mock) {
    console.warn('  DB_MOCK=true — backfill no funciona en modo mock (usa export-portable).');
    process.exit(1);
  }
  if (!process.env.ALLOW_BACKFILL_WRITE || process.env.ALLOW_BACKFILL_WRITE !== 'true') {
    console.warn('  ALLOW_BACKFILL_WRITE no está "true". Abortando.');
    console.warn('  Usa: ALLOW_BACKFILL_WRITE=true npx ts-node ...backfill.ts');
    process.exit(1);
  }

  console.log('  Probando permisos de escritura en S3...');
  const canWrite = await probeWritePermission();
  if (!canWrite) {
    console.error('  NO se pudo escribir en S3. Abortando.');
    process.exit(1);
  }
  console.log('  Permisos OK.');

  const hasExiftool = await checkExiftool();
  console.log(`  Exiftool: ${hasExiftool ? 'OK' : 'NO INSTALADO (no se embeberán metadatos)'}`);

  // List keys.
  console.log('  Listando objetos en S3...');
  const s3Objects = await listAllKeys();
  console.log(`  ${s3Objects.length} objetos encontrados.`);

  const manifest = await loadManifest();
  let processed = 0;
  let skipped = 0;
  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < s3Objects.length; i++) {
    const { key, etag } = s3Objects[i];
    if (manifest[key] === etag) {
      skipped++;
      continue;
    }

    process.stdout.write(`  [${i + 1}/${s3Objects.length}] ${key} ... `);

    const row = await findRowByKey(key);
    if (!row) {
      console.log('SKIP (no DB row)');
      skipped++;
      continue;
    }

    const original = await downloadFromS3(key);
    if (!original) { failed++; console.log('FAIL (download)'); continue; }

    const ext = (row.filename?.match(/\.(\w+)$/)?.[1] ?? 'webp').toLowerCase();
    let converted: Buffer;
    try {
      if (ext === 'png') {
        converted = await sharp(original).png({ compressionLevel: 0 }).toBuffer();
      } else if (ext === 'jpg') {
        converted = await sharp(original).jpeg({ quality: 100 }).toBuffer();
      } else {
        converted = await sharp(original).webp({ quality: 100, lossless: true }).toBuffer();
      }
    } catch { converted = original; }

    if (hasExiftool) {
      const { buffer: enriched } = await embedMetadata({
        buffer: converted, ext,
        description: row.enhanced_prompt ?? row.original_prompt,
        subject: row.subject, tags: row.tags,
        id: row.id, style: row.style, mood: row.mood,
        useCase: row.use_case, colorPalette: row.color_palette,
        fileName: row.filename, createdAt: row.created_at,
      });
      converted = enriched;
    }

    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
    const ok = await uploadToS3(key, converted, mime);
    if (ok) {
      manifest[key] = etag;
      uploaded++;
      processed++;
      console.log('OK');
    } else {
      failed++;
      console.log('FAIL (upload)');
    }

    // Save manifest every BATCH_SIZE files.
    if (processed % BATCH_SIZE === 0) await saveManifest(manifest);
  }

  await saveManifest(manifest);
  console.log(`\n=== Listo: ${uploaded} subidas, ${skipped} sin cambios, ${failed} fallidas ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
