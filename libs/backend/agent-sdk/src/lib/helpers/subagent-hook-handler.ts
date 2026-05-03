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
 * 2. Subagent text streams inline through the parent SDK message stream
 *    (enabled by `forwardSubagentText: true` in SdkQueryOptionsBuilder).
 * 3. SubagentStop hook fires -> registry.update() to mark as 'completed'.
 *
 * TASK_2026_109 Fix 2: removed dependency on AgentSessionWatcherService —
 * the JSONL tail-watching path it owned is replaced by inline subagent
 * forwarding in the SDK stream itself. The watcher is now a no-op stub
 * that retains its public API for legacy consumers.
 *
 * @see TASK_2025_099 - Real-Time Subagent Text Streaming via SDK Hooks
 * @see TASK_2025_103 - Subagent Resumption Feature
 * @see TASK_2026_109 - SDK improvement bundle (Fix 2)
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
   * TASK_2025_103: Now accepts parentSessionId for registry tracking.
   * This enables tracking which session spawned which subagents.
   *
   * FIX (TASK_2025_103 QA): parentSessionId is now captured in closure instead
   * of stored as instance state. This prevents state corruption when multiple
   * sessions run concurrently (singleton service would overwrite shared state).
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
   * TASK_2025_100 FIX: Now passes agentType to startWatching so that
   * AgentSessionWatcherService can emit an 'agent-start' event early.
   * This fixes the race condition where summary chunks arrived before
   * the agent node was created.
   *
   * TASK_2025_103: Now registers subagent with SubagentRegistryService
   * to enable resumption of interrupted subagents.
   *
   * FIX (TASK_2025_103 QA): parentSessionId is now passed as parameter
   * (captured in closure) instead of read from instance state.
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

      // TASK_2026_109 Fix 2: AgentSessionWatcherService is now a no-op stub —
      // subagent text streams inline through the parent SDK message stream
      // via `forwardSubagentText: true` in SdkQueryOptionsBuilder. No file
      // watching is started here.

      // TASK_2025_103: Register subagent with registry for resumption tracking
      // Only register if we have both toolUseId and parentSessionId
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
   * TASK_2025_103: Now updates SubagentRegistryService to mark
   * the subagent as 'completed' when SubagentStop hook fires.
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

      // TASK_2026_109 Fix 2: setToolUseId on the watcher is now a no-op
      // (watcher is a stub). Subagent text routes through the SDK stream
      // directly with `forwardSubagentText: true`.

      // FIX: Resolve the registry record using toolUseId first, then agentId fallback.
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

        // TASK_2026_109 Fix 2: watcher event emission and stopWatching are
        // no-ops now. Background completion is observed solely via
        // SubagentRegistryService transitions.

        // Mark as background_completed (deletes from registry)
        this.subagentRegistry.update(resolvedToolCallId, {
          status: 'background_completed',
          completedAt: Date.now(),
        });
      } else {
        // Foreground agent - normal completion flow
        // TASK_2026_109 Fix 2: stopWatching is a no-op (watcher stub).

        // TASK_2025_103: Mark subagent as completed in registry
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
