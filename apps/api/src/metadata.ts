/**
 * Incrustación y lectura de metadatos EXIF/IPTC/XMP en imágenes.
 *
 * Usa `exiftool` (binario del sistema). Degradación silenciosa si no está
 * disponible o falla.
 *
 * Namespace propio: `XMP-vorael:` — el "frontmatter" de cada imagen.
 */
import { execFile } from 'child_process';
import { writeFile, unlink, readFile as readFileFs } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { config } from './config';

const execFileAsync = promisify(execFile);

/** Ruta al .ExifTool_config que define el namespace XMP-vorael. */
const EXIFTOOL_CONFIG = join(__dirname, '../.ExifTool_config');

// ── Embed ────────────────────────────────────────────────────────────────────

export interface EmbedMetadataOpts {
  buffer: Buffer;
  ext: string;
  description: string | null;
  subject: string | null;
  tags: string[] | null;
  /** Campos propios (XMP-vorael). */
  id?: string | null;
  style?: string | null;
  mood?: string | null;
  useCase?: string | null;
  colorPalette?: string[] | null;
  fileName?: string | null;
  createdAt?: string | null;
}

export interface EmbedMetadataResult {
  buffer: Buffer;
  embedded: boolean;
}

function argsFromOpts(opts: EmbedMetadataOpts): string[] {
  const args: string[] = [];

  // Namespace propio: XMP-vorael
  if (opts.id) args.push(`-XMP-vorael:id=${opts.id}`);
  if (opts.style) args.push(`-XMP-vorael:style=${opts.style}`);
  if (opts.mood) args.push(`-XMP-vorael:mood=${opts.mood}`);
  if (opts.useCase) args.push(`-XMP-vorael:useCase=${opts.useCase}`);
  if (opts.colorPalette && opts.colorPalette.length > 0) {
    args.push(`-XMP-vorael:palette=${opts.colorPalette.join(', ')}`);
  }
  if (opts.fileName) args.push(`-XMP-vorael:fileName=${opts.fileName}`);
  if (opts.createdAt) args.push(`-XMP-vorael:createdAt=${opts.createdAt}`);

  // XMP estándar: legible por cualquier herramienta.
  if (opts.description) {
    args.push(`-EXIF:ImageDescription=${opts.description}`);
    args.push(`-XMP:Description=${opts.description}`);
  }
  args.push('-EXIF:Artist=Corporación Universitaria Americana - VORAEL');

  if (opts.tags && opts.tags.length > 0) {
    for (const tag of opts.tags) {
      args.push(`-IPTC:Keywords=${tag}`);
    }
  }

  if (opts.subject) {
    args.push(`-XMP:Subject=${opts.subject}`);
    args.push(`-XMP:Title=${opts.subject}`);
  }

  return args;
}

/**
 * Incrusta metadatos EXIF/IPTC/XMP en la imagen.
 * Si exiftool no está disponible o falla, retorna el buffer original.
 */
export async function embedMetadata(opts: EmbedMetadataOpts): Promise<EmbedMetadataResult> {
  const { buffer, ext } = opts;

  try {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tmpIn = join(tmpdir(), `vorael-in-${ts}.${ext}`);
    const tmpOut = join(tmpdir(), `vorael-out-${ts}.${ext}`);

    await writeFile(tmpIn, buffer);

    const args = [
      '-overwrite_original',
      '-config', EXIFTOOL_CONFIG,
      tmpIn,
      '-o', tmpOut,
      ...argsFromOpts(opts),
    ];

    await execFileAsync('exiftool', args);
    const result = await readFileFs(tmpOut);

    await Promise.all([
      unlink(tmpIn).catch(() => {}),
      unlink(tmpOut).catch(() => {}),
    ]);

    return { buffer: result, embedded: true };
  } catch {
    return { buffer, embedded: false };
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

export interface ReadMetadataResult {
  id: string | null;
  description: string | null;
  subject: string | null;
  tags: string[];
  style: string | null;
  mood: string | null;
  useCase: string | null;
  colorPalette: string[];
  fileName: string | null;
  createdAt: string | null;
  artist: string | null;
  /** Los campos XMP-vorael fueron encontrados. */
  hasVoraelMeta: boolean;
}

/**
 * Lee metadatos EXIF/IPTC/XMP de un buffer de imagen.
 * Si exiftool falla o no está instalado, devuelve campos vacíos.
 */
export async function readImageMetadata(buffer: Buffer, ext: string): Promise<ReadMetadataResult> {
  const fallback: ReadMetadataResult = {
    id: null, description: null, subject: null, tags: [],
    style: null, mood: null, useCase: null, colorPalette: [],
    fileName: null, createdAt: null, artist: null, hasVoraelMeta: false,
  };

  try {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tmpFile = join(tmpdir(), `vorael-read-${ts}.${ext}`);
    await writeFile(tmpFile, buffer);

    const { stdout } = await execFileAsync('exiftool', [
      '-json',
      '-config', EXIFTOOL_CONFIG,
      '-XMP:all',
      '-XMP-vorael:all',
      '-EXIF:ImageDescription',
      '-EXIF:Artist',
      '-IPTC:Keywords',
      tmpFile,
    ]);

    await unlink(tmpFile).catch(() => {});

    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    const m = parsed[0];

    // Mapeo de campos XMP-vorael (namespace propio)
    const vorael = m.XMPVorael || m['XMP-vorael'] || {};
    const hasVoraelMeta = !!(vorael.id || vorael.style || vorael.mood);

    // Tags: pueden venir de IPTC:Keywords (array) o XMP:Subject (string|array)
    let tags: string[] = [];
    const iptcKeywords = m.IPTCKeywords || m.IPTCKeyword;
    if (Array.isArray(iptcKeywords)) tags = iptcKeywords;
    else if (typeof iptcKeywords === 'string') tags = [iptcKeywords];
    const xmpSubject = m.XMPSubject;
    if (Array.isArray(xmpSubject)) tags = tags.concat(xmpSubject);
    else if (typeof xmpSubject === 'string') tags.push(xmpSubject);

    // Palette: Guardado como "hex1, hex2, ..." en XMP-vorael
    const paletteRaw = vorael.palette || null;
    const colorPalette = paletteRaw
      ? paletteRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];

    return {
      id: vorael.id || null,
      description: m.EXIFImageDescription || m.XMPDescription || null,
      subject: m.XMPSubject || m.XMPTitle || null,
      tags: [...new Set(tags)].filter(Boolean),
      style: vorael.style || null,
      mood: vorael.mood || null,
      useCase: vorael.useCase || null,
      colorPalette,
      fileName: vorael.fileName || null,
      createdAt: vorael.createdAt || null,
      artist: m.EXIFArtist || null,
      hasVoraelMeta,
    };
  } catch {
    return fallback;
  }
}

/**
 * Comprueba si exiftool está disponible en el sistema.
 */
export async function checkExiftool(): Promise<boolean> {
  try {
    await execFileAsync('exiftool', ['-ver']);
    return true;
  } catch {
    return false;
  }
}
