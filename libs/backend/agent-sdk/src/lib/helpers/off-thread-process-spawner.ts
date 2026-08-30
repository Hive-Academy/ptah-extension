/**
 * `OffThreadProcessSpawner` — the host-thread half of the SDK's process spawn.
 *
 * `child_process.spawn` is NOT asynchronous. libuv's `uv_spawn` runs
 * `CreateProcessW` inline on the calling thread and Windows scans the target
 * image while creating the process, so the cost tracks the executable's size:
 * `cmd.exe` 9 ms, `node.exe` ~700 ms, `claude.exe` (253 MB) 1850-1975 ms on the
 * reference machine. The Claude Agent SDK performs that spawn inside
 * `query()`'s SYNCHRONOUS prologue — `ProcessTransport`'s constructor calls
 * `initialize()` which calls `spawnLocalProcess()` — so every query launch
 * froze the Electron main process for ~1.6 s, ten times during boot alone
 * (TASK_2026_341, `tmp/logs/log.log` lines 693/698, 951/952, ...). No spawn flag
 * changes it; a different THREAD is the only lever, and
 * `Options.spawnClaudeCodeProcess` is the only public seam the SDK offers for
 * taking it.
 *
 * So `spawn()` here returns a SHIM immediately — an `EventEmitter` with a
 * `Writable` stdin and a `Readable` stdout — while the real
 * `child_process.spawn` happens on a `worker_threads` Worker. Measured: the
 * worker pays the same 2.7 s, the host loop's max delay stays at 29 ms.
 *
 * **Three rules this shim exists to keep:**
 *
 * 1. **`kill()` also fires `process.kill(pid, signal)` directly.** The SDK
 *    registers a `process.on('exit')` sweep that SIGTERMs every live transport
 *    on host shutdown. That handler runs synchronously as the host dies, so a
 *    kill routed only through `postMessage` would never be drained by the
 *    worker and the CLI child would be orphaned. A kill arriving before the pid
 *    is known is queued and applied when `spawned` lands.
 * 2. **`exitCode` stays `null` until the child actually exits.** The SDK gates
 *    every stdin write on `process.exitCode !== null`; reporting an exit code
 *    early turns a live session into "Cannot write to terminated process".
 * 3. **The shim wires `options.stderr` itself, via `onStderr`.** The SDK only
 *    pipes and forwards stderr inside `spawnLocalProcess`. Once a custom
 *    spawner is supplied that code path is skipped entirely, so
 *    `SdkQueryRunner`'s stderr classifier would go silent unless the callback
 *    is handed down here.
 *
 * **Escape hatch.** `PTAH_SDK_INLINE_SPAWN=1`, or a `new Worker` that throws,
 * falls back to the inline `child_process.spawn` the SDK would have done
 * itself. The behaviour is then exactly today's — blocking, but working — so a
 * worker-hostile host can be recovered without a rebuild.
 */

import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  SpawnOptions,
  SpawnedProcess,
} from '../types/sdk-types/claude-sdk.types';
import { OFF_THREAD_SPAWNER_WORKER_SOURCE } from './off-thread-process-spawner-source';

const SERVICE_TAG = '[OffThreadProcessSpawner]';

/** Set to `1` to bypass the worker and spawn inline (the SDK's own behaviour). */
const INLINE_SPAWN_ENV_KEY = 'PTAH_SDK_INLINE_SPAWN';

/**
 * How long to wait for `stdout-end` after a terminal event before tearing the
 * worker down anyway. A consumer that stops reading stdout would otherwise
 * strand one thread per launch. Unref'd: it must never hold the host open.
 */
const STDOUT_DRAIN_GRACE_MS = 10_000;

export interface OffThreadSpawnHooks {
  /**
   * Receives the child's stderr, decoded as UTF-8. Supplying it is what makes
   * the worker pipe stderr at all — see rule 3 in the file header.
   */
  readonly onStderr?: (data: string) => void;
}

/**
 * Which thread actually created the child.
 *
 * Reported on every handle because the two paths are behaviourally identical
 * from the SDK's side and differ only in what they cost the caller's loop —
 * which is precisely the thing that regresses silently. It is what the fallback
 * warning names, and what `off-thread-process-spawner.spec.ts` asserts on.
 */
export type SpawnTransport = 'worker' | 'inline';

/** A `SpawnedProcess` that also says which thread spawned it. */
export interface PtahSpawnedProcess extends SpawnedProcess {
  readonly transport: SpawnTransport;
}

/** Worker -> host messages. Mirrors the protocol in the worker source. */
type WorkerErrorMessage = {
  type: 'error';
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
};

type WorkerMessage =
  | { type: 'spawned'; pid: number | null }
  | { type: 'stdout'; chunk: Uint8Array }
  | { type: 'stderr'; text: string }
  | { type: 'stdout-end' }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | WorkerErrorMessage;

/** An `Error` carrying the `code` the SDK's spawn-failure classifier reads. */
interface SpawnFailure extends Error {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

function rebuildError(message: WorkerErrorMessage): Error {
  const error: SpawnFailure = new Error(message.message);
  if (message.code !== undefined) error.code = message.code;
  if (message.errno !== undefined) error.errno = message.errno;
  if (message.syscall !== undefined) error.syscall = message.syscall;
  if (message.path !== undefined) error.path = message.path;
  return error;
}

function workerError(message: string): Error {
  const error: SpawnFailure = new Error(message);
  error.code = 'EWORKER';
  return error;
}

/**
 * Drop keys whose value is `undefined`.
 *
 * `child_process` already skips them, but the env crosses a structured clone
 * first and an explicit strip keeps the key SET the child sees identical on the
 * worker and inline paths.
 */
function stripUndefinedEnv(env: SpawnOptions['env']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * The shim handed to the SDK in place of a `ChildProcess`, backed by a Worker.
 *
 * Extends `EventEmitter` for the same reason `ChildProcess` does: the SDK
 * attaches `on('exit')` / `on('error')` and calls `off` on teardown.
 */
class WorkerBackedProcess extends EventEmitter implements PtahSpawnedProcess {
  readonly transport = 'worker' as const;
  readonly stdin: Writable;
  readonly stdout: Readable;

  private worker: Worker | null = null;
  private pid: number | null = null;
  private pendingKill: NodeJS.Signals | null = null;
  private killedFlag = false;
  private code: number | null = null;
  private settled = false;
  private stdoutEnded = false;
  private graceTimer: NodeJS.Timeout | null = null;
  private readonly onAbort: () => void;

  constructor(
    private readonly options: SpawnOptions,
    private readonly hooks: OffThreadSpawnHooks,
    private readonly onTerminate: (
      target: WorkerBackedProcess,
      termination: Promise<void>,
    ) => void,
  ) {
    super();
    // An EventEmitter with no 'error' listener THROWS on emit. The SDK attaches
    // its own listener in the same synchronous block that calls us, so this
    // only covers the gap — and the gap is exactly where a spawn failure lands.
    this.on('error', () => undefined);

    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        const view = new Uint8Array(chunk);
        this.post({ type: 'stdin', chunk: view }, [view.buffer]);
        callback();
      },
      final: (callback) => {
        this.post({ type: 'stdin-end' });
        callback();
      },
    });

    this.stdout = new Readable({
      read: () => {
        this.post({ type: 'resume' });
      },
    });

    this.onAbort = () => {
      this.kill('SIGTERM');
    };

    this.worker = new Worker(OFF_THREAD_SPAWNER_WORKER_SOURCE, { eval: true });
    this.attachWorker(this.worker);

    this.post({
      type: 'spawn',
      command: options.command,
      args: [...options.args],
      cwd: options.cwd,
      env: stripUndefinedEnv(options.env),
      wantStderr: Boolean(hooks.onStderr),
    });

    if (options.signal.aborted) this.onAbort();
    else options.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  get killed(): boolean {
    return this.killedFlag;
  }

  get exitCode(): number | null {
    return this.code;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.settled) return false;
    this.killedFlag = true;
    if (this.pid !== null) this.signalDirectly(this.pid, signal);
    else this.pendingKill = signal;
    this.post({ type: 'kill', signal });
    return true;
  }

  /** Terminate the worker now, whatever state the child is in. For dispose. */
  forceTerminate(): void {
    this.kill('SIGKILL');
    this.settled = true;
    this.detachAbort();
    this.endStdout();
    this.teardown();
  }

  private attachWorker(worker: Worker): void {
    worker.on('message', (raw: unknown) => {
      this.onWorkerMessage(raw as WorkerMessage);
    });
    worker.on('error', (error: Error) => {
      this.fail(workerError(`Spawn worker failed: ${error.message}`));
    });
    worker.on('exit', () => {
      this.fail(workerError('Spawn worker exited before the child started.'));
    });
  }

  private onWorkerMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'spawned': {
        this.pid = message.pid;
        if (this.pendingKill !== null && this.pid !== null) {
          const signal = this.pendingKill;
          this.pendingKill = null;
          this.signalDirectly(this.pid, signal);
        }
        return;
      }
      case 'stdout': {
        if (!this.stdout.push(Buffer.from(message.chunk))) {
          this.post({ type: 'pause' });
        }
        return;
      }
      case 'stderr': {
        this.hooks.onStderr?.(message.text);
        return;
      }
      case 'stdout-end': {
        this.endStdout();
        this.maybeTeardown();
        return;
      }
      case 'exit': {
        this.finish(message.code, message.signal);
        return;
      }
      case 'error': {
        this.fail(rebuildError(message));
        return;
      }
      default:
        return;
    }
  }

  /** Emit the terminal 'exit' exactly once and start the teardown clock. */
  private finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.settled) return;
    this.settled = true;
    this.code = code;
    this.detachAbort();
    this.emit('exit', code, signal);
    this.armGrace();
    this.maybeTeardown();
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.detachAbort();
    this.emit('error', error);
    this.armGrace();
    this.maybeTeardown();
  }

  /** Push EOF at most once — a second `push(null)` throws ERR_STREAM_PUSH_AFTER_EOF. */
  private endStdout(): void {
    if (this.stdoutEnded) return;
    this.stdoutEnded = true;
    this.stdout.push(null);
  }

  private detachAbort(): void {
    this.options.signal.removeEventListener('abort', this.onAbort);
  }

  private armGrace(): void {
    if (this.graceTimer || this.stdoutEnded) return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.endStdout();
      this.teardown();
    }, STDOUT_DRAIN_GRACE_MS);
    this.graceTimer.unref?.();
  }

  private maybeTeardown(): void {
    if (!this.settled || !this.stdoutEnded) return;
    this.teardown();
  }

  private teardown(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    this.onTerminate(
      this,
      worker.terminate().then(
        () => undefined,
        () => undefined,
      ),
    );
  }

  /**
   * Signal the child from THIS thread. See rule 1 in the file header: the SDK's
   * exit sweep runs as the host process dies, and a worker round trip does not
   * survive that.
   */
  private signalDirectly(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(pid, signal);
    } catch (error: unknown) {
      // ESRCH means the child is already gone, which is the outcome we wanted.
      // Anything else is equally unactionable here — the 'exit'/'error' event
      // is what the caller reads.
      void error;
    }
  }

  private post(message: unknown, transfer?: ArrayBuffer[]): void {
    const worker = this.worker;
    if (!worker) return;
    try {
      worker.postMessage(message, transfer);
    } catch (error: unknown) {
      this.fail(
        workerError(
          `Failed to reach the spawn worker: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  }
}

/** The inline (blocking) path — exactly what the SDK's own spawner does. */
class InlineProcess extends EventEmitter implements PtahSpawnedProcess {
  readonly transport = 'inline' as const;
  readonly stdin: Writable;
  readonly stdout: Readable;

  constructor(private readonly child: childProcess.ChildProcess) {
    super();
    this.on('error', () => undefined);
    if (!child.stdin || !child.stdout) {
      throw new Error('Inline spawn produced a child without stdio pipes.');
    }
    this.stdin = child.stdin;
    this.stdout = child.stdout;
    child.on('exit', (code, signal) => {
      this.emit('exit', code, signal);
    });
    child.on('error', (error: Error) => {
      this.emit('error', error);
    });
  }

  get killed(): boolean {
    return this.child.killed;
  }

  get exitCode(): number | null {
    return this.child.exitCode;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    return this.child.kill(signal);
  }
}

@injectable()
export class OffThreadProcessSpawner {
  private readonly live = new Set<WorkerBackedProcess>();
  private readonly terminations = new Set<Promise<void>>();
  private warnedInline = false;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Spawn the Claude Code CLI without blocking this thread.
   *
   * Returns synchronously. The child is created on a worker; its stdio is
   * bridged back over the worker's message port.
   */
  spawn(
    options: SpawnOptions,
    hooks: OffThreadSpawnHooks = {},
  ): PtahSpawnedProcess {
    if (process.env[INLINE_SPAWN_ENV_KEY] === '1') {
      this.warnInlineOnce(`${INLINE_SPAWN_ENV_KEY}=1`);
      return this.spawnInline(options, hooks);
    }

    try {
      const spawned = new WorkerBackedProcess(
        options,
        hooks,
        (target, termination) => this.onTerminate(target, termination),
      );
      this.live.add(spawned);
      return spawned;
    } catch (error: unknown) {
      this.warnInlineOnce(
        error instanceof Error ? error.message : String(error),
      );
      return this.spawnInline(options, hooks);
    }
  }

  /**
   * Terminate every worker still running and resolve once all threads are gone.
   *
   * Nothing in production calls this — each worker terminates itself when its
   * child exits — but a host shutting down, and every spec, needs a join point
   * that proves no thread is left behind.
   */
  async dispose(): Promise<void> {
    for (const target of [...this.live]) target.forceTerminate();
    this.live.clear();
    await Promise.all([...this.terminations]);
  }

  private onTerminate(
    target: WorkerBackedProcess,
    termination: Promise<void>,
  ): void {
    this.live.delete(target);
    this.terminations.add(termination);
    void termination.then(() => {
      this.terminations.delete(termination);
    });
  }

  private warnInlineOnce(reason: string): void {
    if (this.warnedInline) return;
    this.warnedInline = true;
    this.logger.warn(
      `${SERVICE_TAG} Falling back to inline spawn — query launch will block this thread`,
      { reason },
    );
  }

  private spawnInline(
    options: SpawnOptions,
    hooks: OffThreadSpawnHooks,
  ): PtahSpawnedProcess {
    const child = childProcess.spawn(options.command, options.args, {
      cwd: options.cwd,
      env: stripUndefinedEnv(options.env),
      stdio: ['pipe', 'pipe', hooks.onStderr ? 'pipe' : 'ignore'],
      signal: options.signal,
      windowsHide: true,
    });

    const onStderr = hooks.onStderr;
    if (onStderr && child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        onStderr(data.toString('utf8'));
      });
    }

    return new InlineProcess(child);
  }
}
