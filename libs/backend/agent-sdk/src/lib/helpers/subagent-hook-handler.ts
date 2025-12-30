/**
 * SubagentHookHandler - Encapsulates SDK subagent hook callbacks
 *
 * Connects SDK lifecycle hooks to AgentSessionWatcherService for
 * real-time subagent text streaming.
 *
 * Key behaviors:
 * - Hooks NEVER throw (would break SDK)
 * - Always return { continue: true } for non-blocking
 * - Logging for all lifecycle events (debug level)
 *
 * Flow:
 * 1. SubagentStart hook fires -> startWatching(agentId, sessionId, workspacePath, toolUseId?)
 * 2. AgentSessionWatcherService watches for agent-{agent_id}.jsonl files
 * 3. File grows -> summary chunks emitted to webview
 * 4. SubagentStop hook fires -> setToolUseId(agentId, toolUseId), stopWatching(agentId)
 *
 * @see TASK_2025_099 - Real-Time Subagent Text Streaming via SDK Hooks
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { AgentSessionWatcherService } from '@ptah-extension/vscode-core';
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
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private readonly agentWatcher: AgentSessionWatcherService
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
   * @param workspacePath - Workspace path for agent file detection
   * @returns Hooks configuration for SDK query options
   */
  createHooks(
    workspacePath: string
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    // DIAGNOSTIC: Log hook creation
    this.logger.info('[SubagentHookHandler] Creating hooks for workspace', {
      workspacePath,
    });

    return {
      SubagentStart: [
        {
          hooks: [
            async (
              input: HookInput,
              toolUseId: string | undefined,
              _options: { signal: AbortSignal }
            ): Promise<HookJSONOutput> => {
              // DIAGNOSTIC: Log that the hook was actually invoked by SDK
              this.logger.info(
                '[SubagentHookHandler] >>> SubagentStart HOOK INVOKED <<<',
                {
                  hookEventName: input.hook_event_name,
                  toolUseId,
                  sessionId: input.session_id,
                }
              );

              // Use type guard instead of type assertion for type safety
              if (!isSubagentStartHook(input)) {
                this.logger.warn(
                  '[SubagentHookHandler] Unexpected hook input type for SubagentStart',
                  {
                    expected: 'SubagentStart',
                    received: input.hook_event_name,
                  }
                );
                return { continue: true };
              }
              return this.handleSubagentStart(input, toolUseId, workspacePath);
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
              _options: { signal: AbortSignal }
            ): Promise<HookJSONOutput> => {
              // DIAGNOSTIC: Log that the hook was actually invoked by SDK
              this.logger.info(
                '[SubagentHookHandler] >>> SubagentStop HOOK INVOKED <<<',
                {
                  hookEventName: input.hook_event_name,
                  toolUseId,
                  sessionId: input.session_id,
                }
              );

              // Use type guard instead of type assertion for type safety
              if (!isSubagentStopHook(input)) {
                this.logger.warn(
                  '[SubagentHookHandler] Unexpected hook input type for SubagentStop',
                  {
                    expected: 'SubagentStop',
                    received: input.hook_event_name,
                  }
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
   * for the agent's JSONL transcript file.
   *
   * @param input - SubagentStart hook input containing agentId, sessionId, etc.
   * @param toolUseId - Optional Task tool_use ID (may not be available at start)
   * @param workspacePath - Workspace path for finding sessions directory
   * @returns HookJSONOutput - Always { continue: true }
   */
  private async handleSubagentStart(
    input: SubagentStartHookInput,
    toolUseId: string | undefined,
    workspacePath: string
  ): Promise<HookJSONOutput> {
    try {
      this.logger.debug('[SubagentHookHandler] SubagentStart received', {
        agentId: input.agent_id,
        agentType: input.agent_type,
        sessionId: input.session_id,
        toolUseId,
        workspacePath,
      });

      await this.agentWatcher.startWatching(
        input.agent_id,
        input.session_id,
        workspacePath,
        toolUseId
      );

      this.logger.debug(
        '[SubagentHookHandler] SubagentStart processed successfully',
        {
          agentId: input.agent_id,
        }
      );
    } catch (error) {
      // CRITICAL: Never throw from hooks - it would break SDK
      this.logger.error(
        '[SubagentHookHandler] Error in SubagentStart hook',
        error instanceof Error ? error : new Error(String(error))
      );
    }

    // Always return continue: true to not block SDK
    return { continue: true };
  }

  /**
   * Handle SubagentStop hook
   *
   * Called when a subagent completes execution. Sets the toolUseId
   * (for UI routing) and stops file watching.
   *
   * @param input - SubagentStop hook input containing agentId, transcriptPath, etc.
   * @param toolUseId - Task tool_use ID (usually available at stop)
   * @returns HookJSONOutput - Always { continue: true }
   */
  private async handleSubagentStop(
    input: SubagentStopHookInput,
    toolUseId: string | undefined
  ): Promise<HookJSONOutput> {
    try {
      this.logger.debug('[SubagentHookHandler] SubagentStop received', {
        agentId: input.agent_id,
        transcriptPath: input.agent_transcript_path,
        stopHookActive: input.stop_hook_active,
        toolUseId,
      });

      // Set toolUseId if available (for UI routing of summary chunks)
      if (toolUseId) {
        this.agentWatcher.setToolUseId(input.agent_id, toolUseId);
      }

      // Stop watching this agent
      this.agentWatcher.stopWatching(input.agent_id);

      this.logger.debug(
        '[SubagentHookHandler] SubagentStop processed successfully',
        {
          agentId: input.agent_id,
          toolUseId,
        }
      );
    } catch (error) {
      // CRITICAL: Never throw from hooks - it would break SDK
      this.logger.error(
        '[SubagentHookHandler] Error in SubagentStop hook',
        error instanceof Error ? error : new Error(String(error))
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
