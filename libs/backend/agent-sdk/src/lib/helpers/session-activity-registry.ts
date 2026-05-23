import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

export interface SessionActivityPayload {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly role: 'user' | 'assistant';
  readonly timestamp: number;
}

export type SessionActivityCallback = (
  payload: SessionActivityPayload,
) => void | Promise<void>;

interface SessionActivityEventMap {
  activity: (payload: SessionActivityPayload) => void;
}

@injectable()
export class SessionActivityRegistry {
  private readonly emitter = new EventEmitter<SessionActivityEventMap>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  register(callback: SessionActivityCallback): () => void {
    const wrapped = (payload: SessionActivityPayload): void => {
      try {
        const result = callback(payload);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.logger.error(
              '[SessionActivityRegistry] async subscriber threw',
              err instanceof Error ? err : new Error(String(err)),
            );
          });
        }
      } catch (err: unknown) {
        this.logger.error(
          '[SessionActivityRegistry] subscriber threw',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    };
    this.emitter.on('activity', wrapped);
    return () => {
      this.emitter.off('activity', wrapped);
    };
  }

  get size(): number {
    return this.emitter.listenerCount('activity');
  }

  notifyAll(payload: SessionActivityPayload): void {
    this.emitter.emit('activity', payload);
  }
}
