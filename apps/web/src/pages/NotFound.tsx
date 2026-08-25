import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-6xl font-bold text-ink">404</p>
      <p className="max-w-sm text-sm text-ink-dim">
        La ruta que buscas no existe. Quizá fue movida o nunca estuvo aquí.
      </p>
      <Link to="/" className="btn-primary">
        Volver a la galería
      </Link>
    </div>
  );
}
