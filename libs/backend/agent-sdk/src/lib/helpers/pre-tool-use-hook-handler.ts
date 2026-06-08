import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isPreToolUseHook } from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { PreToolUseCallbackRegistry } from './pre-tool-use-callback-registry';

@injectable()
export class PreToolUseHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_PRE_TOOL_USE_CALLBACK_REGISTRY)
    private readonly callbackRegistry: PreToolUseCallbackRegistry,
  ) {}

  createHooks(
    sessionId: string,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      PreToolUse: [
        {
          matcher: 'Read',
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              try {
                if (!isPreToolUseHook(input)) {
                  return { continue: true };
                }
                if (input.tool_name !== 'Read') {
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
                  toolName: input.tool_name,
                  toolInput: input.tool_input,
                  sessionId: resolvedSessionId,
                  workspaceRoot: cwd,
                  timestamp: Date.now(),
                });
              } catch (error: unknown) {
                this.logger.warn(
                  '[PreToolUseHookHandler] hook fan-out threw, swallowing',
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
