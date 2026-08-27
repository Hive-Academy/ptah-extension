import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '../di/tokens';
import { SdkQueryRunner } from '../helpers/sdk-query-runner.service';
import { InternalQueryQueueTimeoutError } from '../errors/internal-query-queue-timeout.error';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './internal-query.types';

const SERVICE_TAG = '[InternalQueryService]';

const CONCURRENCY_SECTION = 'ptah';

/** `ptah.internalQuery.maxConcurrent` — see {@link DEFAULT_MAX_CONCURRENT}. */
export const INTERNAL_QUERY_CONCURRENCY_KEY = 'internalQuery.maxConcurrent';

/** `ptah.internalQuery.queueTimeoutMs` — see {@link DEFAULT_QUEUE_TIMEOUT_MS}. */
export const INTERNAL_QUERY_QUEUE_TIMEOUT_KEY = 'internalQuery.queueTimeoutMs';

/**
 * How many one-shot queries may be in flight at once, across every caller.
 *
 * One, deliberately. Each one-shot query spawns a real `claude` subprocess,
 * and the in-flight bookkeeping every caller keeps is PER SESSION — the memory
 * curator's `inFlightCurates`, skill-synthesis's lane map — so nothing above
 * this service counted them globally. Its rate limiter is per HOUR, not per
 * concurrent call. Three chatty sessions crossing their turn thresholds
 * together therefore spawned three subprocesses at once, each fanning hook
 * callbacks back onto the one thread that also owns every `BrowserWindow`
 * (TASK_2026_323, blocker B6).
 */
export const DEFAULT_MAX_CONCURRENT = 1;

/**
 * How long a one-shot query may wait for a concurrency slot before
 * `execute()` rejects with `InternalQueryQueueTimeoutError`.
 *
 * The gate serializes subprocesses host-wide, so a caller queued behind a
 * long query would otherwise block indefinitely. This ceiling is the bound:
 * a waiter that does not reach the front within this window is removed from
 * the queue and rejected, leaving the gate consistent for the next waiter.
 */
export const DEFAULT_QUEUE_TIMEOUT_MS = 60_000;

/** Thrown to a waiter whose `AbortSignal` fires before it reaches the front. */
function abortError(): Error {
  const error = new Error('Internal query aborted while waiting for a slot.');
  error.name = 'AbortError';
  return error;
}

interface Waiter {
  settled: boolean;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  detach: () => void;
}

/**
 * FIFO concurrency gate.
 *
 * Separate from {@link InternalQueryService} so the queueing can be exercised
 * without an SDK, and so the "one gate for the whole host" property is a
 * property of ONE object rather than of a scattering of counters. The service
 * holds exactly one instance and is registered `Lifecycle.Singleton`
 * (`di/register.ts`), which is what makes the limit host-wide.
 */
export class InternalQueryConcurrencyGate {
  private active = 0;
  private limit = DEFAULT_MAX_CONCURRENT;
  private readonly waiters: Waiter[] = [];

  /** Callers currently queued behind the limit. */
  get queued(): number {
    return this.waiters.length;
  }

  /** Callers currently holding a slot. */
  get inFlight(): number {
    return this.active;
  }

  /**
   * Take a slot, waiting in FIFO order when the limit is reached.
   *
   * @param limit  read fresh on every call, so a settings change takes effect
   *               without a restart. Also becomes the limit {@link release}
   *               drains against.
   * @param signal aborting while queued removes the waiter and rejects with an
   *               `AbortError`. A waiter that already holds a slot is NOT
   *               affected — the caller's own abort controller reaches the SDK
   *               query directly, and the slot is released when its stream ends.
   * @param queueTimeoutMs  ceiling on how long the waiter may stay queued. When
   *               it elapses the waiter is removed from the queue and rejected
   *               with `InternalQueryQueueTimeoutError` — no slot leaks and the
   *               next waiter is woken. Defaults to
   *               {@link DEFAULT_QUEUE_TIMEOUT_MS}.
   * @returns an idempotent release function.
   */
  acquire(
    limit: number,
    signal?: AbortSignal,
    queueTimeoutMs?: number,
  ): Promise<() => void> {
    this.limit =
      Number.isFinite(limit) && limit >= 1
        ? Math.floor(limit)
        : DEFAULT_MAX_CONCURRENT;

    if (signal?.aborted) return Promise.reject(abortError());

    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(this.makeRelease());
    }

    const effectiveTimeoutMs =
      Number.isFinite(queueTimeoutMs) && (queueTimeoutMs as number) > 0
        ? Math.floor(queueTimeoutMs as number)
        : DEFAULT_QUEUE_TIMEOUT_MS;

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        settled: false,
        resolve,
        reject,
        detach: () => undefined,
      };
      const timeoutId: ReturnType<typeof setTimeout> = setTimeout(
        () =>
          settleReject(new InternalQueryQueueTimeoutError(effectiveTimeoutMs)),
        effectiveTimeoutMs,
      );
      // The ceiling must not keep the host alive: a waiter queued at shutdown
      // should not pin the event loop. unref lets the timer fire only while the
      // loop is otherwise alive (the normal case), and drops it on exit.
      (timeoutId as { unref?: () => void }).unref?.();
      let removeAbort: (() => void) | undefined;

      const removeFromQueue = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };

      // detach clears BOTH the abort listener and the queue timeout. It is
      // called by drain() when the waiter reaches the front, and by
      // settleReject when the waiter leaves the queue via abort or timeout —
      // so a settled waiter never leaves a dangling timer or listener behind.
      waiter.detach = () => {
        if (removeAbort) removeAbort();
        clearTimeout(timeoutId);
      };

      const settleReject = (error: Error): void => {
        if (waiter.settled) return;
        waiter.settled = true;
        removeFromQueue();
        waiter.detach();
        reject(error);
      };

      if (signal) {
        const onAbort = (): void => settleReject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => signal.removeEventListener('abort', onAbort);
      }

      this.waiters.push(waiter);
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }

  private drain(): void {
    while (this.waiters.length > 0 && this.active < this.limit) {
      const waiter = this.waiters.shift();
      if (!waiter || waiter.settled) continue;
      waiter.settled = true;
      waiter.detach();
      this.active++;
      waiter.resolve(this.makeRelease());
    }
  }
}

@injectable()
export class InternalQueryService {
  private readonly gate = new InternalQueryConcurrencyGate();

  constructor(
    @inject(SDK_TOKENS.SDK_QUERY_RUNNER)
    private readonly runner: SdkQueryRunner,
    @inject(TOKENS.LOGGER, { isOptional: true })
    private readonly logger: Logger | null = null,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace: IWorkspaceProvider | null = null,
  ) {}

  /**
   * Whether this host initialized the SDK at all.
   *
   * Headless callers (`skill-synthesis`'s lane runner, the memory curator) get
   * registered this service on EVERY host, including the CLI's
   * `withEngine({ requireSdk: false })` boots where `initialize()` never runs.
   * Resolving the DI token therefore does not mean an LLM is reachable, and
   * `execute` would throw `SdkError` on every call. This is the question those
   * callers actually need answered before they spend an attempt.
   */
  isInitialized(): boolean {
    return this.runner.isInitialized();
  }

  /**
   * Run a one-shot query, waiting for a concurrency slot first.
   *
   * The slot is held for the LIFETIME of the query, not just the launch: it is
   * released when the returned stream finishes, is broken out of, or throws, and
   * also by `close()` / `abort()`. Releasing at launch would gate nothing —
   * `runOneShot` returns as soon as the SDK hands back a conversation handle,
   * long before the subprocess has done any work.
   *
   * A caller that neither iterates the stream nor closes the handle holds its
   * slot indefinitely. Every caller in this repo iterates to the `result`
   * message; the guarantee is documented rather than defended because a timeout
   * here would abort real work whose only fault was being slow.
   */
  async execute(config: InternalQueryConfig): Promise<InternalQueryHandle> {
    const release = await this.acquireSlot(config);

    let handle: InternalQueryHandle;
    try {
      handle = await this.runner.runOneShot({
        mode: 'oneShot',
        cwd: config.cwd,
        model: config.model,
        prompt: config.prompt,
        systemPromptAppend: config.systemPromptAppend,
        mcpServerRunning: config.mcpServerRunning,
        mcpPort: config.mcpPort,
        maxTurns: config.maxTurns,
        outputFormat: config.outputFormat,
        abortController: config.abortController,
        auth: config.auth,
      });
    } catch (error: unknown) {
      release();
      throw error;
    }

    return this.holdSlotUntilDone(handle, release);
  }

  private async acquireSlot(config: InternalQueryConfig): Promise<() => void> {
    const limit = this.readMaxConcurrent();
    const queueTimeoutMs = this.resolveQueueTimeoutMs(config);
    if (this.gate.inFlight >= limit) {
      this.logger?.debug(
        `${SERVICE_TAG} one-shot query waiting for a concurrency slot`,
        {
          limit,
          inFlight: this.gate.inFlight,
          queued: this.gate.queued,
          model: config.model,
        },
      );
    }
    return this.gate.acquire(
      limit,
      config.abortController?.signal,
      queueTimeoutMs,
    );
  }

  private holdSlotUntilDone(
    handle: InternalQueryHandle,
    release: () => void,
  ): InternalQueryHandle {
    const source = handle.stream;
    async function* guarded(): AsyncGenerator<SDKMessage> {
      try {
        yield* source;
      } finally {
        // Runs on normal completion, on `throw`, AND on the `return()` that
        // `for await (…) { break }` performs — which is how every consumer in
        // this repo leaves the loop once it sees the `result` message.
        release();
      }
    }

    return {
      stream: guarded(),
      abort: () => {
        try {
          handle.abort();
        } finally {
          release();
        }
      },
      close: () => {
        try {
          handle.close();
        } finally {
          release();
        }
      },
    };
  }

  private readMaxConcurrent(): number {
    if (!this.workspace) return DEFAULT_MAX_CONCURRENT;
    try {
      const value = this.workspace.getConfiguration<number>(
        CONCURRENCY_SECTION,
        INTERNAL_QUERY_CONCURRENCY_KEY,
        DEFAULT_MAX_CONCURRENT,
      );
      return typeof value === 'number' && Number.isFinite(value) && value >= 1
        ? Math.floor(value)
        : DEFAULT_MAX_CONCURRENT;
    } catch (error: unknown) {
      this.logger?.warn(
        `${SERVICE_TAG} could not read ${INTERNAL_QUERY_CONCURRENCY_KEY}; using the default`,
        {
          error: error instanceof Error ? error.message : String(error),
          fallback: DEFAULT_MAX_CONCURRENT,
        },
      );
      return DEFAULT_MAX_CONCURRENT;
    }
  }

  private resolveQueueTimeoutMs(config: InternalQueryConfig): number {
    if (config.queueTimeoutMs !== undefined) {
      return Number.isFinite(config.queueTimeoutMs) && config.queueTimeoutMs > 0
        ? Math.floor(config.queueTimeoutMs)
        : DEFAULT_QUEUE_TIMEOUT_MS;
    }
    if (!this.workspace) return DEFAULT_QUEUE_TIMEOUT_MS;
    try {
      const value = this.workspace.getConfiguration<number>(
        CONCURRENCY_SECTION,
        INTERNAL_QUERY_QUEUE_TIMEOUT_KEY,
        DEFAULT_QUEUE_TIMEOUT_MS,
      );
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : DEFAULT_QUEUE_TIMEOUT_MS;
    } catch (error: unknown) {
      this.logger?.warn(
        `${SERVICE_TAG} could not read ${INTERNAL_QUERY_QUEUE_TIMEOUT_KEY}; using the default`,
        {
          error: error instanceof Error ? error.message : String(error),
          fallback: DEFAULT_QUEUE_TIMEOUT_MS,
        },
      );
      return DEFAULT_QUEUE_TIMEOUT_MS;
    }
  }
}
