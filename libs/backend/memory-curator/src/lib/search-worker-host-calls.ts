import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';

const MAX_RUNNING = 2;
const MAX_QUEUED = 16;
// Inside the worker request deadline (timeout - 500 ms); the search deadline race cuts in first.
const QUEUE_WAIT_MS = 3_500;

/** Host calls survive search-worker result-cache invalidation by database writes. */
export class SearchWorkerHostCalls {
  private running = 0;
  private readonly queue: Array<() => void> = [];
  private readonly embeds = new Map<string, Promise<Float32Array[]>>();
  private readonly reranks = new Map<string, Promise<ReadonlyArray<{ id: string; score: number }>>>();
  private readonly embeddings = new Map<string, { value: Float32Array[]; expires: number }>();
  private readonly failed = new Map<string, number>();

  constructor(private readonly embedder: IEmbedder) {}

  embed(texts: readonly string[]): Promise<Float32Array[]> {
    const key = JSON.stringify(['embed', texts]);
    const cached = this.embeddings.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
    const existing = this.embeds.get(key);
    if (existing) return existing;
    const work = this.call(key, () => this.embedder.embed(texts), 4_000).then((vectors) => {
      if (this.embeddings.size >= 100) this.embeddings.delete(this.embeddings.keys().next().value ?? '');
      this.embeddings.set(key, { value: vectors, expires: Date.now() + 60_000 });
      return vectors;
    }).finally(() => this.embeds.delete(key));
    this.embeds.set(key, work);
    return work;
  }

  rerank(query: string, candidates: ReadonlyArray<{ id: string; text: string }>, topK: number): Promise<ReadonlyArray<{ id: string; score: number }>> {
    const reranker = this.embedder;
    if (!(reranker instanceof EmbedderWorkerClient)) return Promise.reject(new Error('reranker unavailable'));
    const key = JSON.stringify(['rerank', query, candidates, topK]);
    const existing = this.reranks.get(key);
    if (existing) return existing;
    const work = this.call(key, () => reranker.rerank(query, candidates, topK), 2_000)
      .finally(() => this.reranks.delete(key));
    this.reranks.set(key, work);
    return work;
  }

  private call<T>(key: string, start: () => Promise<T>, timeoutMs: number): Promise<T> {
    if ((this.failed.get(key) ?? 0) > Date.now()) return Promise.reject(new Error('host call cooling down'));
    if (this.running >= MAX_RUNNING && this.queue.length >= MAX_QUEUED) {
      return Promise.reject(new Error('host call queue full'));
    }
    return new Promise<T>((resolve, reject) => {
      let queueTimer: ReturnType<typeof setTimeout> | undefined;
      const run = () => {
        clearTimeout(queueTimer);
        this.running++;
        let callTimer: ReturnType<typeof setTimeout> | undefined;
        const work = Promise.resolve().then(start);
        void Promise.race([work, new Promise<never>((_, fail) => {
          callTimer = setTimeout(() => fail(new Error('host call timed out')), timeoutMs);
        })]).then(resolve, (error: unknown) => {
          this.failed.set(key, Date.now() + 5_000);
          reject(error);
        }).finally(() => {
          clearTimeout(callTimer);
          this.running--;
          this.queue.shift()?.();
        });
      };
      if (this.running < MAX_RUNNING) run();
      else {
        this.queue.push(run);
        queueTimer = setTimeout(() => {
          const index = this.queue.indexOf(run);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new Error('host call queue wait timed out'));
        }, QUEUE_WAIT_MS);
      }
    });
  }
}
