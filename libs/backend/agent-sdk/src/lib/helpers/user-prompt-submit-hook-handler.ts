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
import { resolveHookCwd, resolveHookSessionId } from './hook-session-resolver';
import { UserPromptSubmitCallbackRegistry } from './user-prompt-submit-callback-registry';
import type { SubagentBudgetMonitor } from './compaction/subagent-budget-monitor';

/**
 * Upper bound for the pending-handoff pointer of one prompt. It backs the
 * index's own 600 ms budget, so a stalled filesystem never holds the prompt.
 */
export const POINTER_TIMEOUT_MS = 1_000;

/** Error names logged as they are; any other name is logged as `Error`. */
const BUILT_IN_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
]);
/** An error code shaped like `ENOENT` or `ERR_INVALID_ARG`; anything else is dropped. */
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;

@injectable()
export class UserPromptSubmitHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY)
    private readonly callbackRegistry: UserPromptSubmitCallbackRegistry,
    /**
     * Names pending subagent handoff records on main-thread prompts. Absent
     * in callers that construct the handler without one: no pointer.
     */
    @inject(SDK_TOKENS.SDK_SUBAGENT_BUDGET_MONITOR, { isOptional: true })
    private readonly subagentBudgetMonitor?: Pick<
      SubagentBudgetMonitor,
      'handoffPointer'
    >,
  ) {}

  createHooks(
    sessionId: string | undefined,
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
              if (!isUserPromptSubmitHook(input)) {
                return { continue: true };
              }
              const resolvedSessionId = resolveHookSessionId(
                input.session_id,
                sessionId,
              );
              this.fanOut(input.prompt, resolvedSessionId, cwd, sessionId);
              // Main thread only: a subagent's own prompt carries `agent_id`.
              if (input.agent_id || !resolvedSessionId) {
                return { continue: true };
              }
              const additionalContext = await this.pointer(
                resolvedSessionId,
                resolveHookCwd(input.cwd, cwd) ?? undefined,
              );
              return additionalContext
                ? {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'UserPromptSubmit',
                      additionalContext,
                    },
                  }
                : { continue: true };
            },
          ],
        },
      ],
    };
  }

  /** Notify the registered prompt callbacks; never throws. */
  private fanOut(
    prompt: string,
    resolvedSessionId: string | null,
    cwd: string,
    closureSessionId: string | undefined,
  ): void {
    try {
      if (this.callbackRegistry.size === 0) {
        return;
      }
      if (!resolvedSessionId) {
        this.logger.warn(
          '[UserPromptSubmitHookHandler] UserPromptSubmit missing sessionId, skipping fan-out',
          { promptLength: prompt?.length ?? 0 },
        );
        return;
      }
      this.callbackRegistry.notifyAll({
        prompt,
        sessionId: resolvedSessionId,
        workspaceRoot: cwd,
        timestamp: Date.now(),
      });
    } catch (error: unknown) {
      // A built-in error name and a code-shaped code only: a callback controls
      // the message, `name` and `code`, and any of them may carry the prompt.
      const code = (error as { code?: unknown } | null)?.code;
      this.logger.warn(
        '[UserPromptSubmitHookHandler] hook fan-out threw, swallowing',
        {
          errorType:
            error instanceof Error
              ? BUILT_IN_ERROR_NAMES.has(error.name)
                ? error.name
                : 'Error'
              : typeof error,
          errorCode:
            typeof code === 'string' && SAFE_ERROR_CODE.test(code)
              ? code
              : undefined,
          sessionId: closureSessionId,
        },
      );
    }
  }

  /** The pending-handoff pointer, within {@link POINTER_TIMEOUT_MS}; never rejects. */
  private async pointer(
    sessionId: string,
    hookCwd: string | undefined,
  ): Promise<string | undefined> {
    if (!this.subagentBudgetMonitor) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.subagentBudgetMonitor.handoffPointer(sessionId, hookCwd),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), POINTER_TIMEOUT_MS);
        }),
      ]);
    } catch (error: unknown) {
      this.logger.warn(
        '[UserPromptSubmitHookHandler] Handoff pointer failed, skipping',
        {
          errorType: error instanceof Error ? error.name : typeof error,
          sessionId,
        },
      );
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
