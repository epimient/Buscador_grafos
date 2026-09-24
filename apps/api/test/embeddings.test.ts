import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cosine,
  rrfFuse,
  searchSemantic,
  EmbeddingCache,
  type SemanticIndex,
} from '../src/embeddings';

function makeIndex(rows: [string, number[]][]): SemanticIndex {
  return {
    vectors: new Map(rows.map(([id, v]) => [id, Float32Array.from(v)])),
    model: 'test',
    dim: rows[0]?.[1].length ?? 0,
    builtAt: new Date(),
  };
}

describe('cosine', () => {
  it('devuelve 1 para vectores idénticos', () => {
    const a = Float32Array.from([1, 0, 0]);
    expect(cosine(a, a)).toBe(1);
  });

  it('devuelve 0 para vectores ortogonales', () => {
    const a = Float32Array.from([1, 0, 0]);
    const b = Float32Array.from([0, 1, 0]);
    expect(cosine(a, b)).toBe(0);
  });

  it('devuelve -1 para vectores opuestos', () => {
    const a = Float32Array.from([1, 0, 0]);
    const b = Float32Array.from([-1, 0, 0]);
    expect(cosine(a, b)).toBeCloseTo(-1, 5);
  });

  it('ordena por proximidad (cat > dog > car)', () => {
    // "gato": punto en el espacio, "perro" cerca, "coche" más lejos.
    const gato = Float32Array.from([1, 0, 0]);
    const perro = Float32Array.from([0.9, 0.2, 0]);
    const coche = Float32Array.from([0.1, 0, 1]);
    expect(cosine(gato, perro)).toBeGreaterThan(cosine(gato, coche));
  });
});

describe('rrfFuse', () => {
  it('fusiona rankings dando mayor score a quien aparece en ambas listas', () => {
    const lexical = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const semantic = [{ id: 'a' }, { id: 'b' }];
    const fused = rrfFuse(lexical, semantic, 60);

    expect(fused.length).toBe(3);
    expect(fused[0].id).toBe('a');
    expect(fused[0].lexicalRank).toBe(1);
    expect(fused[0].semanticRank).toBe(1);
    expect(fused[0].score).toBeGreaterThan(fused[1].score as number);
  });

  it('mantiene el orden relativo de elementos solo-semánticos', () => {
    const lexical = [{ id: 'a' }];
    const semantic = [{ id: 'z' }, { id: 'b' }];
    const fused = rrfFuse(lexical, semantic, 60);
    expect(fused[0].id).toBe('a');
    expect(fused[1].id).toBe('z');
    expect(fused[2].id).toBe('b');
  });

  it('no rompe con listas vacías', () => {
    expect(rrfFuse([], [], 60)).toEqual([]);
    expect(rrfFuse([{ id: 'a' }], [], 60)).toHaveLength(1);
    expect(rrfFuse([], [{ id: 'b' }], 60)).toHaveLength(1);
  });
});

describe('searchSemantic', () => {
  it('devuelve top-k por similitud sin pares del propio índice de la query', () => {
    const index = makeIndex([
      ['g1', [1, 0, 0]],
      ['g2', [0.9, 0.1, 0]],
      ['g3', [0, 1, 0]],
      ['g4', [0.8, 0.2, -0.1]],
    ]);
    const qVec = Float32Array.from([1, 0, 0]);
    const top = searchSemantic(index, qVec, 2);
    expect(top).toHaveLength(2);
    expect(top[0].id).toBe('g1');
    expect(top[1].id).toBe('g2');
  });

  it('respeta el límite k', () => {
    const index = makeIndex([
      ['a', [1, 0, 0]],
      ['b', [0.95, 0, 0]],
      ['c', [0.9, 0, 0]],
    ]);
    expect(searchSemantic(index, Float32Array.from([1, 0, 0]), 2)).toHaveLength(2);
  });

  it('devuelve vacío si dim no coincide', () => {
    const index = makeIndex([['a', [1, 0]]]);
    expect(searchSemantic(index, Float32Array.from([1, 0, 0]), 5)).toEqual([]);
  });

  it('devuelve vacío con índice vacío', () => {
    const empty: SemanticIndex = {
      vectors: new Map(),
      model: 'test',
      dim: 0,
      builtAt: new Date(),
    };
    expect(searchSemantic(empty, Float32Array.from([1, 0, 0]), 5)).toEqual([]);
  });

  it('descarta resultados con coseno bajo minScore', () => {
    const index = makeIndex([
      ['g1', [1, 0, 0]], // coseno 1.0
      ['g2', [0.9, 0.1, 0]], // coseno ~0.994
      ['g3', [0.1, 0, 0.8]], // coseno ~0.124 < 0.25
    ]);
    const qVec = Float32Array.from([1, 0, 0]);
    const top = searchSemantic(index, qVec, 10, 0.25);
    const ids = top.map((r) => r.id);
    expect(ids).toContain('g1');
    expect(ids).toContain('g2');
    expect(ids).not.toContain('g3');
  });

  it('minScore por defecto usa config.semantic.minScore (ruido excluido)', () => {
    const index = makeIndex([
      ['g1', [1, 0, 0]], // coseno 1.0
      ['ruido', [0.3, 0.9, 0.1]], // coseno ~0.31 < default 0.65 → no entra
      ['ruido2', [-0.5, 0.8, 0.2]], // coseno negativo → no entra
    ]);
    const top = searchSemantic(index, Float32Array.from([1, 0, 0]), 10);
    const ids = top.map((r) => r.id);
    expect(ids).toContain('g1');
    expect(ids).not.toContain('ruido');
    expect(ids).not.toContain('ruido2');
  });
});

describe('EmbeddingCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('guarda y recupera con LRU', () => {
    const cache = new EmbeddingCache(2);
    cache.set('a', Float32Array.from([1]));
    cache.set('b', Float32Array.from([2]));
    expect(cache.get('a')![0]).toBe(1);

    // 'a' se acaba de tocar → 'b' se expulsa al meter 'c'.
    cache.set('c', Float32Array.from([3]));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')![0]).toBe(1);
    expect(cache.get('c')![0]).toBe(3);
  });

  it('re-acceder mueve al final (más reciente)', () => {
    const cache = new EmbeddingCache(2);
    cache.set('a', Float32Array.from([1]));
    cache.set('b', Float32Array.from([2]));
    cache.get('a'); // tocar 'a' → la vuelve más reciente
    cache.set('c', Float32Array.from([3]));
    expect(cache.get('b')).toBeUndefined(); // 'b' expulsada (la menos reciente)
    expect(cache.get('a')![0]).toBe(1);
  });
});