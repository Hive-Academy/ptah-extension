/**
 * SessionStartHookHandler - Handles SDK SessionStart hooks
 *
 * Detects when the SDK restarts a session due to /clear command
 * and notifies the frontend to reset tab state.
 *
 * SessionStart hook fires with source:
 * - 'startup': New session started
 * - 'resume': Session resumed from disk
 * - 'clear': /clear command processed - conversation cleared
 * - 'compact': After compaction completes
 *
 * We only care about 'clear' to reset frontend state.
 *
 * Key behaviors:
 * - Hook NEVER throws (would break SDK)
 * - Always returns { continue: true } for non-blocking
 * - Uses callback pattern (fire-and-forget)
 * - Logging for session start events (info level)
 *
 * @see TASK_2025_181 - Fix slash command handling
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  SessionStartHookInput,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isSessionStartHook } from '../types/sdk-types/claude-sdk.types';

/**
 * Callback type for notifying when session is cleared via /clear command
 * - sessionId: The session that was cleared
 * - newSessionId: The new session ID assigned by SDK after clear (from BaseHookInput.session_id)
 * - timestamp: When the clear was detected
 */
export type SessionClearedCallback = (data: {
  sessionId: string;
  newSessionId?: string;
  timestamp: number;
}) => void;

/**
 * SessionStartHookHandler Service
 *
 * Creates SDK hook callbacks that detect /clear commands and notify the UI.
 * Uses callback pattern for notification (consistent with CompactionHookHandler).
 *
 * Usage:
 * ```typescript
 * const hookHandler = container.resolve(SDK_TOKENS.SDK_SESSION_START_HOOK_HANDLER);
 * const hooks = hookHandler.createHooks(sessionId, (data) => {
 *   // Notify webview that session was cleared
 *   rpcHandler.notify('session:cleared', data);
 * });
 *
 * // Pass to SDK query options
 * const options = { ...otherOptions, hooks: { ...existingHooks, ...hooks } };
 * ```
 */
@injectable()
export class SessionStartHookHandler {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Create hooks configuration for SDK query options
   *
   * Returns a hooks object that can be merged with existing hooks (like subagent hooks,
   * compaction hooks). The hook callback is wrapped with error handling to ensure
   * the SDK is never blocked by hook failures.
   *
   * Note: The AbortSignal parameter is part of the SDK hook callback signature
   * but is intentionally not used in SessionStart hooks. SessionStart events
   * are informational and complete instantly - there's no long-running
   * operation to abort. The signal is preserved for SDK API compliance.
   *
   * @param sessionId - Session ID for tracking which session fired the hook
   * @param onSessionCleared - Callback to invoke when /clear is detected (optional)
   * @returns Hooks configuration for SDK query options
   */
  createHooks(
    sessionId: string,
    onSessionCleared?: SessionClearedCallback
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    // Capture callback in closure for use in hook
    const capturedCallback = onSessionCleared;

    // DIAGNOSTIC: Log hook creation
    this.logger.info('[SessionStartHookHandler] Creating hooks for session', {
      sessionId,
      hasCallback: !!capturedCallback,
    });

    return {
      SessionStart: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal }
            ): Promise<HookJSONOutput> => {
              // Log that the hook was invoked by SDK
              this.logger.info(
                '[SessionStartHookHandler] SessionStart hook invoked',
                {
                  hookEventName: input.hook_event_name,
                  sessionId,
                }
              );

              try {
                // Use type guard for type safety
                if (!isSessionStartHook(input)) {
                  this.logger.warn(
                    '[SessionStartHookHandler] Unexpected hook input type for SessionStart',
                    {
                      expected: 'SessionStart',
                      received: input.hook_event_name,
                    }
                  );
                  return { continue: true };
                }

                // Log session start details
                this.logger.info(
                  '[SessionStartHookHandler] SessionStart hook triggered',
                  {
                    sessionId,
                    source: input.source,
                    newSessionId: input.session_id,
                  }
                );

                // Only invoke callback when source is 'clear' (i.e., /clear command was processed)
                if (input.source === 'clear' && capturedCallback) {
                  const clearedData = {
                    sessionId,
                    newSessionId: input.session_id,
                    timestamp: Date.now(),
                  };

                  this.logger.debug(
                    '[SessionStartHookHandler] Invoking session cleared callback',
                    clearedData
                  );

                  // Invoke callback but don't await (fire-and-forget)
                  // This ensures we don't block the SDK even if callback takes time
                  try {
                    capturedCallback(clearedData);
                  } catch (callbackError) {
                    // Log but don't throw - callback errors shouldn't block SDK
                    this.logger.error(
                      '[SessionStartHookHandler] Error in session cleared callback',
                      callbackError instanceof Error
                        ? callbackError
                        : new Error(String(callbackError))
                    );
                  }
                }

                this.logger.debug(
                  '[SessionStartHookHandler] SessionStart processed successfully',
                  { sessionId }
                );
              } catch (error) {
                // CRITICAL: Never throw from hooks - it would break SDK
                this.logger.error(
                  '[SessionStartHookHandler] Error in SessionStart hook',
                  error instanceof Error ? error : new Error(String(error))
                );
              }

              // Always return continue: true to not block SDK
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
   * (e.g., CompactionHookHandler, SubagentHookHandler).
   */
  dispose(): void {
    this.logger.debug('[SessionStartHookHandler] Disposed');
  }
}
