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

interface SdkAdapterEventMap {
  initialized: (event: SdkAdapterInitializedEvent) => void;
  disposed: (event: SdkAdapterDisposedEvent) => void;
  configChanged: (event: SdkAdapterConfigChangedEvent) => void;
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
          SdkAdapterConfigChangedEvent,
      );
    } catch (err) {
      this.logger.warn(
        `[SdkAdapterEvents] '${event}' listener threw`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}
