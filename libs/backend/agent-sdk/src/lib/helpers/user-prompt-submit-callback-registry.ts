import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface UserPromptSubmitPayload {
  readonly prompt: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}

export type UserPromptSubmitCallback =
  CallbackRegistryCallback<UserPromptSubmitPayload>;

@injectable()
export class UserPromptSubmitCallbackRegistry extends CallbackRegistryBase<UserPromptSubmitPayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'UserPromptSubmitCallbackRegistry');
  }
}
