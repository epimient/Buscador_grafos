import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Mock data must be hoisted alongside vi.mock.
const { mockSnapshot, mockSearch, mockScoreSearch, mockRelated, mockTagsList, mockTagImages, mockFilters, mockStats, mockExportGraph } =
  vi.hoisted(() => ({
    mockSnapshot: {
      graph: { neighbors: vi.fn().mockReturnValue([]) },
      byId: new Map([
        ['g1', { id: 'g1', s3_url: 'https://example.com/g1.webp', tags: ['cat'] }],
      ]),
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
    mockScoreSearch: vi.fn().mockReturnValue({
      ids: ['g1'],
      total: 1,
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
    mockExportGraph: vi.fn().mockReturnValue({
      nodes: [{ id: 'g1', type: 'image', label: 'g1', size: 3, color: '#6366f1' }],
      edges: [],
    }),
  }));

vi.mock('../src/db', () => ({
  pool: { query: vi.fn() },
  pingDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/s3', () => ({
  s3: { send: vi.fn() },
}));

// Stub de la búsqueda semántica: la ruta hace import() dinámico de
// '../embeddings'. Mantenemos searchSemantic/rrfFuse reales (importOriginal) y
// controlamos solo el índice y el embedding de la query.
const sem = vi.hoisted(() => ({
  getSemanticIndex: vi.fn(),
  embedQuery: vi.fn(),
}));

vi.mock('../src/embeddings', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/embeddings')>();
  return {
    ...mod,
    getSemanticIndex: sem.getSemanticIndex,
    embedQuery: sem.embedQuery,
  };
});

vi.mock('../src/graph', () => ({
  graphStore: {
    ready: true,
    snapshot: mockSnapshot,
    exportGraph: mockExportGraph,
  },
  search: mockSearch,
  scoreSearch: mockScoreSearch,
  related: mockRelated,
  tagsList: mockTagsList,
  tagImages: mockTagImages,
  filters: mockFilters,
  stats: mockStats,
  fetchAllRows: vi.fn().mockResolvedValue([]),
  fetchDeltaRows: vi.fn().mockResolvedValue([]),
  applyDelta: vi.fn(),
}));

import request from 'supertest';
import { app } from '../src/index';

let server: Server;

beforeEach(async () => {
  vi.clearAllMocks();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.on('listening', r));
  // Defaults para el stub semántico: si un request entra en semantic/hybrid
  // (config SEARCH_MODE), degrada a lexical sin tocar Ollama.
  sem.getSemanticIndex.mockResolvedValue({
    vectors: new Map(),
    model: 'bge-m3',
    dim: 0,
    builtAt: new Date(),
  });
  sem.embedQuery.mockResolvedValue(null);
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
    expect(mockScoreSearch).toHaveBeenCalled();
  });

  it('returns empty for empty query', async () => {
    const res = await request(baseUrl()).get('/api/search?q=');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('returns the induced subgraph when graph=1', async () => {
    const res = await request(baseUrl()).get('/api/search?q=cat&graph=1');
    expect(res.status).toBe(200);
    expect(res.body.graph).toBeDefined();
    expect(res.body.graph.nodes).toHaveLength(1);
    expect(res.body.graph.nodes[0]).toHaveProperty('size');
    // Se debe haber pedido el subgrafo sobre ids (top del ranking).
    expect(mockExportGraph).toHaveBeenCalledWith(
      expect.objectContaining({ ids: ['g1'], hops: 1 }),
    );
  });

  it('omits graph when graph falsy', async () => {
    const res = await request(baseUrl()).get('/api/search?q=cat');
    expect(res.status).toBe(200);
    expect(res.body.graph).toBeUndefined();
    expect(mockExportGraph).not.toHaveBeenCalled();
  });
});

describe('GET /api/search con modo semantic/hybrid', () => {
  const byId = mockSnapshot.byId as unknown as Map<string, { id: string; s3_url: string; tags: string[] }>;

  const makeIndex = () => ({
    vectors: new Map<string, Float32Array>([
      ['g1', Float32Array.from([1, 0, 0, 0])],
      ['s1', Float32Array.from([0.9, 0.1, 0, 0])],
      ['s2', Float32Array.from([0, 1, 0, 0])],
    ]),
    model: 'bge-m3',
    dim: 4,
    builtAt: new Date(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sem.getSemanticIndex.mockResolvedValue(makeIndex() as never);
    sem.embedQuery.mockResolvedValue(Float32Array.from([1, 0, 0, 0]) as never);
    byId.set('s1', { id: 's1', s3_url: 'https://example.com/s1.webp', tags: ['car'] });
    byId.set('s2', { id: 's2', s3_url: 'https://example.com/s2.webp', tags: ['car'] });
  });

  afterEach(() => {
    byId.delete('s1');
    byId.delete('s2');
  });

  it('hybrid fusiona el ranking léxico con el semántico vía RRF', async () => {
    // lexical = ['g1'] (mockScoreSearch). Semántico: g1 (cos 1), s1 (cos ~0.99).
    const res = await request(baseUrl()).get('/api/search?q=car&mode=hybrid');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hybrid');
    expect(sem.getSemanticIndex).toHaveBeenCalled();
    expect(sem.embedQuery).toHaveBeenCalledWith('car');
    // RRF: g1 aparece en ambos rankings -> score compuesto mayor.
    expect(res.body.items[0].id).toBe('g1');
    // total = ranking RRF materializado, no el total léxico (fix de paginación).
    expect(res.body.total).toBe(2);
  });

  it('semantic usa solo el ranking por coseno y total = top-k materializado', async () => {
    const res = await request(baseUrl()).get('/api/search?q=car&mode=semantic');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('semantic');
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['g1', 's1']);
    expect(res.body.total).toBe(2);
  });

  it('degrade a lexical si el índice está vacío o Ollama no responde', async () => {
    sem.getSemanticIndex.mockResolvedValue({
      vectors: new Map(),
      model: 'bge-m3',
      dim: 0,
      builtAt: new Date(),
    } as never);
    sem.embedQuery.mockResolvedValue(null);
    const res = await request(baseUrl()).get('/api/search?q=car&mode=hybrid');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hybrid');
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['g1']);
    expect(res.body.total).toBe(1); // total léxico
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
