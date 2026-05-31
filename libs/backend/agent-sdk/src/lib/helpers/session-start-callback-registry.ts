import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact';

export interface SessionStartPayload {
  readonly source: SessionStartSource;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}

export type SessionStartCallback =
  CallbackRegistryCallback<SessionStartPayload>;

@injectable()
export class SessionStartCallbackRegistry extends CallbackRegistryBase<SessionStartPayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'SessionStartCallbackRegistry');
  }
}
