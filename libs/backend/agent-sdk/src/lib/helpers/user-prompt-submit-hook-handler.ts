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
import { agentIdField } from './callback-registry.base';
import { UserPromptSubmitCallbackRegistry } from './user-prompt-submit-callback-registry';
import type { SubagentBudgetMonitor } from './compaction/subagent-budget-monitor';
import type {
  NextTurnReminder,
  NextTurnReminderQueue,
} from './next-turn-reminder.queue';

/**
 * Upper bound for the pending-handoff pointer of one prompt. It backs the
 * index's own 600 ms budget, so a stalled filesystem never holds the prompt.
 */
export const POINTER_TIMEOUT_MS = 1_000;

/** Built-in error classes a callback failure is logged as, most specific first. */
const LOGGED_ERROR_CLASSES = [
  TypeError,
  RangeError,
  ReferenceError,
  SyntaxError,
  Error,
] as const;

/**
 * The class of a thrown value, found with `instanceof` against built-in
 * classes only. No property of the value is read: a callback controls its
 * message, `name` and `code` (any may carry the prompt), and a getter on
 * them could throw.
 */
function callbackErrorType(error: unknown): string {
  const match = LOGGED_ERROR_CLASSES.find((type) => error instanceof type);
  return match ? match.name : typeof error;
}

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
    @inject(SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE, { isOptional: true })
    private readonly nextTurnReminderQueue?: Pick<
      NextTurnReminderQueue,
      'takeEntry' | 'allows'
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
              this.fanOut(
                input.prompt,
                resolvedSessionId,
                cwd,
                sessionId,
                input.agent_id,
              );
              // Main thread only: a subagent's own prompt carries `agent_id`.
              if (input.agent_id || !resolvedSessionId) {
                return { continue: true };
              }
              let drained: NextTurnReminder | null = null;
              try {
                drained =
                  this.nextTurnReminderQueue?.takeEntry(resolvedSessionId) ??
                  null;
              } catch (error: unknown) {
                // degradation-audit: reported - an optional reminder failure cannot stop a prompt.
                this.logger.warn(
                  '[UserPromptSubmitHookHandler] Reminder drain failed, skipping',
                  { errorType: callbackErrorType(error) },
                );
              }
              const pointer = await this.pointer(
                resolvedSessionId,
                resolveHookCwd(input.cwd, cwd) ?? undefined,
              );
              // Re-checked after the await: its producer may be off by now.
              const reminder = this.stillAllowed(drained);
              const additionalContext = [pointer, reminder]
                .filter(Boolean)
                .join('\n\n');
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
    agentId: string | undefined,
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
        ...agentIdField(agentId),
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[UserPromptSubmitHookHandler] hook fan-out threw, swallowing',
        {
          errorType: callbackErrorType(error),
          sessionId: closureSessionId,
        },
      );
    }
  }

  /**
   * The drained reminder's text if its owner still allows injection right
   * now (for host routing: the live setting); otherwise `null`. Untagged
   * reminders of other producers always pass.
   */
  private stillAllowed(drained: NextTurnReminder | null): string | null {
    if (!drained || !this.nextTurnReminderQueue) return null;
    try {
      return this.nextTurnReminderQueue.allows(
        drained.owner,
        drained.generation,
      )
        ? drained.text
        : null;
    } catch (error: unknown) {
      // degradation-audit: reported - an unreadable gate withholds only that optional reminder.
      this.logger.warn(
        '[UserPromptSubmitHookHandler] Reminder check failed, skipping',
        { errorType: callbackErrorType(error) },
      );
      return null;
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
      // degradation-audit: reported - optional handoff pointer failure is logged and omitted.
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
