import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';

export interface SdkAdapterInitializedEvent {
  readonly success: boolean;
  readonly timestamp: number;
}

export interface SdkAdapterDisposedEvent {
  readonly timestamp: number;
}

export interface SdkAdapterConfigChangedEvent {
  readonly key: string;
  readonly timestamp: number;
}

export interface SdkAdapterAuthFileChangedEvent {
  /** Provider whose external credential file changed (e.g. 'openai-codex'). */
  readonly providerId: string;
  readonly timestamp: number;
}

interface SdkAdapterEventMap {
  initialized: (event: SdkAdapterInitializedEvent) => void;
  disposed: (event: SdkAdapterDisposedEvent) => void;
  configChanged: (event: SdkAdapterConfigChangedEvent) => void;
  authFileChanged: (event: SdkAdapterAuthFileChangedEvent) => void;
}

export type SdkAdapterEventName = keyof SdkAdapterEventMap;

@injectable()
export class SdkAdapterEvents {
  private readonly emitter = new EventEmitter<SdkAdapterEventMap>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  emitInitialized(event: SdkAdapterInitializedEvent): void {
    this.safeEmit('initialized', event);
  }

  emitDisposed(event: SdkAdapterDisposedEvent): void {
    this.safeEmit('disposed', event);
  }

  emitConfigChanged(event: SdkAdapterConfigChangedEvent): void {
    this.safeEmit('configChanged', event);
  }

  emitAuthFileChanged(event: SdkAdapterAuthFileChangedEvent): void {
    this.safeEmit('authFileChanged', event);
  }

  onInitialized(
    listener: (event: SdkAdapterInitializedEvent) => void,
  ): () => void {
    this.emitter.on('initialized', listener);
    return () => this.emitter.off('initialized', listener);
  }

  onDisposed(listener: (event: SdkAdapterDisposedEvent) => void): () => void {
    this.emitter.on('disposed', listener);
    return () => this.emitter.off('disposed', listener);
  }

  onConfigChanged(
    listener: (event: SdkAdapterConfigChangedEvent) => void,
  ): () => void {
    this.emitter.on('configChanged', listener);
    return () => this.emitter.off('configChanged', listener);
  }

  onAuthFileChanged(
    listener: (event: SdkAdapterAuthFileChangedEvent) => void,
  ): () => void {
    this.emitter.on('authFileChanged', listener);
    return () => this.emitter.off('authFileChanged', listener);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  listenerCount(event: SdkAdapterEventName): number {
    return this.emitter.listenerCount(event);
  }

  private safeEmit<E extends SdkAdapterEventName>(
    event: E,
    payload: Parameters<SdkAdapterEventMap[E]>[0],
  ): void {
    try {
      this.emitter.emit(
        event,
        payload as unknown as SdkAdapterInitializedEvent &
          SdkAdapterDisposedEvent &
          SdkAdapterConfigChangedEvent &
          SdkAdapterAuthFileChangedEvent,
      );
    } catch (err) {
      this.logger.warn(
        `[SdkAdapterEvents] '${event}' listener threw`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}
