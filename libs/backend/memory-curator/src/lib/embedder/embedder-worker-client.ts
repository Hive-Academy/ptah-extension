/**
 * EmbedderWorkerClient — main-thread proxy that implements `IEmbedder` by
 * delegating to a `node:worker_threads` Worker which actually runs the
 * `@xenova/transformers` model. Keeps the heavy ONNX runtime off the
 * Electron/VS Code main thread.
 *
 * The worker entry is supplied as an absolute path via DI
 * (PERSISTENCE_TOKENS.EMBEDDER_WORKER_PATH) so tests can swap in a fake.
 */
import { inject, injectable } from 'tsyringe';
import { Worker } from 'node:worker_threads';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type IEmbedder,
} from '@ptah-extension/persistence-sqlite';

interface EmbedRequest {
  readonly id: number;
  readonly type: 'embed';
  readonly texts: readonly string[];
}
interface DisposeRequest {
  readonly id: number;
  readonly type: 'dispose';
}
interface RerankRequest {
  readonly id: number;
  readonly type: 'rerank';
  readonly query: string;
  readonly candidates: ReadonlyArray<{ id: string; text: string }>;
  readonly topK: number;
}
interface WarmupRequest {
  readonly id: number;
  readonly type: 'warmup';
}
interface EmbedResponse {
  readonly id: number;
  readonly ok: true;
  readonly vectors: number[][]; // structured-clone friendly
}
interface RerankResponse {
  readonly id: number;
  readonly ok: true;
  readonly ranked: ReadonlyArray<{ id: string; score: number }>;
}
interface ErrorResponse {
  readonly id: number;
  readonly ok: false;
  readonly error: string;
}

type WorkerResponse = EmbedResponse | RerankResponse | ErrorResponse;

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const DIM = 384;

@injectable()
export class EmbedderWorkerClient implements IEmbedder {
  readonly dim = DIM;
  readonly modelId = MODEL_ID;

  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }
  >();
  /** Set on first fatal worker error to prevent respawning on every embed call. */
  private workerFailed = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.EMBEDDER_WORKER_PATH)
    private readonly workerPath: string,
  ) {}

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const worker = this.ensureWorker();
    const id = this.nextId++;
    const req: EmbedRequest = { id, type: 'embed', texts };
    const reply = await this.send(worker, id, req);
    if (reply.ok === false) {
      throw new Error(`Embedder worker error: ${reply.error}`);
    }
    if (!('vectors' in reply)) {
      throw new Error('Embedder worker returned unexpected response shape');
    }
    return reply.vectors.map((v) => Float32Array.from(v));
  }

  /** Send a RERANK message to the worker. Returns ranked IDs with scores. */
  async rerank(
    query: string,
    candidates: ReadonlyArray<{ id: string; text: string }>,
    topK: number,
  ): Promise<ReadonlyArray<{ id: string; score: number }>> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    const req: RerankRequest = { id, type: 'rerank', query, candidates, topK };
    const reply = await this.send(worker, id, req);
    if (reply.ok === false) {
      throw new Error(`Reranker worker error: ${reply.error}`);
    }
    if (!('ranked' in reply)) {
      throw new Error('Reranker worker returned unexpected response shape');
    }
    return reply.ranked;
  }

  /** Send a WARMUP message — pre-loads both models in the worker. */
  async warmup(): Promise<void> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    const req: WarmupRequest = { id, type: 'warmup' };
    const reply = await this.send(worker, id, req);
    if (reply.ok === false) {
      throw new Error(`Warmup worker error: ${reply.error}`);
    }
  }

  async dispose(): Promise<void> {
    if (!this.worker) return;
    try {
      const id = this.nextId++;
      const req: DisposeRequest = { id, type: 'dispose' };
      await this.send(this.worker, id, req).catch(() => undefined);
      await this.worker.terminate();
    } catch (err) {
      this.logger.warn('[memory-curator] embedder worker termination failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.worker = null;
      this.pending.clear();
    }
  }

  private ensureWorker(): Worker {
    if (this.workerFailed) {
      throw new Error(`Embedder worker unavailable: ${this.workerPath}`);
    }
    if (this.worker) return this.worker;
    const w = new Worker(this.workerPath, {
      type: 'module',
    } as unknown as ConstructorParameters<typeof Worker>[1]);
    w.on('message', (msg: WorkerResponse) => {
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      slot.resolve(msg);
    });
    w.on('error', (err) => {
      this.logger.error('[memory-curator] embedder worker error', err);
      this.workerFailed = true;
      for (const slot of this.pending.values()) slot.reject(err);
      this.pending.clear();
    });
    w.on('exit', (code) => {
      if (code !== 0) {
        this.logger.warn('[memory-curator] embedder worker exited', { code });
      }
      for (const slot of this.pending.values()) {
        slot.reject(new Error(`Embedder worker exited with code ${code}`));
      }
      this.pending.clear();
      this.worker = null;
    });
    this.worker = w;
    return w;
  }

  private send(
    worker: Worker,
    id: number,
    payload: EmbedRequest | DisposeRequest | RerankRequest | WarmupRequest,
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(payload);
    });
  }
}
