import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteImages } from '@/hooks/useImages';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { ImageGrid } from '@/components/features/ImageGrid';
import { FilterPanel } from '@/components/features/FilterPanel';
import { HeroBanner } from '@/components/features/HeroBanner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import type { ActiveFilters } from '@/types/image';

export function GalleryPage() {
  const [params, setParams] = useSearchParams();
  const active: ActiveFilters = useMemo(
    () => ({
      style: params.get('style') ?? undefined,
      mood: params.get('mood') ?? undefined,
      use_case: params.get('use_case') ?? undefined,
    }),
    [params],
  );

  const setFilters = useCallback(
    (next: ActiveFilters) => {
      const sp = new URLSearchParams();
      if (next.style) sp.set('style', next.style);
      if (next.mood) sp.set('mood', next.mood);
      if (next.use_case) sp.set('use_case', next.use_case);
      setParams(sp, { replace: true });
    },
    [setParams],
  );

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteImages(active);

  const onLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinelRef = useInfiniteScroll(onLoadMore, !!hasNextPage);

  const pages = data?.pages ?? [];
  const totalLoaded = pages.reduce((n, p) => n + p.items.length, 0);
  const total = data?.pages[0]?.total;
  const [showHero] = useState(true);

  return (
    <div>
      {showHero && <HeroBanner total={total} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <FilterPanel active={active} onChange={setFilters} />
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold text-ink">
              {total !== undefined ? `${total.toLocaleString('es-CO')} imágenes` : 'Galería'}
            </h2>
          </div>

          {error ? (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          ) : !isLoading && totalLoaded === 0 ? (
            <EmptyState
              title="Sin imágenes"
              description="No hay imágenes que coincidan con los filtros activos."
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
      </div>
    </div>
  );
}
