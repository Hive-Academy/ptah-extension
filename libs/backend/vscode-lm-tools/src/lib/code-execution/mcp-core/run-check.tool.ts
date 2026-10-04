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
  /** Tree kill on timeout. Default `killProcessTree` from platform-core. */
  readonly killTree?: (pid: number) => Promise<void>;
  /** Directory for full logs. Default `<workspaceRoot>/.ptah/tmp/checks`. */
  readonly logDirectory?: string;
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
  readonly verdict: 'passed' | 'failed' | 'timed_out' | 'not_run';
  readonly exitCode: number | null;
  readonly logPath?: string;
}

type TargetResult = 'passed' | 'failed' | 'not run' | 'incomplete' | 'unknown';

export function buildRunCheckTool(): MCPToolDefinition {
  return {
    name: RUN_CHECK_TOOL_NAME,
    description:
      `Run Nx targets (${RUN_CHECK_TARGETS.join(', ')}) for ONE project in your declared workspace ` +
      '(worktrees too) and ' +
      'block until they finish. Runs `nx run-many -t <targets> -p <project> --outputStyle=static` ' +
      'with the workspace-local Nx, no shell. Returns exit code, duration, per-target result and ' +
      `the last lines of a failing run in at most ${WAIT_SUMMARY_MAX_CHARS} chars; the full log is ` +
      'written under .ptah/tmp/checks/ and its path is in the reply. ' +
      `timeoutSec (1-${MAX_WAIT_TIMEOUT_SEC}, default ${DEFAULT_RUN_CHECK_TIMEOUT_SEC}): on timeout ` +
      'the process tree is killed and the reply says so.',
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
    },
    annotations: { destructiveHint: false, openWorldHint: false },
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
        'Install the workspace dependencies first.',
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
      `${run.timedOut ? ', timed out' : ''}, ${durationMs} ms\n`,
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
      durationMs,
      results: collector.results(args.targets, run.code, run.timedOut),
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
  let verdict: string;
  if (input.timedOut) {
    verdict = `TIMED OUT after ${input.timeoutSec}s; the process tree was killed`;
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

  const passed = !input.timedOut && input.code === 0;
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

interface RunResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly spawnError?: string;
}

/**
 * Launch the process and settle on `close`, a spawn error, or — after a
 * timeout's tree kill — {@link KILL_SETTLE_MS} without a `close`.
 */
async function execute(
  command: string,
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  deps: RunCheckDependencies,
  onChunk: (chunk: string) => void,
): Promise<RunResult> {
  const launch = deps.spawnProcess ?? spawnWithoutShell;
  const killTree = deps.killTree ?? ((pid: number) => killProcessTree(pid));
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
    let timedOut = false;
    let settled = false;
    let settleTimer: NodeJS.Timeout | undefined;
    const settle = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(settleTimer);
      resolve(result);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => onChunk(chunk));
    child.stderr?.on('data', (chunk: string) => onChunk(chunk));

    child.on('error', (error: Error) => {
      // After a timeout the only errors left are kill-related; the close (or
      // the settle backstop) reports the run. Before it, an error with no
      // pid is a failed launch.
      if (!timedOut && child.pid === undefined) {
        settle({
          code: null,
          signal: null,
          timedOut: false,
          spawnError: error.message,
        });
      }
    });
    child.on('close', (code, signal) => settle({ code, signal, timedOut }));

    // `settle` closes over `timer`; every caller is an event or a timer,
    // all of which fire after this assignment.
    const timer = unref(
      setTimeout(() => {
        timedOut = true;
        const pid = child.pid;
        const stopWaiting = (): void => {
          settleTimer = unref(
            setTimeout(
              () => settle({ code: null, signal: null, timedOut: true }),
              KILL_SETTLE_MS,
            ),
          );
        };
        if (pid === undefined) {
          stopWaiting();
          return;
        }
        void killTree(pid).then(stopWaiting, stopWaiting);
      }, timeoutMs),
    );
  });
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
    timedOut: boolean,
  ): Map<RunCheckTarget, TargetResult> {
    const out = new Map<RunCheckTarget, TargetResult>();
    for (const target of targets) {
      const started = this.started.has(target);
      let result: TargetResult;
      if (this.failed.has(target)) result = 'failed';
      else if (timedOut) result = started ? 'incomplete' : 'not run';
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
