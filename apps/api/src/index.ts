import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { pingDb } from './db';
import { graphStore, fetchAllRows, fetchDeltaRows } from './graph';
import type { ImageRow } from './types';
import type { GraphStore } from './graph';
import { imagesRouter } from './routes/images';
import { searchRouter } from './routes/search';
import { tagsRouter } from './routes/tags';
import { filtersRouter } from './routes/filters';
import { statsRouter } from './routes/stats';
import { graphRouter } from './routes/graph';

export const app = express();

// Detrás de Nginx: respetar X-Forwarded-* para req.ip / req.protocol.
app.set('trust proxy', 1);

app.use(
  cors({
    origin: config.server.corsOrigin === '*' ? true : config.server.corsOrigin.split(','),
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));

// Serve test images as static files (needed if DB contains mock URLs)
app.use('/test-images', express.static(path.join(__dirname, '../test-images')));
app.use('/test-images-real', express.static(path.join(__dirname, '../test-images-real')));

app.get('/api/health', (_req, res) => {
  const snap = graphStore.snapshot;
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    graph: snap
      ? {
          rows: snap.stats.total,
          nodes: snap.graph.order,
          edges: snap.graph.size,
          builtAt: snap.builtAt.toISOString(),
          buildMs: snap.buildMs,
        }
      : null,
  });
});

app.use('/api/images', imagesRouter);
app.use('/api/search', searchRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/filters', filtersRouter);
app.use('/api/stats', statsRouter);
app.use('/api/graph', graphRouter);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api] error:', err);
  const message = err.message || 'Internal server error';
  res.status(500).json({ error: message });
});

/**
 * Carga el grafo y arranca el refresh.
 */
export async function bootGraph(): Promise<void> {
  if (config.graph.engine !== 'graph') return;

  // Carga inicial; si falla (e.g. postgres caído), el refresh sigue activo
  // y reintentará automáticamente hasta que la DB responda.
  const loadOnce = async (): Promise<ImageRow[]> => {
    const rows = await fetchAllRows();
    graphStore.load(rows);
    return rows;
  };

  try {
    await loadOnce();
  } catch (err) {
    console.warn('[graph] initial load failed, will retry on refresh:', (err as Error).message);
  }

  // El timer SIEMPRE se arranca, incluso si la carga inicial falló.
  // Cada tick decide entre rebuild completo (GRAPH_FULL_RELOAD_MS) o delta
  // incremental desde el watermark (GRAPH_REFRESH_MS).
  graphStore.startRefresh(
    fetchAllRows,
    (wm) => fetchDeltaRows(wm),
    config.graph.refreshMs,
    config.graph.fullReloadMs,
  );
  console.log(
    `[graph] refresh every ${config.graph.refreshMs}ms, full reload every ${config.graph.fullReloadMs}ms`,
  );
}

// Auto-start only when run directly (not imported for tests).
if (require.main === module) {
  const port = config.server.port;
  const host = config.server.host;
  app.listen(port, host, async () => {
    console.log(`[api] listening on http://${host}:${port}`);
    pingDb()
      .then(() => console.log('[api] postgres ok'))
      .catch((e) => console.warn('[api] postgres ping failed:', e.message));
    await bootGraph();
  });
}
