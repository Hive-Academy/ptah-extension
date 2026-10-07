import { spawn } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ORPHAN_GRACE_MS,
  OWNER_MAX_AGE_MS,
  corpusOwnerPath,
  isOwnerLive,
  readCorpusOwner,
  type OwnerProbe,
  withLifecycleCorpus,
  withPinnedCorpus,
} from './corpus';

// Each case runs several real git processes (init, commit, worktree add and
// remove); on Windows that is about 10 s per case, over Jest's 5 s default.
jest.setTimeout(60_000);

// A private temp root per case: a real bench run (this task's or
// TASK_2026_620's) creates `ptah-mcp-bench-corpus-*` in the shared tmpdir at
// any time, and must neither disturb these cases nor be disturbed by them.
let tempRoot = '';
beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'mcp-bench-corpus-spec-'));
});
afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('corpus checkout', () => {
  it('uses a detached pinned worktree and removes it after a disposable lifecycle copy', async () => {
    const repository = await createRepository();
    const configPath = await writeConfig(repository);
    try {
      await writeFile(join(repository, 'skip.txt'), 'not eligible\n', 'utf8');
      let pinnedPath = '';
      await withPinnedCorpus(
        configPath,
        async (corpus) => {
          pinnedPath = corpus.path;
          expect(corpus.eligibleFiles).toBe(1);
          expect((await readCorpusOwner(corpus.path))?.pid).toBe(process.pid);
          await withLifecycleCorpus(corpus, async (lifecycle) => {
            await writeFile(
              join(lifecycle.path, 'keep.ts'),
              'export const pinned = false;\n',
              'utf8',
            );
            expect(
              await readFile(join(lifecycle.path, 'keep.ts'), 'utf8'),
            ).toContain('false');
            expect(lifecycle.eligibleFiles).toBe(1);
          });
          expect(
            await readFile(join(corpus.path, 'keep.ts'), 'utf8'),
          ).toContain('true');
        },
        { tempRoot },
      );
      await expect(
        readFile(join(pinnedPath, 'keep.ts'), 'utf8'),
      ).rejects.toThrow();
      expect(await readCorpusOwner(pinnedPath)).toBeNull();
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('preserves a git add error and deletes an unregistered temporary directory', async () => {
    const repository = await createRepository();
    const configPath = join(repository, 'corpus.config.json');
    const before = await corpusTemporaryEntries(tempRoot);
    try {
      await writeFile(
        configPath,
        JSON.stringify({
          repository: '.',
          commit: 'deadbeef',
          eligibleExtensions: ['.ts'],
        }),
        'utf8',
      );
      await expect(
        withPinnedCorpus(configPath, async () => undefined, { tempRoot }),
      ).rejects.toThrow('git worktree add');
      expect(await corpusTemporaryEntries(tempRoot)).toEqual(before);
      expect(
        await git(repository, ['worktree', 'list', '--porcelain']),
      ).not.toContain('ptah-mcp-bench-corpus-');
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('removes only registered stale corpus worktrees at startup', async () => {
    const repository = await createRepository();
    const configPath = await writeConfig(repository);
    const commit = await git(repository, ['rev-parse', 'HEAD']);
    const stalePath = await mkdtemp(join(tempRoot, 'ptah-mcp-bench-corpus-'));
    const unrelatedPath = await mkdtemp(join(tempRoot, 'mcp-bench-unrelated-'));
    try {
      await git(repository, ['worktree', 'add', '--detach', stalePath, commit]);
      await git(repository, [
        'worktree',
        'add',
        '--detach',
        unrelatedPath,
        commit,
      ]);
      await withPinnedCorpus(
        configPath,
        async () => {
          const worktrees = await git(repository, [
            'worktree',
            'list',
            '--porcelain',
          ]);
          expect(worktrees).not.toContain(forwardSlashes(stalePath));
          expect(worktrees).toContain(forwardSlashes(unrelatedPath));
        },
        { tempRoot },
      );
      await expect(
        readFile(join(stalePath, 'keep.ts'), 'utf8'),
      ).rejects.toThrow();
      expect(await readFile(join(unrelatedPath, 'keep.ts'), 'utf8')).toContain(
        'true',
      );
    } finally {
      await git(repository, ['worktree', 'remove', '--force', unrelatedPath]);
      await rm(repository, { recursive: true, force: true });
    }
  });
});

describe('corpus owner liveness', () => {
  it('leaves a live overlapping checkout alone and removes it only at its own end', async () => {
    const repository = await createRepository();
    const configPath = await writeConfig(repository);
    try {
      await withPinnedCorpus(
        configPath,
        async (outer) => {
          // A second run that starts while the first is live (same pid, so
          // its owner is alive): it must not remove the first corpus.
          await withPinnedCorpus(
            configPath,
            async (inner) => {
              expect(inner.path).not.toBe(outer.path);
              expect(
                await git(repository, ['worktree', 'list', '--porcelain']),
              ).toContain(forwardSlashes(outer.path));
            },
            { tempRoot },
          );
          expect(await readFile(join(outer.path, 'keep.ts'), 'utf8')).toContain(
            'true',
          );
          expect((await readCorpusOwner(outer.path))?.pid).toBe(process.pid);
        },
        { tempRoot },
      );
      expect(await corpusTemporaryEntries(tempRoot)).toEqual([]);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('removes a registered corpus worktree whose owner is dead and keeps a live one', async () => {
    const repository = await createRepository();
    const configPath = await writeConfig(repository);
    const commit = await git(repository, ['rev-parse', 'HEAD']);
    const deadPath = await mkdtemp(join(tempRoot, 'ptah-mcp-bench-corpus-'));
    const livePath = await mkdtemp(join(tempRoot, 'ptah-mcp-bench-corpus-'));
    try {
      for (const [path, pid] of [
        [deadPath, 999_001],
        [livePath, 999_002],
      ] as const) {
        await writeFile(corpusOwnerPath(path), JSON.stringify({ pid }), 'utf8');
        await git(repository, ['worktree', 'add', '--detach', path, commit]);
      }
      await withPinnedCorpus(configPath, async () => undefined, {
        tempRoot,
        isProcessAlive: (pid) => pid === 999_002 || pid === process.pid,
      });
      const worktrees = await git(repository, [
        'worktree',
        'list',
        '--porcelain',
      ]);
      expect(worktrees).not.toContain(forwardSlashes(deadPath));
      expect(worktrees).toContain(forwardSlashes(livePath));
      expect(await readCorpusOwner(deadPath)).toBeNull();
      expect((await readCorpusOwner(livePath))?.pid).toBe(999_002);
    } finally {
      await git(repository, ['worktree', 'remove', '--force', livePath]);
      await rm(repository, { recursive: true, force: true });
    }
  });
});

function forwardSlashes(path: string): string {
  return path.replaceAll('\\', '/');
}

async function writeConfig(repository: string): Promise<string> {
  const configPath = join(repository, 'corpus.config.json');
  await writeFile(
    configPath,
    JSON.stringify({
      repository: '.',
      commit: await git(repository, ['rev-parse', 'HEAD']),
      eligibleExtensions: ['.ts'],
    }),
    'utf8',
  );
  return configPath;
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tempRoot, 'mcp-bench-corpus-repo-'));
  await git(repository, ['init']);
  await git(repository, ['config', 'user.email', 'bench@example.test']);
  await git(repository, ['config', 'user.name', 'MCP Bench']);
  await writeFile(
    join(repository, 'keep.ts'),
    'export const pinned = true;\n',
    'utf8',
  );
  await git(repository, ['add', 'keep.ts']);
  await git(repository, ['commit', '-m', 'pin']);
  return repository;
}

/** Corpus worktree directories and owner files under `root`. */
async function corpusTemporaryEntries(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith('ptah-mcp-bench-corpus-'))
    .map((entry) => join(root, entry.name))
    .sort();
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)),
    );
  });
}

describe('corpus sweep (Phase 1 review M6, M7)', () => {
  it('recognises a stale worktree registered under the real path when tempRoot is a link to it (8.3 / link form)', async () => {
    const repository = await createRepository();
    const configPath = await writeConfig(repository);
    const commit = await git(repository, ['rev-parse', 'HEAD']);
    const realRoot = join(tempRoot, 'real-temp');
    const linkRoot = join(tempRoot, 'link-temp');
    await mkdir(realRoot);
    try {
      symlinkSync(
        realRoot,
        linkRoot,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      return; // the OS refused to create the link; nothing to check
    }
    const stalePath = await mkdtemp(join(realRoot, 'ptah-mcp-bench-corpus-'));
    try {
      await git(repository, ['worktree', 'add', '--detach', stalePath, commit]);
      await withPinnedCorpus(configPath, async () => undefined, {
        tempRoot: linkRoot,
      });
      expect(
        await git(repository, ['worktree', 'list', '--porcelain']),
      ).not.toContain(forwardSlashes(stalePath));
      expect(existsSync(stalePath)).toBe(false);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('sweeps unregistered corpus folders and owner files whose owner is dead, and keeps live or fresh ones', async () => {
    const repository = await createRepository();
    const configPath = await writeConfig(repository);
    const deadFolder = await mkdtemp(join(tempRoot, 'ptah-mcp-bench-corpus-'));
    const liveFolder = await mkdtemp(join(tempRoot, 'ptah-mcp-bench-corpus-'));
    const freshFolder = await mkdtemp(join(tempRoot, 'ptah-mcp-bench-corpus-'));
    const lonelyOwner = corpusOwnerPath(
      join(tempRoot, 'ptah-mcp-bench-corpus-gone'),
    );
    await writeFile(
      corpusOwnerPath(deadFolder),
      JSON.stringify({ pid: 999_011 }),
      'utf8',
    );
    await writeFile(
      corpusOwnerPath(liveFolder),
      JSON.stringify({ pid: 999_012 }),
      'utf8',
    );
    await writeFile(lonelyOwner, JSON.stringify({ pid: 999_013 }), 'utf8');
    try {
      await withPinnedCorpus(configPath, async () => undefined, {
        tempRoot,
        isProcessAlive: (pid) => pid === 999_012 || pid === process.pid,
      });
      expect(existsSync(deadFolder)).toBe(false);
      expect(existsSync(corpusOwnerPath(deadFolder))).toBe(false);
      expect(existsSync(lonelyOwner)).toBe(false);
      expect(existsSync(liveFolder)).toBe(true);
      // No owner file, younger than the grace period: a run may be about to write it.
      expect(existsSync(freshFolder)).toBe(true);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('sweeps an unregistered folder with no owner file once it is older than the grace period', async () => {
    const repository = await createRepository();
    const configPath = await writeConfig(repository);
    const oldFolder = await mkdtemp(join(tempRoot, 'ptah-mcp-bench-corpus-'));
    try {
      await withPinnedCorpus(configPath, async () => undefined, {
        tempRoot,
        probe: { now: () => Date.now() + ORPHAN_GRACE_MS + 60_000 },
      });
      expect(existsSync(oldFolder)).toBe(false);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });
});

describe('isOwnerLive', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const started = '2026-10-07T11:00:00.000Z';
  const probe = (overrides: Partial<OwnerProbe> = {}): OwnerProbe => ({
    isProcessAlive: () => true,
    processStartedAt: async () => Date.parse(started),
    hostname: 'bench-host',
    now: () => now,
    ...overrides,
  });
  const owner = {
    pid: 4242,
    hostname: 'bench-host',
    processStartedAt: started,
    createdAt: '2026-10-07T11:00:05.000Z',
  };

  it('is live when the pid runs with the recorded start time', async () => {
    expect(await isOwnerLive(owner, probe())).toBe(true);
  });

  it('is stale when the pid was reused by a process with another start time', async () => {
    expect(
      await isOwnerLive(
        owner,
        probe({ processStartedAt: async () => now - 60_000 }),
      ),
    ).toBe(false);
  });

  it('is stale when the pid no longer runs', async () => {
    expect(
      await isOwnerLive(owner, probe({ isProcessAlive: () => false })),
    ).toBe(false);
  });

  it('keeps a verified-live owner past the age limit (a long run is not stale)', async () => {
    expect(
      await isOwnerLive(owner, probe({ now: () => now + OWNER_MAX_AGE_MS })),
    ).toBe(true);
  });

  it('is stale past the age limit when its liveness cannot be verified', async () => {
    const late = { now: () => now + OWNER_MAX_AGE_MS };
    expect(
      await isOwnerLive(
        owner,
        probe({ ...late, processStartedAt: async () => null }),
      ),
    ).toBe(false);
    expect(
      await isOwnerLive({ ...owner, hostname: 'other-host' }, probe(late)),
    ).toBe(false);
  });

  it('trusts another host only until the age limit, and an unreadable start time while the pid runs', async () => {
    expect(
      await isOwnerLive(
        { ...owner, hostname: 'other-host' },
        probe({ isProcessAlive: () => false }),
      ),
    ).toBe(true);
    expect(
      await isOwnerLive(owner, probe({ processStartedAt: async () => null })),
    ).toBe(true);
  });
});
