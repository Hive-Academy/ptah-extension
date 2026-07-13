/**
 * EmbedderWorkerClient — main-process proxy that implements `IEmbedder` by
 * delegating to an Electron `utilityProcess` embedder worker (spawned via a
 * host-implemented `IEmbedderWorkerProcessFactory`). Keeps the heavy ONNX
 * runtime off the Electron main thread and, being its own OS process, means a
 * native ONNX `abort()` kills only the child.
 *
 * Lifecycle (mirrors `VoiceWorkerClient`):
 *   - Lazy spawn on first request; stays warm between requests.
 *   - Idle-teardown timer (default 5 min, constructor-configurable) armed when
 *     the in-flight count reaches 0, cancelled by the next request.
 *   - On `exit`: reject all pending and clear the ref — **no permanent failed
 *     flag**, so the next request respawns a fresh worker.
 *   - Crash-loop guard: ≥3 exits within 60 s → refuse spawn for 30 s.
 *
 * When no factory is registered (VS Code / CLI) the client is unavailable:
 * `embed` / `rerank` / `warmup` throw, and `MemorySearchService` falls back to
 * BM25-only search.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, NoopTracer, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS, type ITracer } from '@ptah-extension/platform-core';
import { type IEmbedder } from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from '../di/tokens';
import type {
  IEmbedderWorkerProcess,
  IEmbedderWorkerProcessFactory,
} from './worker-process.port';
import {
  isPipelineProgressMessage,
  type EmbedderWorkerRequest,
  type EmbedderWorkerResponse,
  type PipelineProgressInfo,
} from './embedder-worker-protocol';

// Re-exported so the barrel (`src/index.ts`) keeps its historical export site.
export type { PipelineProgressInfo } from './embedder-worker-protocol';

/** Distributes `Omit` over the request union so each variant keeps its shape. */
type EmbedderWorkerRequestBody = EmbedderWorkerRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never;

export interface PipelineProgressListener {
  (info: PipelineProgressInfo): void;
}

export interface Disposable {
  dispose(): void;
}

/** Default idle-teardown window (ms). Exported so DI can register the token. */
export const DEFAULT_EMBEDDER_IDLE_MS = 5 * 60 * 1000;
const CRASH_LOOP_MAX_EXITS = 3;
const CRASH_LOOP_WINDOW_MS = 60_000;
const CRASH_LOOP_BACKOFF_MS = 30_000;

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const DIM = 384;

interface PendingSlot {
  readonly resolve: (v: EmbedderWorkerResponse) => void;
  readonly reject: (e: Error) => void;
}

@injectable()
export class EmbedderWorkerClient implements IEmbedder {
  readonly dim = DIM;
  readonly modelId = MODEL_ID;

  private worker: IEmbedderWorkerProcess | null = null;
  private nextId = 1;
  private inFlight = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<number, PendingSlot>();
  private readonly progressListeners = new Set<PipelineProgressListener>();
  /** Exit timestamps within the crash-loop window. */
  private recentExits: number[] = [];
  /** When set (> Date.now()) spawns are refused (crash-loop backoff). */
  private refuseSpawnUntil = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(MEMORY_TOKENS.EMBEDDER_WORKER_PROCESS_FACTORY, { isOptional: true })
    private readonly factory: IEmbedderWorkerProcessFactory | null = null,
    @inject(MEMORY_TOKENS.EMBEDDER_WORKER_IDLE_MS, { isOptional: true })
    private readonly idleMs: number = DEFAULT_EMBEDDER_IDLE_MS,
    @inject(PLATFORM_TOKENS.TRACER)
    private readonly tracer: ITracer = new NoopTracer(),
  ) {}

  /** True when a worker factory is registered (Electron host). */
  get available(): boolean {
    return this.factory !== null;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.tracer.startSpan(
      'memory.embed',
      { op: 'ai.embeddings', batchSize: texts.length, dims: DIM },
      async () => {
        const reply = await this.request({ type: 'embed', texts });
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
    const reply = await this.request({
      type: 'rerank',
      query,
      candidates,
      topK,
    });
    if (reply.ok === false) {
      throw new Error(`Reranker worker error: ${reply.error}`);
    }
    if (!('ranked' in reply)) {
      throw new Error('Reranker worker returned unexpected response shape');
    }
    return reply.ranked;
  }

  async warmup(): Promise<void> {
    const reply = await this.request({ type: 'warmup' });
    if (reply.ok === false) {
      throw new Error(`Warmup worker error: ${reply.error}`);
    }
  }

  /** Terminate the worker (will-quit disposal). Idempotent. */
  async dispose(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.teardownWorker();
    for (const slot of this.pending.values()) {
      slot.reject(new Error('Embedder worker disposed.'));
    }
    this.pending.clear();
    this.inFlight = 0;
  }

  onPipelineProgress(listener: PipelineProgressListener): Disposable {
    this.progressListeners.add(listener);
    return {
      dispose: () => {
        this.progressListeners.delete(listener);
      },
    };
  }

  private async request(
    req: EmbedderWorkerRequestBody,
  ): Promise<EmbedderWorkerResponse> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    this.cancelIdleTimer();
    this.inFlight++;
    return new Promise<EmbedderWorkerResponse>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => {
          this.settle();
          resolve(v);
        },
        reject: (e) => {
          this.settle();
          reject(e);
        },
      });
      worker.postMessage({ ...req, id });
    });
  }

  private settle(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight === 0) this.armIdleTimer();
  }

  private ensureWorker(): IEmbedderWorkerProcess {
    const now = Date.now();
    if (this.refuseSpawnUntil > now && !this.worker) {
      throw new Error(
        'Embedder worker temporarily unavailable (crash-loop backoff).',
      );
    }
    if (this.worker) return this.worker;
    if (!this.factory) {
      throw new Error(
        'Embedder worker unavailable: no worker process factory registered on this runtime.',
      );
    }

    const worker = this.factory.spawn();
    worker.on('message', (msg: unknown) => this.handleMessage(msg));
    worker.on('exit', (code: number | null) => this.handleExit(code));
    this.worker = worker;
    return worker;
  }

  private handleMessage(msg: unknown): void {
    if (isPipelineProgressMessage(msg)) {
      this.emitProgress(msg.info);
      return;
    }
    const response = msg as EmbedderWorkerResponse;
    if (typeof response?.id !== 'number') return;
    const slot = this.pending.get(response.id);
    if (!slot) return;
    this.pending.delete(response.id);
    slot.resolve(response);
  }

  private handleExit(code: number | null): void {
    if (code !== 0 && code !== null) {
      this.logger.warn('[memory-curator] embedder worker exited', { code });
    }
    this.worker = null;

    const now = Date.now();
    this.recentExits = this.recentExits.filter(
      (t) => now - t < CRASH_LOOP_WINDOW_MS,
    );
    this.recentExits.push(now);
    if (this.recentExits.length >= CRASH_LOOP_MAX_EXITS) {
      this.refuseSpawnUntil = now + CRASH_LOOP_BACKOFF_MS;
      this.logger.warn(
        '[memory-curator] embedder worker crash-loop; backing off',
        {
          exits: this.recentExits.length,
          backoffMs: CRASH_LOOP_BACKOFF_MS,
        },
      );
    }

    // Reject all in-flight requests; the next request respawns a fresh worker
    // (deliberately no permanent failed flag).
    for (const slot of this.pending.values()) {
      slot.reject(
        new Error('Embedder worker stopped unexpectedly. Please retry.'),
      );
    }
    this.pending.clear();
    this.inFlight = 0;
    this.cancelIdleTimer();
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

  private armIdleTimer(): void {
    this.cancelIdleTimer();
    if (!this.worker) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.inFlight === 0) this.teardownWorker();
    }, this.idleMs);
    // Do not keep the event loop alive purely for the idle timer.
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private teardownWorker(): void {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    try {
      worker.postMessage({ id: this.nextId++, type: 'dispose' });
    } catch {
      /* best-effort dispose signal */
    }
    try {
      worker.kill();
    } catch (error: unknown) {
      this.logger.warn('[memory-curator] embedder worker kill failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
