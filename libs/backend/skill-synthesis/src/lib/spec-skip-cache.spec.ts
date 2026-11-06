import { join } from 'node:path';

const mockStat = jest.fn();
jest.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
}));

import { SKIP_CACHE_TTL_MS, SpecSkipCache } from './spec-skip-cache';

const FOLDER = join('/specs', 'TASK_2026_001');
const CARRIER = join(FOLDER, 'task.md');

function fsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** Folder answers with `folderMtime`; the carrier answers with `carrier`. */
function filesystem(folderMtime: number, carrier: Error | 'present'): void {
  mockStat.mockImplementation(async (path: string) => {
    if (path === FOLDER) return { mtimeMs: folderMtime, size: 0 };
    if (path === CARRIER) {
      if (carrier === 'present') return { mtimeMs: 1, size: 10 };
      throw carrier;
    }
    throw fsError('ENOENT');
  });
}

function carrierStats(): number {
  return mockStat.mock.calls.filter(([path]) => path === CARRIER).length;
}

describe('SpecSkipCache', () => {
  let clock: number;
  let cache: SpecSkipCache;

  beforeEach(() => {
    mockStat.mockReset();
    clock = 1_000;
    cache = new SpecSkipCache(() => clock);
  });

  it('remembers a definite miss (no carrier) while the folder is unchanged', async () => {
    filesystem(5, fsError('ENOENT'));

    expect(await cache.classify(FOLDER)).toBe('skip');
    expect(await cache.classify(FOLDER)).toBe('skip');

    expect(carrierStats()).toBe(1);
  });

  it('treats ENOTDIR as a definite miss too', async () => {
    filesystem(5, fsError('ENOTDIR'));

    expect(await cache.classify(FOLDER)).toBe('skip');
    expect(await cache.classify(FOLDER)).toBe('skip');
    expect(carrierStats()).toBe(1);
  });

  it.each(['EMFILE', 'EBUSY', 'EACCES', 'EPERM'])(
    'never caches a transient %s carrier failure',
    async (code) => {
      filesystem(5, fsError(code));

      expect(await cache.classify(FOLDER)).toBe('read');
      expect(await cache.classify(FOLDER)).toBe('read');
      expect(carrierStats()).toBe(2);
    },
  );

  it('reads a folder whose carrier exists', async () => {
    filesystem(5, 'present');

    expect(await cache.classify(FOLDER)).toBe('read');
  });

  it('looks again when the folder changes (a carrier appeared)', async () => {
    filesystem(5, fsError('ENOENT'));
    expect(await cache.classify(FOLDER)).toBe('skip');

    filesystem(6, 'present');
    expect(await cache.classify(FOLDER)).toBe('read');
  });

  it('expires a remembered miss after the TTL even with an unchanged folder', async () => {
    filesystem(5, fsError('ENOENT'));
    expect(await cache.classify(FOLDER)).toBe('skip');

    // A dangling carrier symlink whose target was created: the folder
    // signature cannot see it, the TTL bounds it.
    filesystem(5, 'present');
    clock += SKIP_CACHE_TTL_MS - 1;
    expect(await cache.classify(FOLDER)).toBe('skip');
    clock += 1;
    expect(await cache.classify(FOLDER)).toBe('read');
  });

  it('does not cache a miss when the folder itself cannot be stat-ed', async () => {
    mockStat.mockRejectedValue(fsError('ENOENT'));

    expect(await cache.classify(FOLDER)).toBe('skip');
    expect(await cache.classify(FOLDER)).toBe('skip');
    expect(carrierStats()).toBe(2);
  });
});
