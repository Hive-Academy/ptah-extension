import crossSpawn from 'cross-spawn';
import { spawn } from 'child_process';
import * as os from 'os';
import which from 'which';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { Logger } from '../logging';

export const DEFAULT_GIT_TIMEOUT_MS = 10_000;
export const WORKTREE_GIT_TIMEOUT_MS = 300_000;

/** Combined stdout + stderr a git child may produce before it is killed. */
export const DEFAULT_GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Output cap for `git status --porcelain=v2 --untracked-files=all`. Lower than
 * the default because the whole buffer is then split and parsed on the main
 * thread; a status past this size is a repository nobody can review anyway.
 */
export const GIT_STATUS_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** Git children allowed to run at once across the whole process. */
export const DEFAULT_GIT_MAX_CONCURRENT = 4;

/**
 * Smallest slot count the gate runs with. With one slot the background lane
 * (max − 1) would be empty or would own the only slot; two keeps one slot that
 * only interactive calls can take.
 */
export const MIN_GIT_MAX_CONCURRENT = 2;

/**
 * A call whose timeout exceeds this is "long" (worktree add/remove run with
 * {@link WORKTREE_GIT_TIMEOUT_MS}) and is gated like background work.
 */
const LONG_GIT_CALL_MS = 60_000;

/**
 * How long a killed child may keep its gate slot while it dies. The slot is
 * released on `close`; this is only the ceiling for a child that never
 * reports one (a failed tree kill, a lost worker message).
 */
const FORCED_KILL_GRACE_MS = 2_000;

/** Queue wait above which the gate reports saturation. */
const SATURATION_WAIT_MS = 5_000;

/** At most one saturation warning per this interval. */
const SATURATION_WARN_INTERVAL_MS = 60_000;

/**
 * Rejection for a git child whose combined output passed its cap. The child
 * has already been killed when this is thrown. Typed so callers can tell an
 * oversized result from a git failure without parsing the message.
 */
export class GitOutputLimitError extends Error {
  readonly code = 'GIT_OUTPUT_LIMIT' as const;

  constructor(
    readonly subcommand: string | undefined,
    readonly limitBytes: number,
  ) {
    super(`git ${subcommand} output exceeded ${limitBytes} bytes`);
    this.name = 'GitOutputLimitError';
  }
}

/** Gives a gate slot back. Idempotent: a second call does nothing. */
export type GitSlotRelease = () => void;

/**
 * `interactive` — someone is waiting on the answer; may use every slot.
 * `background` — watcher refreshes and long commands; may use all but one, so
 * a hung worktree command can never block a status read.
 */
export type GitGateLane = 'interactive' | 'background';

interface GitSlotWaiter {
  readonly enqueuedAt: number;
  readonly lane: GitGateLane;
  readonly grant: (release: GitSlotRelease) => void;
}

/**
 * What a host may set on the process gate. First configuration wins: a
 * repeat with the same values is a no-op, a repeat with different ones is
 * reported once and ignored.
 */
export interface GitProcessGateConfig {
  /**
   * Sink for gate warnings. Saturation before one is set is not reported; a
   * slot-count clamp notice is held and written when it arrives.
   */
  logger?: Pick<Logger, 'warn'>;
  /**
   * Overrides `PTAH_GIT_MAX_CONCURRENT`; ignored unless a positive integer,
   * raised to {@link MIN_GIT_MAX_CONCURRENT}.
   */
  maxConcurrent?: number;
}

/**
 * Process-wide semaphore over git children (TASK_2026_437, INV-3).
 *
 * The editor fans out ~10 concurrent git subprocesses at renderer start and a
 * watcher burst can add more; every one of them competes for the same disks
 * and CPUs, so each run's own duration inflates until the 10 s timeout fires
 * and the retry piles on top. The gate caps live children instead.
 *
 * - Never rejects for saturation: a caller only ever sees latency.
 * - FIFO within a workspace, round-robin across workspaces, so one repository
 *   with a long queue cannot starve another. When both lanes have an
 *   admissible head, the one that has waited longer goes first.
 * - `max` is at least {@link MIN_GIT_MAX_CONCURRENT}, and the background lane
 *   is capped at `max - 1`, so one slot is always interactive-only.
 * - A slot belongs to a CHILD, not to a promise: the run loop releases it when
 *   the child closes (or {@link FORCED_KILL_GRACE_MS} after a forced kill),
 *   never when a timeout rejects, so no new run overlaps a dying one.
 */
export class GitProcessGate {
  private live = 0;
  private backgroundLive = 0;
  /**
   * Waiters per lane, per workspace. Map insertion order IS the round-robin
   * order: a workspace served with more still queued is deleted and
   * re-inserted, which moves it to the back in O(1).
   */
  private readonly queues: Record<GitGateLane, Map<string, GitSlotWaiter[]>> = {
    interactive: new Map(),
    background: new Map(),
  };
  private lastSaturationWarnAt = Number.NEGATIVE_INFINITY;
  private maxConcurrent: number;
  private warn: ((message: string) => void) | undefined;
  private configuredLogger: Pick<Logger, 'warn'> | undefined;
  private maxConfigured = false;
  private conflictReported = false;
  /** Notices raised before any sink existed; written when one is set. */
  private readonly heldNotices: string[] = [];

  constructor(
    maxConcurrent: number,
    warn?: (message: string) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.warn = warn;
    this.maxConcurrent = this.clampMax(maxConcurrent);
  }

  /** Children holding a slot right now. */
  get liveCount(): number {
    return this.live;
  }

  /** Callers waiting for a slot right now. */
  get queuedCount(): number {
    let count = 0;
    for (const lane of Object.values(this.queues)) {
      for (const queue of lane.values()) count += queue.length;
    }
    return count;
  }

  /** Apply a host configuration; first wins (see {@link GitProcessGateConfig}). */
  configure(config: GitProcessGateConfig): void {
    let conflict = false;
    const logger = config.logger;
    if (logger && !this.configuredLogger) {
      this.configuredLogger = logger;
      this.warn = (message) => logger.warn(message);
      for (const notice of this.heldNotices.splice(0)) this.warn(notice);
    } else if (logger && logger !== this.configuredLogger) {
      conflict = true;
    }
    const max = config.maxConcurrent;
    if (max !== undefined && Number.isInteger(max) && max > 0) {
      if (!this.maxConfigured) {
        this.maxConfigured = true;
        this.maxConcurrent = this.clampMax(max);
        this.dispatch();
      } else if (Math.max(max, MIN_GIT_MAX_CONCURRENT) !== this.maxConcurrent) {
        conflict = true;
      }
    }
    if (conflict && !this.conflictReported) {
      this.conflictReported = true;
      this.notify(
        '[GitProcessGate] configured again with different settings; ' +
          'keeping the first configuration',
      );
    }
  }

  /** Raise `requested` to the minimum, noting the clamp once. */
  private clampMax(requested: number): number {
    if (requested >= MIN_GIT_MAX_CONCURRENT) return requested;
    this.notify(
      `[GitProcessGate] git max concurrency ${requested} is below the minimum; ` +
        `using ${MIN_GIT_MAX_CONCURRENT} so one slot stays interactive-only`,
    );
    return MIN_GIT_MAX_CONCURRENT;
  }

  private notify(message: string): void {
    if (this.warn) this.warn(message);
    else this.heldNotices.push(message);
  }

  /** Resolves with a release once a slot in `lane` is free for `workspace`. */
  acquire(
    workspace: string,
    lane: GitGateLane = 'interactive',
  ): Promise<GitSlotRelease> {
    return new Promise((grant) => {
      const queues = this.queues[lane];
      const waiter: GitSlotWaiter = { enqueuedAt: this.now(), lane, grant };
      const queue = queues.get(workspace);
      if (queue) queue.push(waiter);
      else queues.set(workspace, [waiter]);
      this.dispatch();
    });
  }

  private admit(waiter: GitSlotWaiter): void {
    this.live++;
    if (waiter.lane === 'background') this.backgroundLive++;
    const waited = this.now() - waiter.enqueuedAt;
    if (waited > SATURATION_WAIT_MS) this.reportSaturation(waited);
    let released = false;
    waiter.grant(() => {
      if (released) return;
      released = true;
      this.live--;
      if (waiter.lane === 'background') this.backgroundLive--;
      this.dispatch();
    });
  }

  /** The round-robin head of `lane`, or undefined when it has no waiter. */
  private head(lane: GitGateLane): [string, GitSlotWaiter[]] | undefined {
    const next = this.queues[lane].entries().next();
    return next.done ? undefined : next.value;
  }

  private dispatch(): void {
    while (this.live < this.maxConcurrent) {
      const interactive = this.head('interactive');
      const background =
        this.backgroundLive < this.maxConcurrent - 1
          ? this.head('background')
          : undefined;
      const chosen =
        interactive && background
          ? interactive[1][0].enqueuedAt <= background[1][0].enqueuedAt
            ? interactive
            : background
          : (interactive ?? background);
      if (!chosen) return;
      const [workspace, queue] = chosen;
      const waiter = queue.shift() as GitSlotWaiter;
      const queues = this.queues[waiter.lane];
      queues.delete(workspace);
      if (queue.length > 0) queues.set(workspace, queue);
      this.admit(waiter);
    }
  }

  private reportSaturation(waitedMs: number): void {
    const at = this.now();
    if (at - this.lastSaturationWarnAt < SATURATION_WARN_INTERVAL_MS) return;
    this.lastSaturationWarnAt = at;
    this.warn?.(
      `[GitProcessGate] saturated: waited ${waitedMs}ms for a git slot ` +
        `(live=${this.live}, queued=${this.queuedCount}, max=${this.maxConcurrent})`,
    );
  }
}

/** `PTAH_GIT_MAX_CONCURRENT` when it is a positive integer, else the default. */
function maxConcurrentFromEnv(): number {
  const parsed = Number.parseInt(
    process.env['PTAH_GIT_MAX_CONCURRENT'] ?? '',
    10,
  );
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_GIT_MAX_CONCURRENT;
}

/**
 * The one gate every git child in this process passes through.
 *
 * A module-level instance, not an `@injectable`: `execGit` is a free function
 * reached without a container — `task-specs` binds the function itself as a
 * value, the vscode-lm-tools git namespace calls it directly, and
 * `GitReviewReaderService` takes it as a default runner argument. A DI-held
 * gate would need every one of those call sites to thread a resolved instance
 * through. Hosts reach it through {@link configureGitProcessGate} instead.
 */
let processGate: GitProcessGate | undefined;

function gitProcessGate(): GitProcessGate {
  processGate ??= new GitProcessGate(maxConcurrentFromEnv());
  return processGate;
}

/**
 * Wire the process gate to a host's logger (and optionally its slot count).
 * `registerVsCodeCorePlatformAgnostic` calls it, which all three hosts run
 * before any git caller, so `execGit` users with no logger of their own
 * (task-specs, the vscode-lm-tools git namespace) still warn through it.
 * First configuration wins; see {@link GitProcessGateConfig}.
 */
export function configureGitProcessGate(config: GitProcessGateConfig): void {
  gitProcessGate().configure(config);
}

/**
 * Drop the process gate so the next call builds a fresh one (re-reading
 * `PTAH_GIT_MAX_CONCURRENT`). Exists for tests; a slot held by a child of the
 * old gate is released into the old gate and cannot leak into the new one.
 */
export function resetGitProcessGateForTests(): void {
  processGate = undefined;
}

/**
 * Absolute path to the `git` executable, resolved at most once per process.
 *
 * `undefined` — not resolved yet. `null` — resolution ran and found nothing.
 * The two are distinct so a failed lookup is not retried on every call, which
 * would reintroduce exactly the cost this cache exists to remove.
 */
let resolvedGitBinary: string | null | undefined;

/**
 * The command handed to {@link crossSpawn} for every git invocation.
 *
 * Passing the bare name `'git'` makes cross-spawn re-resolve it through
 * `which.sync` on EVERY spawn — a synchronous walk of each PATH entry against
 * each PATHEXT, run on the Electron main thread. Handing it an already
 * resolved absolute path collapses that walk to a single stat.
 *
 * The win is in SYNCHRONOUS main-thread time, which is the part that stalls
 * the event loop. Interleaved A/B on Windows (40 spawns per arm, 3 runs) put
 * the mean synchronous cost of one spawn at 89.6/80.5/108.4 ms for the bare
 * name against 46.9/42.0/81.0 ms for the absolute path — roughly 30-40 ms
 * saved per spawn. Medians are noisier than means here; one run of three had
 * a slightly worse median, so treat this as a consistent modest reduction and
 * not a step change.
 *
 * It is NOT a fix for the multi-second latency on the first diff after launch.
 * That is dominated by the editor fanning out ~10 concurrent git subprocesses
 * at renderer startup, which inflates each process's own run time by an order
 * of magnitude; {@link GitProcessGate} is what bounds that concurrency.
 *
 * An absolute path also pins cross-spawn to its fast path: `parseNonShell`
 * only rewrites the invocation to `cmd.exe /d /s /c` when resolution FAILS, so
 * a resolved `git.exe` can never silently degrade into a shell hop.
 *
 * When git is genuinely absent the bare name is returned unchanged, so the
 * caller still gets cross-spawn's usual ENOENT rather than a novel error from
 * this helper.
 */
function gitCommand(): string {
  if (resolvedGitBinary === undefined) {
    try {
      resolvedGitBinary = which.sync('git', { nothrow: true });
    } catch {
      // `nothrow` covers "not found"; this guards a PATH that cannot be read
      // at all. Either way the bare name is the correct fallback.
      resolvedGitBinary = null;
    }
  }
  return resolvedGitBinary ?? 'git';
}

/**
 * Drop the memoized git path. Exists for tests, which need to observe
 * resolution happening exactly once across calls.
 */
export function resetResolvedGitBinaryForTests(): void {
  resolvedGitBinary = undefined;
}

/**
 * Environment forced on every git invocation.
 *
 * - `LC_ALL` / `LANG` pin git's diagnostics to the C locale so callers may
 *   classify failures without parsing localized message text.
 * - `GIT_OPTIONAL_LOCKS=0` stops read-only commands (notably `git status`)
 *   from taking `.git/index.lock`, which otherwise feeds the file watcher a
 *   change event for every status poll.
 *
 * Caller-supplied `env` entries win, so a call site that genuinely needs a
 * different locale can still ask for one.
 */
const GIT_DETERMINISTIC_ENV: Readonly<Record<string, string>> = {
  LC_ALL: 'C',
  LANG: 'C',
  GIT_OPTIONAL_LOCKS: '0',
};

export interface ExecGitOptions {
  timeoutMs?: number;
  /**
   * Payload written to the child's stdin before the pipe is closed. Required
   * by subcommands that read a patch or blob from standard input
   * (`git apply -`, `git hash-object --stdin`).
   *
   * When omitted, stdin is closed immediately: git subcommands that read
   * stdin would otherwise block forever on a pipe nobody ever ends.
   */
  stdin?: string | Buffer;
  /** Extra environment entries merged over {@link GIT_DETERMINISTIC_ENV}. */
  env?: NodeJS.ProcessEnv;
  /**
   * When supplied, git is launched through the `IProcessSpawner` port instead
   * of inline `crossSpawn`.
   *
   * `child_process.spawn` is not asynchronous: libuv's `uv_spawn` runs
   * `CreateProcessW` on the CALLING thread, so an inline spawn freezes the
   * Electron main process for the whole of it (TASK_2026_341 measured ~1.6 s
   * per launch inline against a 29 ms host-loop max delay off-thread). Every
   * `git:info` on the boot path paid that here.
   *
   * Optional on purpose. The Electron host binds
   * `SDK_TOKENS.SDK_PROCESS_SPAWNER` and passes it down; the VS Code extension
   * and the CLI bind nothing and keep the inline path unchanged, so this
   * helper never depends on a host having wired a spawner.
   */
  spawner?: IProcessSpawner;
  /**
   * Combined stdout + stderr bytes allowed before the child is tree-killed and
   * the call rejects with {@link GitOutputLimitError}. Defaults to
   * {@link DEFAULT_GIT_MAX_OUTPUT_BYTES}.
   */
  maxOutputBytes?: number;
  /**
   * `'background'` lowers the child to below-normal OS priority once its pid
   * is known, best-effort. For work nobody is waiting on (a watcher-driven
   * status refresh); user-initiated commands leave it unset.
   */
  priority?: 'normal' | 'background';
}

export interface ExecGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecGitBufferResult {
  /** Raw stdout bytes — never decoded, so binary blobs survive intact. */
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

/**
 * The slice of a spawned git child this module actually uses.
 *
 * Written out explicitly rather than relying on `ChildProcess` and
 * `SpawnedProcessHandle` being structurally compatible: their `on` overload
 * sets differ, and an assignability accident there would be silent. Two tiny
 * adapters below map each source onto this, so the run loop is written once.
 */
interface GitChildHandle {
  readonly stdin: NodeJS.WritableStream | null;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  /**
   * The child's pid once the spawning thread reports it, `undefined` if it
   * never started.
   *
   * A promise and not a field because off-thread the pid does not exist yet
   * when the handle is returned, and the tree kill needs the real one.
   */
  readonly whenSpawned: Promise<number | undefined>;
  isKilled(): boolean;
  kill(signal: NodeJS.Signals): void;
  onClose(listener: (code: number | null) => void): void;
  onError(listener: (error: Error) => void): void;
}

function spawnGitChild(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  spawner: IProcessSpawner | undefined,
): GitChildHandle {
  if (spawner) {
    const handle = spawner.spawnProcess({
      command: gitCommand(),
      args,
      cwd,
      env,
    });
    return {
      stdin: handle.stdin,
      stdout: handle.stdout,
      stderr: handle.stderr,
      whenSpawned: handle.whenSpawned.then(
        (pid) => pid ?? undefined,
        // The port documents `whenSpawned` as never rejecting; a spawn failure
        // arrives as an `error` event. Absorbed anyway so a port implementation
        // that breaks that promise cannot mint an unhandled rejection.
        () => undefined,
      ),
      isKilled: () => handle.killed,
      kill: (signal) => {
        handle.kill(signal);
      },
      onClose: (listener) => handle.on('close', (code) => listener(code)),
      onError: (listener) => handle.on('error', listener),
    };
  }

  const child = crossSpawn(gitCommand(), args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    whenSpawned: Promise.resolve(child.pid),
    isKilled: () => child.killed,
    kill: (signal) => {
      child.kill(signal);
    },
    onClose: (listener) => {
      child.on('close', (code: number | null) => listener(code));
    },
    onError: (listener) => {
      child.on('error', listener);
    },
  };
}

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        /* taskkill not available; child.kill above is best-effort */
      });
    } catch {
      /* swallow — child.kill() was already attempted by caller */
    }
  }
}

/** Best-effort below-normal OS priority for a background git child. */
function lowerProcessPriority(pid: number | undefined, exited: boolean): void {
  // A child already seen to close is skipped, so its pid is never touched.
  // Residual race: the child can exit, and the OS can reuse its pid, between
  // this check and the syscall — a window of one synchronous call.
  if (pid === undefined || exited) return;
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // degradation-audit: optional-capability - priority is a hint; the child
    // may already have exited (ESRCH) or the OS may refuse (EACCES), and it
    // then simply runs at normal priority, which is the pre-gate behaviour.
  }
}

/**
 * Run git and return stdout as raw bytes.
 *
 * Chunks are accumulated and concatenated once at close rather than decoded
 * per chunk: a multi-byte UTF-8 sequence split across a stream chunk boundary
 * (which node's 64 KiB pipe reads make routine on files above ~64 KiB) would
 * otherwise decode to replacement characters on both sides of the split.
 *
 * Every call first waits for a {@link GitProcessGate} slot; the timeout clock
 * starts at spawn, so queue time never counts against it. Background-priority
 * and long (timeout above 60 s) calls wait in the background lane.
 *
 * Use this for blob reads (NUL-byte binary detection, exact byte lengths) and
 * content hashing. For text output prefer {@link execGit}.
 */
export async function execGitBuffer(
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
): Promise<ExecGitBufferResult> {
  const lane: GitGateLane =
    options?.priority === 'background' ||
    (options?.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS) > LONG_GIT_CALL_MS
      ? 'background'
      : 'interactive';
  const release = await gitProcessGate().acquire(cwd, lane);
  return runGitChild(args, cwd, options, release);
}

/**
 * Spawn one git child and supervise it until it exits. Owns `release`: it is
 * called exactly when the child is gone (or the kill grace ran out), which may
 * be well after the returned promise settled.
 */
function runGitChild(
  args: string[],
  cwd: string,
  options: ExecGitOptions | undefined,
  release: GitSlotRelease,
): Promise<ExecGitBufferResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const maxOutputBytes =
    options?.maxOutputBytes ?? DEFAULT_GIT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    let child: GitChildHandle;
    try {
      child = spawnGitChild(
        args,
        cwd,
        { ...process.env, ...GIT_DETERMINISTIC_ENV, ...options?.env },
        options?.spawner,
      );
    } catch (error: unknown) {
      // No child exists, so nothing can be holding the slot. Rethrown: a throw
      // inside the executor rejects the returned promise.
      release();
      throw error;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let exited = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    if (options?.priority === 'background') {
      void child.whenSpawned.then((pid) => lowerProcessPriority(pid, exited));
    }

    /** Release the slot after the grace period unless `close` comes first. */
    const armReleaseGrace = (onExpiry?: () => void): void => {
      if (graceTimer) return;
      graceTimer = setTimeout(() => {
        onExpiry?.();
        release();
      }, FORCED_KILL_GRACE_MS);
      graceTimer.unref?.();
    };

    /**
     * Kill the child (and on Windows its tree); the slot stays held until it
     * closes or the grace runs out, escalating to SIGKILL first.
     */
    const terminate = (): void => {
      child.kill('SIGTERM');
      // Off-thread the pid is not known synchronously, so the tree kill waits
      // for it rather than reading a field that would still be `undefined`.
      void child.whenSpawned.then((pid) => {
        if (!exited) killProcessTree(pid);
      });
      armReleaseGrace(() => {
        if (!child.isKilled()) child.kill('SIGKILL');
      });
    };

    /** Settle with `error` and kill the child; its slot stays held. */
    const abort = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminate();
      reject(error);
    };

    const timer = setTimeout(() => {
      abort(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    const collect =
      (chunks: Buffer[]) =>
      (data: Buffer): void => {
        if (settled) return;
        outputBytes += data.byteLength;
        if (outputBytes > maxOutputBytes) {
          abort(new GitOutputLimitError(args[0], maxOutputBytes));
          return;
        }
        chunks.push(data);
      };
    child.stdout?.on('data', collect(stdoutChunks));
    child.stderr?.on('data', collect(stderrChunks));

    child.onClose((code: number | null) => {
      exited = true;
      if (graceTimer) clearTimeout(graceTimer);
      release();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? 1,
      });
    });

    child.onError((error: Error) => {
      // A child that never started holds nothing, so its slot goes back at
      // once. One that did start may still be running: kill it exactly as a
      // timeout would, so the slot is never returned while it lives on.
      void child.whenSpawned.then((pid) => {
        if (pid === undefined) release();
        else if (!exited) terminate();
      });
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    // Always close stdin. Git exiting before it drains the pipe raises EPIPE
    // on the writable side; that is expected and must not become an unhandled
    // error, so it is swallowed here — the exit code is the real signal.
    const stdin = child.stdin;
    if (stdin) {
      stdin.on('error', () => {
        /* EPIPE / ECONNRESET when git exits before reading its input */
      });
      if (options?.stdin !== undefined) {
        stdin.end(options.stdin);
      } else {
        stdin.end();
      }
    }
  });
}

/**
 * Run git and return stdout decoded as UTF-8.
 *
 * Thin wrapper over {@link execGitBuffer} — the decode happens once, over the
 * complete output, so chunk boundaries cannot corrupt multi-byte characters.
 */
export async function execGit(
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
): Promise<ExecGitResult> {
  const { stdout, stderr, exitCode } = await execGitBuffer(args, cwd, options);
  return { stdout: stdout.toString('utf8'), stderr, exitCode };
}
