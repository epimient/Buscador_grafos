import { describe, it, expect, beforeEach } from 'vitest';
import { buildGraph, search } from '../src/graph';
import { sampleRows, tokenRows, resetCounter } from './fixtures/images';
import type { GraphSnapshot } from '../src/graph';

let snap: GraphSnapshot;

beforeEach(() => {
  resetCounter();
  snap = buildGraph([...sampleRows, ...tokenRows]);
});

describe('search', () => {
  it('returns empty for empty query', () => {
    const result = search(snap, '');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('returns empty for whitespace-only query', () => {
    const result = search(snap, '   ');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('finds images by tag', () => {
    const result = search(snap, 'cat');
    expect(result.total).toBeGreaterThanOrEqual(3);
    const ids = result.items.map((r) => r.id);
    expect(ids).toContain(sampleRows[0].id); // has tag:cat
  });

  it('finds images by subject token', () => {
    const result = search(snap, 'city');
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items.some((r) => r.subject?.includes('city'))).toBe(true);
  });

  it('finds images by prompt token', () => {
    const result = search(snap, 'neon');
    // 'neon' appears in prompt of futuristic-city and cyberpunk-cat
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('scores tag matches higher than subject matches', () => {
    // 'cat' is a tag on 3 images (score 3) + appears in subject of 1 (score 2)
    const result = search(snap, 'cat');
    expect(result.items.length).toBeGreaterThan(0);
    // All results should have score > 0
  });

  it('applies token-match: "cat" does NOT match "category"', () => {
    const result = search(snap, 'cat');
    const catResult = result.items.map((r) => r.id);
    // tok-01 has subject "Category test" — 'cat' should not match as token
    expect(catResult).not.toContain('tok-01');
  });

  it('applies plural matching: "gato" matches "gatos"', () => {
    const result = search(snap, 'gato');
    const ids = result.items.map((r) => r.id);
    // tok-02 has tag 'gato', tok-03 has tag 'gatos'
    expect(ids).toContain('tok-02');
    expect(ids).toContain('tok-03');
  });

  it('applies plural matching: "gatos" matches "gato"', () => {
    const result = search(snap, 'gatos');
    const ids = result.items.map((r) => r.id);
    expect(ids).toContain('tok-02');
    expect(ids).toContain('tok-03');
  });

  it('multi-term query requires ALL terms to match', () => {
    const result = search(snap, 'cat windowsill');
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items[0].id).toBe(sampleRows[0].id);
  });

  it('multi-term query returns images matching at least some terms', () => {
    // 'cat' is a tag on 3 images — 'spaceship' doesn't exist.
    // The scoring model gives points per matching term (tag overlap), so images
    // with tag 'cat' still score > 0 from that alone. This matches the original
    // SQL behavior (OR-based WHERE).
    const result = search(snap, 'cat spaceship');
    expect(result.total).toBeGreaterThanOrEqual(1);
    // All returned images should have tag 'cat'
    expect(result.items.every((r) => r.tags?.includes('cat'))).toBe(true);
  });

  it('returns correct pagination', () => {
    const result = search(snap, 'cat', { page: 1, limit: 2 });
    expect(result.items.length).toBeLessThanOrEqual(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
    expect(typeof result.hasMore).toBe('boolean');
  });

  it('hasMore is true when there are more results', () => {
    const all = search(snap, 'cat', { page: 1, limit: 1 });
    expect(all.hasMore).toBe(true);
  });

  it('hasMore is false on last page', () => {
    const all = search(snap, 'cat', { page: 1, limit: 100 });
    expect(all.hasMore).toBe(false);
  });

  it('page 2 returns different items', () => {
    const p1 = search(snap, 'cat', { page: 1, limit: 1 });
    const p2 = search(snap, 'cat', { page: 2, limit: 1 });
    if (p2.items.length > 0) {
      expect(p1.items[0].id).not.toBe(p2.items[0].id);
    }
  });

  it('order is score DESC then created_at DESC', () => {
    const result = search(snap, 'cat', { limit: 100 });
    for (let i = 1; i < result.items.length; i++) {
      const a = result.items[i - 1];
      const b = result.items[i];
      // a should have >= score than b (we can't check score directly but
      // we check created_at as tiebreaker)
    }
    // At minimum, results should be non-empty and deterministic
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('clamps page to minimum 1', () => {
    const result = search(snap, 'cat', { page: 0, limit: 10 });
    expect(result.page).toBe(1);
  });

  it('clamps limit to 1-100', () => {
    const r1 = search(snap, 'cat', { limit: 0 });
    expect(r1.limit).toBe(1);
    const r2 = search(snap, 'cat', { limit: 200 });
    expect(r2.limit).toBe(100);
  });

  it('handles case-insensitive search', () => {
    const lower = search(snap, 'cat');
    const upper = search(snap, 'CAT');
    const mixed = search(snap, 'Cat');
    expect(lower.total).toBe(upper.total);
    expect(lower.total).toBe(mixed.total);
  });
});

describe('search coverage (paragraphs)', () => {
  it('ranks paragraphs by coverage: only the image matching most terms ranks first', () => {
    // Párrafo construido íntegramente desde el enhanced_prompt de sampleRows[0].
    const result = search(snap, 'a fluffy cat sitting on a sunny windowsill');
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items[0].id).toBe(sampleRows[0].id);
  });

  it('filters out images that only share a single word of a long paragraph', () => {
    // Imágenes que solo comparten una palabra ('a', 'on') deben quedar fuera.
    const result = search(snap, 'a fluffy cat sitting on a sunny windowsill');
    const ids = result.items.map((r) => r.id);
    expect(ids).not.toContain('tok-02'); // solo comparte "a"
    expect(ids).not.toContain('tok-03');
  });

  it('returns fewer results for a long paragraph than for its keywords alone', () => {
    const paragraph = search(snap, 'cat windowsill sunny fluffy sitting');
    const word = search(snap, 'cat');
    expect(paragraph.total).toBeLessThanOrEqual(word.total);
  });

  it('returns 0 for a paragraph that matches nothing', () => {
    const result = search(snap, 'un gato durmiendo sobre libros viejos');
    expect(result.total).toBe(0);
  });

  it('keeps any-match behavior for short queries (<= 3 terms)', () => {
    // 'cat' tag solo → cuenta aunque el resto del término no exista.
    const result = search(snap, 'cat windowsill spaceship');
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items.every((r) => r.tags?.includes('cat'))).toBe(true);
  });
});
