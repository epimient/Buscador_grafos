import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchHealth,
  fetchImage,
  fetchImages,
  fetchRelated,
  fetchTagImages,
  searchImages,
  type ImageListParams,
  type SearchMode,
} from '@/services/api';
import type { ActiveFilters } from '@/types/image';

export function useInfiniteImages(filters: ActiveFilters, limit = 24) {
  return useInfiniteQuery({
    queryKey: ['images', filters, limit],
    queryFn: ({ pageParam }) =>
      fetchImages({ page: pageParam as number, limit, ...filters } satisfies ImageListParams),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}

export function useImage(id: string) {
  return useQuery({
    queryKey: ['image', id],
    queryFn: () => fetchImage(id),
    enabled: typeof id === 'string' && id.length > 0,
  });
}

export function useRelatedImages(id: string) {
  return useQuery({
    queryKey: ['image', id, 'related'],
    queryFn: () => fetchRelated(id, 8),
    enabled: typeof id === 'string' && id.length > 0,
  });
}

// `mode` undefined = el servidor decide (config SEARCH_MODE). Se incluye en el
// queryKey para que cambiar el toggle re-haga la búsqueda.
export function useInfiniteSearch(q: string, limit = 24, mode?: SearchMode) {
  return useInfiniteQuery({
    queryKey: ['search', q, mode ?? null, limit],
    queryFn: ({ pageParam }) => searchImages({ q, page: pageParam as number, limit, mode }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: q.trim().length > 0,
  });
}

/** Config de búsqueda del servidor (modo y modelo por defecto) para inicializar el toggle. */
export function useSearchConfig() {
  return useQuery({
    queryKey: ['health', 'search'],
    queryFn: fetchHealth,
    staleTime: 60_000,
  });
}

export function useInfiniteTagImages(tag: string, limit = 24) {
  return useInfiniteQuery({
    queryKey: ['tag', tag, limit],
    queryFn: ({ pageParam }) => fetchTagImages(tag, pageParam as number, limit),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: tag.length > 0,
  });
}
