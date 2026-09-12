import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { embedMetadata } from '../src/metadata';
import { execFile } from 'child_process';
import { promisify } from 'util';

// Mock execFile to avoid calling real exiftool.
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
  };
});

const mockExecFile = vi.mocked(execFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('embedMetadata', () => {
  it('calls exiftool with correct args when all fields present', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await embedMetadata({
      buffer: Buffer.from('original'),
      description: 'A fluffy cat',
      subject: 'Cat',
      tags: ['cat', 'animal'],
      ext: 'jpg',
    });

    expect(result.embedded).toBe(true);
    expect(mockExecFile).toHaveBeenCalledOnce();
    const [cmd, args] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('exiftool');
    expect(args).toContain('-overwrite_original');
    expect(args).toContain('-EXIF:ImageDescription=A fluffy cat');
    expect(args).toContain('-EXIF:Artist=Corporación Universitaria Americana - VORAEL');
    expect(args).toContain('-XMP:Subject+=cat');
    expect(args).toContain('-XMP:Subject+=animal');
    expect(args).toContain('-XMP:Title=Cat');
    expect(args).toContain('-XMP:Description=Cat');
  });

  it('skips description/subject/tags when null', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await embedMetadata({
      buffer: Buffer.from('original'),
      description: null,
      subject: null,
      tags: null,
      ext: 'png',
    });

    expect(result.embedded).toBe(true);
    const args = mockExecFile.mock.calls[0][1];
    expect(args).not.toContain(expect.stringContaining('ImageDescription'));
    expect(args).not.toContain(expect.stringContaining('Keywords'));
    expect(args).not.toContain(expect.stringContaining('Subject'));
    expect(args).not.toContain(expect.stringContaining('Title'));
    // Artist is always set.
    expect(args).toContain('-EXIF:Artist=Corporación Universitaria Americana - VORAEL');
  });

  it('returns original buffer when exiftool fails', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(new Error('exiftool not found'), { stdout: '', stderr: '' });
    });

    const original = Buffer.from('original');
    const result = await embedMetadata({
      buffer: original,
      description: 'test',
      subject: 'test',
      tags: ['a'],
      ext: 'jpg',
    });

    expect(result.embedded).toBe(false);
    expect(result.buffer).toBe(original);
  });

  it('returns original buffer when exiftool is missing (ENOENT)', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(err, { stdout: '', stderr: '' });
    });

    const original = Buffer.from('original');
    const result = await embedMetadata({
      buffer: original,
      description: 'test',
      subject: null,
      tags: null,
      ext: 'webp',
    });

    expect(result.embedded).toBe(false);
    expect(result.buffer).toBe(original);
  });
});
