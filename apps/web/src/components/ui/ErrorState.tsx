import { AlertTriangle, RefreshCw } from 'lucide-react';

export function ErrorState({
  message = 'Algo salió mal cargando los datos.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-10 text-center">
      <AlertTriangle className="h-6 w-6 text-red-400" />
      <p className="text-sm text-ink-dim">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost">
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
      )}
    </div>
  );
}
