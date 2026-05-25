import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface StopPayload {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly lastAssistantMessage: string | null;
  readonly effortLevel: string | null;
  readonly hasBackgroundWork: boolean;
  readonly timestamp: number;
}

export type StopCallback = CallbackRegistryCallback<StopPayload>;

@injectable()
export class StopCallbackRegistry extends CallbackRegistryBase<StopPayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'StopCallbackRegistry');
  }
}
