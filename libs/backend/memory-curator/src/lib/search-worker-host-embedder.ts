/**
 * Worker-side `IEmbedder` that forwards embed and rerank calls to the host
 * process, which owns the real embedder utility process.
 *
 * Every call is bounded by `callTimeoutMs`: a host that never answers leaves
 * no entry behind, and the caller degrades (an empty embedding makes the
 * vector branch return nothing, so the hybrid search still returns its BM25
 * rows; a failed rerank keeps the RRF order).
 */
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import {
  MAX_EMBED_TEXTS,
  MAX_RERANK_CANDIDATES,
  type SearchWorkerHostReply,
  type SearchWorkerOutbound,
} from './search-worker.protocol';

type PendingCall =
  | {
      readonly kind: 'embed';
      readonly resolve: (vectors: Float32Array[]) => void;
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
    this.callTimeoutMs = options.callTimeoutMs ?? 2_000;
  }

  /** Number of host calls awaiting an answer. Diagnostic and test accessor. */
  get pendingCalls(): number {
    return this.calls.size;
  }

  embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return Promise.resolve([]);
    if (texts.length > MAX_EMBED_TEXTS) {
      return Promise.reject(
        new Error(`embed batch of ${texts.length} exceeds ${MAX_EMBED_TEXTS}`),
      );
    }
    const id = this.nextId++;
    return new Promise<Float32Array[]>((resolve) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        resolve([]);
      }, this.callTimeoutMs);
      this.calls.set(id, { kind: 'embed', resolve, timer });
      this.post({ kind: 'embed', id, texts: [...texts] });
    });
  }

  rerank(
    query: string,
    candidates: ReadonlyArray<{ id: string; text: string }>,
    topK: number,
  ): Promise<ReadonlyArray<{ id: string; score: number }>> {
    if (!this.canRerank) return Promise.reject(new Error('host reranker unavailable'));
    const bounded = candidates.slice(0, MAX_RERANK_CANDIDATES).map((c) => ({ id: c.id, text: c.text }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`host rerank timed out after ${this.callTimeoutMs} ms`));
      }, this.callTimeoutMs);
      this.calls.set(id, { kind: 'rerank', resolve, reject, timer });
      this.post({ kind: 'rerank', id, query, candidates: bounded, topK: Math.max(1, topK) });
    });
  }

  /** Settle the call a host reply answers. Replies for unknown or expired ids are ignored. */
  settle(reply: SearchWorkerHostReply): void {
    const call = this.calls.get(reply.id);
    if (!call) return;
    this.calls.delete(reply.id);
    clearTimeout(call.timer);
    if (call.kind === 'embed') {
      call.resolve(
        reply.kind === 'embed-result' ? reply.vectors.map((v) => Float32Array.from(v)) : [],
      );
      return;
    }
    if (reply.kind === 'rerank-result') call.resolve(reply.ranked);
    else call.reject(new Error(reply.kind === 'host-call-failed' ? reply.message : 'unexpected host reply'));
  }

  async dispose(): Promise<void> {
    for (const call of this.calls.values()) {
      clearTimeout(call.timer);
      if (call.kind === 'embed') call.resolve([]);
      else call.reject(new Error('search worker shutting down'));
    }
    this.calls.clear();
  }
}
