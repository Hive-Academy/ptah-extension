/**
 * Host-side client of the tree-sitter worker process.
 *
 * Every parse and query runs in the worker, so web-tree-sitter's synchronous
 * WASM work (one query on a large file took over a second in Electron CPU
 * profiles) never blocks the host thread. The client keeps the parser's
 * `Result` contract:
 *
 * - one request is in flight at a time (the worker is one thread anyway), so
 *   the per-request run timeout measures the request, not its wait in line;
 * - waiting requests sit in two lanes ({@link DeadlineQueue}): foreground
 *   (interactive, the default) is always sent before background (bulk
 *   indexing). Each lane has its own capacity, so a background burst cannot
 *   refuse foreground work, and its own wait deadline measured from enqueue;
 *   a request that waits past it is answered with an error and never sent;
 * - a timeout kills and later respawns the worker; an exit fails the request
 *   in flight. Neither ever leaves a caller waiting;
 * - after `maxConsecutiveFailures` crashes or timeouts in a row every request
 *   fails fast for `failureCooldownMs`, then the next one respawns the worker.
 *
 * Client-side failures are `TreeSitterWorkerUnavailableError`, a
 * `grammar-unavailable` parser refusal: the source was not analysed because
 * the parser was unavailable, not because the source failed to parse.
 */
import { Result } from '@ptah-extension/shared';
import type { GenericAstNode, SupportedLanguage } from '../ast.types';
import { ParserRefusalError } from '../parser-refusal';
import type {
  QueryMatch,
  QueryResults,
  TreeSitterLogger,
} from '../tree-sitter-engine';
import type {
  TreeSitterPriority,
  TreeSitterRequestOptions,
} from '../tree-sitter-request-options';
import { DeadlineQueue, type LaneLimits } from './tree-sitter-worker-queue';
import type {
  ITreeSitterWorkerFactory,
  ITreeSitterWorkerProcess,
} from './tree-sitter-worker.port';
import {
  rebuildParserError,
  treeSitterWorkerLogSchema,
  treeSitterWorkerResultEnvelopeSchema,
  treeSitterWorkerResultSchema,
  type TreeSitterWorkerJob,
  type TreeSitterWorkerLog,
  type TreeSitterWorkerRequest,
  type TreeSitterWorkerValue,
} from './tree-sitter-worker.protocol';

export const TREE_SITTER_WORKER_DEFAULTS = {
  foreground: { maxQueued: 256, maxWaitMs: 10_000 },
  background: { maxQueued: 512, maxWaitMs: 60_000 },
  requestTimeoutMs: 30_000,
  maxConsecutiveFailures: 3,
  failureCooldownMs: 60_000,
} as const;

export interface TreeSitterWorkerClientOptions {
  readonly foreground?: Partial<LaneLimits>;
  readonly background?: Partial<LaneLimits>;
  /** Longest one sent request may run before the worker is restarted. */
  readonly requestTimeoutMs?: number;
  readonly maxConsecutiveFailures?: number;
  readonly failureCooldownMs?: number;
  /** Clock seam for the cooldown and the queue deadlines. */
  readonly now?: () => number;
}

const LOG_PREFIX = '[tree-sitter-worker]';

/** The worker could not answer: queue full, crash, timeout or cooldown. */
export class TreeSitterWorkerUnavailableError extends ParserRefusalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('grammar-unavailable', message, options);
    this.name = 'TreeSitterWorkerUnavailableError';
  }
}

type Outcome = Result<TreeSitterWorkerValue, Error>;

interface PendingRequest {
  readonly request: TreeSitterWorkerRequest;
  readonly settle: (outcome: Outcome) => void;
}

interface InFlightRequest {
  readonly pending: PendingRequest;
  readonly child: ITreeSitterWorkerProcess;
  readonly timer: ReturnType<typeof setTimeout>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function describe(request: TreeSitterWorkerRequest): string {
  return `${request.op} (${request.language})`;
}

export class TreeSitterWorkerClient {
  private child: ITreeSitterWorkerProcess | null = null;
  private readonly queue: DeadlineQueue<PendingRequest>;
  private inFlight: InFlightRequest | null = null;
  private nextId = 0;
  private consecutiveFailures = 0;
  private unavailableUntil = 0;
  private readonly requestTimeoutMs: number;
  private readonly maxConsecutiveFailures: number;
  private readonly failureCooldownMs: number;
  private readonly now: () => number;

  constructor(
    private readonly factory: ITreeSitterWorkerFactory,
    private readonly logger: TreeSitterLogger,
    options: TreeSitterWorkerClientOptions = {},
  ) {
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? TREE_SITTER_WORKER_DEFAULTS.requestTimeoutMs;
    this.maxConsecutiveFailures =
      options.maxConsecutiveFailures ??
      TREE_SITTER_WORKER_DEFAULTS.maxConsecutiveFailures;
    this.failureCooldownMs =
      options.failureCooldownMs ?? TREE_SITTER_WORKER_DEFAULTS.failureCooldownMs;
    this.now = options.now ?? Date.now;
    const defaults = TREE_SITTER_WORKER_DEFAULTS;
    this.queue = new DeadlineQueue<PendingRequest>(
      {
        foreground: { ...defaults.foreground, ...options.foreground },
        background: { ...defaults.background, ...options.background },
      },
      this.now,
      (pending, priority, waitedMs) => this.onExpired(pending, priority, waitedMs),
    );
  }

  /**
   * Milliseconds left in the fail-fast cooldown after repeated worker
   * failures; 0 when requests are accepted. The parser reports it as its
   * runtime status, so bulk callers skip and retry instead of failing files.
   */
  unavailableForMs(): number {
    return Math.max(0, this.unavailableUntil - this.now());
  }

  async queryMulti(
    content: string,
    language: SupportedLanguage,
    queries: { key: string; queryString: string }[],
    options?: TreeSitterRequestOptions,
  ): Promise<Result<QueryResults, Error>> {
    const outcome = await this.run(
      { op: 'queryMulti', content, language, queries },
      options,
    );
    const value = outcome.value;
    if (!value) return Result.err(this.errorOf(outcome));
    if (value.op !== 'queryMulti') return Result.err(this.mismatch('queryMulti', value));
    return Result.ok(
      Object.assign(new Map<string, QueryMatch[]>(value.entries), value.quality),
    );
  }

  async query(
    content: string,
    language: SupportedLanguage,
    queryString: string,
    options?: TreeSitterRequestOptions,
  ): Promise<Result<QueryMatch[], Error>> {
    const outcome = await this.run(
      { op: 'query', content, language, queryString },
      options,
    );
    const value = outcome.value;
    if (!value) return Result.err(this.errorOf(outcome));
    if (value.op !== 'query') return Result.err(this.mismatch('query', value));
    return Result.ok(value.matches);
  }

  async parse(
    content: string,
    language: SupportedLanguage,
    options?: TreeSitterRequestOptions,
  ): Promise<Result<GenericAstNode, Error>> {
    const outcome = await this.run({ op: 'parse', content, language }, options);
    const value = outcome.value;
    if (!value) return Result.err(this.errorOf(outcome));
    if (value.op !== 'parse') return Result.err(this.mismatch('parse', value));
    return Result.ok(value.ast);
  }

  /**
   * Kill the worker and fail every waiting request. A later request starts
   * a new worker.
   */
  terminate(): void {
    const error = new TreeSitterWorkerUnavailableError(
      'The tree-sitter worker was terminated',
    );
    const inFlight = this.inFlight;
    if (inFlight) {
      this.finish(inFlight);
      inFlight.pending.settle(Result.err(error));
    }
    this.failQueued(error);
    this.discardProcess();
  }

  private run(
    job: TreeSitterWorkerJob,
    options: TreeSitterRequestOptions | undefined,
  ): Promise<Outcome> {
    const unavailable = this.unavailableError();
    if (unavailable) return Promise.resolve(Result.err(unavailable));
    const priority: TreeSitterPriority = options?.priority ?? 'foreground';
    const request: TreeSitterWorkerRequest = {
      ...job,
      kind: 'request',
      id: this.nextId++,
    };
    return new Promise<Outcome>((resolve) => {
      if (!this.queue.push({ request, settle: resolve }, priority)) {
        resolve(
          Result.err(
            new TreeSitterWorkerUnavailableError(
              `The tree-sitter worker ${priority} queue is full; ${describe(request)} was not run`,
            ),
          ),
        );
        return;
      }
      this.pump();
    });
  }

  /** A request that waited past its lane's deadline: answered, never sent. */
  private onExpired(
    pending: PendingRequest,
    priority: TreeSitterPriority,
    waitedMs: number,
  ): void {
    pending.settle(
      Result.err(
        new TreeSitterWorkerUnavailableError(
          `${describe(pending.request)} waited ${waitedMs} ms in the tree-sitter worker ${priority} queue and was not run`,
        ),
      ),
    );
  }

  /** Send the next waiting request when none is in flight. */
  private pump(): void {
    while (!this.inFlight && this.queue.size > 0) {
      const unavailable = this.unavailableError();
      if (unavailable) {
        this.failQueued(unavailable);
        return;
      }
      const next = this.queue.shift();
      if (!next) return;
      let child: ITreeSitterWorkerProcess;
      try {
        child = this.ensureProcess();
        child.postMessage(next.request);
      } catch (error: unknown) {
        const cause = toError(error);
        this.logger.error(
          `${LOG_PREFIX} could not start the worker or send ${describe(next.request)}`,
          cause,
        );
        next.settle(
          Result.err(
            new TreeSitterWorkerUnavailableError(
              `The tree-sitter worker could not run ${describe(next.request)}: ${cause.message}`,
              { cause },
            ),
          ),
        );
        this.discardProcess();
        this.recordFailure();
        continue;
      }
      const timer = setTimeout(
        () => this.onTimeout(next),
        this.requestTimeoutMs,
      );
      this.inFlight = { pending: next, child, timer };
    }
  }

  private ensureProcess(): ITreeSitterWorkerProcess {
    if (this.child) return this.child;
    const child = this.factory.spawn();
    child.on('message', (message) => this.onMessage(child, message));
    child.on('exit', (code) => this.onExit(child, code));
    this.child = child;
    return child;
  }

  private onMessage(child: ITreeSitterWorkerProcess, raw: unknown): void {
    // A discarded worker is already killed; nothing it still says is wanted.
    if (child !== this.child) return;
    const log = treeSitterWorkerLogSchema.safeParse(raw);
    if (log.success) {
      this.forwardLog(log.data);
      return;
    }
    const envelope = treeSitterWorkerResultEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      this.logger.warn(`${LOG_PREFIX} dropped a message of unknown shape`, {
        issue: envelope.error.message,
      });
      return;
    }
    const inFlight = this.inFlight;
    if (!inFlight || inFlight.pending.request.id !== envelope.data.id) {
      this.logger.warn(`${LOG_PREFIX} dropped a reply for no request in flight`, {
        id: envelope.data.id,
      });
      return;
    }
    this.finish(inFlight);
    const request = inFlight.pending.request;
    const result = treeSitterWorkerResultSchema.safeParse(raw);
    if (!result.success) {
      const error = new Error(
        `The tree-sitter worker sent an invalid reply to ${describe(request)}: ${result.error.message}`,
      );
      this.logger.error(`${LOG_PREFIX} invalid reply`, error);
      inFlight.pending.settle(Result.err(error));
    } else {
      this.consecutiveFailures = 0;
      inFlight.pending.settle(
        result.data.ok
          ? Result.ok(result.data.value)
          : Result.err(rebuildParserError(result.data.error)),
      );
    }
    this.pump();
  }

  private onExit(child: ITreeSitterWorkerProcess, code: number | null): void {
    // A discarded child was killed on purpose; only the live one's exit matters.
    const wasLive = child === this.child;
    if (wasLive) this.child = null;
    const inFlight = this.inFlight;
    if (!inFlight || inFlight.child !== child) {
      if (wasLive) {
        this.logger.warn(`${LOG_PREFIX} worker exited while idle`, { code });
      }
      return;
    }
    this.finish(inFlight);
    const error = new TreeSitterWorkerUnavailableError(
      `The tree-sitter worker exited (code ${code ?? 'null'}) during ${describe(inFlight.pending.request)}`,
    );
    this.logger.error(`${LOG_PREFIX} worker exited with a request in flight`, error);
    inFlight.pending.settle(Result.err(error));
    this.recordFailure();
    this.pump();
  }

  private onTimeout(pending: PendingRequest): void {
    const inFlight = this.inFlight;
    if (!inFlight || inFlight.pending !== pending) return;
    this.finish(inFlight);
    const error = new TreeSitterWorkerUnavailableError(
      `The tree-sitter worker did not answer ${describe(pending.request)} within ${this.requestTimeoutMs} ms; it was restarted`,
    );
    this.logger.error(`${LOG_PREFIX} request timed out`, error);
    pending.settle(Result.err(error));
    this.discardProcess();
    this.recordFailure();
    this.pump();
  }

  private finish(inFlight: InFlightRequest): void {
    clearTimeout(inFlight.timer);
    if (this.inFlight === inFlight) this.inFlight = null;
  }

  private discardProcess(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.kill();
    } catch (error: unknown) {
      // The handle is already dropped; a failed kill means the child is gone.
      this.logger.warn(`${LOG_PREFIX} kill failed`, {
        error: toError(error).message,
      });
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures < this.maxConsecutiveFailures) return;
    this.consecutiveFailures = 0;
    this.unavailableUntil = this.now() + this.failureCooldownMs;
    this.logger.warn(
      `${LOG_PREFIX} ${this.maxConsecutiveFailures} consecutive failures; requests fail for ${this.failureCooldownMs} ms`,
    );
  }

  private unavailableError(): TreeSitterWorkerUnavailableError | null {
    const remaining = this.unavailableForMs();
    return remaining > 0
      ? new TreeSitterWorkerUnavailableError(
          `The tree-sitter worker is unavailable for ${remaining} ms after repeated failures`,
        )
      : null;
  }

  private failQueued(error: Error): void {
    for (const pending of this.queue.drain()) {
      pending.settle(Result.err(error));
    }
  }

  private forwardLog(log: TreeSitterWorkerLog): void {
    const text = `${LOG_PREFIX} ${log.message}`;
    switch (log.level) {
      case 'debug':
        this.logger.debug(text);
        return;
      case 'info':
        this.logger.info(text);
        return;
      case 'warn':
        this.logger.warn(text);
        return;
      case 'error':
        this.logger.error(
          text,
          log.error ? rebuildParserError(log.error) : undefined,
        );
        return;
    }
  }

  private errorOf(outcome: Outcome): Error {
    return outcome.error ?? new Error('The tree-sitter worker returned no value');
  }

  private mismatch(expected: string, value: TreeSitterWorkerValue): Error {
    return new Error(
      `The tree-sitter worker answered ${value.op} to a ${expected} request`,
    );
  }
}
