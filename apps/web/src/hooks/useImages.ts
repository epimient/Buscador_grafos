import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchImage,
  fetchImages,
  fetchRelated,
  fetchTagImages,
  searchImages,
  type ImageListParams,
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

export function useInfiniteSearch(q: string, limit = 24) {
  return useInfiniteQuery({
    queryKey: ['search', q, limit],
    queryFn: ({ pageParam }) => searchImages({ q, page: pageParam as number, limit }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: q.trim().length > 0,
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
