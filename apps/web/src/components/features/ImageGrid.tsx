import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { ImageCard } from './ImageCard';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Image } from '@/types/image';

interface PageLike {
  items: Image[];
}

interface Props {
  /**
   * Grouped by page so we can reset the stagger delay per batch — appending a
   * new page restarts the cascade at 0, instead of accumulating delay across
   * all previously-loaded images.
   */
  pages: PageLike[];
  loading?: boolean;
  loadingMore?: boolean;
}

const GRID_CLASS =
  'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';

export function ImageGrid({ pages, loading = false, loadingMore = false }: Props) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  async function triggerDownload(image: Image) {
    setError(null);
    try {
      const res = await fetch(`/api/images/${image.id}/download?format=webp`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = (image.filename ?? `image-${image.id}`).replace(/\.\w+$/, '');
      a.href = url;
      a.download = `${baseName}.webp`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      setError(`No se pudo descargar: ${msg}`);
    }
  }

  const totalCount = pages.reduce((n, p) => n + p.items.length, 0);

  if (loading && totalCount === 0) {
    return (
      <div className={GRID_CLASS}>
        {Array.from({ length: 15 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5] w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className={GRID_CLASS}>
        {pages.map((page, pageIdx) =>
          page.items.map((image, idxInPage) => (
            // Key includes pageIdx so React keeps each card stable across
            // appends; using image.id alone would still be unique, but this
            // also prevents accidental remounts if two pages share an item.
            <ImageCard
              key={`${pageIdx}-${image.id}`}
              image={image}
              index={idxInPage}
              onDownload={triggerDownload}
            />
          )),
        )}
      </div>

      {loadingMore && (
        <div className={`${GRID_CLASS} mt-4`}>
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/5] w-full" />
          ))}
        </div>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            role="alert"
            className="fixed bottom-6 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 shadow-card backdrop-blur"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => setError(null)}
              className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
