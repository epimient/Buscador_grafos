import { ImageOff } from 'lucide-react';

export function EmptyState({
  title = 'Sin resultados',
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-6 py-16 text-center">
      <ImageOff className="h-8 w-8 text-ink-faint" />
      <h3 className="font-display text-lg text-ink">{title}</h3>
      {description && <p className="max-w-sm text-sm text-ink-dim">{description}</p>}
    </div>
  );
}
