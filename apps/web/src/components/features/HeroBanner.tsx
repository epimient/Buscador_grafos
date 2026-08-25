import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

interface Props {
  total?: number;
}

/**
 * Hero usado solo en la landing. El fondo animado aquí es el ÚNICO efecto
 * decorativo "ambient" en toda la app — el resto de la UI es tranquila a propósito.
 */
export function HeroBanner({ total }: Props) {
  return (
    <section className="relative mb-8 overflow-hidden rounded-3xl border border-white/5 bg-canvas-raised">
      {/* animated mesh background */}
      <div className="pointer-events-none absolute inset-0 bg-mesh-glow" />
      <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-accent/30 blur-3xl">
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          className="h-full w-full rounded-full bg-accent/40 blur-3xl"
        />
      </div>
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-accent-soft/20 blur-3xl">
        <motion.div
          animate={{ scale: [1.1, 0.9, 1.1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="h-full w-full rounded-full bg-accent-soft/30 blur-3xl"
        />
      </div>

      <div className="relative px-6 py-12 md:px-12 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent-soft"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generación curada por IA · Americana
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05, ease: 'easeOut' }}
          className="mt-4 max-w-2xl font-display text-4xl font-bold leading-tight tracking-tight text-ink md:text-5xl"
        >
          Imágenes generadas por IA para cada idea académica.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
          className="mt-3 max-w-xl text-sm text-ink-dim md:text-base"
        >
          Explora, busca y descarga el catálogo visual de Corporación Universitaria Americana —
          {total !== undefined && (
            <>
              {' '}
              <span className="font-semibold text-ink">{total.toLocaleString('es-CO')}</span>{' '}
              piezas listas para usar.
            </>
          )}
        </motion.p>
      </div>
    </section>
  );
}
