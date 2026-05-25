import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface ToolFailurePayload {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly error: string;
  readonly isInterrupt: boolean;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}

export type ToolFailureCallback = CallbackRegistryCallback<ToolFailurePayload>;

@injectable()
export class ToolFailureCallbackRegistry extends CallbackRegistryBase<ToolFailurePayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'ToolFailureCallbackRegistry');
  }
}
