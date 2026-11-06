/**
 * Worker-side `IEmbedder` that forwards embed and rerank calls to the host
 * process, which owns the real embedder utility process.
 *
 * Every call is bounded by `callTimeoutMs`, a backstop at least as long as
 * the host's whole request budget: a host that never answers leaves no entry
 * behind, and the call rejects. The real per-request bound is the request
 * deadline, which the searches race these calls against (`withinBudget`), so
 * a query embed may wait behind another query's embed or rerank for as long
 * as its request allows. The searches degrade visibly: a failed embed marks
 * the response `bm25Only` (the hybrid search still returns its BM25 rows), a
 * failed rerank keeps the RRF order, and neither is cached as final.
 */
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { remainingMs, wireBudgetMs } from './search-deadline';
import {
  MAX_EMBED_TEXTS,
  MAX_RERANK_CANDIDATES,
  type SearchWorkerHostReply,
  type SearchWorkerOutbound,
} from './search-worker.protocol';

/** The host shed an optional call (its reranker is busy); the caller skips it. */
export class HostCallSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostCallSkippedError';
  }
}

type PendingCall =
  | {
      readonly kind: 'embed';
      readonly resolve: (vectors: Float32Array[]) => void;
      readonly reject: (error: Error) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  | {
      readonly kind: 'rerank';
      readonly resolve: (ranked: ReadonlyArray<{ id: string; score: number }>) => void;
      readonly reject: (error: Error) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    };

export interface HostBridgeEmbedderOptions {
  readonly dim: number;
  readonly modelId: string;
  readonly canRerank: boolean;
  readonly post: (message: SearchWorkerOutbound) => void;
  /** Backstop on a host call. Default 5 000 ms, the host's request budget. */
  readonly callTimeoutMs?: number;
}

export class HostBridgeEmbedder implements IEmbedder {
  readonly dim: number;
  readonly modelId: string;
  /** Whether the host embedder can rerank; `MemorySearchService` skips reranking otherwise. */
  readonly canRerank: boolean;
  private readonly post: (message: SearchWorkerOutbound) => void;
  private readonly callTimeoutMs: number;
  private readonly calls = new Map<number, PendingCall>();
  private nextId = 1;

  constructor(options: HostBridgeEmbedderOptions) {
    this.dim = options.dim;
    this.modelId = options.modelId;
    this.canRerank = options.canRerank;
    this.post = options.post;
    this.callTimeoutMs = options.callTimeoutMs ?? 5_000;
  }

  /** Number of host calls awaiting an answer. Diagnostic and test accessor. */
  get pendingCalls(): number {
    return this.calls.size;
  }

  embed(texts: readonly string[], deadlineMs?: number): Promise<Float32Array[]> {
    if (texts.length === 0) return Promise.resolve([]);
    if (texts.length > MAX_EMBED_TEXTS) {
      return Promise.reject(
        new Error(`embed batch of ${texts.length} exceeds ${MAX_EMBED_TEXTS}`),
      );
    }
    const id = this.nextId++;
    const waitMs = Math.min(this.callTimeoutMs, remainingMs(deadlineMs));
    if (waitMs <= 0) return Promise.reject(new Error('host embed deadline expired'));
    return new Promise<Float32Array[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`host embed timed out after ${this.callTimeoutMs} ms`));
      }, waitMs);
      this.calls.set(id, { kind: 'embed', resolve, reject, timer });
      this.post({ kind: 'embed', id, texts: [...texts], ...(deadlineMs === undefined ? {} : { budgetMs: wireBudgetMs(deadlineMs), sentAtMs: Date.now() }) });
    });
  }

  rerank(
    query: string,
    candidates: ReadonlyArray<{ id: string; text: string }>,
    topK: number,
    deadlineMs?: number,
  ): Promise<ReadonlyArray<{ id: string; score: number }>> {
    if (!this.canRerank) return Promise.reject(new Error('host reranker unavailable'));
    const bounded = candidates.slice(0, MAX_RERANK_CANDIDATES).map((c) => ({ id: c.id, text: c.text }));
    const id = this.nextId++;
    const waitMs = Math.min(this.callTimeoutMs, remainingMs(deadlineMs));
    if (waitMs <= 0) return Promise.reject(new HostCallSkippedError('host rerank deadline expired'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`host rerank timed out after ${this.callTimeoutMs} ms`));
      }, waitMs);
      this.calls.set(id, { kind: 'rerank', resolve, reject, timer });
      this.post({ kind: 'rerank', id, query, candidates: bounded, topK: Math.max(1, topK), ...(deadlineMs === undefined ? {} : { budgetMs: wireBudgetMs(deadlineMs), sentAtMs: Date.now() }) });
    });
  }

  /** Settle the call a host reply answers. Replies for unknown or expired ids are ignored. */
  settle(reply: SearchWorkerHostReply): void {
    const call = this.calls.get(reply.id);
    if (!call) return;
    this.calls.delete(reply.id);
    clearTimeout(call.timer);
    if (call.kind === 'embed' && reply.kind === 'embed-result') {
      call.resolve(reply.vectors.map((v) => Float32Array.from(v)));
    } else if (call.kind === 'rerank' && reply.kind === 'rerank-result') {
      call.resolve(reply.ranked);
    } else if (reply.kind === 'host-call-failed') {
      call.reject(reply.busy ? new HostCallSkippedError(reply.message) : new Error(reply.message));
    } else {
      call.reject(new Error('unexpected host reply'));
    }
  }

  async dispose(): Promise<void> {
    for (const call of this.calls.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('search worker shutting down'));
    }
    this.calls.clear();
  }
}
