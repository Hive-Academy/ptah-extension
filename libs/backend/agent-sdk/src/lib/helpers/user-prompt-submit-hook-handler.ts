import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isUserPromptSubmitHook } from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { UserPromptSubmitCallbackRegistry } from './user-prompt-submit-callback-registry';

@injectable()
export class UserPromptSubmitHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY)
    private readonly callbackRegistry: UserPromptSubmitCallbackRegistry,
  ) {}

  createHooks(
    sessionId: string,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      UserPromptSubmit: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              try {
                if (!isUserPromptSubmitHook(input)) {
                  return { continue: true };
                }
                if (this.callbackRegistry.size === 0) {
                  return { continue: true };
                }
                this.callbackRegistry.notifyAll({
                  prompt: input.prompt,
                  sessionId,
                  workspaceRoot: cwd,
                  timestamp: Date.now(),
                });
              } catch (error: unknown) {
                this.logger.warn(
                  '[UserPromptSubmitHookHandler] hook fan-out threw, swallowing',
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
