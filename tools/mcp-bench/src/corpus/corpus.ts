import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { removeTempDir } from '../transport/temp-cleanup';
const corpusConfigSchema = z.object({
  repository: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]+$/i),
  eligibleExtensions: z.array(z.string().startsWith('.')).min(1),
});
export type CorpusConfig = z.infer<typeof corpusConfigSchema>;
export interface CheckedOutCorpus {
  path: string;
  config: CorpusConfig;
  /**
   * A RAW source-file count: every `eligibleExtensions` file outside `.git` and
   * `node_modules`, with no gitignore rule and none of the indexer's skip rules.
   * It is not the product's "eligible files" (the indexer's census, 3,860 in
   * the research); quote the indexer census from a run's coverage block next
   * to it. The scorecard field keeps its name for schema stability.
   */
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

/** The process start time of `pid` (epoch ms), or `null` when it cannot be read. */
export type ProcessStartProbe = (pid: number) => Promise<number | null>;

/** How the sweep decides that a corpus owner is still running. */
export interface OwnerProbe {
  /** Whether a pid names a running process. Default: `process.kill(pid, 0)`. */
  readonly isProcessAlive: (pid: number) => boolean;
  /** Start time of a running pid, to tell a reused pid apart. Default: the OS process table. */
  readonly processStartedAt: ProcessStartProbe;
  /** This machine's hostname; another host's pid cannot be probed. */
  readonly hostname: string;
  readonly now: () => number;
}

export interface PinnedCorpusOptions {
  /** Where corpus worktrees are created and looked for. Default `os.tmpdir()`. */
  readonly tempRoot?: string;
  /** Whether a pid names a running process. Default: `process.kill(pid, 0)`. */
  readonly isProcessAlive?: (pid: number) => boolean;
  /** Overrides for the owner liveness probe (specs). */
  readonly probe?: Partial<OwnerProbe>;
}

/**
 * A run never holds its corpus longer than this (the full bench takes a few
 * hours). An older owner is stale even when its pid is in use: the pid was
 * reused, or the run hung.
 */
export const OWNER_MAX_AGE_MS = 12 * 3_600_000;
/** An unregistered corpus folder with no owner file is left this long (a run between `mkdtemp` and its owner write). */
export const ORPHAN_GRACE_MS = 10 * 60_000;
/** Recorded and observed process start times may differ by clock rounding. */
const START_TIME_TOLERANCE_MS = 5_000;
const CORPUS_PREFIX = 'ptah-mcp-bench-corpus-';

/** `process.kill(pid, 0)`: no signal is sent; EPERM still means the pid exists. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** This process's start time (epoch ms). */
function ownStartTime(): number {
  return Date.now() - process.uptime() * 1000;
}

/**
 * The OS start time of `pid`: `Get-Process` on win32, `ps -o lstart=`
 * elsewhere (10 s timeout). `null` when the process is gone or the probe
 * fails; the caller then relies on the age limit.
 */
export const processStartedAt: ProcessStartProbe = (pid) => {
  if (pid === process.pid) return Promise.resolve(ownStartTime());
  const [command, args] =
    process.platform === 'win32'
      ? [
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${Math.trunc(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
          ],
        ]
      : ['ps', ['-o', 'lstart=', '-p', String(Math.trunc(pid))]];
  return new Promise((done) => {
    execFile(
      command,
      args,
      { timeout: 10_000, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        const parsed = Date.parse(String(stdout).trim());
        done(error || Number.isNaN(parsed) ? null : parsed);
      },
    );
  });
};

const ownerSchema = z.object({
  pid: z.number().int().positive(),
  hostname: z.string().min(1).optional(),
  processStartedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime().optional(),
});
/** What a corpus owner file records. */
export type CorpusOwner = z.infer<typeof ownerSchema>;

/**
 * Whether the run named by `owner` may still use its corpus:
 * - older than {@link OWNER_MAX_AGE_MS}: stale, whatever its pid;
 * - written on another host: live (its pid cannot be probed), until the age limit;
 * - pid not running: stale;
 * - pid running with another start time than recorded: stale (the pid was reused);
 * - otherwise live (also when the start time cannot be read).
 */
export async function isOwnerLive(
  owner: CorpusOwner,
  probe: OwnerProbe,
): Promise<boolean> {
  const created =
    owner.createdAt === undefined ? Number.NaN : Date.parse(owner.createdAt);
  // The age limit is only a fallback for owners whose liveness cannot be
  // verified (another machine, no or unreadable start time); a verified-live
  // owner keeps its checkout however long the run takes.
  const tooOld =
    !Number.isNaN(created) && probe.now() - created > OWNER_MAX_AGE_MS;
  if (owner.hostname !== undefined && owner.hostname !== probe.hostname)
    return !tooOld;
  if (!probe.isProcessAlive(owner.pid)) return false;
  const started =
    owner.processStartedAt === undefined
      ? null
      : await probe.processStartedAt(owner.pid);
  if (started === null || owner.processStartedAt === undefined) return !tooOld;
  return (
    Math.abs(started - Date.parse(owner.processStartedAt)) <=
    START_TIME_TOLERANCE_MS
  );
}

function ownerProbe(options: PinnedCorpusOptions): OwnerProbe {
  return {
    isProcessAlive:
      options.probe?.isProcessAlive ?? options.isProcessAlive ?? isProcessAlive,
    processStartedAt: options.probe?.processStartedAt ?? processStartedAt,
    hostname: options.probe?.hostname ?? hostname(),
    now: options.probe?.now ?? Date.now,
  };
}

export function corpusOwnerPath(worktreePath: string): string {
  return `${resolve(worktreePath)}${CORPUS_OWNER_SUFFIX}`;
}

/** The owner of a corpus worktree, or `null` when no readable owner file exists. */
export async function readCorpusOwner(
  worktreePath: string,
): Promise<CorpusOwner | null> {
  let raw: string;
  try {
    raw = await readFile(corpusOwnerPath(worktreePath), 'utf8');
  } catch {
    return null;
  }
  const parsed = ownerSchema.safeParse(safeJson(raw));
  return parsed.success ? parsed.data : null;
}

export async function withPinnedCorpus<T>(
  configPath: string,
  useCorpus: (corpus: CheckedOutCorpus) => Promise<T>,
  options: PinnedCorpusOptions = {},
): Promise<T> {
  const config = await readCorpusConfig(configPath);
  const repository = resolve(resolve(configPath, '..'), config.repository);
  const tempRoot = options.tempRoot ?? tmpdir();
  const probe = ownerProbe(options);
  await removeStaleCorpusWorktrees(repository, tempRoot, probe);
  await runGit(repository, ['worktree', 'prune']);
  await removeOrphanCorpusFolders(repository, tempRoot, probe);
  const path = await mkdtemp(join(tempRoot, CORPUS_PREFIX));
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
        `${JSON.stringify({ pid: process.pid, hostname: hostname(), processStartedAt: new Date(ownStartTime()).toISOString(), createdAt: new Date().toISOString() } satisfies CorpusOwner)}\n`,
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
  // The run succeeded: a corpus folder left behind is reported and swept by the
  // next run's stale-worktree pass, it must not discard the scorecard.
  if (cleanupErrors.length > 0)
    process.stderr.write(
      `[corpus] corpus cleanup failed, the run's result is kept: ${cleanupErrors.map(errorMessage).join('; ')}
`,
    );
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
    // A temp copy that cannot be removed (win32 handles of a killed host) is
    // reported, never allowed to replace the run's result.
    const left = await removeTempDir(path);
    if (left !== null)
      process.stderr.write(`[corpus] ${left}
`);
  }
}
/** The raw source-file count of {@link CheckedOutCorpus.eligibleFiles}. */
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
  probe: OwnerProbe,
): Promise<void> {
  const worktrees = parseWorktreePaths(
    await runGit(repository, ['worktree', 'list', '--porcelain']),
  );
  for (const path of worktrees) {
    if (!isTemporaryCorpusWorktree(path, tempRoot)) continue;
    const owner = await readCorpusOwner(path);
    if (owner !== null && (await isOwnerLive(owner, probe))) continue;
    const cleanupErrors = await cleanupCorpusPath(repository, path, true);
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Stale corpus cleanup failed: ${cleanupErrors.map(errorMessage).join('; ')}`,
      );
    }
  }
}

/**
 * Remove what a hard-killed run left under `tempRoot` that is not (or no
 * longer) a registered worktree: corpus folders whose owner is stale (or that
 * have no owner file and are older than {@link ORPHAN_GRACE_MS}), and owner
 * files whose folder is gone and whose owner is stale. Folders of live owners
 * and registered worktrees are left alone. Leak-only cleanup: a removal that
 * fails (a file still locked) is left for the next run.
 */
async function removeOrphanCorpusFolders(
  repository: string,
  tempRoot: string,
  probe: OwnerProbe,
): Promise<void> {
  const registered = new Set(
    parseWorktreePaths(
      await runGit(repository, ['worktree', 'list', '--porcelain']),
    ).map(canonicalPath),
  );
  let entries: string[];
  try {
    entries = await readdir(tempRoot);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(CORPUS_PREFIX)) continue;
    const path = join(tempRoot, name);
    const ownerFile = name.endsWith(CORPUS_OWNER_SUFFIX);
    const folder = ownerFile
      ? path.slice(0, -CORPUS_OWNER_SUFFIX.length)
      : path;
    if (ownerFile && existsSync(folder)) continue;
    if (!ownerFile && registered.has(canonicalPath(folder))) continue;
    const owner = await readCorpusOwner(folder);
    let stale: boolean;
    if (owner !== null) stale = !(await isOwnerLive(owner, probe));
    else if (ownerFile) stale = true;
    else {
      const info = await stat(folder).catch(() => null);
      stale =
        info !== null &&
        info.isDirectory() &&
        probe.now() - info.mtimeMs > ORPHAN_GRACE_MS;
    }
    if (!stale) continue;
    for (const target of [folder, corpusOwnerPath(folder)])
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
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
    const left = await removeTempDir(target);
    if (left !== null) errors.push(new Error(left));
  }
  return errors;
}

function parseWorktreePaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

function fold(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/** The real path (links and 8.3 short names resolved) when it exists, else the resolved one; case-folded on win32. */
function canonicalPath(path: string): string {
  try {
    return fold(realpathSync.native(path));
  } catch {
    return fold(resolve(path));
  }
}

function isUnder(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  );
}

/**
 * A `ptah-mcp-bench-corpus-*` worktree under `tempRoot`, compared lexically
 * and after `realpath`: `git worktree list` may print the long form of a temp
 * path that `os.tmpdir()` gives as an 8.3 short name (or through a link).
 */
function isTemporaryCorpusWorktree(path: string, tempRoot: string): boolean {
  if (!basename(path).startsWith(CORPUS_PREFIX)) return false;
  return (
    isUnder(fold(resolve(path)), fold(resolve(tempRoot))) ||
    isUnder(canonicalPath(path), canonicalPath(tempRoot))
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
