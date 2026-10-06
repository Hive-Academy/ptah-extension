import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
const corpusConfigSchema = z.object({
  repository: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]+$/i),
  eligibleExtensions: z.array(z.string().startsWith('.')).min(1),
});
export type CorpusConfig = z.infer<typeof corpusConfigSchema>;
export interface CheckedOutCorpus {
  path: string;
  config: CorpusConfig;
  eligibleFiles: number;
}
export async function readCorpusConfig(
  configPath: string,
): Promise<CorpusConfig> {
  return corpusConfigSchema.parse(
    JSON.parse(await readFile(configPath, 'utf8')) as unknown,
  );
}
export async function withPinnedCorpus<T>(
  configPath: string,
  useCorpus: (corpus: CheckedOutCorpus) => Promise<T>,
): Promise<T> {
  const config = await readCorpusConfig(configPath);
  const repository = resolve(resolve(configPath, '..'), config.repository);
  await removeStaleCorpusWorktrees(repository);
  await runGit(repository, ['worktree', 'prune']);
  const path = await mkdtemp(join(tmpdir(), 'ptah-mcp-bench-corpus-'));
  let worktreeAdded = false;
  let value: T | undefined;
  let primaryError: unknown;
  let cleanupErrors: unknown[] = [];
  try {
    try {
      await runGit(repository, [
        'worktree',
        'add',
        '--detach',
        path,
        config.commit,
      ]);
      worktreeAdded = true;
      value = await useCorpus({
        path,
        config,
        eligibleFiles: await countEligibleFiles(
          path,
          config.eligibleExtensions,
        ),
      });
    } catch (error: unknown) {
      primaryError = error;
    }
  } finally {
    cleanupErrors = await cleanupCorpusPath(repository, path, worktreeAdded);
  }
  if (primaryError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new Error(
        `${errorMessage(primaryError)}\nCleanup failed: ${cleanupErrors.map(errorMessage).join('; ')}`,
      );
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new Error(
      `Corpus cleanup failed: ${cleanupErrors.map(errorMessage).join('; ')}`,
    );
  }
  return value as T;
}
export async function withLifecycleCorpus<T>(
  corpus: CheckedOutCorpus,
  useCorpus: (corpus: CheckedOutCorpus) => Promise<T>,
): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), 'ptah-mcp-bench-lifecycle-'));
  try {
    await cp(corpus.path, path, {
      recursive: true,
      filter: (source) => basename(source) !== '.git',
    });
    return await useCorpus({
      ...corpus,
      path,
      eligibleFiles: await countEligibleFiles(
        path,
        corpus.config.eligibleExtensions,
      ),
    });
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
export async function countEligibleFiles(
  root: string,
  extensions: readonly string[],
): Promise<number> {
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(root, entry.name);
    if (entry.isDirectory())
      count += await countEligibleFiles(path, extensions);
    else if (
      entry.isFile() &&
      extensions.some((extension) => entry.name.endsWith(extension))
    )
      count += 1;
  }
  return count;
}
async function removeStaleCorpusWorktrees(repository: string): Promise<void> {
  const worktrees = parseWorktreePaths(
    await runGit(repository, ['worktree', 'list', '--porcelain']),
  );
  for (const path of worktrees) {
    if (!isTemporaryCorpusWorktree(path)) continue;
    const cleanupErrors = await cleanupCorpusPath(repository, path, true);
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Stale corpus cleanup failed: ${cleanupErrors.map(errorMessage).join('; ')}`,
      );
    }
  }
}

async function cleanupCorpusPath(
  repository: string,
  path: string,
  isRegisteredWorktree: boolean,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (isRegisteredWorktree) {
    try {
      await runGit(repository, ['worktree', 'remove', '--force', path]);
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error: unknown) {
    errors.push(error);
  }
  return errors;
}

function parseWorktreePaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

function isTemporaryCorpusWorktree(path: string): boolean {
  if (!basename(path).startsWith('ptah-mcp-bench-corpus-')) return false;
  const tempRoot = resolve(tmpdir());
  const relativePath = relative(tempRoot, resolve(path));
  return (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runGit(
  cwd: string,
  args: readonly string[],
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', [...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise(stdout);
      else
        reject(
          new Error(
            `git ${args.join(' ')} failed (${code ?? 'terminated'}): ${stderr.trim()}`,
          ),
        );
    });
  });
}
