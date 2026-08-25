import axios from 'axios';
import type {
  DownloadFormat,
  FiltersResponse,
  Image,
  PaginatedImages,
  Stats,
  TagWithCount,
} from '@/types/image';

// In dev, leave VITE_API_URL empty so axios stays relative ("/api/...") and
// requests go through Vite's proxy (same-origin → no CORS).
// In production we set VITE_API_URL to the absolute path under Nginx.
const rawBase = import.meta.env.VITE_API_URL?.trim();
const baseURL = rawBase ? rawBase.replace(/\/$/, '') : '';

export const api = axios.create({
  baseURL,
  timeout: 20_000,
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url;
    const body = err?.response?.data;
    console.error('[api] request failed', { status, url, body, message: err?.message });
    return Promise.reject(err);
  },
);

export interface ImageListParams {
  page?: number;
  limit?: number;
  style?: string;
  mood?: string;
  use_case?: string;
}

export async function fetchImages(params: ImageListParams = {}): Promise<PaginatedImages> {
  const { data } = await api.get<PaginatedImages>('/api/images', { params });
  return data;
}

export async function fetchImage(id: string): Promise<Image> {
  const { data } = await api.get<Image>(`/api/images/${encodeURIComponent(id)}`);
  return data;
}

export async function fetchRelated(id: string, limit = 8): Promise<{ items: Image[] }> {
  const { data } = await api.get<{ items: Image[] }>(
    `/api/images/${encodeURIComponent(id)}/related`,
    { params: { limit } },
  );
  return data;
}

export interface SearchParams {
  q: string;
  page?: number;
  limit?: number;
}

export async function searchImages(params: SearchParams): Promise<PaginatedImages & { q: string }> {
  const { data } = await api.get<PaginatedImages & { q: string }>('/api/search', { params });
  return data;
}

export async function fetchTags(limit = 200): Promise<{ items: TagWithCount[] }> {
  const { data } = await api.get<{ items: TagWithCount[] }>('/api/tags', { params: { limit } });
  return data;
}

export async function fetchTagImages(
  tag: string,
  page = 1,
  limit = 24,
): Promise<PaginatedImages & { tag: string }> {
  const { data } = await api.get<PaginatedImages & { tag: string }>(
    `/api/tags/${encodeURIComponent(tag)}/images`,
    { params: { page, limit } },
  );
  return data;
}

export async function fetchFilters(): Promise<FiltersResponse> {
  const { data } = await api.get<FiltersResponse>('/api/filters');
  return data;
}

export async function fetchStats(): Promise<Stats> {
  const { data } = await api.get<Stats>('/api/stats');
  return data;
}

// The endpoint pulls the original from S3 and re-encodes it with sharp
// (lossless WebP / PNG level 0 / JPEG q100), so big images take a while —
// Nginx allows 120s for it (deploy/nginx-vorael.conf). The instance-wide 20s
// would cut those off, so this one request gets the matching budget.
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Fetches an image re-encoded to `format` as a Blob.
 *
 * Must go through `api` (not a bare `fetch`) so it inherits `baseURL`: in
 * production the SPA lives at /vorael/ and only /vorael/api/ is proxied to
 * Express, so a root-relative "/api/..." never reaches the backend. Vite's dev
 * proxy answers on bare /api, which is why that mistake hides in development.
 */
export async function downloadImage(id: string, format: DownloadFormat): Promise<Blob> {
  try {
    const { data } = await api.get<Blob>(
      `/api/images/${encodeURIComponent(id)}/download`,
      { params: { format }, responseType: 'blob', timeout: DOWNLOAD_TIMEOUT_MS },
    );
    return data;
  } catch (err) {
    throw new Error(await downloadErrorMessage(err));
  }
}

/**
 * The API reports failures as JSON, but `responseType: 'blob'` applies to error
 * bodies too — so `response.data` is a Blob, not the parsed `{ error }`. Read it
 * back as text to recover the message.
 */
async function downloadErrorMessage(err: unknown): Promise<string> {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data;
    if (body instanceof Blob) {
      try {
        const parsed = JSON.parse(await body.text()) as { error?: string };
        if (parsed.error) return parsed.error;
      } catch {
        // Not JSON — e.g. an Nginx HTML error page. Fall back to the status.
      }
    }
    if (err.response) return `Error ${err.response.status}`;
  }
  return err instanceof Error ? err.message : 'No se pudo descargar la imagen.';
}
