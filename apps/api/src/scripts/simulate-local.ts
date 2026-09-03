import fs from 'fs';
import path from 'path';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { config } from '../config';
import { embedMetadata } from '../metadata';
import { MOCK_IMAGES } from '../mockData';
import crypto from 'crypto';

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey }
});

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'generated_images',
  user: process.env.DB_USER || 'vorael',
  password: process.env.DB_PASSWORD || 'vorael123',
});

const LOCAL_DIR = path.join(__dirname, '../../test-images-real');

async function downloadS3Object(key: string, localPath: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  const chunks: any[] = [];
  for await (const chunk of res.Body as any) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  console.log('[simulate] Empezando la simulación local...');

  // 1. Limpiar base de datos
  await pool.query('TRUNCATE TABLE generated_images;');
  console.log('[simulate] Base de datos limpiada.');

  // 2. Obtener lista de imágenes en S3
  const res = await s3.send(new ListObjectsV2Command({ Bucket: config.s3.bucket, MaxKeys: 30 }));
  const keys = (res.Contents || []).map(c => c.Key).filter((k): k is string => !!k && k.endsWith('.webp'));
  console.log(`[simulate] Se encontraron ${keys.length} imágenes en S3.`);

  if (keys.length === 0) {
    console.log('[simulate] No hay imágenes .webp en S3 para simular.');
    process.exit(0);
  }

  // 3. Procesar cada imagen
  let i = 0;
  for (const key of keys) {
    // Asignar metadatos aleatorios desde mockData
    const mockMeta = MOCK_IMAGES[i % MOCK_IMAGES.length];
    
    console.log(`[simulate] Descargando ${key}...`);
    const buffer = await downloadS3Object(key, '');
    
    const localFilename = path.basename(key);
    const localPath = path.join(LOCAL_DIR, localFilename);
    const localUrl = `http://localhost:3001/test-images-real/${localFilename}`;

    const newId = crypto.randomUUID();

    console.log(`[simulate] Incrustando metadatos físicos en ${localFilename}...`);
    const embedResult = await embedMetadata({
      buffer,
      ext: 'webp',
      id: newId,
      description: mockMeta.original_prompt || '',
      subject: mockMeta.subject || '',
      tags: mockMeta.tags || [],
      style: mockMeta.style || '',
      mood: mockMeta.mood || '',
      useCase: mockMeta.use_case || '',
      colorPalette: mockMeta.color_palette || [],
      fileName: localFilename,
      createdAt: new Date().toISOString()
    });

    if (!embedResult.embedded) {
      console.warn(`[simulate] ADVERTENCIA: Falló la incrustación de metadatos en ${localFilename}. Verifica que exiftool funcione.`);
    }

    fs.writeFileSync(localPath, embedResult.buffer);
    console.log(`[simulate] Guardado en disco local: ${localPath}`);

    // Insertar en la BD apuntando a localUrl
    await pool.query(
      `INSERT INTO generated_images
         (id, s3_key, s3_url, original_prompt, enhanced_prompt,
          tags, style, subject, mood, color_palette, use_case, filename, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        newId,
        key,
        localUrl, // Servido localmente
        mockMeta.original_prompt,
        mockMeta.enhanced_prompt,
        mockMeta.tags,
        mockMeta.style,
        mockMeta.subject,
        mockMeta.mood,
        mockMeta.color_palette,
        mockMeta.use_case,
        localFilename,
        new Date()
      ]
    );
    console.log(`[simulate] Guardado en PostgreSQL: ${newId}`);
    
    i++;
  }

  const count = await pool.query('SELECT COUNT(*)::int AS total FROM generated_images');
  console.log(`[simulate] ¡Proceso terminado! Total de imágenes en DB: ${count.rows[0].total}`);

  await pool.end();
}

main().catch(err => {
  console.error('[simulate] Error:', err);
  process.exit(1);
});
