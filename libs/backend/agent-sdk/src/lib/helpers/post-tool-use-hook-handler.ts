import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isPostToolUseHook } from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { PostToolUseCallbackRegistry } from './post-tool-use-callback-registry';

function extractExitCode(toolResponse: unknown): number | null {
  if (toolResponse === null || typeof toolResponse !== 'object') {
    return null;
  }
  const candidate = (toolResponse as Record<string, unknown>)['exit_code'];
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }
  const camel = (toolResponse as Record<string, unknown>)['exitCode'];
  if (typeof camel === 'number' && Number.isFinite(camel)) {
    return camel;
  }
  return null;
}

function deriveSuccess(
  toolResponse: unknown,
  exitCode: number | null,
): boolean {
  if (exitCode !== null) {
    return exitCode === 0;
  }
  if (toolResponse === null || typeof toolResponse !== 'object') {
    return true;
  }
  const isError = (toolResponse as Record<string, unknown>)['is_error'];
  if (typeof isError === 'boolean') {
    return !isError;
  }
  return true;
}

@injectable()
export class PostToolUseHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly callbackRegistry: PostToolUseCallbackRegistry,
  ) {}

  createHooks(
    sessionId: string,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      PostToolUse: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              try {
                if (!isPostToolUseHook(input)) {
                  return { continue: true };
                }
                if (this.callbackRegistry.size === 0) {
                  return { continue: true };
                }
                const exitCode = extractExitCode(input.tool_response);
                const success = deriveSuccess(input.tool_response, exitCode);
                const resolvedSessionId =
                  typeof input.session_id === 'string' &&
                  input.session_id.length > 0
                    ? input.session_id
                    : sessionId;
                this.callbackRegistry.notifyAll({
                  toolName: input.tool_name,
                  toolInput: input.tool_input,
                  toolOutput: input.tool_response,
                  exitCode,
                  success,
                  sessionId: resolvedSessionId,
                  workspaceRoot: cwd,
                  timestamp: Date.now(),
                });
              } catch (error: unknown) {
                this.logger.warn(
                  '[PostToolUseHookHandler] hook fan-out threw, swallowing',
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
