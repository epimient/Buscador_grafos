import { describe, it, expect, beforeEach } from 'vitest';
import { buildGraph, GraphStore } from '../src/graph';
import { sampleRows, tokenRows, emptyRows, resetCounter } from './fixtures/images';
import type { ImageRow } from '../src/types';

beforeEach(() => {
  resetCounter();
});

describe('buildGraph', () => {
  it('creates nodes and edges for all rows', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.byId.size).toBe(sampleRows.length);
    expect(snap.graph.order).toBeGreaterThan(sampleRows.length);
    expect(snap.graph.size).toBeGreaterThan(0);
    expect(snap.orderedIds.length).toBe(sampleRows.length);
  });

  it('creates Image nodes with type attribute', () => {
    const snap = buildGraph(sampleRows);
    for (const row of sampleRows) {
      expect(snap.graph.hasNode(row.id)).toBe(true);
      expect(snap.graph.getNodeAttribute(row.id, 'type')).toBe('Image');
    }
  });

  it('creates Tag nodes with correct prefix', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.graph.hasNode('tag:cat')).toBe(true);
    expect(snap.graph.hasNode('tag:dog')).toBe(true);
    expect(snap.graph.hasNode('tag:neon')).toBe(true);
  });

  it('creates Style nodes', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.graph.hasNode('style:Photorealistic')).toBe(true);
    expect(snap.graph.hasNode('style:3D Render')).toBe(true);
    expect(snap.graph.hasNode('style:Oil Painting')).toBe(true);
  });

  it('creates Mood nodes', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.graph.hasNode('mood:Calm')).toBe(true);
    expect(snap.graph.hasNode('mood:Futuristic')).toBe(true);
    expect(snap.graph.hasNode('mood:Dark')).toBe(true);
  });

  it('creates UseCase nodes', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.graph.hasNode('ucase:Wallpaper')).toBe(true);
    expect(snap.graph.hasNode('ucase:Banner')).toBe(true);
  });

  it('creates Color nodes', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.graph.hasNode('color:#7C5CFF')).toBe(true);
    expect(snap.graph.hasNode('color:#FFD700')).toBe(true);
  });

  it('creates TAGGED_WITH edges', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.graph.hasEdge('tag:cat', sampleRows[0].id)).toBe(true);
    expect(snap.graph.hasEdge('tag:dog', sampleRows[1].id)).toBe(true);
  });

  it('creates HAS_STYLE edges', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.graph.hasEdge('style:Photorealistic', sampleRows[0].id)).toBe(true);
  });

  it('creates CO_OCCURS_WITH edges between tags that share images', () => {
    const snap = buildGraph(sampleRows);
    // 'cat' and 'animal' both appear in image 0
    expect(snap.graph.hasEdge('tag:cat', 'tag:animal')).toBe(true);
    // 'cat' and 'dog' appear together in image 6 (cats-dogs)
    expect(snap.graph.hasEdge('tag:cat', 'tag:dog')).toBe(true);
    // Check weight through the coWeights Map
    const weight = snap.coWeights.get('cat')?.get('dog');
    expect(weight).toBeGreaterThanOrEqual(1);
  });

  it('populates tagIndex correctly', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.tagIndex.get('cat')?.size).toBeGreaterThanOrEqual(2);
    expect(snap.tagIndex.get('dog')?.size).toBeGreaterThanOrEqual(2);
    expect(snap.tagIndex.get('neon')?.size).toBe(2);
  });

  it('populates styleIndex correctly', () => {
    const snap = buildGraph(sampleRows);
    const realistic = snap.styleIndex.get('Photorealistic');
    expect(realistic?.size).toBeGreaterThanOrEqual(3);
  });

  it('populates moodIndex correctly', () => {
    const snap = buildGraph(sampleRows);
    const futuristic = snap.moodIndex.get('Futuristic');
    expect(futuristic?.size).toBeGreaterThanOrEqual(2);
  });

  it('populates colorIndex correctly', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.colorIndex.get('#7C5CFF')?.size).toBe(2);
  });

  it('populates textIndex with tokenized words', () => {
    const snap = buildGraph(sampleRows);
    const tokens = snap.textIndex.get(sampleRows[0].id);
    expect(tokens).toBeDefined();
    expect(tokens).toContain('cat');
    expect(tokens).toContain('windowsill');
    expect(tokens).toContain('fluffy');
  });

  it('orderedIds is sorted by created_at DESC, id DESC', () => {
    const snap = buildGraph(sampleRows);
    for (let i = 1; i < snap.orderedIds.length; i++) {
      const prev = snap.byId.get(snap.orderedIds[i - 1])!;
      const curr = snap.byId.get(snap.orderedIds[i])!;
      // prev should come before curr in DESC order
      const cmpDate = prev.created_at.localeCompare(curr.created_at);
      if (cmpDate !== 0) {
        expect(cmpDate).toBeGreaterThanOrEqual(0);
      } else {
        expect(prev.id.localeCompare(curr.id)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('stats.total matches row count', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.stats.total).toBe(sampleRows.length);
  });

  it('stats.tags is sorted by count DESC', () => {
    const snap = buildGraph(sampleRows);
    for (let i = 1; i < snap.stats.tags.length; i++) {
      expect(snap.stats.tags[i - 1].count).toBeGreaterThanOrEqual(
        snap.stats.tags[i].count,
      );
    }
  });

  it('handles null fields gracefully', () => {
    const snap = buildGraph(emptyRows);
    expect(snap.byId.size).toBe(1);
    expect(snap.graph.hasNode('emp-01')).toBe(true);
    expect(snap.stats.total).toBe(1);
    expect(snap.tagIndex.size).toBe(0);
    expect(snap.textIndex.get('emp-01')).toEqual([]);
  });

  it('handles empty input', () => {
    const snap = buildGraph([]);
    expect(snap.byId.size).toBe(0);
    expect(snap.orderedIds).toEqual([]);
    expect(snap.stats.total).toBe(0);
  });

  it('builtAt is a Date', () => {
    const snap = buildGraph(sampleRows);
    expect(snap.builtAt).toBeInstanceOf(Date);
  });
});

describe('GraphStore', () => {
  it('starts as not ready with null snapshot', () => {
    const store = new GraphStore();
    expect(store.ready).toBe(false);
    expect(store.snapshot).toBeNull();
  });

  it('loads snapshot and becomes ready', () => {
    const store = new GraphStore();
    store.load(sampleRows);
    expect(store.ready).toBe(true);
    expect(store.snapshot).not.toBeNull();
    expect(store.snapshot!.byId.size).toBe(sampleRows.length);
  });

  it('replaces snapshot atomically', () => {
    const store = new GraphStore();
    store.load(sampleRows);
    const oldSnap = store.snapshot;
    store.load(tokenRows);
    expect(store.snapshot).not.toBe(oldSnap);
    expect(store.snapshot!.byId.size).toBe(tokenRows.length);
  });

  it('stop clears timer without error', () => {
    const store = new GraphStore();
    store.stop();
    expect(true).toBe(true);
  });
});
