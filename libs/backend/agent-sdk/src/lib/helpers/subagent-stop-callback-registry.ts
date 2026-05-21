import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

export interface SubagentStopPayload {
  readonly subagentSessionId: string;
  readonly parentSessionId: string;
  readonly workspaceRoot: string;
  readonly agentId: string;
  readonly agentType: string;
  readonly transcriptPath: string;
  readonly timestamp: number;
}

export type SubagentStopCallback = (
  payload: SubagentStopPayload,
) => void | Promise<void>;

interface SubagentStopEventMap {
  'subagent-stop': (payload: SubagentStopPayload) => void;
}

@injectable()
export class SubagentStopCallbackRegistry {
  private readonly emitter = new EventEmitter<SubagentStopEventMap>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  register(callback: SubagentStopCallback): () => void {
    const wrapped = (payload: SubagentStopPayload): void => {
      try {
        const result = callback(payload);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.logger.error(
              '[SubagentStopCallbackRegistry] async subscriber threw',
              err instanceof Error ? err : new Error(String(err)),
            );
          });
        }
      } catch (err: unknown) {
        this.logger.error(
          '[SubagentStopCallbackRegistry] subscriber threw',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    };
    this.emitter.on('subagent-stop', wrapped);
    return () => {
      this.emitter.off('subagent-stop', wrapped);
    };
  }

  get size(): number {
    return this.emitter.listenerCount('subagent-stop');
  }

  notifyAll(payload: SubagentStopPayload): void {
    this.emitter.emit('subagent-stop', payload);
  }
}
