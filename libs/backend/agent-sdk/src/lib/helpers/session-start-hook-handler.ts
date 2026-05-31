import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isSessionStartHook } from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { SessionStartCallbackRegistry } from './session-start-callback-registry';

@injectable()
export class SessionStartHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_START_CALLBACK_REGISTRY)
    private readonly callbackRegistry: SessionStartCallbackRegistry,
  ) {}

  createHooks(
    sessionId: string,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      SessionStart: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              try {
                if (!isSessionStartHook(input)) {
                  return { continue: true };
                }
                if (this.callbackRegistry.size === 0) {
                  return { continue: true };
                }
                const resolvedSessionId =
                  typeof input.session_id === 'string' &&
                  input.session_id.length > 0
                    ? input.session_id
                    : sessionId;
                this.callbackRegistry.notifyAll({
                  source: input.source,
                  sessionId: resolvedSessionId,
                  workspaceRoot: cwd,
                  timestamp: Date.now(),
                });
              } catch (error: unknown) {
                this.logger.warn(
                  '[SessionStartHookHandler] hook fan-out threw, swallowing',
                  {
                    error:
                      error instanceof Error ? error.message : String(error),
                    sessionId,
                  },
                );
              }
              return { continue: true };
            },
          ],
        },
      ],
    };
  }
}
