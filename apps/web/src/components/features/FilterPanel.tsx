import { useFilters } from '@/hooks/useFilters';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import type { ActiveFilters } from '@/types/image';
import { cn } from '@/lib/utils';

interface Props {
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
}

function FilterGroup({
  title,
  values,
  active,
  onPick,
}: {
  title: string;
  values: Array<{ value: string; count: number }>;
  active?: string;
  onPick: (next?: string) => void;
}) {
  if (!values || values.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {title}
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {values.slice(0, 16).map((v) => {
          const isActive = active === v.value;
          return (
            <button
              key={v.value}
              type="button"
              onClick={() => onPick(isActive ? undefined : v.value)}
              className={cn('chip', isActive && 'chip-active')}
            >
              <span className="capitalize">{v.value}</span>
              <span className="text-[10px] text-ink-faint">{v.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FilterPanel({ active, onChange }: Props) {
  const { data, isLoading } = useFilters();

  const activeCount =
    (active.style ? 1 : 0) + (active.mood ? 1 : 0) + (active.use_case ? 1 : 0);

  return (
    <aside className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-ink">Filtros</h3>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="inline-flex items-center gap-1 text-xs text-ink-dim hover:text-accent"
          >
            <X className="h-3 w-3" />
            Limpiar ({activeCount})
          </button>
        )}
      </div>

      <AnimatePresence>
        {activeCount > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-1.5"
          >
            {(['style', 'mood', 'use_case'] as const).map((k) => {
              const v = active[k];
              if (!v) return null;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onChange({ ...active, [k]: undefined })}
                  className="chip chip-active"
                >
                  <span className="capitalize">{v}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-4">
          <div className="skeleton h-3 w-16 rounded" />
          <div className="skeleton h-20 w-full rounded" />
        </div>
      ) : (
        <>
          <FilterGroup
            title="Estilo"
            values={data?.styles ?? []}
            active={active.style}
            onPick={(v) => onChange({ ...active, style: v })}
          />
          <FilterGroup
            title="Mood"
            values={data?.moods ?? []}
            active={active.mood}
            onPick={(v) => onChange({ ...active, mood: v })}
          />
          <FilterGroup
            title="Uso"
            values={data?.useCases ?? []}
            active={active.use_case}
            onPick={(v) => onChange({ ...active, use_case: v })}
          />
        </>
      )}
    </aside>
  );
}
