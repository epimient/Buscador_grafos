import { describe, it, expect } from 'vitest';
import { generateDataset } from '../src/seed/engine';

describe('generateDataset', () => {
  it('generates the requested number of rows', () => {
    expect(generateDataset(1000)).toHaveLength(1000);
  });

  it('is deterministic for a fixed seed', () => {
    const a = generateDataset(100, { seed: 42 });
    const b = generateDataset(100, { seed: 42 });
    expect(a).toEqual(b);
  });

  it('varies with the seed', () => {
    const a = generateDataset(50, { seed: 1 });
    const b = generateDataset(50, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('uses unique sequential gen-* ids', () => {
    const rows = generateDataset(250);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(250);
    expect(ids[0]).toBe('gen-0001');
    expect(ids[249]).toBe('gen-0250');
  });

  it('fills every metadata field with non-empty values', () => {
    for (const row of generateDataset(500)) {
      expect(row.subject).toBeTruthy();
      expect(row.style).toBeTruthy();
      expect(row.mood).toBeTruthy();
      expect(row.use_case).toBeTruthy();
      expect(row.original_prompt).toBeTruthy();
      expect(row.enhanced_prompt).toBeTruthy();
      expect(Array.isArray(row.tags)).toBe(true);
      expect(row.tags!.length).toBeGreaterThanOrEqual(3);
      expect(row.tags!.length).toBeLessThanOrEqual(8);
      expect(Array.isArray(row.color_palette)).toBe(true);
      expect(row.color_palette!.length).toBeGreaterThanOrEqual(2);
      expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
    }
  });

  it('respects a provided asset pool cyclically', () => {
    const assets = [
      { s3_key: 'test-images-real/a.webp', s3_url: 'http://localhost:3001/test-images-real/a.webp' },
      { s3_key: 'test-images-real/b.webp', s3_url: 'http://localhost:3001/test-images-real/b.webp' },
    ];
    const rows = generateDataset(5, { assets });
    expect(rows[0].s3_key).toBe('test-images-real/a.webp');
    expect(rows[1].s3_key).toBe('test-images-real/b.webp');
    expect(rows[2].s3_key).toBe('test-images-real/a.webp');
  });

  it('keeps searchable vocabulary coherent (subject tokens appear in prompts or tags)', () => {
    const rows = generateDataset(80);
    for (const row of rows) {
      const subjectTokens = row.subject!.toLowerCase().split(/\s+/);
      const searchable = `${row.original_prompt} ${row.enhanced_prompt} ${row.tags!.join(' ')}`.toLowerCase();
      for (const t of subjectTokens) {
        expect(searchable).toContain(t);
      }
    }
  });
});