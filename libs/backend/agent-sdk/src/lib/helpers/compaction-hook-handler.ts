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
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  PreCompactHookInput,
  PostCompactHookInput,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import type { LiveUsageTracker } from './live-usage-tracker';
import type { CompactionCallbackRegistry } from './compaction-callback-registry';
import type { SdkAdapterEvents } from './sdk-adapter-events.service';

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
 * duration computation.
 */
export type CompactionStartCallback = (data: {
  sessionId: string;
  trigger: 'manual' | 'auto';
  timestamp: number;
  preTokens: number;
  cwd?: string | null;
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
 * Type guard narrowing a hook input to PostCompactHookInput.
 */
export function isPostCompactHook(
  input: HookInput,
): input is PostCompactHookInput {
  return input.hook_event_name === 'PostCompact';
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
    @inject(SDK_TOKENS.SDK_LIVE_USAGE_TRACKER)
    private readonly usageTracker: LiveUsageTracker,
    @inject(SDK_TOKENS.SDK_COMPACTION_CALLBACK_REGISTRY)
    private readonly callbackRegistry?: CompactionCallbackRegistry,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private readonly sdkAdapterEvents?: SdkAdapterEvents,
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
    cwd: string | null,
    onCompactionStart?: CompactionStartCallback,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const capturedCallback = onCompactionStart;
    this.logger.info('[CompactionHookHandler] Creating hooks for session', {
      sessionId,
      hasCallback: !!capturedCallback,
    });

    const sdkAdapterEvents = this.sdkAdapterEvents;
    return {
      PreCompact: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              this.logger.info(
                '[CompactionHookHandler] PreCompact hook invoked',
                {
                  hookEventName: input.hook_event_name,
                  sessionId,
                },
              );

              try {
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
                this.logger.info(
                  '[CompactionHookHandler] PreCompact hook triggered',
                  {
                    sessionId,
                    trigger,
                    hasCustomInstructions: !!input.custom_instructions,
                  },
                );
                let preTokensSampled: number | null = null;
                const ensurePreTokens = () => {
                  if (preTokensSampled === null) {
                    preTokensSampled =
                      this.usageTracker.getCumulativeTokens(sessionId);
                  }
                  return preTokensSampled;
                };

                if (this.callbackRegistry && this.callbackRegistry.size > 0) {
                  this.callbackRegistry.notifyAll({
                    sessionId,
                    trigger,
                    timestamp: Date.now(),
                    preTokens: ensurePreTokens(),
                    cwd,
                  });
                }
                if (capturedCallback) {
                  const preTokens = ensurePreTokens();

                  const compactionData = {
                    sessionId,
                    trigger,
                    timestamp: Date.now(),
                    preTokens,
                    cwd,
                  };

                  this.logger.debug(
                    '[CompactionHookHandler] Invoking compaction callback',
                    compactionData,
                  );
                  try {
                    capturedCallback(compactionData);
                  } catch (callbackError) {
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
                this.logger.error(
                  '[CompactionHookHandler] Error in PreCompact hook',
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
              return { continue: true };
            },
          ],
        },
      ],
      PostCompact: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              this.logger.info(
                '[CompactionHookHandler] PostCompact hook invoked',
                {
                  hookEventName: input.hook_event_name,
                  sessionId,
                },
              );

              try {
                if (!isPostCompactHook(input)) {
                  this.logger.warn(
                    '[CompactionHookHandler] Unexpected hook input type for PostCompact',
                    {
                      expected: 'PostCompact',
                      received: input.hook_event_name,
                    },
                  );
                  return { continue: true };
                }
                const trigger = input.trigger;
                if (trigger !== 'manual' && trigger !== 'auto') {
                  this.logger.warn(
                    '[CompactionHookHandler] Invalid trigger value, skipping emit',
                    {
                      trigger,
                      sessionId,
                    },
                  );
                  return { continue: true };
                }

                if (sdkAdapterEvents) {
                  const resolvedSessionId = input.session_id ?? sessionId;
                  const resolvedCwd = input.cwd ?? cwd;
                  if (!resolvedSessionId || !resolvedCwd) {
                    this.logger.warn(
                      '[CompactionHookHandler] PostCompact missing sessionId or cwd, skipping emit',
                      {
                        hasSessionId: Boolean(resolvedSessionId),
                        hasCwd: Boolean(resolvedCwd),
                        trigger,
                      },
                    );
                  } else {
                    sdkAdapterEvents.emitCompactionComplete({
                      sessionId: resolvedSessionId,
                      cwd: resolvedCwd,
                      trigger,
                      compactSummary: input.compact_summary,
                      timestamp: Date.now(),
                    });
                  }
                }

                this.logger.debug(
                  '[CompactionHookHandler] PostCompact processed successfully',
                  { sessionId },
                );
              } catch (error: unknown) {
                this.logger.error(
                  '[CompactionHookHandler] Error in PostCompact hook',
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
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
