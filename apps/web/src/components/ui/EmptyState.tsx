import type { ReactNode } from 'react';
import { ImageOff } from 'lucide-react';

export function EmptyState({
  title = 'Sin resultados',
  description,
  action,
}: {
  title?: string;
  description?: string;
  /** Acción opcional (p. ej. un botón para cambiar de modo de búsqueda). */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-6 py-16 text-center">
      <ImageOff className="h-8 w-8 text-ink-faint" />
      <h3 className="font-display text-lg text-ink">{title}</h3>
      {description && <p className="max-w-sm text-sm text-ink-dim">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
