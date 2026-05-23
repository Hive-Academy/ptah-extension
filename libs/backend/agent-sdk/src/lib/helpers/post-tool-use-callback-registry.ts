import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

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

export type PostToolUseCallback = CallbackRegistryCallback<PostToolUsePayload>;

@injectable()
export class PostToolUseCallbackRegistry extends CallbackRegistryBase<PostToolUsePayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'PostToolUseCallbackRegistry');
  }
}
