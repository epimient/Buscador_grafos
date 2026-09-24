import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useInfiniteSearch, useSearchConfig } from '@/hooks/useImages';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { ImageGrid } from '@/components/features/ImageGrid';
import { GraphCanvas } from '@/components/features/GraphCanvas';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { Network } from 'lucide-react';
import { isSearchMode, searchImages, type SearchMode } from '@/services/api';
import { cn } from '@/lib/utils';

const MODES: Array<{ id: SearchMode; label: string; hint: string }> = [
  { id: 'lexical', label: 'Léxica', hint: 'coincidencia por tokens' },
  { id: 'semantic', label: 'Semántica', hint: 'similitud por embeddings' },
  { id: 'hybrid', label: 'Híbrida', hint: 'fusión de ambas (RRF)' },
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const [showGraph, setShowGraph] = useState(false);

  // Toggle: el param explícito manda; si no viene, usamos el default del
  // servidor (expuesto en /api/health) y caemos a hybrid mientras carga.
  const modeParam = params.get('mode');
  const explicitMode = modeParam && isSearchMode(modeParam) ? modeParam : undefined;
  const { data: health } = useSearchConfig();
  const activeMode = explicitMode ?? health?.search?.mode ?? 'hybrid';

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteSearch(q, 24, explicitMode);

  // Subgrafo de la búsqueda: se pide aparte (graph=1) cuando el usuario abre
  // el toggle — el feed infinito no debería arrastrar el grafo en cada página.
  const { data: graphResp, isFetching: graphLoading } = useQuery({
    queryKey: ['search', q, activeMode, 'graph'],
    queryFn: () =>
      searchImages({
        q,
        mode: explicitMode ?? activeMode,
        limit: 100,
        graph: true,
      }),
    enabled: showGraph && q.length > 0,
  });

  const onLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onPickMode = useCallback(
    (mode: SearchMode) => {
      // Escribimos el modo en el URL (compartible y parte del queryKey) para
      // que el toggle responda incluso antes de cargar /api/health.
      setParams({ q, mode }, { replace: true });
    },
    [setParams, q],
  );

  const toggleGraph = useCallback(() => {
    setShowGraph((v) => !v);
  }, []);

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

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs uppercase tracking-wider text-ink-faint">Modo</span>
          {MODES.map((m) => {
            const isActive = activeMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                title={m.hint}
                onClick={() => onPickMode(m.id)}
                className={cn('chip', isActive && 'chip-active')}
              >
                {m.label}
              </button>
            );
          })}
          <span className="mx-2 h-4 w-px bg-white/10" />
          <button
            type="button"
            onClick={toggleGraph}
            title={showGraph ? 'Volver a los resultados' : 'Ver el grafo de esta búsqueda'}
            className={cn('chip', showGraph && 'chip-active')}
          >
            <Network className="mr-1 h-3.5 w-3.5" aria-hidden />
            {showGraph ? 'Ver resultados' : 'Ver grafo'}
          </button>
        </div>
      </header>

      {showGraph ? (
        // Subgrafo inducido por el top-100 del ranking actual: imágenes (indigo)
        // + metadatos que comparten (tags amber, estilos verde, moods morado…).
        // El tamaño del metadato = cuántas imágenes de la búsqueda lo comparten.
        <div className="relative rounded-2xl border border-white/5 bg-canvas-raised overflow-hidden" style={{ height: '70vh' }}>
          {graphLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas/80">
              <Spinner />
            </div>
          )}
          {graphResp?.graph && graphResp.graph.nodes.length > 0 ? (
            <GraphCanvas data={graphResp.graph} height="70vh" />
          ) : (
            !graphLoading && (
              <div className="flex h-full items-center justify-center p-8">
                <EmptyState
                  title="Sin grafo para esta búsqueda"
                  description="Los resultados no comparten metadatos suficientes para armar el subgrafo."
                />
              </div>
            )
          )}
        </div>
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : !isLoading && totalLoaded === 0 ? (
        <EmptyState
          title="Sin coincidencias"
          description={`No encontramos imágenes para “${q}”. Prueba con términos más generales o cambia el modo.`}
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
