/**
 * Host-side coordinator for the SQLite search utility process.
 *
 * Electron-independent: the host supplies an `ISearchWorkerFactory`. Every
 * request resolves; a stalled, crashed or saturated worker yields the empty
 * ("degraded") result for that request kind instead of an error, so callers
 * on the main thread never wait longer than `timeoutMs`.
 *
 * - Every message from the worker is parsed with `searchWorkerOutboundSchema`,
 *   and every result with the schema of the request kind it answers.
 * - A process exit, a failed init or a stall (a timeout while no embed/rerank
 *   call is outstanding on the host) kills the process, settles every pending
 *   request as degraded and starts an exponential backoff capped at 30 s.
 *   While backing off, requests resolve degraded at once; nothing is queued.
 * - At most `maxPending` requests are in flight; more resolve degraded.
 * - `dispose()` kills the process and stops respawns (app quit).
 */
import type { z } from 'zod';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import type { CodeSymbolHitPage, MemoryListPage } from '@ptah-extension/memory-contracts';
import type { MemoryChunk, MemorySearchResponse } from './memory.types';
import type { CodeSymbolSearchParams, CodeSymbolSearchResult } from './code-symbol.store';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';
import type { ISearchWorkerFactory, ISearchWorkerProcess, ISqliteSearchWorker } from './search-worker.port';
import {
  searchWorkerOutboundSchema,
  searchWorkerQuerySchema,
  searchWorkerResultSchemas,
  type SearchWorkerInbound,
  type SearchWorkerOutbound,
  type SearchWorkerQuery,
} from './search-worker.protocol';
import type { CuratorLogger } from './sqlite-reader-deps.types';

const LOG_PREFIX = '[sqlite-search-worker]';
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 30_000;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type QueryBody = DistributiveOmit<SearchWorkerQuery, 'id'>;

interface PendingRequest {
  readonly child: ISearchWorkerProcess;
  readonly timer: ReturnType<typeof setTimeout>;
  /** Resolve with a raw worker result; degrades when it fails its schema. */
  readonly settle: (raw: unknown) => void;
  /** Resolve with the empty result for this request kind. */
  readonly degrade: () => void;
}

export interface SearchWorkerClientOptions {
  /** Per-request budget before the request resolves degraded. Default 5 000 ms. */
  readonly timeoutMs?: number;
  /** Requests allowed in flight at once. Default 32. */
  readonly maxPending?: number;
}

export class SearchWorkerClient implements ISqliteSearchWorker {
  private process: ISearchWorkerProcess | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private failures = 0;
  private retryAfter = 0;
  /** Bumped on every process reset so host calls of a dead process are not counted. */
  private generation = 0;
  private hostCallsInFlight = 0;
  private saturated = false;
  private disposed = false;
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  private readonly reranker: EmbedderWorkerClient | null;

  constructor(
    private readonly factory: ISearchWorkerFactory,
    private readonly embedder: IEmbedder,
    private readonly logger: CuratorLogger,
    options: SearchWorkerClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxPending = options.maxPending ?? 32;
    this.reranker = embedder instanceof EmbedderWorkerClient ? embedder : null;
  }

  searchMemory(query: string, topK: number, workspaceRoot?: string | null): Promise<MemorySearchResponse> {
    return this.request(
      { kind: 'memory', query, topK: clampTopK(topK), workspaceRoot },
      searchWorkerResultSchemas.memory,
      { hits: [], bm25Only: true },
    );
  }

  searchSymbols(query: string, topK: number, workspaceRoot?: string): Promise<CodeSymbolHitPage> {
    return this.request(
      { kind: 'symbols', query, topK: clampTopK(topK), workspaceRoot },
      searchWorkerResultSchemas.symbols,
      { hits: [], bm25Only: true },
    );
  }

  searchSymbolPage(params: CodeSymbolSearchParams): Promise<CodeSymbolSearchResult> {
    return this.request(
      { kind: 'symbol-page', params: { ...params, kinds: params.kinds ? [...params.kinds] : undefined } },
      searchWorkerResultSchemas['symbol-page'],
      { items: [], total: 0 },
    );
  }

  listMemories(workspaceRoot: string, limit: number): Promise<MemoryListPage> {
    return this.request(
      { kind: 'list', workspaceRoot, limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 20 },
      searchWorkerResultSchemas.list,
      { memories: [], total: 0 },
    );
  }

  getChunks(memoryId: string): Promise<readonly MemoryChunk[]> {
    return this.request({ kind: 'chunks', memoryId }, searchWorkerResultSchemas.chunks, []);
  }

  /** Kill the worker and stop respawning. Pending requests resolve degraded. Idempotent. */
  dispose(): void {
    this.disposed = true;
    const child = this.process;
    if (child) this.resetProcess(child, false);
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
    // which would otherwise surface only as a timeout and a restart.
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
    const child = this.ensureProcess();
    if (!child) return Promise.resolve(empty);
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => this.onTimeout(id, child), this.timeoutMs);
      this.pending.set(id, {
        child,
        timer,
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
      try {
        child.postMessage(message);
      } catch (error: unknown) {
        this.logger.warn(`${LOG_PREFIX} request send failed`, { error: errorMessage(error) });
        this.resetProcess(child, true);
      }
    });
  }

  private ensureProcess(): ISearchWorkerProcess | null {
    if (this.process) return this.process;
    let child: ISearchWorkerProcess;
    let init: SearchWorkerInbound;
    try {
      const config = this.factory.databaseConfig();
      init = {
        kind: 'init',
        dbPath: config.dbPath,
        vecPath: config.vecPath,
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
    child.on('message', (message) => this.handleMessage(child, message));
    child.on('exit', (code) => {
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
    return child;
  }

  private handleMessage(child: ISearchWorkerProcess, raw: unknown): void {
    if (child !== this.process) return;
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
        this.takePending(message.id)?.settle(message.result);
        return;
      case 'error': {
        const slot = this.takePending(message.id);
        this.logger.warn(`${LOG_PREFIX} query failed; answering degraded`, { error: message.message });
        slot?.degrade();
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
    switch (message.level) {
      case 'debug':
        this.logger.debug(text, message.context);
        return;
      case 'info':
        this.logger.info(text, message.context);
        return;
      case 'warn':
        this.logger.warn(text, message.context);
        return;
      case 'error':
        this.logger.error(text, message.context);
        return;
    }
  }

  private async answerHostCall(
    child: ISearchWorkerProcess,
    message: Extract<SearchWorkerOutbound, { kind: 'embed' | 'rerank' }>,
  ): Promise<void> {
    const generation = this.generation;
    this.hostCallsInFlight++;
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
    } finally {
      if (generation === this.generation) this.hostCallsInFlight--;
    }
    if (child !== this.process) return;
    try {
      child.postMessage(reply);
    } catch (error: unknown) {
      this.logger.warn(`${LOG_PREFIX} host reply send failed`, { error: errorMessage(error) });
    }
  }

  private onTimeout(id: number, child: ISearchWorkerProcess): void {
    const slot = this.takePending(id);
    if (!slot) return;
    slot.degrade();
    // A worker waiting on the host's embedder is not stalled; one doing
    // nothing the host can see for the whole budget is, and is restarted.
    const stalled = this.hostCallsInFlight === 0;
    this.logger.warn(`${LOG_PREFIX} request timed out; answering degraded`, {
      timeoutMs: this.timeoutMs,
      restarting: stalled,
    });
    if (stalled) this.resetProcess(child, true);
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
    this.generation++;
    this.hostCallsInFlight = 0;
    try {
      child.kill();
    } catch (error: unknown) {
      // The process has usually exited already; nothing else to release.
      this.logger.debug(`${LOG_PREFIX} kill after exit`, { error: errorMessage(error) });
    }
    for (const [id, slot] of [...this.pending]) {
      if (slot.child !== child) continue;
      this.takePending(id);
      slot.degrade();
    }
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
