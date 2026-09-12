import { describe, it, expect, beforeEach } from 'vitest';
import { buildGraph, applyDelta, computeWatermark } from '../src/graph';
import { sampleRows, tokenRows, resetCounter } from './fixtures/images';
import type { ImageRow } from '../src/types';
import type { GraphSnapshot } from '../src/graph';

let snap: GraphSnapshot;

beforeEach(() => {
  resetCounter();
  snap = buildGraph([...sampleRows, ...tokenRows]);
});

describe('computeWatermark', () => {
  it('returns null for empty rows', () => {
    expect(computeWatermark([])).toBeNull();
  });

  it('picks the max created_at', () => {
    const wm = computeWatermark(snapshotRows(snap).slice(0, 2));
    const latest = snapshotRows(snap)
      .slice(0, 2)
      .reduce<string>((acc, r) => {
        const ts = String(r.created_at);
        return ts > acc ? ts : acc;
      }, '');
    expect(wm).not.toBeNull();
    expect(wm!.created_at).toBe(latest);
  });

  it('tie-breaks by id when created_at is equal', () => {
    const rows: ImageRow[] = [
      { ...snapshotRows(snap)[0], id: 'aaa', created_at: '2026-05-01T00:00:00Z' },
      { ...snapshotRows(snap)[0], id: 'bbb', created_at: '2026-05-01T00:00:00Z' },
    ];
    expect(computeWatermark(rows)).toEqual({
      created_at: '2026-05-01T00:00:00Z',
      id: 'bbb',
    });
  });

  it('preserves microsecond precision (pg to_char .US), not truncated to ms', () => {
    // Regresión: un Double Date→.toISOString() truncaba a milisegundos, el
    // watermark quedaba "un microsegundo atrás" y cada tick re-fetchaba la
    // misma fila más reciente.
    const rows: ImageRow[] = [
      { ...snapshotRows(snap)[0], id: 'a', created_at: '2026-09-10T06:07:03.542100Z' },
      { ...snapshotRows(snap)[0], id: 'b', created_at: '2026-09-10T06:07:03.542123Z' },
    ];
    expect(computeWatermark(rows)!.created_at).toBe('2026-09-10T06:07:03.542123Z');
  });

  it('converts Date objects to ISO (defensive path)', () => {
    const rows: ImageRow[] = [
      { ...snapshotRows(snap)[0], id: 'd', created_at: '2026-09-10T06:07:03.542123Z' },
      // @ts-expect-error solo simula un Date residual de pg (antes del fix)
      { ...snapshotRows(snap)[0], id: 'e', created_at: new Date('2026-09-10T06:07:03.999Z') },
    ];
    expect(computeWatermark(rows)!.created_at).toBe('2026-09-10T06:07:03.999Z');
  });
});

describe('applyDelta', () => {
  it('adds a brand new row to every structure', () => {
    const before = {
      total: snap.stats.total,
      nodes: snap.graph.order,
      edges: snap.graph.size,
      ordered: snap.orderedIds.length,
      tags: snap.stats.tags.length,
    };

    const row: ImageRow = {
      id: 'img-new-1',
      s3_key: 'key/new1.webp',
      s3_url: 'https://sfo3.digitaloceanspaces.com/n8ns3/new1.webp',
      original_prompt: 'a brand new cat in neon',
      enhanced_prompt: 'a brand new fluffy cat under bright neon lights',
      tags: ['cat', 'neon', 'brand'],
      style: '3D Render',
      subject: 'Brand new cat',
      mood: 'Futuristic',
      color_palette: ['#7C5CFF', '#000000'],
      use_case: 'Social Media',
      filename: 'new1.webp',
      created_at: '2026-06-01T10:00:00Z',
    };

    applyDelta(snap, [row]);

    expect(snap.stats.total).toBe(before.total + 1);
    // +2 nodos: la imagen nueva + el tag nuevo 'brand' (cat/neon ya existían).
    expect(snap.graph.order).toBe(before.nodes + 2);
    expect(snap.graph.size).toBeGreaterThan(before.edges);
    expect(snap.byId.has('img-new-1')).toBe(true);
    expect(snap.orderedIds.length).toBe(before.ordered + 1);
    expect(snap.orderedIds[0]).toBe('img-new-1'); // created_at más reciente
    expect(snap.tagIndex.get('cat')!.has('img-new-1')).toBe(true);
    expect(snap.styleIndex.get('3D Render')!.has('img-new-1')).toBe(true);
    expect(snap.moodIndex.get('Futuristic')!.has('img-new-1')).toBe(true);
    expect(snap.useCaseIndex.get('Social Media')!.has('img-new-1')).toBe(true);
    expect(snap.colorIndex.get('#7C5CFF')!.has('img-new-1')).toBe(true);
    expect(snap.textIndex.get('img-new-1')!.original.has('neon')).toBe(true);

    // El nuevo tag 'brand' aparece en stats.
    expect(snap.stats.tags.some((t) => t.tag === 'brand' && t.count === 1)).toBe(true);
    // 'cat' sube de 3 (windowsill, cats-dogs, cyberpunk-cat) a 4 con la fila nueva.
    expect(snap.stats.tags.find((t) => t.tag === 'cat')!.count).toBe(4);
  });

  it('updates co-occurrence weights for existing tag pairs', () => {
    const before = snap.coWeights.get('cat')?.get('neon') ?? 0;
    const row: ImageRow = {
      id: 'img-new-2',
      s3_key: 'key/new2.webp',
      s3_url: 'https://sfo3.digitaloceanspaces.com/n8ns3/new2.webp',
      original_prompt: 'cat neon',
      enhanced_prompt: 'cat neon extra',
      tags: ['cat', 'neon'],
      style: null,
      subject: null,
      mood: null,
      color_palette: null,
      use_case: null,
      filename: null,
      created_at: '2026-06-02T10:00:00Z',
    };
    applyDelta(snap, [row]);
    expect(snap.coWeights.get('cat')?.get('neon')).toBe(before + 1);
    // La arista CO_OCCURS_WITH entre los nodos se actualiza con el nuevo peso.
    const weight = snap.graph.getEdgeAttribute('tag:cat', 'tag:neon', 'weight');
    expect(weight).toBe(before + 1);
  });

  it('recomputes orderedIds in the correct order', () => {
    const older: ImageRow = {
      id: 'img-old-1',
      s3_key: 'key/old.webp',
      s3_url: 'https://s3.example.com/old.webp',
      original_prompt: 'old cat',
      enhanced_prompt: 'old cat enhanced',
      tags: ['cat'],
      style: null,
      subject: null,
      mood: null,
      color_palette: null,
      use_case: null,
      filename: null,
      created_at: '2020-01-01T00:00:00Z',
    };
    applyDelta(snap, [older]);
    // Fila vieja: queda al final, no al principio.
    expect(snap.orderedIds[snap.orderedIds.length - 1]).toBe('img-old-1');
  });

  it('skips duplicate ids (append-only semantics)', () => {
    const before = snap.stats.total;
    const dupe = snap.byId.get(sampleRows[0].id)!;
    applyDelta(snap, [dupe]);
    expect(snap.stats.total).toBe(before);
  });

  it('same result as building from an expanded row set', () => {
    const extra: ImageRow = {
      id: 'img-par-1',
      s3_key: 'key/par.webp',
      s3_url: 'https://s3.example.com/par.webp',
      original_prompt: 'parallel universe cat',
      enhanced_prompt: 'parallel universe cat with neon and style',
      tags: ['cat', 'neon', 'parallel'],
      style: '3D Render',
      subject: 'Parallel cat',
      mood: 'Futuristic',
      color_palette: ['#7C5CFF'],
      use_case: 'Banner',
      filename: null,
      created_at: '2026-07-01T10:00:00Z',
    };

    const deltaSnap = buildGraph(snapshotRows(snap));
    applyDelta(deltaSnap, [extra]);

    const fullSnap = buildGraph([...snapshotRows(snap).map((r) => ({ ...r })), extra]);

    expect(deltaSnap.stats).toEqual(fullSnap.stats);
    expect(deltaSnap.orderedIds).toEqual(fullSnap.orderedIds);
    expect(deltaSnap.topByDegree).toEqual(fullSnap.topByDegree);
    expect([...deltaSnap.coWeights.entries()]).toEqual([...fullSnap.coWeights.entries()]);
    expect(deltaSnap.graph.order).toBe(fullSnap.graph.order);
    expect(deltaSnap.graph.size).toBe(fullSnap.graph.size);
  });
});

function snapshotRows(s: GraphSnapshot): ImageRow[] {
  return [...s.byId.values()];
}