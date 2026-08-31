import type { Image } from '@/types/image';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function pickImageRatio(id: string | number): number {
  const ratios = [4 / 5, 3 / 4, 1 / 1, 5 / 4, 4 / 3, 16 / 9];
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ratios[h % ratios.length];
}

/**
 * Filename to save an image under: drops the stored extension and applies the
 * downloaded format's. "sunset.png" + "webp" -> "sunset.webp".
 */
export function downloadFileName(image: Image, ext: string): string {
  const baseName = (image.filename ?? `image-${image.id}`).replace(/\.\w+$/, '');
  return `${baseName}.${ext}`;
}

/** Hands a Blob to the browser as a file download, via a synthetic anchor click. */
export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
