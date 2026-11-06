/**
 * Host-side coordinator for the SQLite search utility process.
 *
 * Electron-independent: the host supplies an `ISearchWorkerFactory`. Every
 * request resolves; a stalled, crashed or saturated worker yields the empty
 * ("degraded") result for that request kind instead of an error.
 *
 * - Every message from the worker is parsed with `searchWorkerOutboundSchema`,
 *   and every result with the schema of the request kind it answers. A row
 *   that fails its schema is dropped and logged; the rest of the page stays.
 * - At most `maxInFlight` requests are owed by the worker at once; the rest
 *   wait host-side, so a request's `timeoutMs` runs from its dispatch, not
 *   from time spent queued behind others in the single-threaded worker. A
 *   queued request waits at most `queueTimeoutMs` for its turn, so a caller
 *   waits at most `queueTimeoutMs + timeoutMs` (10 s by default).
 * - A timeout degrades only that request. The process is killed (every pending
 *   request degrades, exponential backoff capped at 30 s) only when it is
 *   unresponsive: it owes answers and has sent no message of any kind for
 *   `livenessMs`. A process exit, a failed init or a failed send also kill it.
 *   While backing off, requests resolve degraded at once; nothing is queued.
 * - At most `maxPending` requests are queued or in flight; more resolve degraded.
 * - Forking the worker also warms the host embedder, so the first vector
 *   search does not pay the model load inside its budget.
 * - `dispose()` kills the process, stops respawns and waits (bounded) for the
 *   exit, so the host can close SQLite after the reader is gone (app quit).
 */
import type { z } from 'zod';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import type { CodeSymbolHitPage, MemoryListPage } from '@ptah-extension/memory-contracts';
import type { MemoryChunk, MemorySearchResponse } from './memory.types';
import type { CodeSymbolSearchParams, CodeSymbolSearchResult } from './code-symbol.store';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';
import type { ISearchWorkerFactory, ISearchWorkerProcess, ISqliteSearchWorker } from './search-worker.port';
import {
  createSearchWorkerResultSchemas,
  searchWorkerOutboundSchema,
  searchWorkerQuerySchema,
  type DroppedRowsReport,
  type SearchWorkerInbound,
  type SearchWorkerOutbound,
  type SearchWorkerQuery,
  type SearchWorkerResultSchemas,
} from './search-worker.protocol';
import { rebuildWorkerError } from './search-worker-error';
import type { CuratorLogger } from './sqlite-reader-deps.types';

const LOG_PREFIX = '[sqlite-search-worker]';
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 30_000;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type QueryBody = DistributiveOmit<SearchWorkerQuery, 'id'>;

interface PendingRequest {
  readonly message: SearchWorkerQuery;
  /** Queue-wait timer until dispatch, then the run timer. */
  timer: ReturnType<typeof setTimeout>;
  dispatched: boolean;
  /** Resolve with a raw worker result; degrades when it fails its schema. */
  readonly settle: (raw: unknown) => void;
  /** Resolve with the empty result for this request kind. */
  readonly degrade: () => void;
}

export interface SearchWorkerClientOptions {
  /** Budget from dispatch to the worker's answer. Default 5 000 ms. */
  readonly timeoutMs?: number;
  /** Budget for waiting host-side for a dispatch slot. Default `timeoutMs`. */
  readonly queueTimeoutMs?: number;
  /** Requests queued or in flight at once. Default 32. */
  readonly maxPending?: number;
  /** Requests the worker may owe at once; the rest wait host-side. Default 4. */
  readonly maxInFlight?: number;
  /** Silence, while the worker owes answers, that marks it unresponsive. Default 10 000 ms. */
  readonly livenessMs?: number;
  /** How long `dispose()` waits for the process to exit. Default 2 000 ms. */
  readonly exitWaitMs?: number;
}

export class SearchWorkerClient implements ISqliteSearchWorker {
  private process: ISearchWorkerProcess | null = null;
  /** Settles when the current (or last) process exits. */
  private processExited: Promise<void> = Promise.resolve();
  private readonly pending = new Map<number, PendingRequest>();
  /** Ids waiting host-side for a dispatch slot, oldest first. */
  private readonly queue: number[] = [];
  /** Ids posted to the current process that it has not answered yet (timed out or not). */
  private readonly owed = new Set<number>();
  private lastActivityAt = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private failures = 0;
  private retryAfter = 0;
  private saturated = false;
  private disposed = false;
  private readonly timeoutMs: number;
  private readonly queueTimeoutMs: number;
  private readonly maxPending: number;
  private readonly maxInFlight: number;
  private readonly livenessMs: number;
  private readonly exitWaitMs: number;
  private readonly reranker: EmbedderWorkerClient | null;
  private readonly schemas: SearchWorkerResultSchemas;

  constructor(
    private readonly factory: ISearchWorkerFactory,
    private readonly embedder: IEmbedder,
    private readonly logger: CuratorLogger,
    options: SearchWorkerClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.queueTimeoutMs = options.queueTimeoutMs ?? this.timeoutMs;
    this.maxPending = options.maxPending ?? 32;
    this.maxInFlight = Math.max(1, options.maxInFlight ?? 4);
    this.livenessMs = options.livenessMs ?? 10_000;
    this.exitWaitMs = options.exitWaitMs ?? 2_000;
    this.reranker = embedder instanceof EmbedderWorkerClient ? embedder : null;
    this.schemas = createSearchWorkerResultSchemas((report) => this.reportDroppedRows(report));
  }

  searchMemory(query: string, topK: number, workspaceRoot?: string | null): Promise<MemorySearchResponse> {
    return this.request(
      { kind: 'memory', query, topK: clampTopK(topK), workspaceRoot },
      this.schemas.memory,
      { hits: [], bm25Only: true },
    );
  }

  searchSymbols(query: string, topK: number, workspaceRoot?: string): Promise<CodeSymbolHitPage> {
    return this.request(
      { kind: 'symbols', query, topK: clampTopK(topK), workspaceRoot },
      this.schemas.symbols,
      { hits: [], bm25Only: true },
    );
  }

  searchSymbolPage(params: CodeSymbolSearchParams): Promise<CodeSymbolSearchResult> {
    return this.request(
      { kind: 'symbol-page', params: { ...params, kinds: params.kinds ? [...params.kinds] : undefined } },
      this.schemas['symbol-page'],
      { items: [], total: 0 },
    );
  }

  listMemories(workspaceRoot: string, limit: number): Promise<MemoryListPage> {
    return this.request(
      { kind: 'list', workspaceRoot, limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 20 },
      this.schemas.list,
      { memories: [], total: 0 },
    );
  }

  getChunks(memoryId: string): Promise<readonly MemoryChunk[]> {
    return this.request({ kind: 'chunks', memoryId }, this.schemas.chunks, []);
  }

  /**
   * Kill the worker and stop respawning. Pending requests resolve degraded.
   * Resolves once the process has exited, or after `exitWaitMs`. Idempotent.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    const child = this.process;
    if (!child) return;
    const exited = this.processExited;
    this.resetProcess(child, false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(`${LOG_PREFIX} process did not exit after kill`, { waitedMs: this.exitWaitMs });
        resolve();
      }, this.exitWaitMs);
      timer.unref?.();
    });
    try {
      await Promise.race([exited, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private request<T>(body: QueryBody, schema: z.ZodType<T>, empty: T): Promise<T> {
    if (this.disposed || Date.now() < this.retryAfter) return Promise.resolve(empty);
    if (this.pending.size >= this.maxPending) {
      if (!this.saturated) {
        this.saturated = true;
        this.logger.warn(`${LOG_PREFIX} too many requests in flight; answering degraded`, {
          maxPending: this.maxPending,
        });
      }
      return Promise.resolve(empty);
    }
    this.saturated = false;
    // Validated before it leaves: the worker drops a message it cannot parse,
    // which would otherwise surface only as a timeout.
    const id = this.nextId++;
    const checked = searchWorkerQuerySchema.safeParse({ ...body, id });
    if (!checked.success) {
      this.logger.warn(`${LOG_PREFIX} request rejected before send; answering degraded`, {
        kind: body.kind,
        issue: checked.error.issues[0]?.message,
      });
      return Promise.resolve(empty);
    }
    const message: SearchWorkerQuery = checked.data;
    if (!this.ensureProcess()) return Promise.resolve(empty);
    return new Promise<T>((resolve) => {
      this.pending.set(id, {
        message,
        timer: setTimeout(() => this.onTimeout(id), this.queueTimeoutMs),
        dispatched: false,
        degrade: () => resolve(empty),
        settle: (raw) => {
          const parsed = schema.safeParse(raw);
          if (parsed.success) {
            this.failures = 0;
            resolve(parsed.data);
            return;
          }
          this.logger.warn(`${LOG_PREFIX} result failed validation; answering degraded`, {
            kind: body.kind,
            issue: parsed.error.issues[0]?.message,
            path: parsed.error.issues[0]?.path.map(String).join('.'),
          });
          resolve(empty);
        },
      });
      this.queue.push(id);
      this.pump();
    });
  }

  /** Dispatch queued requests while the worker owes fewer than `maxInFlight`. */
  private pump(): void {
    while (this.process && this.owed.size < this.maxInFlight) {
      const id = this.queue.shift();
      if (id === undefined) return;
      const slot = this.pending.get(id);
      if (slot) this.dispatch(this.process, id, slot);
    }
  }

  private dispatch(child: ISearchWorkerProcess, id: number, slot: PendingRequest): void {
    clearTimeout(slot.timer);
    slot.timer = setTimeout(() => this.onTimeout(id), this.timeoutMs);
    slot.dispatched = true;
    // The silence clock starts when the worker begins owing an answer.
    if (this.owed.size === 0) this.lastActivityAt = Date.now();
    this.owed.add(id);
    this.armWatchdog();
    try {
      child.postMessage(slot.message);
    } catch (error: unknown) {
      this.logger.warn(`${LOG_PREFIX} request send failed`, { error: errorMessage(error) });
      this.resetProcess(child, true);
    }
  }

  private ensureProcess(): ISearchWorkerProcess | null {
    if (this.process) return this.process;
    let child: ISearchWorkerProcess;
    let init: SearchWorkerInbound;
    let vecPath: string | undefined;
    try {
      const config = this.factory.databaseConfig();
      vecPath = config.vecPath;
      init = {
        kind: 'init',
        dbPath: config.dbPath,
        vecPath,
        embedderDim: this.embedder.dim,
        embedderModelId: this.embedder.modelId,
        rerankAvailable: this.reranker !== null,
      };
      child = this.factory.spawn();
    } catch (error: unknown) {
      // degradation-audit: reported - logged at warn; the request answers
      // degraded and the next spawn waits for the backoff.
      this.logger.warn(`${LOG_PREFIX} spawn failed`, { error: errorMessage(error) });
      this.backOff();
      return null;
    }
    this.process = child;
    let markExited: () => void = () => undefined;
    this.processExited = new Promise<void>((resolve) => {
      markExited = resolve;
    });
    child.on('message', (message) => this.handleMessage(child, message));
    child.on('exit', (code) => {
      markExited();
      if (child !== this.process) return;
      this.logger.warn(`${LOG_PREFIX} process exited`, { code });
      this.resetProcess(child, true);
    });
    try {
      // Electron queues this until the child's parent port is ready; it is
      // delivered before the request posted right after.
      child.postMessage(init);
    } catch (error: unknown) {
      // degradation-audit: reported - logged at warn; the process is reset and
      // the request answers degraded.
      this.logger.warn(`${LOG_PREFIX} init send failed`, { error: errorMessage(error) });
      this.resetProcess(child, true);
      return null;
    }
    if (vecPath) this.warmEmbedder();
    return child;
  }

  /**
   * Start the host embedder's model load while the worker boots, so the
   * worker's first embed call does not spend its budget on it. A failure here
   * resurfaces at warn on the search that needs the embedder.
   */
  private warmEmbedder(): void {
    this.embedder.embed(['warmup']).then(
      () => undefined,
      (error: unknown) =>
        this.logger.debug(`${LOG_PREFIX} embedder warm-up failed`, { error: errorMessage(error) }),
    );
  }

  private handleMessage(child: ISearchWorkerProcess, raw: unknown): void {
    if (child !== this.process) return;
    // Any message, even one that fails validation, proves the worker is alive.
    this.lastActivityAt = Date.now();
    const parsed = searchWorkerOutboundSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(`${LOG_PREFIX} rejected an invalid worker message`, {
        issue: parsed.error.issues[0]?.message,
      });
      return;
    }
    const message = parsed.data;
    switch (message.kind) {
      case 'ready':
        // Backoff resets on the first good result, not here: a worker that
        // starts but crashes on every query must keep backing off.
        this.logger.info(`${LOG_PREFIX} ready`, { vecLoaded: message.vecLoaded });
        return;
      case 'init-failed':
        this.logger.warn(`${LOG_PREFIX} init failed`, { error: message.message });
        this.resetProcess(child, true);
        return;
      case 'result':
        this.owed.delete(message.id);
        this.takePending(message.id)?.settle(message.result);
        this.pump();
        return;
      case 'error': {
        this.owed.delete(message.id);
        const slot = this.takePending(message.id);
        this.logger.warn(`${LOG_PREFIX} query failed; answering degraded`, { error: message.message });
        slot?.degrade();
        this.pump();
        return;
      }
      case 'log':
        this.forwardLog(message);
        return;
      case 'embed':
      case 'rerank':
        void this.answerHostCall(child, message);
        return;
    }
  }

  private forwardLog(message: Extract<SearchWorkerOutbound, { kind: 'log' }>): void {
    const text = `${LOG_PREFIX} ${message.message}`;
    // A logged Error is rebuilt with the worker's stack and cause chain, so the
    // host logger receives a real Error, as everywhere else in the host.
    const detail = message.error ? rebuildWorkerError(message.error) : message.context;
    const args: unknown[] = detail === undefined ? [] : [detail];
    switch (message.level) {
      case 'debug':
        this.logger.debug(text, ...args);
        return;
      case 'info':
        this.logger.info(text, ...args);
        return;
      case 'warn':
        this.logger.warn(text, ...args);
        return;
      case 'error':
        this.logger.error(text, detail);
        return;
    }
  }

  private reportDroppedRows(report: DroppedRowsReport): void {
    this.logger.warn(`${LOG_PREFIX} dropped result rows that failed validation`, {
      kind: report.kind,
      dropped: report.dropped,
      kept: report.kept,
      issue: report.issue,
      path: report.path,
    });
  }

  private async answerHostCall(
    child: ISearchWorkerProcess,
    message: Extract<SearchWorkerOutbound, { kind: 'embed' | 'rerank' }>,
  ): Promise<void> {
    let reply: SearchWorkerInbound;
    try {
      if (message.kind === 'embed') {
        const vectors = await this.embedder.embed(message.texts);
        reply = { kind: 'embed-result', id: message.id, vectors: vectors.map((v) => Array.from(v)) };
      } else if (this.reranker) {
        const ranked = await this.reranker.rerank(message.query, message.candidates, message.topK);
        reply = { kind: 'rerank-result', id: message.id, ranked: ranked.map((r) => ({ id: r.id, score: r.score })) };
      } else {
        reply = { kind: 'host-call-failed', id: message.id, message: 'reranker unavailable' };
      }
    } catch (error: unknown) {
      this.logger.warn(`${LOG_PREFIX} host ${message.kind} failed`, { error: errorMessage(error) });
      reply = { kind: 'host-call-failed', id: message.id, message: errorMessage(error) };
    }
    if (child !== this.process) return;
    try {
      child.postMessage(reply);
    } catch (error: unknown) {
      this.logger.warn(`${LOG_PREFIX} host reply send failed`, { error: errorMessage(error) });
    }
  }

  /** Degrade one request; the worker keeps running (liveness decides restarts). */
  private onTimeout(id: number): void {
    const slot = this.takePending(id);
    if (!slot) return;
    if (!slot.dispatched) {
      const queued = this.queue.indexOf(id);
      if (queued >= 0) this.queue.splice(queued, 1);
    }
    slot.degrade();
    this.logger.warn(`${LOG_PREFIX} request timed out; answering degraded`, {
      kind: slot.message.kind,
      phase: slot.dispatched ? 'running' : 'queued',
      timeoutMs: slot.dispatched ? this.timeoutMs : this.queueTimeoutMs,
      owed: this.owed.size,
      queued: this.queue.length,
    });
  }

  private armWatchdog(): void {
    if (this.watchdog !== null || !this.process) return;
    const wait = Math.max(0, this.lastActivityAt + this.livenessMs - Date.now());
    this.watchdog = setTimeout(() => this.checkLiveness(), wait);
    this.watchdog.unref?.();
  }

  /** Restart a worker that owes answers but has sent nothing for `livenessMs`. */
  private checkLiveness(): void {
    this.watchdog = null;
    const child = this.process;
    if (!child || this.owed.size === 0) return;
    const silentMs = Date.now() - this.lastActivityAt;
    if (silentMs < this.livenessMs) {
      this.armWatchdog();
      return;
    }
    this.logger.warn(`${LOG_PREFIX} worker unresponsive; restarting`, {
      silentMs,
      owed: this.owed.size,
      pending: this.pending.size,
    });
    this.resetProcess(child, true);
  }

  private takePending(id: number): PendingRequest | undefined {
    const slot = this.pending.get(id);
    if (!slot) return undefined;
    this.pending.delete(id);
    clearTimeout(slot.timer);
    return slot;
  }

  private resetProcess(child: ISearchWorkerProcess, backOff: boolean): void {
    if (child !== this.process) return;
    this.process = null;
    this.owed.clear();
    this.queue.length = 0;
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    try {
      child.kill();
    } catch (error: unknown) {
      // The process has usually exited already; nothing else to release.
      this.logger.debug(`${LOG_PREFIX} kill after exit`, { error: errorMessage(error) });
    }
    // Every pending request belongs to this process: there is only ever one.
    for (const id of [...this.pending.keys()]) this.takePending(id)?.degrade();
    if (backOff) this.backOff();
  }

  private backOff(): void {
    this.failures = Math.min(this.failures + 1, 8);
    this.retryAfter = Date.now() + Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.failures - 1));
  }
}

function clampTopK(topK: number): number {
  return Number.isFinite(topK) ? Math.max(1, Math.min(50, Math.floor(topK))) : 10;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
