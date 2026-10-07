import { spawn } from 'node:child_process';
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
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
/**
 * Suffix of the owner file written beside each corpus worktree
 * (`<tempRoot>/ptah-mcp-bench-corpus-XXXX.ptah-mcp-bench-owner`). It names the
 * process that checked the corpus out, so a concurrent run (another worktree
 * of this repository, or TASK_2026_620's bench) never removes a live corpus.
 * It sits beside the worktree, not inside it, so no corpus reader sees it.
 */
export const CORPUS_OWNER_SUFFIX = '.ptah-mcp-bench-owner';

export interface PinnedCorpusOptions {
  /** Where corpus worktrees are created and looked for. Default `os.tmpdir()`. */
  readonly tempRoot?: string;
  /** Whether a pid names a running process. Default: `process.kill(pid, 0)`. */
  readonly isProcessAlive?: (pid: number) => boolean;
}

/** `process.kill(pid, 0)`: no signal is sent; EPERM still means the pid exists. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function corpusOwnerPath(worktreePath: string): string {
  return `${resolve(worktreePath)}${CORPUS_OWNER_SUFFIX}`;
}

/** The owner pid of a corpus worktree, or `null` when no readable owner file exists. */
export async function readCorpusOwner(
  worktreePath: string,
): Promise<number | null> {
  let raw: string;
  try {
    raw = await readFile(corpusOwnerPath(worktreePath), 'utf8');
  } catch {
    return null;
  }
  const parsed = z
    .object({ pid: z.number().int().positive() })
    .safeParse(safeJson(raw));
  return parsed.success ? parsed.data.pid : null;
}

export async function withPinnedCorpus<T>(
  configPath: string,
  useCorpus: (corpus: CheckedOutCorpus) => Promise<T>,
  options: PinnedCorpusOptions = {},
): Promise<T> {
  const config = await readCorpusConfig(configPath);
  const repository = resolve(resolve(configPath, '..'), config.repository);
  const tempRoot = options.tempRoot ?? tmpdir();
  await removeStaleCorpusWorktrees(
    repository,
    tempRoot,
    options.isProcessAlive ?? isProcessAlive,
  );
  await runGit(repository, ['worktree', 'prune']);
  const path = await mkdtemp(join(tempRoot, 'ptah-mcp-bench-corpus-'));
  let worktreeAdded = false;
  let value: T | undefined;
  let primaryError: unknown;
  let cleanupErrors: unknown[];
  try {
    try {
      // Written before the worktree is registered: a concurrent cleaner lists
      // registered worktrees only, so it never sees this one without an owner.
      await writeFile(
        corpusOwnerPath(path),
        `${JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() })}\n`,
        'utf8',
      );
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
/**
 * Remove the registered corpus worktrees under `tempRoot` whose owner is gone
 * (a crashed run). A worktree whose owner process is alive belongs to a
 * concurrent run and is left alone; one with no readable owner file predates
 * the owner file or lost it, and is removed as before.
 */
async function removeStaleCorpusWorktrees(
  repository: string,
  tempRoot: string,
  alive: (pid: number) => boolean,
): Promise<void> {
  const worktrees = parseWorktreePaths(
    await runGit(repository, ['worktree', 'list', '--porcelain']),
  );
  for (const path of worktrees) {
    if (!isTemporaryCorpusWorktree(path, tempRoot)) continue;
    const owner = await readCorpusOwner(path);
    if (owner !== null && alive(owner)) continue;
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
  for (const target of [path, corpusOwnerPath(path)]) {
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  return errors;
}

function parseWorktreePaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

function isTemporaryCorpusWorktree(path: string, tempRoot: string): boolean {
  if (!basename(path).startsWith('ptah-mcp-bench-corpus-')) return false;
  const fold = (value: string): string =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  const relativePath = relative(fold(resolve(tempRoot)), fold(resolve(path)));
  return (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
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
