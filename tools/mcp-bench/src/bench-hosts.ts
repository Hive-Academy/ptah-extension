/**
 * The hosts a bench run starts, as lifecycle sessions: the isolated
 * `cli-headless` bench host (`launchBenchHost`, with the memory ground truth
 * seeded through `PTAH_BENCH_MEMORY_SEED` when asked) or the Electron app
 * (launch or attach). Each start is recorded with what its stop reported, so
 * the scorecard's `run.guardMode`, `run.guard` and `run.hostExit` come from
 * the stop reports ({@link runMetadata}), never from guesses.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { resolveBenchDataDir } from './bench-data';

import type { BenchSession } from './lifecycle/lifecycle-scenarios';
import type { Scorecard } from './scorecard/scorecard.types';
import {
  MEMORY_SEED_ENV,
  type MemorySeedRoots,
} from './transport/memory-seed-env';
import {
  ATTACH_MODE_NA_REASON,
  attachElectronHost,
  launchElectronHost,
} from './transport/electron-host';
import { stopThenRethrow } from './transport/guarded-stop';
import {
  HostLaunchError,
  launchBenchHost,
  type HostExit,
} from './transport/host-launcher';
import {
  McpHttpClient,
  workspaceBaseUrl,
  type McpToolCaller,
} from './transport/mcp-client';
import type { GuardReport } from './transport/real-state-guard';

/** The `mcp-bench` project root; Nx targets run with the workspace root as cwd. */
export function benchProjectRoot(): string {
  return resolve('tools', 'mcp-bench');
}

const polyglotConfigSchema = z.object({
  polyglot: z.array(
    z.object({
      id: z.string().min(1),
      language: z.string().min(1),
      repository: z.string().url(),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
    }),
  ),
});

/** The `polyglot` pins of `corpus.config.json` (the corpus reader strips them). */
export async function readPolyglotConfig(
  configPath: string,
): Promise<PolyglotCorpusEntry[]> {
  return polyglotConfigSchema.parse(
    JSON.parse(await readFile(configPath, 'utf8')) as unknown,
  ).polyglot;
}

/** `git` in `cwd`, resolving with its trimmed stdout; rejects on a non-zero exit. */
export type GitRunner = (
  cwd: string,
  args: readonly string[],
  timeoutMs?: number,
) => Promise<string>;

/** A polyglot corpus pin of `corpus.config.json` (Batch 7). */
export interface PolyglotCorpusEntry {
  readonly id: string;
  readonly language: string;
  readonly repository: string;
  readonly commit: string;
}

/** Which host a run drives. */
export interface HostTarget {
  readonly host: 'cli-headless' | 'electron';
  readonly electronMode: 'launch' | 'attach';
}

/** Shifts every `code_symbols.updated_at` back in the host's isolated DB (scenario 6). */
export async function backdateCodeSymbols(
  dbPath: string,
  ageMs: number,
): Promise<number> {
  type Statement = { run(...params: unknown[]): { changes: number } };
  type Database = {
    pragma(source: string): unknown;
    prepare(sql: string): Statement;
    close(): void;
  };
  // Resolved from the workspace root at run time; the bench bundle keeps it external.
  const { createRequire } = await import('node:module');
  const open = createRequire(resolve('package.json'))('better-sqlite3') as new (
    path: string,
  ) => Database;
  const db = new open(dbPath);
  try {
    db.pragma('busy_timeout = 10000');
    return db
      .prepare('UPDATE code_symbols SET updated_at = updated_at - ?')
      .run(ageMs).changes;
  } finally {
    db.close();
  }
}

/** A launch attempt that ended before the host was ready. */
export interface LaunchFailure {
  readonly attempt: number;
  readonly exit: HostExit;
  readonly message: string;
  /** Spawn of the attempt to its end. */
  readonly elapsedMs: number;
}

/** One host the run started (or tried to), with what its stop reported. */
export interface HostRecord {
  readonly label: string;
  readonly workspaceRoot: string;
  exit: HostExit | null;
  guard: GuardReport | null;
  guardMode: GuardReport['mode'] | 'not-applied';
  /** Launch attempts that died before ready; one retry is allowed, never silent. */
  readonly launchFailures: LaunchFailure[];
  started: boolean;
}

/**
 * The host started but its tool discovery (`tools/list`) failed; it was
 * stopped before this was thrown. Retryable like a pre-ready crash.
 */
export class HostDiscoveryError extends HostLaunchError {
  constructor(message: string, exit: HostExit, options?: { cause?: unknown }) {
    super(message, exit, options);
    this.name = 'HostDiscoveryError';
  }
}

/** Attempts per host: the first, plus one retry of a host that dies before ready. */
const LAUNCH_ATTEMPTS = 2;

/**
 * Launch (or attach) one host on `workspaceRoot` and wrap it as a session.
 * A host that ends before it is ready (`HostLaunchError`, `exited-early`) is
 * retried once; each failed attempt is kept on the record (exit code, kind,
 * stderr tail, time to death) for the scorecard. A second failure rethrows
 * the `HostLaunchError`; a guard error always propagates.
 */
export async function startHost(
  target: HostTarget,
  workspaceRoot: string,
  label: string,
  records: HostRecord[],
  memoryRoots: MemorySeedRoots | null,
  log: (line: string) => void,
  launchCli: typeof launchBenchHost = launchBenchHost,
): Promise<RunningHost> {
  const record: HostRecord = {
    label,
    workspaceRoot,
    exit: null,
    guard: null,
    guardMode: 'not-applied',
    launchFailures: [],
    started: false,
  };
  records.push(record);
  for (let attempt = 1; ; attempt += 1) {
    log(
      `[host] ${label} starting on ${workspaceRoot}${attempt > 1 ? ` (retry ${attempt - 1})` : ''}`,
    );
    const startedAt = performance.now();
    try {
      const host = await startHostOnce(
        target,
        workspaceRoot,
        label,
        record,
        memoryRoots,
        log,
        launchCli,
      );
      record.started = true;
      return host;
    } catch (error: unknown) {
      if (!(error instanceof HostLaunchError)) throw error;
      const failure: LaunchFailure = {
        attempt,
        exit: error.exit,
        message: error.message.slice(0, 600),
        elapsedMs: Math.round(performance.now() - startedAt),
      };
      record.launchFailures.push(failure);
      record.exit = error.exit;
      log(
        `[host] ${label} failed before ready (attempt ${attempt}): ${describeLaunchFailure(failure)}`,
      );
      const retryable =
        error.exit.kind === 'exited-early' ||
        error instanceof HostDiscoveryError;
      if (!retryable || attempt >= LAUNCH_ATTEMPTS) throw error;
    }
  }
}

/** `exited-early, exit 3221226505 after 1734 ms: <message>`. */
export function describeLaunchFailure(failure: LaunchFailure): string {
  return `${failure.exit.kind}, exit ${failure.exit.exitCode ?? failure.exit.signal ?? 'none'} after ${failure.elapsedMs} ms: ${failure.message}`;
}

/**
 * One lifecycle row per host that needed a retry or never started, so the
 * retry is visible in the scorecard (tool `bench-host`; no suite has it).
 */
export function hostLaunchRows(
  records: readonly HostRecord[],
): { scenario: string; tool: string; pass: boolean; detail: string }[] {
  return records
    .filter((record) => record.launchFailures.length > 0)
    .map((record) => ({
      scenario: `host-launch:${record.label}`,
      tool: 'bench-host',
      pass: record.started,
      detail: `${record.started ? 'started after a retry' : 'never started'} on ${record.workspaceRoot}; ${record.launchFailures.map((failure) => `attempt ${failure.attempt}: ${describeLaunchFailure(failure)}`).join('; ')}`,
    }));
}

export interface RunningHost extends BenchSession {
  readonly listedTools: ReadonlySet<string>;
  readonly memoryNaReason: string | null;
}

async function startHostOnce(
  target: HostTarget,
  workspaceRoot: string,
  label: string,
  record: HostRecord,
  memoryRoots: MemorySeedRoots | null,
  log: (line: string) => void,
  launchCli: typeof launchBenchHost,
): Promise<RunningHost> {
  const clients = new Map<string, McpHttpClient>();
  let port: number;
  let coldStartMs: number | null;
  let dbPath: string | null;
  let client: McpHttpClient;
  let memoryNaReason: string | null = null;
  let stopHost: () => Promise<{ exit: HostExit; guard: GuardReport | null }>;
  if (target.host === 'cli-headless') {
    const launched = await launchCli({
      workspaceRoot,
      ...(memoryRoots === null
        ? {}
        : { env: { [MEMORY_SEED_ENV]: JSON.stringify(memoryRoots) } }),
    });
    record.guardMode = launched.guardMode;
    ({ port, coldStartMs, client } = launched);
    dbPath = launched.ready.dbPath;
    if (memoryRoots === null)
      memoryNaReason = 'memory roots were not seeded for this host';
    stopHost = async () => {
      const report = await launched.stop();
      return { exit: report.exit, guard: report.guard };
    };
  } else {
    const electron =
      target.electronMode === 'attach'
        ? await attachElectronHost({ workspaceRoot })
        : await launchElectronHost({ workspaceRoot });
    record.guardMode = electron.guardMode;
    ({ port, coldStartMs, client } = electron);
    dbPath = electron.dbPath;
    memoryNaReason =
      electron.mode === 'attach'
        ? ATTACH_MODE_NA_REASON
        : 'memory seeding runs only in the cli-headless host (its afterContainerReady hook); the Electron app has no seeding hook';
    stopHost = async () => {
      const report = await electron.stop();
      return report.mode === 'attach'
        ? {
            exit: {
              kind: 'clean',
              exitCode: null,
              signal: null,
              detail:
                'attach mode: the bench neither started nor stopped the app',
            },
            guard: null,
          }
        : { exit: report.exit, guard: report.guard };
    };
  }
  // Post-launch discovery: a failure here must not leave the host, its
  // temp home and its guard running. Stop it (a guard error from the stop
  // wins), then report the failure as a launch failure that may be retried.
  let listedTools: Set<string>;
  try {
    listedTools = new Set((await client.listTools()).map((tool) => tool.name));
  } catch (error: unknown) {
    let exit: HostExit | null = null;
    await stopThenRethrow(async () => {
      const report = await stopHost();
      record.exit = report.exit;
      record.guard = report.guard;
      exit = report.exit;
    }, error).catch((rethrown: unknown) => {
      if (rethrown !== error) throw rethrown;
    });
    throw new HostDiscoveryError(
      `tools/list failed after the host was ready: ${error instanceof Error ? error.message : String(error)}`,
      exit ?? {
        kind: 'killed',
        exitCode: null,
        signal: null,
        detail: 'stopped after a failed tools/list',
      },
      { cause: error },
    );
  }
  const callerFor = (root: string): McpToolCaller => {
    if (root === workspaceRoot) return client;
    let found = clients.get(root);
    if (found === undefined) {
      found = new McpHttpClient({ baseUrl: workspaceBaseUrl(port, root) });
      clients.set(root, found);
    }
    return found;
  };
  let stopped: Promise<{ exit: HostExit }> | undefined;
  return {
    workspaceRoot,
    coldStartMs,
    dbPath,
    client,
    callerFor,
    listedTools,
    memoryNaReason,
    stop: () => {
      stopped ??= (async () => {
        for (const extra of clients.values()) extra.close();
        const report = await stopHost();
        record.exit = report.exit;
        record.guard = report.guard;
        log(
          `[host] ${label} stopped: ${report.exit.kind}${report.exit.detail ? ` (${report.exit.detail})` : ''}`,
        );
        return { exit: report.exit };
      })();
      return stopped;
    },
  };
}

/** `run.guardMode`, `run.guard` and `run.hostExit` from every host the run started. */
export function runMetadata(
  records: readonly HostRecord[],
): Pick<Scorecard['run'], 'guardMode' | 'guard' | 'hostExit'> {
  const guards = records.flatMap((record) =>
    record.guard === null ? [] : [record.guard],
  );
  const unprobed = new Map<
    number,
    { pid: number; name: string; handles: number }
  >();
  for (const guard of guards)
    if (guard.mode === 'process-watch')
      for (const item of guard.unprobedProcesses)
        unprobed.set(item.pid, {
          pid: item.pid,
          name: item.name,
          handles: Math.max(item.handles, unprobed.get(item.pid)?.handles ?? 0),
        });
  const modes = records.map((record) => record.guardMode);
  const guardMode = modes.includes('process-watch')
    ? 'process-watch'
    : modes.includes('hash')
      ? 'hash'
      : 'not-applied';
  const main = records[0]?.exit ?? {
    kind: 'exited-early' as const,
    exitCode: null,
    signal: null,
    detail: 'no host was started',
  };
  const others = records
    .slice(1)
    .filter((record) => record.exit !== null && record.exit.kind !== 'clean');
  const detail = [
    main.detail,
    ...others.map(
      (record) =>
        `${record.label}: ${record.exit?.kind}${record.exit?.detail ? ` (${record.exit.detail})` : ''}`,
    ),
    ...records.flatMap((record) =>
      record.launchFailures.map(
        (failure) =>
          `${record.label} launch attempt ${failure.attempt}: ${describeLaunchFailure(failure)}`,
      ),
    ),
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('; ');
  return {
    guardMode,
    guard: { partial: unprobed.size > 0, unprobed: [...unprobed.values()] },
    hostExit: {
      kind: main.kind,
      exitCode: main.exitCode,
      signal: main.signal,
      ...(detail ? { detail } : {}),
    },
  };
}

/** Memory roots A and B, and a git worktree of A, under the run's scratch folder. */
export async function createMemoryRoots(
  scratch: string,
  git: GitRunner,
): Promise<MemorySeedRoots> {
  const rootA = join(scratch, 'memory-A');
  const rootB = join(scratch, 'memory-B');
  const worktreeOfA = join(scratch, 'memory-A-worktree');
  await mkdir(rootA, { recursive: true });
  await mkdir(rootB, { recursive: true });
  await git(rootA, ['init']);
  await git(rootA, ['config', 'user.email', 'bench@example.test']);
  await git(rootA, ['config', 'user.name', 'MCP Bench']);
  await writeFile(join(rootA, 'README.md'), '# memory root A\n', 'utf8');
  await git(rootA, ['add', 'README.md']);
  await git(rootA, ['commit', '-m', 'memory root A']);
  await git(rootA, ['worktree', 'add', '-b', 'bench-worktree', worktreeOfA]);
  return { rootA, rootB, worktreeOfA };
}

/** The cached clone of a polyglot corpus in the bench data folder, and a per-run worktree of the pin. */
export async function polyglotCheckout(
  entry: PolyglotCorpusEntry,
  scratch: string,
  git: GitRunner,
  log: (line: string) => void,
): Promise<{ root: string; gitRoot: string }> {
  const cache = join(
    resolveBenchDataDir({ create: true }),
    'corpora',
    entry.id,
  );
  if (!existsSync(join(cache, '.git'))) {
    log(`[polyglot] cloning ${entry.repository} into ${cache}`);
    await rm(cache, { recursive: true, force: true });
    await mkdir(resolve(cache, '..'), { recursive: true });
    await git(
      resolve(cache, '..'),
      ['clone', '--no-checkout', entry.repository, cache],
      600_000,
    );
  }
  const root = join(scratch, `polyglot-${entry.id}`);
  await git(cache, ['worktree', 'prune']);
  await git(cache, ['worktree', 'add', '--detach', root, entry.commit]);
  return { root, gitRoot: cache };
}
