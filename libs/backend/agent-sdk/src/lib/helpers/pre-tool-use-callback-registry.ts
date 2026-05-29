import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface PreToolUsePayload {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}

export type PreToolUseCallback = CallbackRegistryCallback<PreToolUsePayload>;

@injectable()
export class PreToolUseCallbackRegistry extends CallbackRegistryBase<PreToolUsePayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'PreToolUseCallbackRegistry');
  }
}
