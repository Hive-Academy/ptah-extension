import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type IEmbedder,
} from '@ptah-extension/persistence-sqlite';
import { type EmbedderDownloadPhase } from '@ptah-extension/memory-contracts';
import { MEMORY_TOKENS } from '../di/tokens';
import { MemoryCuratorService } from '../memory-curator.service';
import {
  EmbedderWorkerClient,
  type Disposable,
  type PipelineProgressInfo,
} from './embedder-worker-client';

export interface EmbedderStatusError {
  readonly message: string;
  readonly code?: string;
}

export interface EmbedderStatusSnapshot {
  readonly ready: boolean;
  readonly downloading: boolean;
  readonly progress?: number;
  readonly error?: EmbedderStatusError;
}

export interface EmbedderStatusChangeListener {
  (snapshot: EmbedderStatusSnapshot): void;
}

const PROGRESS_EMIT_THROTTLE_MS = 500;

@injectable()
export class EmbedderStatusService {
  private ready = false;
  private downloading = false;
  private progress: number | undefined;
  private lastError: EmbedderStatusError | undefined;
  private inFlight: Promise<void> | null = null;
  private lastRingEmitAt = 0;
  private progressSubscription: Disposable | null = null;
  private readonly listeners = new Set<EmbedderStatusChangeListener>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.EMBEDDER) private readonly embedder: IEmbedder,
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly curator: MemoryCuratorService,
  ) {
    this.attachProgressSource();
  }

  getStatus(): EmbedderStatusSnapshot {
    const snapshot: EmbedderStatusSnapshot = {
      ready: this.ready,
      downloading: this.downloading,
    };
    if (this.progress !== undefined) {
      return { ...snapshot, progress: this.progress, error: this.lastError };
    }
    if (this.lastError) {
      return { ...snapshot, error: this.lastError };
    }
    return snapshot;
  }

  on(event: 'change', listener: EmbedderStatusChangeListener): Disposable {
    if (event !== 'change') {
      throw new Error(
        `[memory-curator] EmbedderStatusService: unsupported event '${event}'`,
      );
    }
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.runWarmup();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  recordError(error: EmbedderStatusError): void {
    this.lastError = error;
    this.downloading = false;
    this.progress = undefined;
    this.emitRing('failed', undefined, error.message);
    this.notifyChange();
  }

  private async runWarmup(): Promise<void> {
    this.downloading = true;
    this.progress = 0;
    this.lastError = undefined;
    this.lastRingEmitAt = 0;
    this.emitRing('starting', 0);
    this.notifyChange();

    try {
      if (typeof this.embedder.warmup === 'function') {
        await this.embedder.warmup();
      }
      this.ready = true;
      this.downloading = false;
      this.progress = 1;
      this.emitRing('ready', 1);
      this.notifyChange();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      let code: string | undefined;
      if (error instanceof Error) {
        const candidate = (error as unknown as { code?: unknown }).code;
        if (typeof candidate === 'string') {
          code = candidate;
        }
      }
      this.lastError = code ? { message, code } : { message };
      this.downloading = false;
      this.progress = undefined;
      this.emitRing('failed', undefined, message);
      this.notifyChange();
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private attachProgressSource(): void {
    if (this.progressSubscription) return;
    if (!(this.embedder instanceof EmbedderWorkerClient)) {
      this.logger.debug(
        '[memory-curator] EmbedderStatusService: embedder does not expose progress source — skipping subscription',
      );
      return;
    }
    this.progressSubscription = this.embedder.onPipelineProgress((info) => {
      this.handlePipelineProgress(info);
    });
  }

  private handlePipelineProgress(info: PipelineProgressInfo): void {
    if (info.status === 'initiate' || info.status === 'download') {
      if (!this.downloading) {
        this.downloading = true;
        this.progress = 0;
        this.emitRing('starting', 0);
        this.notifyChange();
      }
      return;
    }

    if (info.status === 'progress') {
      const ratio = this.deriveProgressRatio(info);
      this.downloading = true;
      this.progress = ratio;
      this.maybeEmitRingProgress(ratio);
      this.notifyChange();
      return;
    }

    if (info.status === 'done') {
      return;
    }

    if (info.status === 'ready') {
      this.ready = true;
      this.downloading = false;
      this.progress = 1;
      this.lastError = undefined;
      this.lastRingEmitAt = 0;
      this.emitRing('ready', 1);
      this.notifyChange();
    }
  }

  private deriveProgressRatio(info: PipelineProgressInfo): number {
    if (typeof info.progress === 'number' && Number.isFinite(info.progress)) {
      const clamped = Math.max(0, Math.min(100, info.progress));
      return clamped / 100;
    }
    if (
      typeof info.loaded === 'number' &&
      typeof info.total === 'number' &&
      info.total > 0
    ) {
      return Math.max(0, Math.min(1, info.loaded / info.total));
    }
    return this.progress ?? 0;
  }

  private maybeEmitRingProgress(progress: number): void {
    const now = Date.now();
    if (now - this.lastRingEmitAt < PROGRESS_EMIT_THROTTLE_MS) return;
    this.lastRingEmitAt = now;
    this.emitRing('downloading', progress);
  }

  private emitRing(
    phase: EmbedderDownloadPhase,
    progress?: number,
    error?: string,
  ): void {
    try {
      this.curator.pushEvent({
        kind: 'embedder-download',
        timestamp: Date.now(),
        phase,
        ...(progress !== undefined ? { progress } : {}),
        ...(error !== undefined ? { error } : {}),
      });
    } catch (err: unknown) {
      this.logger.warn(
        '[memory-curator] EmbedderStatusService event push failed',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  private notifyChange(): void {
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error: unknown) {
        this.logger.warn(
          '[memory-curator] EmbedderStatusService change listener threw',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }
}
