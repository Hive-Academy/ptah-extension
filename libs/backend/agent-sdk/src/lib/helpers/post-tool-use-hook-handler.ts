import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
  PostToolUseHookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isPostToolUseHook } from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { resolveHookSessionId } from './hook-session-resolver';
import type { ToolOutputCapper } from './compaction/tool-output-capper';
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
    @inject(SDK_TOKENS.SDK_TOOL_OUTPUT_CAPPER)
    private readonly capper?: ToolOutputCapper,
  ) {}

  createHooks(
    sessionId: string | undefined,
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
              if (!isPostToolUseHook(input)) {
                return { continue: true };
              }
              const cappedOutput = await this.capToolOutput(input, cwd);
              this.fanOut(input, sessionId, cwd);
              if (cappedOutput === input.tool_response) {
                return { continue: true };
              }
              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: 'PostToolUse',
                  updatedToolOutput: cappedOutput,
                },
              };
            },
          ],
        },
      ],
    };
  }

  /**
   * Runs the output capper. Returns the original `tool_response` object when
   * nothing changed; fail-open — a capper error never breaks the hook.
   */
  private async capToolOutput(
    input: PostToolUseHookInput,
    cwd: string,
  ): Promise<unknown> {
    if (!this.capper) {
      return input.tool_response;
    }
    try {
      return await this.capper.cap(
        input.tool_name,
        input.tool_input,
        input.tool_response,
        cwd,
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[PostToolUseHookHandler] output capper threw, ignoring',
        {
          error: error instanceof Error ? error.message : String(error),
          toolName: input.tool_name,
        },
      );
      return input.tool_response;
    }
  }

  private fanOut(
    input: PostToolUseHookInput,
    sessionId: string | undefined,
    cwd: string,
  ): void {
    try {
      if (this.callbackRegistry.size === 0) {
        return;
      }
      const exitCode = extractExitCode(input.tool_response);
      const success = deriveSuccess(input.tool_response, exitCode);
      const resolvedSessionId = resolveHookSessionId(
        input.session_id,
        sessionId,
      );
      if (!resolvedSessionId) {
        this.logger.warn(
          '[PostToolUseHookHandler] PostToolUse missing sessionId, skipping fan-out',
          { toolName: input.tool_name },
        );
        return;
      }
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
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        },
      );
    }
  }
}
