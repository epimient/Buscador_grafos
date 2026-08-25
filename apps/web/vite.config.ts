import { defineConfig, loadEnv, type Plugin, type ViteDevServer, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vite serves index.html at the configured `base` (e.g. /vorael/), so visiting
 * /vorael (no trailing slash) returns 404. This plugin issues a 302 redirect
 * to the base-with-slash form, preserving the query string.
 */
function redirectBasePath(basePath: string): Plugin {
  const withSlash = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const withoutSlash = withSlash.replace(/\/$/, '');

  function attach(server: ViteDevServer | PreviewServer) {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? '';
      const [pathname, query] = url.split('?');
      if (pathname === withoutSlash) {
        res.statusCode = 302;
        res.setHeader('Location', query ? `${withSlash}?${query}` : withSlash);
        res.end();
        return;
      }
      next();
    });
  }

  return {
    name: 'redirect-base-path',
    apply: () => withoutSlash.length > 0,
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rawBase = env.VITE_BASE_PATH || '/vorael/';
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

  // Same normalisation axios applies in src/services/api.ts, so the proxy keys
  // below match the URLs the bundle actually requests.
  const apiPrefix = (env.VITE_API_URL ?? '').trim().replace(/\/$/, '');
  const apiTarget = env.VITE_DEV_API_PROXY || 'http://localhost:3001';

  return {
    base,
    plugins: [react(), redirectBasePath(base)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    // `vite preview` serves the real build, so with VITE_API_URL set the bundle
    // asks for the prefixed "/vorael/api/...". Nothing local answers that, and
    // the SPA fallback would hand back index.html instead of JSON. Mirror the
    // Nginx rule (deploy/nginx-vorael.conf) — strip the prefix, forward to
    // Express — so a preview is a faithful rehearsal of production. With
    // VITE_API_URL empty the key collapses to "/api" and the rewrite is a no-op.
    preview: {
      port: 4173,
      proxy: {
        [`${apiPrefix}/api`]: {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (p: string) => p.replace(`${apiPrefix}/api`, '/api'),
        },
      },
    },
  };
});
