/**
 * EmbedderWorkerClient — main-thread proxy that implements `IEmbedder` by
 * delegating to a `node:worker_threads` Worker which actually runs the
 * `@huggingface/transformers` model. Keeps the heavy ONNX runtime off the
 * Electron/VS Code main thread.
 *
 * The worker entry is supplied as an absolute path via DI
 * (PERSISTENCE_TOKENS.EMBEDDER_WORKER_PATH) so tests can swap in a fake.
 */
import { inject, injectable } from 'tsyringe';
import { Worker } from 'node:worker_threads';
import { TOKENS, NoopTracer, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS, type ITracer } from '@ptah-extension/platform-core';
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
  readonly vectors: number[][];
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

export interface PipelineProgressInfo {
  readonly status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
  readonly name?: string;
  readonly file?: string;
  readonly progress?: number;
  readonly loaded?: number;
  readonly total?: number;
}

interface PipelineProgressMessage {
  readonly type: 'pipeline-progress';
  readonly info: PipelineProgressInfo;
}

type WorkerResponse = EmbedResponse | RerankResponse | ErrorResponse;
type WorkerMessage = WorkerResponse | PipelineProgressMessage;

export interface PipelineProgressListener {
  (info: PipelineProgressInfo): void;
}

export interface Disposable {
  dispose(): void;
}

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
  private workerFailed = false;
  private readonly progressListeners = new Set<PipelineProgressListener>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.EMBEDDER_WORKER_PATH)
    private readonly workerPath: string,
    @inject(PLATFORM_TOKENS.TRACER)
    private readonly tracer: ITracer = new NoopTracer(),
    @inject(PERSISTENCE_TOKENS.EMBEDDER_MODEL_CACHE_DIR, { isOptional: true })
    private readonly modelCacheDir: string | null = null,
  ) {}

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.tracer.startSpan(
      'memory.embed',
      { op: 'ai.embeddings', batchSize: texts.length, dims: DIM },
      async () => {
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
      },
    );
  }

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
    } catch (err: unknown) {
      this.logger.warn('[memory-curator] embedder worker termination failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.worker = null;
      this.pending.clear();
    }
  }

  onPipelineProgress(listener: PipelineProgressListener): Disposable {
    this.progressListeners.add(listener);
    return {
      dispose: () => {
        this.progressListeners.delete(listener);
      },
    };
  }

  private emitProgress(info: PipelineProgressInfo): void {
    for (const listener of this.progressListeners) {
      try {
        listener(info);
      } catch (error: unknown) {
        this.logger.warn('[memory-curator] embedder progress listener threw', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private ensureWorker(): Worker {
    if (this.workerFailed) {
      throw new Error(`Embedder worker unavailable: ${this.workerPath}`);
    }
    if (this.worker) return this.worker;
    const w = new Worker(this.workerPath, {
      type: 'module',
      workerData: { modelCacheDir: this.modelCacheDir },
    } as unknown as ConstructorParameters<typeof Worker>[1]);
    w.on('message', (msg: WorkerMessage) => {
      if (
        typeof (msg as PipelineProgressMessage).type === 'string' &&
        (msg as PipelineProgressMessage).type === 'pipeline-progress'
      ) {
        this.emitProgress((msg as PipelineProgressMessage).info);
        return;
      }
      const response = msg as WorkerResponse;
      const slot = this.pending.get(response.id);
      if (!slot) return;
      this.pending.delete(response.id);
      slot.resolve(response);
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
