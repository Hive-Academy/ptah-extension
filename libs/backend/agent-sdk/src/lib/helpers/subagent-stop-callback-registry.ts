import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface SubagentStopPayload {
  readonly subagentSessionId: string;
  readonly parentSessionId: string;
  readonly workspaceRoot: string;
  readonly agentId: string;
  readonly agentType: string;
  readonly transcriptPath: string;
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
