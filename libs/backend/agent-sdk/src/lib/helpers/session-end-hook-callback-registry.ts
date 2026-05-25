import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface SessionEndHookPayload {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly reason: string;
  readonly timestamp: number;
}

export type SessionEndHookCallback =
  CallbackRegistryCallback<SessionEndHookPayload>;

@injectable()
export class SessionEndHookCallbackRegistry extends CallbackRegistryBase<SessionEndHookPayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'SessionEndHookCallbackRegistry');
  }
}
