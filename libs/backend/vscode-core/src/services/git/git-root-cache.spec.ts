import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitRootCache } from './git-root-cache';

async function makeRepoDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ptah-root-cache-'));
  await mkdir(join(root, '.git'));
  return root;
}

describe(GitRootCache.name, () => {
  let root: string;

  beforeEach(async () => {
    root = await makeRepoDir();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('joins concurrent probes, reuses success, and invalidates a deleted path', async () => {
    const cache = new GitRootCache();
    const probe = jest.fn().mockResolvedValue(root);
    const [first, second] = await Promise.all([
      cache.resolve(root, probe), cache.resolve(root, probe),
    ]);
    expect(first).toBe(root);
    expect(second).toBe(root);
    expect(await cache.resolve(root, probe)).toBe(root);
    expect(probe).toHaveBeenCalledTimes(1);
    await rm(root, { recursive: true, force: true });
    expect(await cache.resolve(root, probe)).toBeNull();
    expect(await cache.resolve(root, probe)).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);
    await mkdir(join(root, '.git'), { recursive: true });
    expect(await cache.resolve(root, probe)).toBe(root);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('probes again when the cached root no longer holds a .git entry', async () => {
    const cache = new GitRootCache();
    const probe = jest.fn().mockResolvedValue(root);
    expect(await cache.resolve(root, probe)).toBe(root);
    await rm(join(root, '.git'), { recursive: true, force: true });
    probe.mockResolvedValue(null);
    expect(await cache.resolve(root, probe)).toBeNull();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('serves a fresh answer after invalidation while the directory stays present', async () => {
    const cache = new GitRootCache();
    const nested = join(root, 'packages', 'app');
    await mkdir(join(nested, '.git'), { recursive: true });
    const probe = jest.fn().mockResolvedValue(root);
    expect(await cache.resolve(nested, probe)).toBe(root);
    probe.mockResolvedValue(nested);
    expect(await cache.resolve(nested, probe)).toBe(root);
    cache.invalidate(root);
    expect(await cache.resolve(nested, probe)).toBe(nested);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('does not store or share a probe answer that an invalidation overtook', async () => {
    const cache = new GitRootCache();
    let finishOld: (value: string | null) => void = () => undefined;
    const oldProbe = jest.fn(
      () => new Promise<string | null>((resolve) => { finishOld = resolve; }),
    );
    const oldAnswer = cache.resolve(root, oldProbe);
    while (oldProbe.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    cache.invalidate(root);
    const freshProbe = jest.fn().mockResolvedValue(root);
    const freshAnswer = cache.resolve(root, freshProbe);
    finishOld('/stale/root');
    expect(await oldAnswer).toBe('/stale/root');
    expect(await freshAnswer).toBe(root);
    expect(freshProbe).toHaveBeenCalledTimes(1);
    expect(await cache.resolve(root, freshProbe)).toBe(root);
    expect(freshProbe).toHaveBeenCalledTimes(1);
  });

  it('keeps answers for paths outside the invalidated root', async () => {
    const other = await makeRepoDir();
    try {
      const cache = new GitRootCache();
      const probe = jest.fn((target: string) => Promise.resolve(target));
      await cache.resolve(root, () => probe(root));
      await cache.resolve(other, () => probe(other));
      cache.invalidate(root);
      await cache.resolve(other, () => probe(other));
      expect(probe).toHaveBeenCalledTimes(2);
      await cache.resolve(root, () => probe(root));
      expect(probe).toHaveBeenCalledTimes(3);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});
