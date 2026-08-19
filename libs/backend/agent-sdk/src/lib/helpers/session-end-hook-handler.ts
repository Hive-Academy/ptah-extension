import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isSessionEndHook } from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { resolveHookSessionId } from './hook-session-resolver';
import { SessionEndHookCallbackRegistry } from './session-end-hook-callback-registry';

@injectable()
export class SessionEndHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_END_HOOK_CALLBACK_REGISTRY)
    private readonly callbackRegistry: SessionEndHookCallbackRegistry,
  ) {}

  createHooks(
    sessionId: string | undefined,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      SessionEnd: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              try {
                if (!isSessionEndHook(input)) {
                  return { continue: true };
                }
                if (this.callbackRegistry.size === 0) {
                  return { continue: true };
                }
                const resolvedSessionId = resolveHookSessionId(
                  input.session_id,
                  sessionId,
                );
                if (!resolvedSessionId) {
                  this.logger.warn(
                    '[SessionEndHookHandler] SessionEnd missing sessionId, skipping fan-out',
                    { reason: input.reason },
                  );
                  return { continue: true };
                }
                this.callbackRegistry.notifyAll({
                  sessionId: resolvedSessionId,
                  workspaceRoot: cwd,
                  reason: input.reason,
                  timestamp: Date.now(),
                });
              } catch (error: unknown) {
                this.logger.warn(
                  '[SessionEndHookHandler] hook fan-out threw, swallowing',
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
