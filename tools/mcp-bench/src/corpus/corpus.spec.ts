import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLifecycleCorpus, withPinnedCorpus } from './corpus';

// Each case runs several real git processes (init, commit, worktree add and
// remove); on Windows that is about 10 s per case, over Jest's 5 s default.
jest.setTimeout(60_000);

describe('corpus checkout', () => {
  it('uses a detached pinned worktree and removes it after a disposable lifecycle copy', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'mcp-bench-corpus-repo-'));
    const configPath = join(repository, 'corpus.config.json');
    try {
      await git(repository, ['init']);
      await git(repository, ['config', 'user.email', 'bench@example.test']);
      await git(repository, ['config', 'user.name', 'MCP Bench']);
      await writeFile(
        join(repository, 'keep.ts'),
        'export const pinned = true;\n',
        'utf8',
      );
      await writeFile(join(repository, 'skip.txt'), 'not eligible\n', 'utf8');
      await git(repository, ['add', '.']);
      await git(repository, ['commit', '-m', 'pin']);
      const commit = await git(repository, ['rev-parse', 'HEAD']);
      await writeFile(
        configPath,
        JSON.stringify({
          repository: '.',
          commit,
          eligibleExtensions: ['.ts'],
        }),
        'utf8',
      );

      let pinnedPath = '';
      await withPinnedCorpus(configPath, async (corpus) => {
        pinnedPath = corpus.path;
        expect(corpus.eligibleFiles).toBe(1);
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
        expect(await readFile(join(corpus.path, 'keep.ts'), 'utf8')).toContain(
          'true',
        );
      });
      await expect(
        readFile(join(pinnedPath, 'keep.ts'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('preserves a git add error and deletes an unregistered temporary directory', async () => {
    const repository = await createRepository();
    const configPath = join(repository, 'corpus.config.json');
    const before = await corpusTemporaryDirectories();
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
        withPinnedCorpus(configPath, async () => undefined),
      ).rejects.toThrow('git worktree add');
      expect(await corpusTemporaryDirectories()).toEqual(before);
      expect(
        await git(repository, ['worktree', 'list', '--porcelain']),
      ).not.toContain('ptah-mcp-bench-corpus-');
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('removes only registered stale corpus worktrees at startup', async () => {
    const repository = await createRepository();
    const configPath = join(repository, 'corpus.config.json');
    const commit = await git(repository, ['rev-parse', 'HEAD']);
    const stalePath = await mkdtemp(join(tmpdir(), 'ptah-mcp-bench-corpus-'));
    const unrelatedPath = await mkdtemp(join(tmpdir(), 'mcp-bench-unrelated-'));
    try {
      await git(repository, ['worktree', 'add', '--detach', stalePath, commit]);
      await git(repository, [
        'worktree',
        'add',
        '--detach',
        unrelatedPath,
        commit,
      ]);
      await writeFile(
        configPath,
        JSON.stringify({
          repository: '.',
          commit,
          eligibleExtensions: ['.ts'],
        }),
        'utf8',
      );
      await withPinnedCorpus(configPath, async () => {
        const worktrees = await git(repository, [
          'worktree',
          'list',
          '--porcelain',
        ]);
        expect(worktrees).not.toContain(stalePath);
        expect(worktrees).toContain(unrelatedPath.replaceAll('\\', '/'));
      });
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

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), 'mcp-bench-corpus-repo-'));
  await git(repository, ['init']);
  await git(repository, ['config', 'user.email', 'bench@example.test']);
  await git(repository, ['config', 'user.name', 'MCP Bench']);
  await writeFile(
    join(repository, 'keep.ts'),
    'export const pinned = true;\n',
    'utf8',
  );
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-m', 'pin']);
  return repository;
}

async function corpusTemporaryDirectories(): Promise<string[]> {
  return (await readdir(tmpdir(), { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('ptah-mcp-bench-corpus-'),
    )
    .map((entry) => join(tmpdir(), entry.name))
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
