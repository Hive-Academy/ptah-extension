/**
 * Host side of the search worker's embed and rerank calls.
 *
 * - A concurrency slot is held until the embedder's own promise settles, not
 *   until the caller stops waiting, so the limits bound the real work queued
 *   in the single embedder utility process.
 * - Embeds: at most two run at once and sixteen wait (FIFO, bounded wait).
 *   Identical texts share one call, and a successful embedding is cached for
 *   a minute even when it arrives after every caller stopped waiting.
 * - Reranks: at most one runs at once. A rerank is one synchronous batched
 *   cross-encoder pass in the embedder process, and every query embed posted
 *   after it waits for it; a distinct rerank that arrives while one runs is
 *   shed (`busy`), and the worker keeps the RRF order without caching it.
 *   Results are cached by a hash of query, topK and candidates.
 * - A call outstanding for 30 s means the embedder is wedged: that is logged
 *   once per episode, and searches degrade (bm25Only, RRF order) until it
 *   answers. Nothing is restarted here (the embedder client owns its process).
 *
 * Embedder process note: `onnxruntime-node` runs each inference synchronously
 * from a `setImmediate`, and the embedder worker embeds a batch one text per
 * run, so a query embed interleaves with a large ingestion batch text by text;
 * only reranks are long single runs, hence the rerank limit.
 */
import { createHash } from 'node:crypto';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';
import { withinBudget } from './search-deadline';
import type { SearchWorkerHostReply, SearchWorkerOutbound } from './search-worker.protocol';
import type { CuratorLogger } from './sqlite-reader-deps.types';

type Ranked = ReadonlyArray<{ id: string; score: number }>;
type HostCallMessage = Extract<SearchWorkerOutbound, { kind: 'embed' | 'rerank' }>;

const LOG_PREFIX = '[sqlite-search-worker]';
const MAX_RUNNING_EMBEDS = 2;
const MAX_QUEUED_EMBEDS = 16;
const QUEUE_WAIT_MS = 3_500;
/** Caller wait; above the worker's request budget, so the worker's deadline decides first. */
const CALL_WAIT_MS = 5_000;
const HUNG_CALL_MS = 30_000;
const CACHE_TTL_MS = 60_000;
const MAX_CACHED = 100;

/** A distinct rerank arrived while another one runs. */
export class HostRerankBusyError extends Error {
  constructor() {
    super('host reranker busy');
    this.name = 'HostRerankBusyError';
  }
}

class TtlCache<T> {
  private readonly entries = new Map<string, { readonly value: T; readonly expires: number }>();

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires > Date.now()) return entry.value;
    this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    const oldest = this.entries.keys().next();
    if (this.entries.size >= MAX_CACHED && !oldest.done) this.entries.delete(oldest.value);
    this.entries.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  }
}

export class SearchWorkerHostCalls {
  private runningEmbeds = 0;
  private readonly embedQueue: Array<() => void> = [];
  private rerankRunning = false;
  private hungReported = false;
  private readonly overdueCalls = new Set<symbol>();
  private readonly embeds = new Map<string, Promise<Float32Array[]>>();
  private readonly reranks = new Map<string, Promise<Ranked>>();
  private readonly embeddings = new TtlCache<Float32Array[]>();
  private readonly ranked = new TtlCache<Ranked>();

  constructor(
    private readonly embedder: IEmbedder,
    private readonly logger: CuratorLogger,
  ) {}

  /** Answer one worker call. Never rejects: a failure becomes `host-call-failed`. */
  async answer(message: HostCallMessage): Promise<SearchWorkerHostReply> {
    if (message.kind === 'rerank' && !(this.embedder instanceof EmbedderWorkerClient)) {
      return { kind: 'host-call-failed', id: message.id, message: 'reranker unavailable' };
    }
    try {
      if (message.kind === 'embed') {
        const vectors = await this.embed(message.texts);
        return { kind: 'embed-result', id: message.id, vectors: vectors.map((v) => Array.from(v)) };
      }
      const ranked = await this.rerank(message.query, message.candidates, message.topK);
      return { kind: 'rerank-result', id: message.id, ranked: ranked.map((r) => ({ id: r.id, score: r.score })) };
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      if (error instanceof HostRerankBusyError) {
        this.logger.debug(`${LOG_PREFIX} host rerank shed; another rerank is running`);
        return { kind: 'host-call-failed', id: message.id, message: text, busy: true };
      }
      this.logger.warn(`${LOG_PREFIX} host ${message.kind} failed`, { error: text });
      return { kind: 'host-call-failed', id: message.id, message: text };
    }
  }

  embed(texts: readonly string[]): Promise<Float32Array[]> {
    const key = JSON.stringify(texts);
    const cached = this.embeddings.get(key);
    if (cached) return Promise.resolve(cached);
    let work = this.embeds.get(key);
    if (!work) {
      const started = this.runEmbed(texts);
      work = started;
      this.embeds.set(key, started);
      void started
        .then(
          (vectors) => {
            if (vectors.every((v) => v.length === this.embedder.dim)) this.embeddings.set(key, vectors);
          },
          // Not swallowed: every caller waiting on this call receives the
          // rejection and answers it as host-call-failed (warn).
          () => undefined,
        )
        .finally(() => this.embeds.delete(key));
    }
    return withinBudget(work, CALL_WAIT_MS, 'host embed');
  }

  rerank(query: string, candidates: ReadonlyArray<{ id: string; text: string }>, topK: number): Promise<Ranked> {
    const reranker = this.embedder;
    if (!(reranker instanceof EmbedderWorkerClient)) return Promise.reject(new Error('reranker unavailable'));
    const key = createHash('sha256').update(JSON.stringify([query, topK, candidates])).digest('hex');
    const cached = this.ranked.get(key);
    if (cached) return Promise.resolve(cached);
    let work = this.reranks.get(key);
    if (!work) {
      if (this.rerankRunning) return Promise.reject(new HostRerankBusyError());
      const started = this.runExclusive(() => reranker.rerank(query, candidates, topK), 'rerank');
      work = started;
      this.reranks.set(key, started);
      void started
        .then(
          (ranked) => this.ranked.set(key, ranked),
          // Not swallowed: every caller waiting on this call receives the
          // rejection and answers it as host-call-failed (warn).
          () => undefined,
        )
        .finally(() => this.reranks.delete(key));
    }
    return withinBudget(work, CALL_WAIT_MS, 'host rerank');
  }

  /**
   * Load the embedder's models in the background. With a reranker this holds
   * the rerank slot, so search reranks are shed instead of waiting behind
   * the cross-encoder load.
   */
  warmup(): Promise<void> {
    const embedder = this.embedder;
    if (!(embedder instanceof EmbedderWorkerClient)) return embedder.embed(['warmup']).then(() => undefined);
    if (this.rerankRunning) return Promise.resolve();
    return this.runExclusive(() => embedder.warmup(), 'warmup');
  }

  private runEmbed(texts: readonly string[]): Promise<Float32Array[]> {
    return new Promise<Float32Array[]>((resolve, reject) => {
      const start = (waitTimer?: ReturnType<typeof setTimeout>): void => {
        clearTimeout(waitTimer);
        this.runningEmbeds++;
        void this.track(Promise.resolve().then(() => this.embedder.embed(texts)), 'embed')
          .then(resolve, reject)
          .finally(() => {
            this.runningEmbeds--;
            this.embedQueue.shift()?.();
          });
      };
      if (this.runningEmbeds < MAX_RUNNING_EMBEDS) {
        start();
        return;
      }
      if (this.embedQueue.length >= MAX_QUEUED_EMBEDS) {
        reject(new Error('host embed queue full'));
        return;
      }
      const queuedStart = (): void => start(waitTimer);
      this.embedQueue.push(queuedStart);
      const waitTimer = setTimeout(() => {
        const index = this.embedQueue.indexOf(queuedStart);
        if (index >= 0) this.embedQueue.splice(index, 1);
        reject(new Error('host embed queue wait timed out'));
      }, QUEUE_WAIT_MS);
    });
  }

  private runExclusive<T>(start: () => Promise<T>, kind: string): Promise<T> {
    this.rerankRunning = true;
    return this.track(Promise.resolve().then(start), kind).finally(() => {
      this.rerankRunning = false;
    });
  }

  /** Report, once per episode, an embedder call that has not settled for `HUNG_CALL_MS`. */
  private track<T>(work: Promise<T>, kind: string): Promise<T> {
    const call = Symbol(kind);
    const timer = setTimeout(() => {
      this.overdueCalls.add(call);
      if (this.hungReported) return;
      this.hungReported = true;
      this.logger.warn(`${LOG_PREFIX} host embedder has not answered a ${kind} call; searches degrade until it does`, {
        outstandingMs: HUNG_CALL_MS,
      });
    }, HUNG_CALL_MS);
    timer.unref?.();
    return work.finally(() => {
      clearTimeout(timer);
      this.overdueCalls.delete(call);
      if (this.overdueCalls.size === 0) this.hungReported = false;
    });
  }
}
