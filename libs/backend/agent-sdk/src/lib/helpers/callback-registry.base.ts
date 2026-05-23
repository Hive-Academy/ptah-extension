import EventEmitter from 'eventemitter3';
import { type Logger } from '@ptah-extension/vscode-core';

export type CallbackRegistryCallback<TPayload> = (
  payload: TPayload,
) => void | Promise<void>;

interface CallbackRegistryEventMap<TPayload> {
  event: (payload: TPayload) => void;
}

export abstract class CallbackRegistryBase<TPayload> {
  private readonly emitter = new EventEmitter<
    CallbackRegistryEventMap<TPayload>
  >();

  protected constructor(
    private readonly logger: Logger,
    private readonly logScope: string,
  ) {}

  register(callback: CallbackRegistryCallback<TPayload>): () => void {
    const wrapped = (payload: TPayload): void => {
      try {
        const result = callback(payload);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.logger.error(
              `[${this.logScope}] async subscriber threw`,
              err instanceof Error ? err : new Error(String(err)),
            );
          });
        }
      } catch (err: unknown) {
        this.logger.error(
          `[${this.logScope}] subscriber threw`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    };
    this.emitter.on('event', wrapped);
    return () => {
      this.emitter.off('event', wrapped);
    };
  }

  get size(): number {
    return this.emitter.listenerCount('event');
  }

  notifyAll(payload: TPayload): void {
    this.emitter.emit('event', payload);
  }
}
