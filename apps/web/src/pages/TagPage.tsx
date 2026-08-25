import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useInfiniteTagImages } from '@/hooks/useImages';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { ImageGrid } from '@/components/features/ImageGrid';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';

export function TagPage() {
  const { tag = '' } = useParams<{ tag: string }>();
  const decoded = decodeURIComponent(tag);

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteTagImages(decoded);

  const onLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinelRef = useInfiniteScroll(onLoadMore, !!hasNextPage);

  const pages = data?.pages ?? [];
  const totalLoaded = pages.reduce((n, p) => n + p.items.length, 0);
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div>
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-ink-faint">Tag</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink">
          #{decoded}
          <span className="ml-3 align-middle text-sm font-normal text-ink-dim">
            {total.toLocaleString('es-CO')} imágenes
          </span>
        </h1>
      </header>

      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : !isLoading && totalLoaded === 0 ? (
        <EmptyState
          title="Sin imágenes con este tag"
          description="Es posible que el tag haya sido removido o aún no se haya indexado."
        />
      ) : (
        <ImageGrid pages={pages} loading={isLoading} loadingMore={isFetchingNextPage} />
      )}

      <div ref={sentinelRef} className="h-10" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
    </div>
  );
}
