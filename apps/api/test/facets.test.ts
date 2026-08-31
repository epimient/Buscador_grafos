import { describe, it, expect, beforeEach } from 'vitest';
import { buildGraph, filters, stats } from '../src/graph';
import { sampleRows, resetCounter } from './fixtures/images';
import type { GraphSnapshot } from '../src/graph';

let snap: GraphSnapshot;

beforeEach(() => {
  resetCounter();
  snap = buildGraph(sampleRows);
});

describe('filters', () => {
  it('returns styles with counts', () => {
    const result = filters(snap);
    expect(result.styles.length).toBeGreaterThan(0);
    for (const s of result.styles) {
      expect(s).toHaveProperty('value');
      expect(s).toHaveProperty('count');
      expect(typeof s.count).toBe('number');
      expect(s.count).toBeGreaterThan(0);
    }
  });

  it('returns moods with counts', () => {
    const result = filters(snap);
    expect(result.moods.length).toBeGreaterThan(0);
    for (const m of result.moods) {
      expect(m).toHaveProperty('value');
      expect(m).toHaveProperty('count');
    }
  });

  it('returns useCases with counts', () => {
    const result = filters(snap);
    expect(result.useCases.length).toBeGreaterThan(0);
    for (const u of result.useCases) {
      expect(u).toHaveProperty('value');
      expect(u).toHaveProperty('count');
    }
  });

  it('top style is among the most common', () => {
    const result = filters(snap);
    // Count actual most common from fixtures
    const maxCount = Math.max(...result.styles.map((s) => s.count));
    expect(result.styles[0].count).toBe(maxCount);
  });

  it('Calm or Vibrant or Futuristic is among top moods', () => {
    const result = filters(snap);
    const topMood = result.moods[0].value;
    expect(['Calm', 'Vibrant', 'Futuristic']).toContain(topMood);
  });
});

describe('stats', () => {
  it('returns total matching row count', () => {
    const result = stats(snap);
    expect(result.total).toBe(sampleRows.length);
  });

  it('topStyles has at most 10 items', () => {
    const result = stats(snap);
    expect(result.topStyles.length).toBeLessThanOrEqual(10);
  });

  it('topMoods has at most 10 items', () => {
    const result = stats(snap);
    expect(result.topMoods.length).toBeLessThanOrEqual(10);
  });

  it('topTags has at most 20 items', () => {
    const result = stats(snap);
    expect(result.topTags.length).toBeLessThanOrEqual(20);
  });

  it('topTags items have tag and count', () => {
    const result = stats(snap);
    for (const t of result.topTags) {
      expect(t).toHaveProperty('tag');
      expect(t).toHaveProperty('count');
      expect(typeof t.tag).toBe('string');
      expect(typeof t.count).toBe('number');
    }
  });

  it('topStyles items have value and count', () => {
    const result = stats(snap);
    for (const s of result.topStyles) {
      expect(s).toHaveProperty('value');
      expect(s).toHaveProperty('count');
    }
  });

  it('topMoods items have value and count', () => {
    const result = stats(snap);
    for (const m of result.topMoods) {
      expect(m).toHaveProperty('value');
      expect(m).toHaveProperty('count');
    }
  });

  it('total is correct with empty input', () => {
    const emptySnap = buildGraph([]);
    const result = stats(emptySnap);
    expect(result.total).toBe(0);
    expect(result.topStyles).toEqual([]);
    expect(result.topMoods).toEqual([]);
    expect(result.topTags).toEqual([]);
  });
});
