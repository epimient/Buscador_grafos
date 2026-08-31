/**
 * Scanner — reconstruye el grafo/índice desde archivos con metadatos.
 *
 * Modo Obsidian: lee los XMP/EXIF de cada imagen y materializa el grafo.
 * Para cuando la DB se perdió o no existe.
 *
 * Uso:
 *   npx ts-node --transpile-only src/scripts/scanner.ts [--dir ./export-vorael] [--mock]
 *
 * En modo mock opera sobre test-images/.
 */
import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { readImageMetadata, checkExiftool } from '../metadata';
import { graphStore, type GraphSnapshot } from '../graph';
import type { ImageRow } from '../types';
import sharp from 'sharp';

interface ScanOpts {
  dir: string;
}

const IMAGE_EXTS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.tiff', '.gif']);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readFileAsBuffer(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}

function filenameToImageRow(filename: string, meta: any, buffer: Buffer): ImageRow {
  const ext = extname(filename).replace('.', '').toLowerCase();
  return {
    id: meta.id ?? filename.replace(/\.\w+$/, ''),
    s3_key: `scanned/${filename}`,
    s3_url: '',
    original_prompt: meta.description,
    enhanced_prompt: meta.description,
    tags: meta.tags.length > 0 ? meta.tags : null,
    style: meta.style,
    subject: meta.subject,
    mood: meta.mood,
    color_palette: meta.colorPalette.length > 0 ? meta.colorPalette : null,
    use_case: meta.useCase,
    filename: meta.fileName ?? filename,
    created_at: meta.createdAt ?? new Date().toISOString(),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const useMock = args.includes('--mock');
  const dir = dirIdx !== -1 ? args[dirIdx + 1]
    : useMock
      ? join(__dirname, '../../test-images')
      : join(__dirname, '../../export-vorael');

  console.log('=== VORAEL — Scanner (rebuild from files) ===');
  console.log(`  Dir: ${dir}`);

  const hasExiftool = await checkExiftool();
  if (hasExiftool) {
    console.log('  Exiftool: OK');
  } else {
    console.warn('  Exiftool: NO INSTALADO — metadatos limitados');
  }

  const files = (await readdir(dir)).filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()));
  console.log(`  ${files.length} imágenes encontradas.`);

  if (files.length === 0) {
    console.warn('  Sin imágenes para escanear.');
    process.exit(0);
  }

  const rows: ImageRow[] = [];

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    process.stdout.write(`  [${i + 1}/${files.length}] ${filename} ... `);

    try {
      const buffer = await readFileAsBuffer(join(dir, filename));
      const ext = extname(filename).replace('.', '');
      const meta = await readImageMetadata(buffer, ext);
      const row = filenameToImageRow(filename, meta, buffer);
      rows.push(row);

      const fieldCount = [row.style, row.mood, row.use_case, row.subject, ...row.tags ?? []]
        .filter(Boolean).length;
      console.log(`OK (${fieldCount} campos, vorael=${meta.hasVoraelMeta})`);
    } catch (err) {
      console.log(`FAIL: ${(err as Error).message}`);
    }
  }

  console.log(`\n  Cargando grafo desde ${rows.length} imágenes escaneadas...`);
  graphStore.load(rows);

  const snap = graphStore.snapshot!;
  console.log(`  Grafo: ${snap.graph.order} nodos, ${snap.graph.size} aristas`);
  console.log(`  Tags: ${snap.tagIndex.size}, Styles: ${snap.styleIndex.size}, Moods: ${snap.moodIndex.size}`);

  console.log('\n=== Listo. Grafo materializado en memoria. ===');
  console.log('  (Esto es un rebuild en memoria — no modifica la DB.)');
  process.exit(0);
}

main().catch((err) => {
  console.error('Scanner failed:', err);
  process.exit(1);
});
