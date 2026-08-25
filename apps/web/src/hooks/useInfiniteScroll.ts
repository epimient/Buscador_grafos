import { useEffect, useRef } from 'react';

/**
 * Stable IntersectionObserver: the observer is created once per `enabled`
 * transition. The latest `onIntersect` is read through a ref so changing the
 * callback identity (e.g. when isFetchingNextPage flips) does NOT tear down
 * and re-create the observer — which would otherwise fire spuriously every
 * time the sentinel is still in view after a fetch.
 */
export function useInfiniteScroll(onIntersect: () => void, enabled = true) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onIntersect);
  callbackRef.current = onIntersect;

  useEffect(() => {
    if (!enabled) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) callbackRef.current();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return sentinelRef;
}
