import { Link } from 'react-router-dom';
import { useStats } from '@/hooks/useFilters';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { FilterValue } from '@/types/image';

function StatList({
  title,
  items,
  hrefBuilder,
}: {
  title: string;
  items: FilterValue[];
  hrefBuilder?: (v: string) => string;
}) {
  const max = items.reduce((m, x) => Math.max(m, x.count), 0) || 1;
  return (
    <section className="rounded-2xl border border-white/5 bg-canvas-raised p-5">
      <h3 className="mb-4 font-display text-base font-semibold text-ink">{title}</h3>
      <ul className="space-y-2">
        {items.map((it) => {
          const inner = (
            <>
              <span className="flex-1 truncate text-sm text-ink capitalize">{it.value}</span>
              <span className="font-mono text-xs text-ink-dim">{it.count}</span>
            </>
          );
          const pct = (it.count / max) * 100;
          return (
            <li key={it.value} className="relative">
              <div className="relative flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-white/[0.04]">
                <div
                  className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-accent/15 to-accent/0"
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
                <div className="relative z-10 flex w-full items-center gap-3">
                  {hrefBuilder ? (
                    <Link to={hrefBuilder(it.value)} className="flex w-full items-center gap-3">
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex w-full items-center gap-3">{inner}</div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StatsPage() {
  const { data, isLoading, error, refetch } = useStats();

  if (error) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div>
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-ink-faint">Datos</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink">Estadísticas</h1>
      </header>

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <div className="mb-8 rounded-2xl border border-white/5 bg-mesh-glow bg-canvas-raised p-6">
            <p className="text-xs uppercase tracking-wider text-ink-faint">Total de imágenes</p>
            <p className="mt-1 font-display text-5xl font-bold text-ink">
              {data.total.toLocaleString('es-CO')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <StatList
              title="Top estilos"
              items={data.topStyles}
              hrefBuilder={(v) => `/?style=${encodeURIComponent(v)}`}
            />
            <StatList
              title="Top moods"
              items={data.topMoods}
              hrefBuilder={(v) => `/?mood=${encodeURIComponent(v)}`}
            />
            <StatList
              title="Top tags"
              items={data.topTags}
              hrefBuilder={(v) => `/tag/${encodeURIComponent(v)}`}
            />
          </div>
        </>
      )}
    </div>
  );
}
