import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Mock data must be hoisted alongside vi.mock.
const { mockSnapshot, mockSearch, mockRelated, mockTagsList, mockTagImages, mockFilters, mockStats } =
  vi.hoisted(() => ({
    mockSnapshot: {
      graph: { neighbors: vi.fn().mockReturnValue([]) },
      byId: new Map(),
      tagIndex: new Map(),
      styleIndex: new Map(),
      moodIndex: new Map(),
      useCaseIndex: new Map(),
      colorIndex: new Map(),
      textIndex: new Map(),
      coWeights: new Map(),
      orderedIds: [],
      stats: {
        total: 0,
        styles: [{ value: 'Photorealistic', count: 5 }],
        moods: [{ value: 'Calm', count: 3 }],
        tags: [{ tag: 'cat', count: 4 }],
        useCases: [{ value: 'Banner', count: 2 }],
      },
      builtAt: new Date(),
    },
    mockSearch: vi.fn().mockReturnValue({
      items: [{ id: 'g1', s3_url: 'https://example.com/g1.webp', tags: ['cat'] }],
      total: 1,
      page: 1,
      limit: 24,
      hasMore: false,
    }),
    mockRelated: vi.fn().mockReturnValue({
      items: [{ id: 'g2', s3_url: 'https://example.com/g2.webp', tags: ['dog'] }],
    }),
    mockTagsList: vi.fn().mockReturnValue({
      items: [{ tag: 'cat', count: 4 }],
    }),
    mockTagImages: vi.fn().mockReturnValue({
      items: [{ id: 'g1', s3_url: 'https://example.com/g1.webp', tags: ['cat'] }],
      total: 1,
      page: 1,
      limit: 24,
      hasMore: false,
      tag: 'cat',
    }),
    mockFilters: vi.fn().mockReturnValue({
      styles: [{ value: 'Photorealistic', count: 5 }],
      moods: [{ value: 'Calm', count: 3 }],
      useCases: [{ value: 'Banner', count: 2 }],
    }),
    mockStats: vi.fn().mockReturnValue({
      total: 100,
      topStyles: [{ value: 'Photorealistic', count: 5 }],
      topMoods: [{ value: 'Calm', count: 3 }],
      topTags: [{ tag: 'cat', count: 4 }],
    }),
  }));

vi.mock('../src/db', () => ({
  pool: { query: vi.fn() },
  pingDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/s3', () => ({
  s3: { send: vi.fn() },
}));

vi.mock('../src/graph', () => ({
  graphStore: {
    ready: true,
    snapshot: mockSnapshot,
  },
  search: mockSearch,
  related: mockRelated,
  tagsList: mockTagsList,
  tagImages: mockTagImages,
  filters: mockFilters,
  stats: mockStats,
  fetchAllRows: vi.fn().mockResolvedValue([]),
}));

import request from 'supertest';
import { app } from '../src/index';

let server: Server;

beforeEach(async () => {
  vi.clearAllMocks();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.on('listening', r));
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function baseUrl(): string {
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await request(baseUrl()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ts).toBeDefined();
  });
});

describe('GET /api/search', () => {
  it('returns paginated results with q field', async () => {
    const res = await request(baseUrl()).get('/api/search?q=cat');
    expect(res.status).toBe(200);
    expect(res.body.q).toBe('cat');
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.page).toBe('number');
    expect(typeof res.body.limit).toBe('number');
    expect(typeof res.body.hasMore).toBe('boolean');
    expect(mockSearch).toHaveBeenCalled();
  });

  it('returns empty for empty query', async () => {
    const res = await request(baseUrl()).get('/api/search?q=');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe('GET /api/images/:id/related', () => {
  it('returns { items: Image[] }', async () => {
    const res = await request(baseUrl()).get('/api/images/g1/related');
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(mockRelated).toHaveBeenCalled();
  });
});

describe('GET /api/tags', () => {
  it('returns { items: TagWithCount[] }', async () => {
    const res = await request(baseUrl()).get('/api/tags');
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0]).toHaveProperty('tag');
    expect(res.body.items[0]).toHaveProperty('count');
    expect(mockTagsList).toHaveBeenCalled();
  });
});

describe('GET /api/tags/:tag/images', () => {
  it('returns paginated results with tag field', async () => {
    const res = await request(baseUrl()).get('/api/tags/cat/images');
    expect(res.status).toBe(200);
    expect(res.body.tag).toBe('cat');
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.hasMore).toBe('boolean');
    expect(mockTagImages).toHaveBeenCalled();
  });
});

describe('GET /api/filters', () => {
  it('returns { styles, moods, useCases }', async () => {
    const res = await request(baseUrl()).get('/api/filters');
    expect(res.status).toBe(200);
    expect(res.body.styles).toBeDefined();
    expect(res.body.moods).toBeDefined();
    expect(res.body.useCases).toBeDefined();
    expect(Array.isArray(res.body.styles)).toBe(true);
    expect(Array.isArray(res.body.moods)).toBe(true);
    expect(Array.isArray(res.body.useCases)).toBe(true);
    expect(mockFilters).toHaveBeenCalled();
  });
});

describe('GET /api/stats', () => {
  it('returns { total, topStyles, topMoods, topTags }', async () => {
    const res = await request(baseUrl()).get('/api/stats');
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(Array.isArray(res.body.topStyles)).toBe(true);
    expect(Array.isArray(res.body.topMoods)).toBe(true);
    expect(Array.isArray(res.body.topTags)).toBe(true);
    expect(mockStats).toHaveBeenCalled();
  });
});

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(baseUrl()).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
