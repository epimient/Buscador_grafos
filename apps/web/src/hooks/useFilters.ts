import { useQuery } from '@tanstack/react-query';
import { fetchFilters, fetchStats, fetchTags } from '@/services/api';

export function useFilters() {
  return useQuery({
    queryKey: ['filters'],
    queryFn: fetchFilters,
    staleTime: 5 * 60_000,
  });
}

export function useTags(limit = 200) {
  return useQuery({
    queryKey: ['tags', limit],
    queryFn: () => fetchTags(limit),
    staleTime: 5 * 60_000,
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    staleTime: 5 * 60_000,
  });
}
