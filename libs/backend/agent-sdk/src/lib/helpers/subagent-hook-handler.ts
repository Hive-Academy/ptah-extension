/**
 * SubagentHookHandler - Encapsulates SDK subagent hook callbacks
 *
 * Connects SDK lifecycle hooks to SubagentRegistryService for tracking
 * subagent lifecycle state (resumption support).
 *
 * Key behaviors:
 * - Hooks NEVER throw (would break SDK)
 * - Always return { continue: true } for non-blocking
 * - Logging for all lifecycle events (debug level)
 *
 * Flow:
 * 1. SubagentStart hook fires -> registry.register() for resumption tracking
 * 2. Subagent visibility flows via `agentProgressSummaries: true` Option in
 *    SdkQueryOptionsBuilder + task_* system messages (task_started,
 *    task_progress, task_updated, task_notification) handled by
 *    SdkMessageTransformer.
 * 3. SubagentStop hook fires -> registry.update() to mark as 'completed'.
 *
 * Subagent visibility flows via the SDK's built-in task_* event stream
 * (`agentProgressSummaries: true` Option). The legacy AgentSessionWatcherService
 * is a no-op stub retained for legacy consumers.
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import {
  isSubagentStartHook,
  isSubagentStopHook,
} from '../types/sdk-types/claude-sdk.types';
import type {
  SubagentStartHookInput,
  SubagentStopHookInput,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';

/**
 * SubagentHookHandler Service
 *
 * Creates SDK hook callbacks that connect subagent lifecycle events
 * to the AgentSessionWatcherService for real-time text streaming.
 *
 * Usage:
 * ```typescript
 * const hookHandler = container.resolve(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER);
 * const hooks = hookHandler.createHooks('/path/to/workspace');
 *
 * // Pass to SDK query options
 * const options = { ...otherOptions, hooks };
 * ```
 */
@injectable()
export class SubagentHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
  ) {}

  /**
   * Create hooks configuration for SDK query options
   *
   * Returns a hooks object that can be spread into SDK query options.
   * Each hook callback is wrapped with error handling to ensure
   * the SDK is never blocked by hook failures.
   *
   * Note: The AbortSignal parameter is part of the SDK hook callback signature
   * but is intentionally not used in subagent hooks. Subagent lifecycle events
   * (start/stop) are informational and complete instantly - there's no long-running
   * operation to abort. The signal is preserved for SDK API compliance.
   *
   * parentSessionId is captured in closure (not stored as instance state) to
   * prevent state corruption when multiple sessions run concurrently —
   * a singleton service would otherwise overwrite shared state.
   *
   * @param workspacePath - Workspace path for agent file detection
   * @param parentSessionId - Optional parent session ID for registry tracking
   * @returns Hooks configuration for SDK query options
   */
  createHooks(
    workspacePath: string,
    parentSessionId?: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    // FIX: Capture parentSessionId in closure instead of storing on instance
    // This prevents concurrent session corruption (multiple sessions would overwrite)
    const capturedParentSessionId = parentSessionId;

    // DIAGNOSTIC: Log hook creation
    this.logger.info('[SubagentHookHandler] Creating hooks for workspace', {
      workspacePath,
      parentSessionId: capturedParentSessionId,
    });

    return {
      SubagentStart: [
        {
          hooks: [
            async (
              input: HookInput,
              toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              // DIAGNOSTIC: Log that the hook was actually invoked by SDK
              this.logger.info(
                '[SubagentHookHandler] >>> SubagentStart HOOK INVOKED <<<',
                {
                  hookEventName: input.hook_event_name,
                  toolUseId,
                  sessionId: input.session_id,
                  parentSessionId: capturedParentSessionId,
                },
              );

              // Use type guard instead of type assertion for type safety
              if (!isSubagentStartHook(input)) {
                this.logger.warn(
                  '[SubagentHookHandler] Unexpected hook input type for SubagentStart',
                  {
                    expected: 'SubagentStart',
                    received: input.hook_event_name,
                  },
                );
                return { continue: true };
              }
              // FIX: Pass capturedParentSessionId from closure
              return this.handleSubagentStart(
                input,
                toolUseId,
                workspacePath,
                capturedParentSessionId,
              );
            },
          ],
        },
      ],
      SubagentStop: [
        {
          hooks: [
            async (
              input: HookInput,
              toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              // DIAGNOSTIC: Log that the hook was actually invoked by SDK
              this.logger.info(
                '[SubagentHookHandler] >>> SubagentStop HOOK INVOKED <<<',
                {
                  hookEventName: input.hook_event_name,
                  toolUseId,
                  sessionId: input.session_id,
                },
              );

              // Use type guard instead of type assertion for type safety
              if (!isSubagentStopHook(input)) {
                this.logger.warn(
                  '[SubagentHookHandler] Unexpected hook input type for SubagentStop',
                  {
                    expected: 'SubagentStop',
                    received: input.hook_event_name,
                  },
                );
                return { continue: true };
              }
              return this.handleSubagentStop(input, toolUseId);
            },
          ],
        },
      ],
    };
  }

  /**
   * Handle SubagentStart hook
   *
   * Called when a subagent begins execution. Initiates file watching
   * for the agent's JSONL transcript file AND registers the subagent
   * in the SubagentRegistryService for resumption tracking.
   *
   * @param input - SubagentStart hook input containing agentId, sessionId, etc.
   * @param toolUseId - Optional Task tool_use ID (may not be available at start)
   * @param workspacePath - Workspace path for finding sessions directory
   * @param parentSessionId - Parent session ID captured in closure
   * @returns HookJSONOutput - Always { continue: true }
   */
  private async handleSubagentStart(
    input: SubagentStartHookInput,
    toolUseId: string | undefined,
    workspacePath: string,
    parentSessionId?: string,
  ): Promise<HookJSONOutput> {
    try {
      this.logger.debug('[SubagentHookHandler] SubagentStart received', {
        agentId: input.agent_id,
        agentType: input.agent_type,
        sessionId: input.session_id,
        toolUseId,
        workspacePath,
        parentSessionId,
      });

      // Subagent visibility flows via `agentProgressSummaries: true` Option +
      // task_* system messages handled by SdkMessageTransformer. No file
      // watching is started here.

      // Register subagent with registry for resumption tracking.
      // Only register if we have both toolUseId and parentSessionId.
      // NOTE: input.session_id from the hook IS the parent session ID, not the subagent's own.
      // The subagent's own session ID is not exposed by the SDK hook.
      // For resumption, we use agentId (short hex) with the Task tool's resume parameter.
      if (toolUseId && parentSessionId) {
        this.subagentRegistry.register({
          toolCallId: toolUseId,
          sessionId: input.session_id, // Parent session ID (SDK hook doesn't expose subagent's own)
          agentType: input.agent_type,
          startedAt: Date.now(),
          parentSessionId,
          agentId: input.agent_id,
        });

        this.logger.info(
          '[SubagentHookHandler] Subagent registered in registry',
          {
            toolCallId: toolUseId,
            sessionId: input.session_id,
            agentType: input.agent_type,
            parentSessionId,
          },
        );
      } else {
        this.logger.debug(
          '[SubagentHookHandler] Skipping registry registration - missing toolUseId or parentSessionId',
          {
            hasToolUseId: !!toolUseId,
            hasParentSessionId: !!parentSessionId,
          },
        );
      }

      this.logger.debug(
        '[SubagentHookHandler] SubagentStart processed successfully',
        {
          agentId: input.agent_id,
        },
      );
    } catch (error) {
      // CRITICAL: Never throw from hooks - it would break SDK
      this.logger.error(
        '[SubagentHookHandler] Error in SubagentStart hook',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Always return continue: true to not block SDK
    return { continue: true };
  }

  /**
   * Handle SubagentStop hook
   *
   * Called when a subagent completes execution. Sets the toolUseId
   * (for UI routing), stops file watching, and marks the subagent
   * as 'completed' in the registry.
   *
   * For background agents: marks as 'background_completed' and emits
   * a BackgroundAgentCompletedEvent through the agent watcher so the
   * webview is notified even after the main turn has completed.
   *
   * @param input - SubagentStop hook input containing agentId, transcriptPath, etc.
   * @param toolUseId - Task tool_use ID (usually available at stop)
   * @returns HookJSONOutput - Always { continue: true }
   */
  private async handleSubagentStop(
    input: SubagentStopHookInput,
    toolUseId: string | undefined,
  ): Promise<HookJSONOutput> {
    try {
      this.logger.debug('[SubagentHookHandler] SubagentStop received', {
        agentId: input.agent_id,
        transcriptPath: input.agent_transcript_path,
        stopHookActive: input.stop_hook_active,
        toolUseId,
      });

      // setToolUseId on the watcher is a no-op (watcher is a stub). Subagent
      // visibility routes through the SDK's task_* event stream via
      // `agentProgressSummaries: true` Option.

      // Resolve the registry record using toolUseId first, then agentId fallback.
      // The SDK may provide different toolUseId formats between SubagentStart (UUID)
      // and SubagentStop (toolu_* format), causing registry.get(toolUseId) to miss.
      // The agentId (short hex, e.g., "a329b32") is stable across both hooks.
      let resolvedToolCallId = toolUseId ?? undefined;
      let record = resolvedToolCallId
        ? this.subagentRegistry.get(resolvedToolCallId)
        : null;

      if (!record && input.agent_id) {
        const fallbackId = this.subagentRegistry.getToolCallIdByAgentId(
          input.agent_id,
        );
        if (fallbackId) {
          record = this.subagentRegistry.get(fallbackId);
          if (record) {
            this.logger.info(
              '[SubagentHookHandler] Used agentId fallback to resolve registry record',
              {
                originalToolUseId: toolUseId,
                resolvedToolCallId: fallbackId,
                agentId: input.agent_id,
              },
            );
            resolvedToolCallId = fallbackId;
          }
        }
      }

      const isBackground = record?.isBackground === true;

      if (isBackground && resolvedToolCallId) {
        // Background agent completed - emit completion event via watcher
        // and mark as background_completed in registry
        this.logger.info(
          '[SubagentHookHandler] Background subagent completed',
          {
            toolCallId: resolvedToolCallId,
            agentId: input.agent_id,
            agentType: record?.agentType,
          },
        );

        // Watcher event emission and stopWatching are no-ops; background
        // completion is observed solely via SubagentRegistryService transitions.

        // Mark as background_completed (deletes from registry)
        this.subagentRegistry.update(resolvedToolCallId, {
          status: 'background_completed',
          completedAt: Date.now(),
        });
      } else {
        // Foreground agent - normal completion flow.
        // Mark subagent as completed in registry.
        if (resolvedToolCallId) {
          this.subagentRegistry.update(resolvedToolCallId, {
            status: 'completed',
          });

          this.logger.info(
            '[SubagentHookHandler] Subagent marked as completed in registry',
            {
              toolCallId: resolvedToolCallId,
              agentId: input.agent_id,
              usedFallback: resolvedToolCallId !== toolUseId,
            },
          );
        }
      }

      this.logger.debug(
        '[SubagentHookHandler] SubagentStop processed successfully',
        {
          agentId: input.agent_id,
          toolUseId,
          isBackground,
        },
      );
    } catch (error) {
      // CRITICAL: Never throw from hooks - it would break SDK
      this.logger.error(
        '[SubagentHookHandler] Error in SubagentStop hook',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Always return continue: true to not block SDK
    return { continue: true };
  }

  /**
   * Dispose of the hook handler
   *
   * Called during extension deactivation to clean up resources.
   * Currently no-op but maintains consistency with other handlers
   * (e.g., SdkPermissionHandler) and provides a hook for future cleanup needs.
   */
  dispose(): void {
    this.logger.debug('[SubagentHookHandler] Disposed');
  }
}
