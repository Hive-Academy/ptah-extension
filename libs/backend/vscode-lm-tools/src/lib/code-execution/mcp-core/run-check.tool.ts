/**
 * `ptah_run_check` — run Nx checks for one project and return a short summary
 * (TASK_2026_597, D13).
 *
 * It runs `node <workspace>/node_modules/nx/.../nx.js run-many -t <targets>
 * -p <project> --outputStyle=static` from an argument array with
 * `shell: false`, in the caller's workspace root. Nothing in the command line
 * comes from the caller except the validated project name and target list
 * (`RunCheckArgsSchema`); the Nx path is derived from the workspace root the
 * dispatcher resolved, never from the arguments.
 *
 * The full log goes to `<workspace>/.ptah/tmp/checks/<ts>-<project>.log`
 * (the `.ptah/tmp` convention `tool-result-budget.ts` spools under). The reply
 * — exit code, duration, per-target result, the last output lines of a
 * failing run, and the log path — is at most {@link WAIT_SUMMARY_MAX_CHARS}
 * chars. On timeout the whole process tree is killed and the reply says so.
 *
 * A run is also stopped, tree and all, when the caller's `signal` aborts
 * (the MCP request was cancelled) or when the host calls
 * {@link killRunningChecks} on dispose: a check never outlives the host that
 * started it, on Windows (`taskkill /T`) or POSIX (process group).
 *
 * Served as `ptah_run_check` (HTTP, `protocol-dispatcher.ts`) and
 * `run_check` (stdio, `agent-tool.dispatcher.ts`).
 */
import { createWriteStream, type WriteStream } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { killProcessTree } from '@ptah-extension/platform-core';
import type { MCPToolDefinition } from '../types';
import {
  DEFAULT_RUN_CHECK_TIMEOUT_SEC,
  HTTP_MAX_AGENT_WAIT_SEC,
  MAX_WAIT_TIMEOUT_SEC,
  RUN_CHECK_TARGETS,
  WAIT_SUMMARY_MAX_CHARS,
  type RunCheckArgs,
  type RunCheckTarget,
} from './wait-tools-args.schema';

/** The one tool name. Exported so the dispatchers and their specs agree on it. */
export const RUN_CHECK_TOOL_NAME = 'ptah_run_check';

/**
 * Where Nx's CLI entry may live, relative to the workspace root. Nx 23 ships
 * it under `dist/bin`; older releases under `bin`. First match wins.
 */
export const NX_ENTRY_CANDIDATES: readonly (readonly string[])[] = [
  ['node_modules', 'nx', 'dist', 'bin', 'nx.js'],
  ['node_modules', 'nx', 'bin', 'nx.js'],
];

/** How long to wait for `close` after the tree kill before giving up on it. */
const KILL_SETTLE_MS = 10_000;
/** Output lines kept in memory for the summary; the log has everything. */
const TAIL_LINES_KEPT = 400;
/** Longest single output line kept in memory or shown in the reply. */
const MAX_LINE_CHARS = 300;

const ESC = String.fromCharCode(0x1b);
/** CSI escape sequences (colours, cursor moves); the summary is plain text. */
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
/** `> nx run <project>:<target>` — a task starting (or replayed from cache). */
const TASK_START = /^>\s*nx run (\S+):(\S+)/;
/** The heading of Nx's failed-task list; `- <project>:<target>` lines follow. */
const FAILED_TASKS_HEADING = /^Failed tasks:/;
const FAILED_TASK_ITEM = /^-\s+(\S+):(\S+)\s*$/;
/** Nx's closing summary line; task output ends above it. */
const RUN_SUMMARY = /^NX\s+(Ran|Successfully ran) target/;

/** The slice of a child process this tool uses. */
export interface CheckProcess {
  readonly pid?: number;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: 'error', listener: (error: Error) => void): this;
  /** The root process ended; its stdio (and so `close`) may still be open. */
  on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export type SpawnCheckProcess = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    detached: boolean;
  },
) => CheckProcess | Promise<CheckProcess>;

export interface RunCheckDependencies {
  /** The caller's workspace root, resolved by the dispatcher. Never from the arguments. */
  readonly workspaceRoot: string;
  /** Node executable. Default `node` from PATH. */
  readonly nodeExecutable?: string;
  /** Process launcher. Default `child_process.spawn` with `shell: false`. */
  readonly spawnProcess?: SpawnCheckProcess;
  /** Existence check for the Nx entry. Default `fs.access`. */
  readonly fileExists?: (path: string) => Promise<boolean>;
  /**
   * Tree kill on timeout, cancel or dispose. Rejects when the kill failed.
   * Default `killProcessTree` from platform-core, its `onError` turned into a
   * rejection.
   */
  readonly killTree?: (pid: number) => Promise<void>;
  /**
   * Aborts when the caller no longer wants the result (the MCP request was
   * cancelled). The run's process tree is killed and the verdict is
   * `cancelled`. Other running checks are untouched.
   */
  readonly signal?: AbortSignal;
  /** Directory for full logs. Default `<workspaceRoot>/.ptah/tmp/checks`. */
  readonly logDirectory?: string;
  /** Called as soon as the full-log path is available (HTTP job observability). */
  readonly onLogOpened?: (path: string | undefined) => void;
  /** Clock (epoch ms). Default `Date.now`. */
  readonly now?: () => number;
}

export interface RunCheckOutcome {
  /** True when the check could not be run at all (no Nx, no Node). A failing check is not an error. */
  readonly isError: boolean;
  readonly text: string;
  /** Absolute path of the full log, when one was written. */
  readonly logPath?: string;
  /** The tool reply's `structuredContent`: always names the folder the check ran in (`cwd`). */
  readonly structured: RunCheckStructuredResult;
}

export interface RunCheckStructuredResult {
  /** The folder Nx was (or would have been) run in. */
  readonly cwd: string;
  readonly project: string;
  readonly targets: readonly RunCheckTarget[];
  readonly verdict:
    'passed' | 'failed' | 'timed_out' | 'cancelled' | 'not_run' | 'running';
  readonly exitCode: number | null;
  readonly logPath?: string;
  readonly jobId?: string;
}

type TargetResult = 'passed' | 'failed' | 'not run' | 'incomplete' | 'unknown';

export function buildRunCheckTool({
  transport = 'http',
}: { transport?: 'http' | 'stdio' } = {}): MCPToolDefinition {
  const httpCap =
    transport === 'http'
      ? ` HTTP calls block at most ${HTTP_MAX_AGENT_WAIT_SEC} s; a longer check returns a jobId — collect it with ptah_run_check_wait.`
      : '';
  const description =
    transport === 'stdio'
      ? `Run Nx targets (${RUN_CHECK_TARGETS.join(', ')}) for ONE project in your declared workspace ` +
        '(worktrees inside an open workspace folder too) and ' +
        'block until done. Runs `nx run-many -t <targets> -p <project> --outputStyle=static` ' +
        'with the workspace-local Nx, no shell. Returns exit code, duration, per-target result and ' +
        `the last lines of a failing run in at most ${WAIT_SUMMARY_MAX_CHARS} chars; the full log is ` +
        'written under .ptah/tmp/checks/ (path in the reply). ' +
        `timeoutSec (1-${MAX_WAIT_TIMEOUT_SEC}, default ${DEFAULT_RUN_CHECK_TIMEOUT_SEC}): on timeout ` +
        'the process tree is killed and the reply says so.'
      : `Run Nx targets (${RUN_CHECK_TARGETS.join(', ')}) for ONE project in your declared workspace ` +
        '(worktrees inside an open workspace folder too). Uses workspace-local Nx, no shell. ' +
        `Returns exit code, duration, per-target result and failing tail (at most ${WAIT_SUMMARY_MAX_CHARS} chars); ` +
        'the full log is under .ptah/tmp/checks/. ' +
        `timeoutSec (1-${MAX_WAIT_TIMEOUT_SEC}, default ${DEFAULT_RUN_CHECK_TIMEOUT_SEC}) kills its tree on timeout.` +
        httpCap;
  return {
    name: RUN_CHECK_TOOL_NAME,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          pattern: '^[A-Za-z0-9@/_.][A-Za-z0-9@/_.-]{0,119}$',
          description: 'Nx project name, e.g. "@scope/lib" or "my-app".',
        },
        targets: {
          type: 'array',
          items: { type: 'string', enum: [...RUN_CHECK_TARGETS] },
          minItems: 1,
          maxItems: RUN_CHECK_TARGETS.length,
        },
        timeoutSec: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_WAIT_TIMEOUT_SEC,
          description: `Longest run in seconds (default ${DEFAULT_RUN_CHECK_TIMEOUT_SEC}).`,
        },
      },
      required: ['project', 'targets'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false },
  };
}

/**
 * Run one check. `args` is the parsed `RunCheckArgsSchema` value; the caller
 * validates at the boundary.
 */
export async function runCheck(
  args: RunCheckArgs,
  deps: RunCheckDependencies,
): Promise<RunCheckOutcome> {
  const now = deps.now ?? Date.now;
  const root = deps.workspaceRoot;
  const exists = deps.fileExists ?? fileExists;
  const candidates = NX_ENTRY_CANDIDATES.map((parts) => join(root, ...parts));
  const notRun = (logPath?: string): RunCheckStructuredResult => ({
    cwd: root,
    project: args.project,
    targets: args.targets,
    verdict: 'not_run',
    exitCode: null,
    ...(logPath ? { logPath } : {}),
  });
  const nxEntry = await firstExisting(candidates, exists);
  if (nxEntry === undefined) {
    return {
      isError: true,
      text:
        `ptah_run_check: Nx was not found in this workspace (${root}). Looked for ${candidates.join(' and ')}. ` +
        'Install the workspace dependencies first; a worktree needs its own install or a node_modules link.',
      structured: notRun(),
    };
  }

  const node = deps.nodeExecutable ?? 'node';
  const argv = [
    nxEntry,
    'run-many',
    '-t',
    args.targets.join(','),
    '-p',
    args.project,
    '--outputStyle=static',
  ];
  const log = await openLog(
    deps.logDirectory ?? join(root, '.ptah', 'tmp', 'checks'),
    args.project,
    now(),
  );
  deps.onLogOpened?.(log.path);
  log.write(`$ ${node} ${argv.join(' ')}\n(cwd ${root})\n\n`);

  const collector = new OutputCollector(args.project);
  const startedAt = now();
  const run = await execute(
    node,
    argv,
    root,
    args.timeoutSec * 1000,
    deps,
    (chunk) => {
      log.write(chunk);
      collector.push(chunk);
    },
  );
  collector.flush();
  const durationMs = now() - startedAt;
  log.write(
    `\n[ptah_run_check] ${run.spawnError ? `spawn error: ${run.spawnError}` : `exit ${run.code ?? 'none'}${run.signal ? ` (${run.signal})` : ''}`}` +
      `${run.timedOut ? ', timed out' : ''}${run.cancelled ? `, cancelled ${run.cancelled.replace('_', ' ')}` : ''}` +
      `${run.killFailed ? `, tree kill of pid ${run.killFailed.pid} failed: ${run.killFailed.reason}` : ''}, ${durationMs} ms\n`,
  );
  await log.close();

  if (run.spawnError !== undefined) {
    return {
      isError: true,
      text:
        `ptah_run_check: could not start "${node}" in ${root}: ${run.spawnError}. ` +
        'Node.js must be on PATH for the host process.' +
        (log.path ? ` Log: ${log.path}` : ''),
      ...(log.path ? { logPath: log.path } : {}),
      structured: notRun(log.path),
    };
  }

  let verdict: RunCheckStructuredResult['verdict'] = 'failed';
  if (run.timedOut) verdict = 'timed_out';
  else if (run.cancelled) verdict = 'cancelled';
  else if (run.code === 0) verdict = 'passed';
  return {
    isError: false,
    text: formatRunCheckSummary({
      cwd: root,
      project: args.project,
      targets: args.targets,
      timeoutSec: args.timeoutSec,
      code: run.code,
      timedOut: run.timedOut,
      ...(run.cancelled ? { cancelled: run.cancelled } : {}),
      ...(run.killFailed ? { killFailedPid: run.killFailed.pid } : {}),
      durationMs,
      results: collector.results(
        args.targets,
        run.code,
        run.timedOut || run.cancelled !== undefined,
      ),
      lastLines: collector.lastTaskLines(),
      logPath: log.path,
      logError: log.error,
    }),
    ...(log.path ? { logPath: log.path } : {}),
    structured: {
      cwd: root,
      project: args.project,
      targets: args.targets,
      verdict,
      exitCode: run.code,
      ...(log.path ? { logPath: log.path } : {}),
    },
  };
}

export interface RunCheckSummaryInput {
  /** The folder the check ran in; always printed. */
  readonly cwd: string;
  readonly project: string;
  readonly targets: readonly RunCheckTarget[];
  readonly timeoutSec: number;
  readonly code: number | null;
  readonly timedOut: boolean;
  /** Set when the run was cancelled (request abort or host dispose). */
  readonly cancelled?: CancelPoint;
  /** Set when the tree kill of a timed-out or cancelled run failed: the pid it named. */
  readonly killFailedPid?: number;
  readonly durationMs: number;
  readonly results: ReadonlyMap<RunCheckTarget, TargetResult>;
  readonly lastLines: readonly string[];
  readonly logPath?: string;
  readonly logError?: string;
}

/**
 * Render the reply within {@link WAIT_SUMMARY_MAX_CHARS}. The verdict,
 * per-target results and log path always fit; the output lines of a run that
 * did not pass fill the rest, newest kept.
 */
export function formatRunCheckSummary(input: RunCheckSummaryInput): string {
  const seconds = (input.durationMs / 1000).toFixed(1);
  const killed =
    input.killFailedPid === undefined
      ? 'the process tree was killed'
      : `kill failed (pid ${input.killFailedPid} may still be running)`;
  let verdict: string;
  if (input.timedOut) {
    verdict = `TIMED OUT after ${input.timeoutSec}s; ${killed}`;
  } else if (input.cancelled === 'before_start') {
    verdict = 'CANCELLED before Nx started';
  } else if (input.cancelled === 'while_running') {
    verdict = `CANCELLED; ${killed}`;
  } else if (input.code === 0) {
    verdict = 'PASSED (exit 0)';
  } else {
    verdict = `FAILED (exit ${input.code ?? 'none'})`;
  }
  const fixed = [
    `ptah_run_check ${input.project} [${input.targets.join(', ')}]: ${verdict}, ${seconds}s.`,
    `Ran in: ${input.cwd}`,
    'Targets:',
    ...input.targets.map((t) => `- ${t}: ${input.results.get(t) ?? 'unknown'}`),
    logLine(input),
  ].join('\n');

  const passed =
    !input.timedOut && input.cancelled === undefined && input.code === 0;
  if (passed || input.lastLines.length === 0) return clamp(fixed);

  const heading = '\nLast output lines:';
  let used = fixed.length + heading.length;
  const kept: string[] = [];
  for (let i = input.lastLines.length - 1; i >= 0; i--) {
    const line = `\n  ${input.lastLines[i]}`;
    if (used + line.length > WAIT_SUMMARY_MAX_CHARS) break;
    kept.unshift(line);
    used += line.length;
  }
  return clamp(kept.length > 0 ? `${fixed}${heading}${kept.join('')}` : fixed);
}

/** A short, repeat-safe HTTP job reply. */
export function formatRunCheckRunning(input: {
  readonly jobId: string;
  readonly project: string;
  readonly targets: readonly RunCheckTarget[];
  readonly elapsedMs: number;
  readonly logPath?: string;
  readonly cwd: string;
}): string {
  const seconds = (input.elapsedMs / 1000).toFixed(1);
  return clamp(
    `ptah_run_check ${input.project} [${input.targets.join(', ')}]: RUNNING, ${seconds}s.\n` +
      `Job: ${input.jobId}\nRan in: ${input.cwd}\n` +
      `Full log: ${input.logPath ?? '.ptah/tmp/checks (opening)'}\n` +
      'Call ptah_run_check_wait with this jobId to collect or cancel it.',
  );
}

function logLine(input: RunCheckSummaryInput): string {
  if (!input.logPath) {
    return `Full log: not written (${input.logError ?? 'unknown error'})`;
  }
  return input.logError
    ? `Full log: ${input.logPath} (incomplete: ${input.logError})`
    : `Full log: ${input.logPath}`;
}

function clamp(text: string): string {
  return text.length <= WAIT_SUMMARY_MAX_CHARS
    ? text
    : `${text.slice(0, WAIT_SUMMARY_MAX_CHARS - 1)}…`;
}

/** Where a cancel caught the run: before the process existed, or while it ran. */
type CancelPoint = 'before_start' | 'while_running';

interface RunResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly cancelled?: CancelPoint;
  /** Set when the tree kill (timeout or cancel) failed. */
  readonly killFailed?: { readonly pid: number; readonly reason: string };
  readonly spawnError?: string;
}

/**
 * Every check whose process may be alive, by pid, with the call that stops it
 * (tree kill, `cancelled` verdict). An entry leaves when its run settles —
 * unless the tree kill failed and the process never closed: then the entry
 * stays, as a bare tree-kill retry, until a `close` or a successful retry.
 * On Windows the retry also ends when the root process exits: `taskkill /T`
 * finds the tree by the root's pid, so after the root is gone it cannot reach
 * the orphans, and the pid may be reused by an unrelated process.
 */
const liveChecks = new Map<number, () => Promise<void>>();
let abortLaunchingRunCheckJobs: (() => void) | undefined;

/** Registers the HTTP job registry's pre-spawn abort hook. */
export function setRunCheckJobAbortAll(abortAll: () => void): void {
  abortLaunchingRunCheckJobs = abortAll;
}

/**
 * Kill the process tree of every running check, each through its own run's
 * stop path (so each reply says `cancelled`), and retry the tree kill of
 * every settled run whose kill failed. For host dispose: a detached POSIX
 * process group, or a Windows tree, would otherwise outlive the host.
 *
 * Never rejects: every stop and retry records its own kill failure. Resolves
 * once every tree kill has finished, which can take up to the tree-kill grace
 * period (`PROCESS_TREE_KILL_GRACE_MS`, 5 s). Hosts therefore await it with
 * a bounded budget and no catch: VS Code `deactivate` runs it beside the agent
 * reap, Electron `will-quit` defers the quit while {@link runningCheckPids} is
 * non-empty and awaits it inside the disposal chain.
 */
export async function killRunningChecks(): Promise<void> {
  // Jobs enter the registry before `runCheck` has obtained a pid. Abort them
  // first so dispose cannot leave that launch alive outside this host.
  abortLaunchingRunCheckJobs?.();
  await Promise.all([...liveChecks.values()].map((stop) => stop()));
}

/** The pids of the checks running now. */
export function runningCheckPids(): readonly number[] {
  return [...liveChecks.keys()];
}

/**
 * Launch the process and settle on `close`, a spawn error, or — after a
 * timeout's, cancel's or dispose's tree kill — {@link KILL_SETTLE_MS}
 * without a `close`.
 */
async function execute(
  command: string,
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  deps: RunCheckDependencies,
  onChunk: (chunk: string) => void,
): Promise<RunResult> {
  if (deps.signal?.aborted) {
    return {
      code: null,
      signal: null,
      timedOut: false,
      cancelled: 'before_start',
    };
  }
  const launch = deps.spawnProcess ?? spawnWithoutShell;
  const killTree = deps.killTree ?? killTreeOrThrow;
  let child: CheckProcess;
  try {
    child = await launch(command, argv, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NX_TUI: 'false' },
      // POSIX: a process group of its own, so the tree kill reaches every
      // task Nx starts. Windows' taskkill walks the tree without it.
      detached: process.platform !== 'win32',
    });
  } catch (error: unknown) {
    return {
      code: null,
      signal: null,
      timedOut: false,
      spawnError: error instanceof Error ? error.message : String(error),
    };
  }

  return new Promise<RunResult>((resolve) => {
    const pid = child.pid;
    const signal = deps.signal;
    /** Why the run was stopped; unset while it is left to finish. */
    let stopReason: 'timeout' | 'cancel' | undefined;
    let stopping: Promise<void> | undefined;
    let settled = false;
    let closed = false;
    /**
     * Windows only: the root process has exited, so its pid no longer names
     * this tree and a retry by pid could reach whichever process reuses it.
     * On POSIX the kill targets the process group, which outlives its leader.
     */
    let rootPidReleased = false;
    let settleTimer: NodeJS.Timeout | undefined;
    /** Why the tree kill failed; unset while no kill failed. */
    let killFailure: string | undefined;
    /** This run's `liveChecks` entry, so a reused pid's entry is never touched. */
    let entry: (() => Promise<void>) | undefined;
    const ended = (
      code: number | null,
      exitSignal: NodeJS.Signals | null,
    ): RunResult => ({
      code,
      signal: exitSignal,
      timedOut: stopReason === 'timeout',
      ...(stopReason === 'cancel'
        ? { cancelled: 'while_running' as const }
        : {}),
      ...(killFailure !== undefined && pid !== undefined
        ? { killFailed: { pid, reason: killFailure } }
        : {}),
    });
    const register = (next: () => Promise<void>): void => {
      if (pid === undefined) return;
      entry = next;
      liveChecks.set(pid, next);
    };
    const unregister = (): void => {
      if (pid !== undefined && entry && liveChecks.get(pid) === entry) {
        liveChecks.delete(pid);
      }
      entry = undefined;
    };
    /**
     * Dispose's retry for a settled run whose kill failed and which never
     * closed and whose root is still alive. A successful kill unlists the
     * pid; a failed one leaves it for the next dispose, until the process
     * closes or (Windows) its root exits.
     */
    const retryKill = (): Promise<void> =>
      pid === undefined
        ? Promise.resolve()
        : killTree(pid).then(unregister, (error: unknown) => {
            killFailure = errorText(error);
          });
    const settle = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(settleTimer);
      signal?.removeEventListener('abort', onAbort);
      if (killFailure !== undefined && !closed && !rootPidReleased) {
        register(retryKill);
      } else unregister();
      resolve(result);
    };

    /**
     * Kill this run's tree once, whatever asked first; a later request (a
     * cancel after the timeout fired) joins the kill already under way and
     * does not change the reason. After the kill, wait up to
     * {@link KILL_SETTLE_MS} for `close` before reporting without it.
     */
    const stop = (reason: 'timeout' | 'cancel'): Promise<void> => {
      if (settled) return Promise.resolve();
      if (stopping) return stopping;
      stopReason = reason;
      clearTimeout(timer);
      const stopWaiting = (): void => {
        if (settled) return;
        settleTimer = unref(
          setTimeout(() => settle(ended(null, null)), KILL_SETTLE_MS),
        );
      };
      // A failed kill is recorded: the reply says the tree may still run, and
      // the pid stays listed for dispose's retry until the process closes.
      stopping = (pid === undefined ? Promise.resolve() : killTree(pid)).then(
        stopWaiting,
        (error: unknown) => {
          killFailure = errorText(error);
          stopWaiting();
        },
      );
      return stopping;
    };
    const onAbort = (): void => {
      void stop('cancel');
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => onChunk(chunk));
    child.stderr?.on('data', (chunk: string) => onChunk(chunk));

    child.on('error', (error: Error) => {
      // After a stop the only errors left are kill-related; the close (or
      // the settle backstop) reports the run. Before it, an error with no
      // pid is a failed launch.
      if (stopReason === undefined && child.pid === undefined) {
        settle({
          code: null,
          signal: null,
          timedOut: false,
          spawnError: error.message,
        });
      }
    });
    child.on('exit', () => {
      if (process.platform !== 'win32') return;
      rootPidReleased = true;
      // A settled run's entry is only the retry: drop it now. A run still
      // going keeps its stop entry until it settles, and `settle` then sees
      // the root is gone and lists no retry.
      if (settled) unregister();
    });
    child.on('close', (code, exitSignal) => {
      // The process is gone: unlist it even when the run settled earlier on
      // the backstop after a failed kill.
      closed = true;
      unregister();
      settle(ended(code, exitSignal));
    });

    // `settle` and `stop` close over `timer`; nothing calls them before this
    // assignment (the abort wiring below comes after it).
    const timer = unref(
      setTimeout(() => {
        void stop('timeout');
      }, timeoutMs),
    );

    register(() => stop('cancel'));
    signal?.addEventListener('abort', onAbort, { once: true });
    // Aborted while the process was launching: the listener above will
    // never fire, so stop now.
    if (signal?.aborted) onAbort();
  });
}

/**
 * The default tree kill: `killProcessTree` reports a failure only through
 * `onError` and always resolves, so the first reported error becomes this
 * promise's rejection.
 */
async function killTreeOrThrow(pid: number): Promise<void> {
  let failure: { readonly error: unknown } | undefined;
  await killProcessTree(pid, 'SIGTERM', (error: unknown) => {
    failure ??= { error };
  });
  if (failure !== undefined) throw failure.error;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The run's own timers never keep the host alive: the MCP request waiting on
 * the result is what does (the same rule as `AgentProcessManager.unrefTimer`).
 * Guarded because fake-timer implementations may lack `unref`.
 */
function unref(timer: NodeJS.Timeout): NodeJS.Timeout {
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    timer.unref();
  }
  return timer;
}

async function spawnWithoutShell(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean },
): Promise<CheckProcess> {
  // Loaded lazily, as platform-core's tree reaper does: this module is pulled
  // in by the MCP dispatcher, and most of its consumers never run a check.
  const { spawn } = await import('node:child_process');
  return spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: options.detached,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Splits output into lines, keeps a bounded tail, and records Nx task outcomes. */
class OutputCollector {
  private partial = '';
  private readonly tail: string[] = [];
  private readonly started = new Set<string>();
  private readonly failed = new Set<string>();
  private inFailedList = false;
  private sawFailedList = false;

  constructor(private readonly project: string) {}

  push(chunk: string): void {
    const text = this.partial + chunk;
    const lines = text.split(/\r?\n/);
    this.partial = lines.pop() ?? '';
    for (const line of lines) this.line(line);
  }

  flush(): void {
    if (this.partial) this.line(this.partial);
    this.partial = '';
  }

  results(
    targets: readonly RunCheckTarget[],
    code: number | null,
    /** The run was stopped by a timeout or a cancel, not left to finish. */
    stopped: boolean,
  ): Map<RunCheckTarget, TargetResult> {
    const out = new Map<RunCheckTarget, TargetResult>();
    for (const target of targets) {
      const started = this.started.has(target);
      let result: TargetResult;
      if (this.failed.has(target)) result = 'failed';
      else if (stopped) result = started ? 'incomplete' : 'not run';
      else if (code === 0) result = 'passed';
      else if (!started) result = 'not run';
      else result = this.sawFailedList ? 'passed' : 'unknown';
      out.set(target, result);
    }
    return out;
  }

  /** The kept output above Nx's closing summary, or all of it when there is none. */
  lastTaskLines(): string[] {
    let end = this.tail.length;
    for (let i = this.tail.length - 1; i >= 0; i--) {
      if (RUN_SUMMARY.test(this.tail[i].trim())) {
        end = i;
        break;
      }
    }
    return this.tail.slice(0, end).filter((line) => line.trim().length > 0);
  }

  private line(raw: string): void {
    const line = raw.replace(ANSI_CSI, '').trimEnd();
    const trimmed = line.trim();
    const start = TASK_START.exec(trimmed);
    if (start && start[1] === this.project) this.started.add(start[2]);
    if (FAILED_TASKS_HEADING.test(trimmed)) {
      this.inFailedList = true;
      this.sawFailedList = true;
    } else if (this.inFailedList && trimmed) {
      const item = FAILED_TASK_ITEM.exec(trimmed);
      if (item) {
        if (item[1] === this.project) this.failed.add(item[2]);
      } else {
        this.inFailedList = false;
      }
    }
    this.tail.push(
      line.length <= MAX_LINE_CHARS
        ? line
        : `${line.slice(0, MAX_LINE_CHARS - 1)}…`,
    );
    if (this.tail.length > TAIL_LINES_KEPT) this.tail.shift();
  }
}

interface CheckLog {
  readonly path?: string;
  readonly error?: string;
  write(text: string): void;
  close(): Promise<void>;
}

/**
 * Open the full-log file. A log that cannot be written does not stop the
 * check: the reply says why the log is missing instead.
 */
async function openLog(
  directory: string,
  project: string,
  nowMs: number,
): Promise<CheckLog> {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const path = join(directory, `${stamp}-${project.replace(/[@/]/g, '_')}.log`);
  let stream: WriteStream;
  try {
    await mkdir(directory, { recursive: true });
    stream = createWriteStream(path, { flags: 'wx' });
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve());
      stream.once('error', reject);
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      error: reason,
      write: () => undefined,
      close: async () => undefined,
    };
  }
  let failure: string | undefined;
  stream.on('error', (error: Error) => {
    failure = error.message;
  });
  return {
    path,
    get error() {
      return failure;
    },
    write: (text) => {
      if (failure === undefined) stream.write(text);
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (failure !== undefined) {
          resolve();
          return;
        }
        stream.end(() => resolve());
      }),
  };
}

async function firstExisting(
  paths: readonly string[],
  exists: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const path of paths) {
    if (await exists(path)) return path;
  }
  return undefined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error: unknown) {
    // degradation-audit: optional-capability - an unreadable Nx entry is the
    // same as a missing one here; the caller reports every path it tried.
    void error;
    return false;
  }
}
