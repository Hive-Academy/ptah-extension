import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

export interface UserPromptSubmitPayload {
  readonly prompt: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}

export type UserPromptSubmitCallback = (
  payload: UserPromptSubmitPayload,
) => void | Promise<void>;

interface UserPromptSubmitEventMap {
  'user-prompt-submit': (payload: UserPromptSubmitPayload) => void;
}

@injectable()
export class UserPromptSubmitCallbackRegistry {
  private readonly emitter = new EventEmitter<UserPromptSubmitEventMap>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  register(callback: UserPromptSubmitCallback): () => void {
    const wrapped = (payload: UserPromptSubmitPayload): void => {
      try {
        const result = callback(payload);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.logger.error(
              '[UserPromptSubmitCallbackRegistry] async subscriber threw',
              err instanceof Error ? err : new Error(String(err)),
            );
          });
        }
      } catch (err: unknown) {
        this.logger.error(
          '[UserPromptSubmitCallbackRegistry] subscriber threw',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    };
    this.emitter.on('user-prompt-submit', wrapped);
    return () => {
      this.emitter.off('user-prompt-submit', wrapped);
    };
  }

  get size(): number {
    return this.emitter.listenerCount('user-prompt-submit');
  }

  notifyAll(payload: UserPromptSubmitPayload): void {
    this.emitter.emit('user-prompt-submit', payload);
  }
}
