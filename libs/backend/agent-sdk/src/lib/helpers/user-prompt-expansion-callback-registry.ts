import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface UserPromptExpansionPayload {
  readonly skillSlug: string;
  readonly expansionType: 'slash_command' | 'mcp_prompt';
  readonly commandArgs: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}

export type UserPromptExpansionCallback =
  CallbackRegistryCallback<UserPromptExpansionPayload>;

@injectable()
export class UserPromptExpansionCallbackRegistry extends CallbackRegistryBase<UserPromptExpansionPayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'UserPromptExpansionCallbackRegistry');
  }
}
