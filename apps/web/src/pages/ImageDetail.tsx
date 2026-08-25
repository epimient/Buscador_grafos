import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, ChevronDown, Download, Loader2, Sparkles, Tag as TagIcon } from 'lucide-react';
import { useImage, useRelatedImages } from '@/hooks/useImages';
import { ImageCard } from '@/components/features/ImageCard';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { downloadFileName, formatDate, saveBlobAs } from '@/lib/utils';
import { downloadImage } from '@/services/api';
import type { DownloadFormat } from '@/types/image';

const FORMAT_LABELS: Record<DownloadFormat, { label: string; hint: string }> = {
  webp: { label: 'WebP', hint: 'Recomendado' },
  png: { label: 'PNG', hint: 'Sin pérdida' },
  jpg: { label: 'JPG', hint: 'Máx. compatibilidad' },
};

export function ImageDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: image, isLoading, error, refetch } = useImage(id);
  const { data: related } = useRelatedImages(id);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<DownloadFormat>('webp');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [dropdownOpen]);

  async function onDownload(fmt: DownloadFormat) {
    if (!image) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await downloadImage(image.id, fmt);
      saveBlobAs(blob, downloadFileName(image, fmt));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo descargar la imagen.';
      setDownloadError(msg);
    } finally {
      setDownloading(false);
    }
  }

  if (!id) {
    return <ErrorState message="ID de imagen inválido." />;
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-[60vh] w-full" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (error || !image) {
    return (
      <ErrorState
        message={(error as Error | null)?.message ?? 'No pudimos cargar esta imagen.'}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div>
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* Image preview */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-2xl border border-white/5 bg-canvas-raised shadow-card"
        >
          {!imgLoaded && <Skeleton className="aspect-[4/3] w-full" />}
          <img
            src={image.s3_url}
            alt={image.subject ?? image.filename ?? `Imagen ${image.id}`}
            onLoad={() => setImgLoaded(true)}
            className={`w-full transition-opacity duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </motion.div>

        {/* Metadata panel */}
        <div className="space-y-6">
          {image.subject && (
            <header>
              <p className="text-xs uppercase tracking-wider text-ink-faint">Sujeto</p>
              <h1 className="mt-1 font-display text-3xl font-bold leading-tight text-ink">
                {image.subject}
              </h1>
              <p className="mt-2 text-xs text-ink-faint">Creada el {formatDate(image.created_at)}</p>
            </header>
          )}

          <div ref={dropdownRef} className="relative">
            <div className="flex w-full overflow-hidden rounded-xl">
              <button
                onClick={() => onDownload(selectedFormat)}
                disabled={downloading}
                className="btn-primary flex-1 rounded-r-none border-r border-indigo-400/30"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloading ? 'Descargando…' : `Descargar ${FORMAT_LABELS[selectedFormat].label}`}
              </button>
              <button
                type="button"
                onClick={() => setDropdownOpen((v) => !v)}
                aria-label="Elegir formato"
                className="btn-primary rounded-l-none px-3"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>
            </div>

            {dropdownOpen && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-white/10 bg-canvas-raised shadow-card">
                {(['webp', 'png', 'jpg'] as const).map((fmt) => {
                  const { label, hint } = FORMAT_LABELS[fmt];
                  const active = selectedFormat === fmt;
                  return (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => { setSelectedFormat(fmt); setDropdownOpen(false); }}
                      className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-white/5 ${active ? 'text-indigo-400' : 'text-ink-dim'}`}
                    >
                      {active ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="font-medium">{label}</span>
                      <span className="ml-auto text-xs text-ink-faint">{hint}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {downloadError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {downloadError}
            </p>
          )}

          {/* Quick attrs */}
          <div className="grid grid-cols-2 gap-3">
            {image.style && (
              <AttrCard label="Estilo">
                <span className="capitalize">{image.style}</span>
              </AttrCard>
            )}
            {image.mood && (
              <AttrCard label="Mood">
                <span className="capitalize">{image.mood}</span>
              </AttrCard>
            )}
            {image.use_case && (
              <AttrCard label="Uso" className="col-span-2">
                <span className="capitalize">{image.use_case}</span>
              </AttrCard>
            )}
          </div>

          {image.color_palette && image.color_palette.length > 0 && (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-ink-faint">Paleta</p>
              <div className="flex flex-wrap gap-2">
                {image.color_palette.map((c) => (
                  <div
                    key={c}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5"
                  >
                    <span
                      className="h-5 w-5 rounded-md border border-white/15"
                      style={{ backgroundColor: c }}
                      aria-hidden
                    />
                    <span className="font-mono text-xs text-ink-dim">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {image.tags && image.tags.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-faint">
                <TagIcon className="h-3 w-3" />
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {image.tags.map((tag) => (
                  <Link key={tag} to={`/tag/${encodeURIComponent(tag)}`} className="chip">
                    #{tag}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {image.enhanced_prompt && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-faint">
                <Sparkles className="h-3 w-3" />
                Prompt mejorado
              </p>
              <div className="rounded-xl border border-white/5 bg-canvas-raised p-4 text-sm leading-relaxed text-ink-dim">
                {image.enhanced_prompt}
              </div>
            </div>
          )}

          {image.original_prompt && (
            <details className="rounded-xl border border-white/5 bg-canvas-raised p-4 text-sm text-ink-dim">
              <summary className="cursor-pointer text-xs uppercase tracking-wider text-ink-faint">
                Prompt original
              </summary>
              <p className="mt-2 leading-relaxed">{image.original_prompt}</p>
            </details>
          )}
        </div>
      </div>

      {/* Related — only render when we actually have items.
          No skeleton, no spinner, no placeholder: an empty/failed/loading
          /related response must produce zero layout. */}
      {related?.items && related.items.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 font-display text-xl font-semibold text-ink">Relacionadas</h2>
          <div className="columns-1 gap-4 sm:columns-2 md:columns-3 lg:columns-4">
            {related.items.map((rel, i) => (
              <div key={rel.id} className="mb-4 break-inside-avoid">
                <ImageCard image={rel} index={i} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AttrCard({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-white/5 bg-canvas-raised p-3 ${className ?? ''}`}>
      <p className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink">{children}</p>
    </div>
  );
}
