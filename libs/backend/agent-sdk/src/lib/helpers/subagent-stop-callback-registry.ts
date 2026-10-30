import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface SubagentStopPayload {
  /** Derived from the transcript file name; null when no transcript path. */
  readonly subagentSessionId: string | null;
  /** Null when neither the hook payload nor the closure carries one. */
  readonly parentSessionId: string | null;
  readonly workspaceRoot: string | null;
  readonly agentId: string;
  readonly agentType: string | null;
  readonly transcriptPath: string | null;
  readonly timestamp: number;
}

export type SubagentStopCallback =
  CallbackRegistryCallback<SubagentStopPayload>;

@injectable()
export class SubagentStopCallbackRegistry extends CallbackRegistryBase<SubagentStopPayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'SubagentStopCallbackRegistry');
  }
}
