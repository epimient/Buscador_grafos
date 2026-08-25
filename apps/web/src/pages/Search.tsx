import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteSearch } from '@/hooks/useImages';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { ImageGrid } from '@/components/features/ImageGrid';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteSearch(q);

  const onLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinelRef = useInfiniteScroll(onLoadMore, !!hasNextPage);

  const pages = data?.pages ?? [];
  const totalLoaded = pages.reduce((n, p) => n + p.items.length, 0);
  const total = data?.pages[0]?.total ?? 0;

  if (!q) {
    return (
      <EmptyState
        title="Escribe algo para buscar"
        description="La barra superior busca por sujeto, prompt y tags."
      />
    );
  }

  return (
    <div>
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-ink-faint">Búsqueda</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink">
          “{q}”
          <span className="ml-3 align-middle text-sm font-normal text-ink-dim">
            {total.toLocaleString('es-CO')} resultados
          </span>
        </h1>
      </header>

      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : !isLoading && totalLoaded === 0 ? (
        <EmptyState
          title="Sin coincidencias"
          description={`No encontramos imágenes para “${q}”. Prueba con términos más generales.`}
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
