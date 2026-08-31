import { describe, it, expect, beforeEach } from 'vitest';
import { buildGraph, tagsList, tagImages } from '../src/graph';
import { sampleRows, resetCounter } from './fixtures/images';
import type { GraphSnapshot } from '../src/graph';

let snap: GraphSnapshot;

beforeEach(() => {
  resetCounter();
  snap = buildGraph(sampleRows);
});

describe('tagsList', () => {
  it('returns all tags with counts', () => {
    const result = tagsList(snap);
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item).toHaveProperty('tag');
      expect(item).toHaveProperty('count');
      expect(typeof item.count).toBe('number');
    }
  });

  it('tags are sorted by count DESC, tag ASC', () => {
    const result = tagsList(snap);
    for (let i = 1; i < result.items.length; i++) {
      const a = result.items[i - 1];
      const b = result.items[i];
      if (a.count === b.count) {
        expect(a.tag.localeCompare(b.tag)).toBeLessThanOrEqual(0);
      } else {
        expect(a.count).toBeGreaterThanOrEqual(b.count);
      }
    }
  });

  it('respects limit', () => {
    const result = tagsList(snap, 5);
    expect(result.items.length).toBeLessThanOrEqual(5);
  });

  it('cat and dog should have high counts', () => {
    const result = tagsList(snap);
    const catTag = result.items.find((t) => t.tag === 'cat');
    const dogTag = result.items.find((t) => t.tag === 'dog');
    expect(catTag).toBeDefined();
    expect(dogTag).toBeDefined();
    expect(catTag!.count).toBeGreaterThanOrEqual(2);
    expect(dogTag!.count).toBeGreaterThanOrEqual(2);
  });
});

describe('tagImages', () => {
  it('returns images for a specific tag', () => {
    const result = tagImages(snap, 'cat');
    expect(result.tag).toBe('cat');
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items.every((r) => r.tags?.includes('cat'))).toBe(true);
  });

  it('returns empty for unknown tag', () => {
    const result = tagImages(snap, 'nonexistent');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('items are sorted by created_at DESC', () => {
    const result = tagImages(snap, 'cat', { limit: 100 });
    for (let i = 1; i < result.items.length; i++) {
      const prev = result.items[i - 1];
      const curr = result.items[i];
      const cmp = prev.created_at.localeCompare(curr.created_at);
      if (cmp !== 0) {
        expect(cmp).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('pagination works correctly', () => {
    const all = tagImages(snap, 'cat', { limit: 100 });
    const p1 = tagImages(snap, 'cat', { page: 1, limit: 1 });
    expect(p1.items.length).toBe(1);
    expect(p1.total).toBe(all.total);
    if (all.total > 1) {
      expect(p1.hasMore).toBe(true);
    }
  });

  it('clamps page and limit', () => {
    const r1 = tagImages(snap, 'cat', { page: 0 });
    expect(r1.page).toBe(1);
    const r2 = tagImages(snap, 'cat', { limit: 200 });
    expect(r2.limit).toBe(100);
  });
});
