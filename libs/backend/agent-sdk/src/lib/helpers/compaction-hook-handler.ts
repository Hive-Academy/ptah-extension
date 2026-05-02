/**
 * CompactionHookHandler - Handles SDK PreCompact hooks and notifies via callback
 *
 * Connects SDK compaction lifecycle hooks to the UI notification system via callbacks.
 * When SDK is about to compact (summarize) conversation history, this hook fires
 * and notifies the webview to display a "Optimizing Context" notification.
 *
 * Key behaviors:
 * - Hook NEVER throws (would break SDK)
 * - Always returns { continue: true } for non-blocking
 * - Uses callback pattern (EventBus is deleted from codebase)
 * - Logging for compaction events (info level)
 *
 * Flow:
 * 1. SDK triggers PreCompact hook before compacting conversation
 * 2. CompactionHookHandler receives hook input with trigger type (manual/auto)
 * 3. Callback is invoked to notify webview of compaction start
 * 4. UI shows "Optimizing Context" notification
 * 5. Hook returns { continue: true } to allow SDK to proceed with compaction
 *
 * @see TASK_2025_098 - SDK Session Compaction
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  PreCompactHookInput,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import type { SdkMessageTransformer } from '../sdk-message-transformer';

/**
 * Callback type for notifying when compaction starts
 * - sessionId: The session being compacted
 * - trigger: 'manual' (user requested) or 'auto' (threshold reached)
 * - timestamp: When the compaction started
 * - preTokens: Cumulative pre-compaction token usage (input + output +
 *   cache_read + cache_creation) sampled from the live transformer at
 *   PreCompact firing time. Used by the frontend to freeze the
 *   pre-compaction header stats during the compaction window and to pair
 *   the start event with the eventual `compact_boundary` for delta /
 *   duration computation. (TASK_2026_109 A2)
 */
export type CompactionStartCallback = (data: {
  sessionId: string;
  trigger: 'manual' | 'auto';
  timestamp: number;
  preTokens: number;
}) => void;

/**
 * Type guard to check if hook input is PreCompact
 * @param input - Hook input to check
 * @returns True if input is PreCompactHookInput
 */
export function isPreCompactHook(
  input: HookInput,
): input is PreCompactHookInput {
  return input.hook_event_name === 'PreCompact';
}

/**
 * CompactionHookHandler Service
 *
 * Creates SDK hook callbacks that notify the UI when compaction starts.
 * Uses callback pattern instead of EventBus (which was deleted from codebase).
 *
 * Usage:
 * ```typescript
 * const hookHandler = container.resolve(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER);
 * const hooks = hookHandler.createHooks(sessionId, (data) => {
 *   // Notify webview of compaction start
 *   rpcHandler.notify('session:compacting', data);
 * });
 *
 * // Pass to SDK query options
 * const options = { ...otherOptions, hooks: { ...existingHooks, ...hooks } };
 * ```
 */
@injectable()
export class CompactionHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    // TASK_2026_109 (A2): Inject the message transformer to read the latest
    // cumulative pre-compaction token snapshot at PreCompact firing time.
    // The transformer aggregates `message_start` + `message_delta` usage on
    // the streaming wire — sampling it here gives the frontend the exact
    // value needed to freeze the pre-compaction header stats during the
    // compaction window.
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer,
  ) {}

  /**
   * Create hooks configuration for SDK query options
   *
   * Returns a hooks object that can be merged with existing hooks (like subagent hooks).
   * The hook callback is wrapped with error handling to ensure
   * the SDK is never blocked by hook failures.
   *
   * Note: The AbortSignal parameter is part of the SDK hook callback signature
   * but is intentionally not used in compaction hooks. PreCompact events
   * are informational and complete instantly - there's no long-running
   * operation to abort. The signal is preserved for SDK API compliance.
   *
   * @param sessionId - Session ID for tracking which session is being compacted
   * @param onCompactionStart - Callback to invoke when compaction starts (optional)
   * @returns Hooks configuration for SDK query options
   */
  createHooks(
    sessionId: string,
    onCompactionStart?: CompactionStartCallback,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    // Capture callback in closure for use in hook
    const capturedCallback = onCompactionStart;

    // DIAGNOSTIC: Log hook creation
    this.logger.info('[CompactionHookHandler] Creating hooks for session', {
      sessionId,
      hasCallback: !!capturedCallback,
    });

    return {
      PreCompact: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              // Log that the hook was invoked by SDK
              this.logger.info(
                '[CompactionHookHandler] PreCompact hook invoked',
                {
                  hookEventName: input.hook_event_name,
                  sessionId,
                },
              );

              try {
                // Use type guard for type safety
                if (!isPreCompactHook(input)) {
                  this.logger.warn(
                    '[CompactionHookHandler] Unexpected hook input type for PreCompact',
                    {
                      expected: 'PreCompact',
                      received: input.hook_event_name,
                    },
                  );
                  return { continue: true };
                }

                // TASK_2025_098: Validate trigger field before use
                // SDK should always provide 'manual' or 'auto', but we guard against malformed data
                const trigger = input.trigger;
                if (trigger !== 'manual' && trigger !== 'auto') {
                  this.logger.warn(
                    '[CompactionHookHandler] Invalid trigger value, skipping callback',
                    {
                      trigger,
                      sessionId,
                    },
                  );
                  return { continue: true };
                }

                // Log compaction details
                this.logger.info(
                  '[CompactionHookHandler] PreCompact hook triggered',
                  {
                    sessionId,
                    trigger,
                    hasCustomInstructions: !!input.custom_instructions,
                  },
                );

                // Notify via callback if provided
                if (capturedCallback) {
                  // TASK_2026_109 (A2): Sample cumulative pre-compaction tokens
                  // from the live transformer snapshot. Returns 0 for sessions
                  // that haven't yet produced any assistant turn — acceptable
                  // because compaction-before-first-turn is a no-op edge case.
                  const preTokens =
                    this.messageTransformer.getCumulativeTokens(sessionId);

                  const compactionData = {
                    sessionId,
                    trigger, // Use validated trigger variable
                    timestamp: Date.now(),
                    preTokens,
                  };

                  this.logger.debug(
                    '[CompactionHookHandler] Invoking compaction callback',
                    compactionData,
                  );

                  // Invoke callback but don't await (fire-and-forget)
                  // This ensures we don't block the SDK even if callback takes time
                  try {
                    capturedCallback(compactionData);
                  } catch (callbackError) {
                    // Log but don't throw - callback errors shouldn't block SDK
                    this.logger.error(
                      '[CompactionHookHandler] Error in compaction callback',
                      callbackError instanceof Error
                        ? callbackError
                        : new Error(String(callbackError)),
                    );
                  }
                }

                this.logger.debug(
                  '[CompactionHookHandler] PreCompact processed successfully',
                  { sessionId },
                );
              } catch (error) {
                // CRITICAL: Never throw from hooks - it would break SDK
                this.logger.error(
                  '[CompactionHookHandler] Error in PreCompact hook',
                  error instanceof Error ? error : new Error(String(error)),
                );
              }

              // Always return continue: true to not block SDK compaction
              return { continue: true };
            },
          ],
        },
      ],
    };
  }

  /**
   * Dispose of the hook handler
   *
   * Called during extension deactivation to clean up resources.
   * Currently no-op but maintains consistency with other handlers
   * (e.g., SubagentHookHandler) and provides a hook for future cleanup needs.
   */
  dispose(): void {
    this.logger.debug('[CompactionHookHandler] Disposed');
  }
}
