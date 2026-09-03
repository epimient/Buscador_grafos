import { describe, it, expect } from 'vitest';
import { readImageMetadata, checkExiftool } from '../src/metadata';
import sharp from 'sharp';

describe('checkExiftool', () => {
  it('returns a boolean', async () => {
    const result = await checkExiftool();
    expect(typeof result).toBe('boolean');
  });
});

describe('readImageMetadata', () => {
  it('returns fallback for plain webp without metadata', async () => {
    const hasExiftool = await checkExiftool();

    const buf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#FF0000' },
    }).webp().toBuffer();

    const result = await readImageMetadata(buf, 'webp');
    if (!hasExiftool) {
      expect(result.hasVoraelMeta).toBe(false);
      expect(result.tags).toEqual([]);
      expect(result.id).toBeNull();
    } else {
      expect(result.hasVoraelMeta).toBe(false);
      expect(result.artist).toBeNull();
    }
  });

  it('reads vorael namespace metadata after embed roundtrip', async () => {
    const hasExiftool = await checkExiftool();
    if (!hasExiftool) return;

    const { embedMetadata } = await import('../src/metadata');

    const original = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#00FF00' },
    }).webp().toBuffer();

    const { buffer: embeddedBuf, embedded } = await embedMetadata({
      buffer: original,
      ext: 'webp',
      description: 'A test image',
      subject: 'Test subject',
      tags: ['cat', 'test'],
      id: 'test-001',
      style: 'Photorealistic',
      mood: 'Calm',
      useCase: 'Wallpaper',
      colorPalette: ['#FF0000', '#00FF00'],
      fileName: 'test.webp',
      createdAt: '2026-01-01T00:00:00Z',
    });

    expect(embedded).toBe(true);

    const meta = await readImageMetadata(embeddedBuf, 'webp');
    expect(meta.hasVoraelMeta).toBe(true);
    expect(meta.id).toBe('test-001');
    expect(meta.description).toBe('A test image');
    expect(meta.subject).toBe('Test subject');
    expect(meta.tags).toContain('cat');
    expect(meta.tags).toContain('test');
    expect(meta.style).toBe('Photorealistic');
    expect(meta.mood).toBe('Calm');
    expect(meta.useCase).toBe('Wallpaper');
    expect(meta.colorPalette).toEqual(['#FF0000', '#00FF00']);
    expect(meta.fileName).toBe('test.webp');
    expect(meta.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(meta.artist).toBe('Corporación Universitaria Americana - VORAEL');
  });

  it('reads standard XMP fields (subject, description, artist)', async () => {
    const hasExiftool = await checkExiftool();
    if (!hasExiftool) return;

    const { embedMetadata } = await import('../src/metadata');

    const original = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#0000FF' },
    }).png().toBuffer();

    const { buffer: embeddedBuf } = await embedMetadata({
      buffer: original,
      ext: 'png',
      description: 'PNG description',
      subject: 'PNG subject',
      tags: ['blue'],
    });

    const meta = await readImageMetadata(embeddedBuf, 'png');
    expect(meta.description).toBe('PNG description');
    expect(meta.subject).toBe('PNG subject');
    expect(meta.tags).toContain('blue');
    expect(meta.artist).toBe('Corporación Universitaria Americana - VORAEL');
  });
});
