import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  corpusOwnerPath,
  readCorpusOwner,
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
          expect(await readCorpusOwner(corpus.path)).toBe(process.pid);
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
          expect(await readCorpusOwner(outer.path)).toBe(process.pid);
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
      expect(await readCorpusOwner(livePath)).toBe(999_002);
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
