import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface SubagentBudgetStopPayload {
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly timestamp: number;
}

export type SubagentBudgetStopCallback =
  CallbackRegistryCallback<SubagentBudgetStopPayload>;

@injectable()
export class SubagentBudgetStopCallbackRegistry extends CallbackRegistryBase<SubagentBudgetStopPayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'SubagentBudgetStopCallbackRegistry');
  }
}
