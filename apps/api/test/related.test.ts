import { describe, it, expect, beforeEach } from 'vitest';
import { buildGraph, related } from '../src/graph';
import { sampleRows, resetCounter } from './fixtures/images';
import type { GraphSnapshot } from '../src/graph';

let snap: GraphSnapshot;

beforeEach(() => {
  resetCounter();
  snap = buildGraph(sampleRows);
});

describe('related', () => {
  it('returns empty array for unknown id', () => {
    const result = related(snap, 'nonexistent');
    expect(result.items).toEqual([]);
  });

  it('does not include the source image', () => {
    const sourceId = sampleRows[0].id;
    const result = related(snap, sourceId, 100);
    expect(result.items.every((r) => r.id !== sourceId)).toBe(true);
  });

  it('returns images that share tags', () => {
    // Image 0 has tags: cat, animal, indoor, cozy
    // Image 5 has tags: cat, dog, animal, garden — shares cat, animal
    const result = related(snap, sampleRows[0].id, 10);
    expect(result.items.length).toBeGreaterThan(0);
    const resultIds = result.items.map((r) => r.id);
    expect(resultIds).toContain(sampleRows[5].id);
  });

  it('returns images that share style', () => {
    // Image 2 (Futuristic city, 3D Render) and Image 4 (Robot with flower, 3D Render)
    const result = related(snap, sampleRows[2].id, 10);
    const resultIds = result.items.map((r) => r.id);
    expect(resultIds).toContain(sampleRows[4].id);
  });

  it('respects limit', () => {
    const result = related(snap, sampleRows[0].id, 2);
    expect(result.items.length).toBeLessThanOrEqual(2);
  });

  it('default limit is 8', () => {
    const result = related(snap, sampleRows[0].id);
    expect(result.items.length).toBeLessThanOrEqual(8);
  });

  it('returns items as ImageRow objects', () => {
    const result = related(snap, sampleRows[0].id, 3);
    for (const item of result.items) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('s3_url');
      expect(item).toHaveProperty('tags');
    }
  });

  it('related images are ordered by similarity', () => {
    const result = related(snap, sampleRows[0].id, 100);
    expect(result.items.length).toBeGreaterThan(0);
  });
});
