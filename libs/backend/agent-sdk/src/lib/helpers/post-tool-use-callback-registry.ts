import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

export interface PostToolUsePayload {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly toolOutput: unknown;
  readonly exitCode: number | null;
  readonly success: boolean;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}

export type PostToolUseCallback = (
  payload: PostToolUsePayload,
) => void | Promise<void>;

interface PostToolUseEventMap {
  'post-tool-use': (payload: PostToolUsePayload) => void;
}

@injectable()
export class PostToolUseCallbackRegistry {
  private readonly emitter = new EventEmitter<PostToolUseEventMap>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  register(callback: PostToolUseCallback): () => void {
    const wrapped = (payload: PostToolUsePayload): void => {
      try {
        const result = callback(payload);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.logger.error(
              '[PostToolUseCallbackRegistry] async subscriber threw',
              err instanceof Error ? err : new Error(String(err)),
            );
          });
        }
      } catch (err: unknown) {
        this.logger.error(
          '[PostToolUseCallbackRegistry] subscriber threw',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    };
    this.emitter.on('post-tool-use', wrapped);
    return () => {
      this.emitter.off('post-tool-use', wrapped);
    };
  }

  get size(): number {
    return this.emitter.listenerCount('post-tool-use');
  }

  notifyAll(payload: PostToolUsePayload): void {
    this.emitter.emit('post-tool-use', payload);
  }
}
