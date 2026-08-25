import { Link } from 'react-router-dom';
import { useTags } from '@/hooks/useFilters';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { motion } from 'framer-motion';

export function TagsPage() {
  const { data, isLoading, error, refetch } = useTags(300);

  return (
    <div>
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-ink-faint">Explorar</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink">Todos los tags</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Cada chip te lleva a las imágenes asociadas a ese término.
        </p>
      </header>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 40 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data?.items.map((t, i) => (
            <motion.div
              key={t.tag}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.005, 0.4) }}
            >
              <Link to={`/tag/${encodeURIComponent(t.tag)}`} className="chip">
                #{t.tag}
                <span className="text-[10px] text-ink-faint">{t.count}</span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
