/**
 * VoiceWorkerClient — main-process proxy over the Electron `utilityProcess`
 * voice worker. Mirrors `EmbedderWorkerClient` (pending map, id counter,
 * progress fan-out) with the lifecycle deltas FR-2.2 requires:
 *
 *   - Lazy spawn on first request; stays warm between requests.
 *   - Idle teardown timer (default 5 min, constructor-configurable) armed when
 *     the in-flight count reaches 0, cancelled by the next request.
 *   - On `exit`: reject all pending with `VoiceProviderError('process-crashed')`
 *     and clear the ref — **no permanent failed flag**, so the next request
 *     respawns a fresh worker.
 *   - Crash-loop guard: ≥3 exits within 60 s → refuse spawn for 30 s.
 *
 * Also implements `IVoiceDownloadEventSource` so the selector can bridge model
 * download progress to the UI.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  VoiceProviderError,
  VOICE_ASSETS_REMEDIATION,
  type IVoiceDownloadEventSource,
  type VoiceDownloadEvent,
  type VoiceErrorCategory,
  type VoiceEventDisposable,
  type VoiceModelSpec,
} from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from '../di/tokens';
import type {
  IVoiceWorkerProcess,
  IVoiceWorkerProcessFactory,
} from './worker-process.port';
import {
  isDownloadProgressMessage,
  type VoiceWorkerRequest,
  type VoiceWorkerResponse,
} from '../worker/voice-worker-protocol';

/** Distributes `Omit` over the request union so each variant keeps its shape. */
type VoiceWorkerRequestBody = VoiceWorkerRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never;

const DEFAULT_IDLE_MS = 5 * 60 * 1000;
const CRASH_LOOP_MAX_EXITS = 3;
const CRASH_LOOP_WINDOW_MS = 60_000;
const CRASH_LOOP_BACKOFF_MS = 30_000;

const CRASH_LOOP_REMEDIATION =
  'The local voice engine crashed repeatedly and is paused briefly. Please retry in a moment.';

interface PendingSlot {
  readonly resolve: (v: VoiceWorkerResponse) => void;
  readonly reject: (e: Error) => void;
}

@injectable()
export class VoiceWorkerClient implements IVoiceDownloadEventSource {
  private worker: IVoiceWorkerProcess | null = null;
  private nextId = 1;
  private inFlight = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<number, PendingSlot>();
  private readonly downloadListeners = new Set<
    (e: VoiceDownloadEvent) => void
  >();
  /** Exit timestamps within the crash-loop window. */
  private recentExits: number[] = [];
  /** When set (> Date.now()) spawns are refused (crash-loop backoff). */
  private refuseSpawnUntil = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(VOICE_TOKENS.VOICE_WORKER_PROCESS_FACTORY, { isOptional: true })
    private readonly factory: IVoiceWorkerProcessFactory | null = null,
    @inject(VOICE_TOKENS.VOICE_WORKER_IDLE_MS, { isOptional: true })
    private readonly idleMs: number = DEFAULT_IDLE_MS,
  ) {}

  /** True when a worker factory is registered (Electron host). */
  get available(): boolean {
    return this.factory !== null;
  }

  onDownload(listener: (e: VoiceDownloadEvent) => void): VoiceEventDisposable {
    this.downloadListeners.add(listener);
    return {
      dispose: () => {
        this.downloadListeners.delete(listener);
      },
    };
  }

  async transcribe(audioPath: string, model: VoiceModelSpec): Promise<string> {
    const reply = await this.request({
      type: 'stt:transcribe',
      audioPath,
      model,
    });
    if (reply.ok === false) throw this.toError(reply.error, reply.category);
    if (!('text' in reply)) {
      throw new VoiceProviderError(
        'provider-error',
        'local',
        'Voice worker returned an unexpected transcribe response.',
      );
    }
    return reply.text;
  }

  async synthesize(
    text: string,
    voice: string,
    model: VoiceModelSpec,
    dtype: string,
  ): Promise<{ wav: Uint8Array; sampleRate: number }> {
    const reply = await this.request({
      type: 'tts:synthesize',
      text,
      voice,
      model,
      dtype,
    });
    if (reply.ok === false) throw this.toError(reply.error, reply.category);
    if (!('wav' in reply)) {
      throw new VoiceProviderError(
        'provider-error',
        'local',
        'Voice worker returned an unexpected synthesize response.',
      );
    }
    return { wav: reply.wav, sampleRate: reply.sampleRate };
  }

  async downloadStt(
    model: VoiceModelSpec,
  ): Promise<{ alreadyPresent: boolean }> {
    const reply = await this.request({ type: 'stt:download', model });
    if (reply.ok === false) throw this.toError(reply.error, reply.category);
    return {
      alreadyPresent: 'alreadyPresent' in reply && reply.alreadyPresent,
    };
  }

  async downloadTts(
    model: VoiceModelSpec,
    dtype: string,
  ): Promise<{ alreadyPresent: boolean }> {
    const reply = await this.request({
      type: 'tts:download',
      model,
      dtype,
    });
    if (reply.ok === false) throw this.toError(reply.error, reply.category);
    return {
      alreadyPresent: 'alreadyPresent' in reply && reply.alreadyPresent,
    };
  }

  /** Terminate the worker (will-quit disposal). Idempotent. */
  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.teardownWorker();
    for (const slot of this.pending.values()) {
      slot.reject(
        new VoiceProviderError(
          'process-crashed',
          'local',
          'Voice worker disposed.',
        ),
      );
    }
    this.pending.clear();
    this.inFlight = 0;
  }

  private async request(
    req: VoiceWorkerRequestBody,
  ): Promise<VoiceWorkerResponse> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    this.cancelIdleTimer();
    this.inFlight++;
    return new Promise<VoiceWorkerResponse>((resolve, reject) => {
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

  private ensureWorker(): IVoiceWorkerProcess {
    const now = Date.now();
    if (this.refuseSpawnUntil > now && !this.worker) {
      throw new VoiceProviderError(
        'process-crashed',
        'local',
        'The local voice engine is temporarily unavailable.',
        CRASH_LOOP_REMEDIATION,
      );
    }
    if (this.worker) return this.worker;
    if (!this.factory) {
      throw new VoiceProviderError(
        'assets-unavailable',
        'local',
        'Local voice is unavailable on this runtime.',
        VOICE_ASSETS_REMEDIATION,
      );
    }

    const worker = this.factory.spawn();
    worker.on('message', (msg: unknown) => this.handleMessage(msg));
    worker.on('exit', (code: number | null) => this.handleExit(code));
    this.worker = worker;
    return worker;
  }

  private handleMessage(msg: unknown): void {
    if (isDownloadProgressMessage(msg)) {
      this.emitDownload(msg);
      return;
    }
    const response = msg as VoiceWorkerResponse;
    if (typeof response?.id !== 'number') return;
    const slot = this.pending.get(response.id);
    if (!slot) return;
    this.pending.delete(response.id);
    slot.resolve(response);
  }

  private handleExit(code: number | null): void {
    if (code !== 0 && code !== null) {
      this.logger.warn('[voice-providers] voice worker exited', { code });
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
        '[voice-providers] voice worker crash-loop; backing off',
        {
          exits: this.recentExits.length,
          backoffMs: CRASH_LOOP_BACKOFF_MS,
        },
      );
    }

    // Reject all in-flight requests; the next request respawns a fresh worker
    // (deliberately no permanent failed flag — FR-2.2).
    for (const slot of this.pending.values()) {
      slot.reject(
        new VoiceProviderError(
          'process-crashed',
          'local',
          'The local voice engine stopped unexpectedly. Please retry.',
        ),
      );
    }
    this.pending.clear();
    this.inFlight = 0;
    this.cancelIdleTimer();
  }

  private emitDownload(msg: {
    direction: 'tts' | 'stt';
    model: string;
    kind:
      | 'download:start'
      | 'download:progress'
      | 'download:complete'
      | 'download:error';
    percent?: number;
    error?: string;
  }): void {
    const event = this.toDownloadEvent(msg);
    if (!event) return;
    for (const listener of this.downloadListeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        this.logger.warn('[voice-providers] download listener threw', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private toDownloadEvent(msg: {
    direction: 'tts' | 'stt';
    model: string;
    kind:
      | 'download:start'
      | 'download:progress'
      | 'download:complete'
      | 'download:error';
    percent?: number;
    error?: string;
  }): VoiceDownloadEvent | null {
    switch (msg.kind) {
      case 'download:start':
        return {
          kind: 'download:start',
          direction: msg.direction,
          model: msg.model,
        };
      case 'download:progress':
        return {
          kind: 'download:progress',
          direction: msg.direction,
          model: msg.model,
          percent: msg.percent ?? 0,
        };
      case 'download:complete':
        return {
          kind: 'download:complete',
          direction: msg.direction,
          model: msg.model,
        };
      case 'download:error':
        return {
          kind: 'download:error',
          direction: msg.direction,
          model: msg.model,
          error: msg.error ?? 'download failed',
        };
      default:
        return null;
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
      this.logger.warn('[voice-providers] voice worker kill failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private toError(
    message: string,
    category: VoiceErrorCategory,
  ): VoiceProviderError {
    return new VoiceProviderError(category, 'local', message);
  }
}
