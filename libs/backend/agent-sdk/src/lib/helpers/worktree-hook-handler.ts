/**
 * WorktreeHookHandler - Handles SDK WorktreeCreate/WorktreeRemove hooks and notifies via callback
 *
 * Connects SDK worktree lifecycle hooks to the UI notification system via callbacks.
 * When the SDK creates or removes a git worktree, this hook fires and notifies
 * the session host so the frontend can refresh its worktree list.
 *
 * Key behaviors:
 * - Hook NEVER throws (would break SDK)
 * - Always returns { continue: true } for non-blocking
 * - Uses callback pattern (EventBus is deleted from codebase)
 * - Logging for worktree events (info level)
 *
 * Flow:
 * 1. SDK triggers WorktreeCreate/WorktreeRemove hook
 * 2. WorktreeHookHandler receives hook input with worktree details
 * 3. Callback is invoked to notify session host of worktree change
 * 4. Session host sends RPC notification to frontend
 * 5. Hook returns { continue: true } to allow SDK to proceed
 *
 */

import * as path from 'path';
import { injectable, inject } from 'tsyringe';
import type { Logger, GitInfoService } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
} from '../types/sdk-types/claude-sdk.types';
import {
  isWorktreeCreateHook,
  isWorktreeRemoveHook,
} from '../types/sdk-types/claude-sdk.types';

/**
 * Callback type for notifying when a worktree is created
 * - sessionId: The session that triggered the worktree creation
 * - name: The name/branch of the created worktree
 * - cwd: The working directory of the session
 * - timestamp: When the worktree was created
 */
export type WorktreeCreatedCallback = (data: {
  sessionId: string;
  name: string;
  cwd: string;
  timestamp: number;
}) => void;

/**
 * Callback type for notifying when a worktree is removed
 * - sessionId: The session that triggered the worktree removal
 * - worktreePath: The path of the removed worktree
 * - cwd: The working directory of the session
 * - timestamp: When the worktree was removed
 */
export type WorktreeRemovedCallback = (data: {
  sessionId: string;
  worktreePath: string;
  cwd: string;
  timestamp: number;
}) => void;

/**
 * WorktreeHookHandler Service
 *
 * Creates SDK hook callbacks that notify the session host when worktrees
 * are created or removed. Uses callback pattern instead of EventBus
 * (which was deleted from codebase).
 *
 * Usage:
 * ```typescript
 * const hookHandler = container.resolve(SDK_TOKENS.SDK_WORKTREE_HOOK_HANDLER);
 * const hooks = hookHandler.createHooks(
 *   (data) => { // worktree created
 *     rpcHandler.notify('git:worktreeChanged', { action: 'created', name: data.name });
 *   },
 *   (data) => { // worktree removed
 *     rpcHandler.notify('git:worktreeChanged', { action: 'removed', path: data.worktreePath });
 *   },
 * );
 *
 * // Pass to SDK query options
 * const options = { ...otherOptions, hooks: { ...existingHooks, ...hooks } };
 * ```
 */
@injectable()
export class WorktreeHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.GIT_INFO_SERVICE) private readonly gitInfo: GitInfoService,
  ) {}

  /**
   * Create hooks configuration for SDK query options
   *
   * Returns a hooks object that can be merged with existing hooks (like subagent
   * and compaction hooks). The hook callbacks are wrapped with error handling
   * to ensure the SDK is never blocked by hook failures.
   *
   * Note: The AbortSignal parameter is part of the SDK hook callback signature
   * but is intentionally not used in worktree hooks. WorktreeCreate/Remove events
   * are informational and complete instantly - there's no long-running
   * operation to abort. The signal is preserved for SDK API compliance.
   *
   * @param onWorktreeCreated - Callback to invoke when a worktree is created (optional)
   * @param onWorktreeRemoved - Callback to invoke when a worktree is removed (optional)
   * @returns Hooks configuration for SDK query options
   */
  createHooks(
    onWorktreeCreated?: WorktreeCreatedCallback,
    onWorktreeRemoved?: WorktreeRemovedCallback,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const capturedCreatedCallback = onWorktreeCreated;
    const capturedRemovedCallback = onWorktreeRemoved;
    this.logger.info('[WorktreeHookHandler] Creating hooks', {
      hasCreatedCallback: !!capturedCreatedCallback,
      hasRemovedCallback: !!capturedRemovedCallback,
    });

    return {
      WorktreeCreate: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              this.logger.info(
                '[WorktreeHookHandler] WorktreeCreate hook invoked',
                {
                  hookEventName: input.hook_event_name,
                  sessionId: input.session_id,
                },
              );

              try {
                if (!isWorktreeCreateHook(input)) {
                  this.logger.warn(
                    '[WorktreeHookHandler] Unexpected hook input type for WorktreeCreate',
                    {
                      expected: 'WorktreeCreate',
                      received: input.hook_event_name,
                    },
                  );
                  return { continue: true };
                }

                const worktreePath = path.join(
                  input.cwd,
                  '.claude-worktrees',
                  input.name,
                );
                const result = await this.gitInfo.addWorktree(input.cwd, {
                  branch: input.name,
                  path: worktreePath,
                  createBranch: true,
                });

                if (!result.success || !result.worktreePath) {
                  this.logger.warn(
                    '[WorktreeHookHandler] Failed to create worktree — subagent will run without isolation',
                    {
                      sessionId: input.session_id,
                      name: input.name,
                      cwd: input.cwd,
                      error: result.error,
                    },
                  );
                  return { continue: true };
                }

                this.logger.info('[WorktreeHookHandler] Worktree created', {
                  sessionId: input.session_id,
                  name: input.name,
                  worktreePath: result.worktreePath,
                });
                if (capturedCreatedCallback) {
                  const worktreeData = {
                    sessionId: input.session_id,
                    name: input.name,
                    cwd: input.cwd,
                    timestamp: Date.now(),
                  };

                  this.logger.debug(
                    '[WorktreeHookHandler] Invoking worktree created callback',
                    worktreeData,
                  );
                  try {
                    capturedCreatedCallback(worktreeData);
                  } catch (callbackError) {
                    this.logger.error(
                      '[WorktreeHookHandler] Error in worktree created callback',
                      callbackError instanceof Error
                        ? callbackError
                        : new Error(String(callbackError)),
                    );
                  }
                }

                this.logger.debug(
                  '[WorktreeHookHandler] WorktreeCreate processed successfully',
                  { sessionId: input.session_id },
                );
                return {
                  hookSpecificOutput: {
                    hookEventName: 'WorktreeCreate',
                    worktreePath: result.worktreePath,
                  },
                  continue: true,
                };
              } catch (error) {
                this.logger.error(
                  '[WorktreeHookHandler] Error in WorktreeCreate hook',
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
              return { continue: true };
            },
          ],
        },
      ],
      WorktreeRemove: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
              this.logger.info(
                '[WorktreeHookHandler] WorktreeRemove hook invoked',
                {
                  hookEventName: input.hook_event_name,
                  sessionId: input.session_id,
                },
              );

              try {
                if (!isWorktreeRemoveHook(input)) {
                  this.logger.warn(
                    '[WorktreeHookHandler] Unexpected hook input type for WorktreeRemove',
                    {
                      expected: 'WorktreeRemove',
                      received: input.hook_event_name,
                    },
                  );
                  return { continue: true };
                }
                this.logger.info('[WorktreeHookHandler] Worktree removed', {
                  sessionId: input.session_id,
                  worktreePath: input.worktree_path,
                  cwd: input.cwd,
                });
                if (capturedRemovedCallback) {
                  const worktreeData = {
                    sessionId: input.session_id,
                    worktreePath: input.worktree_path,
                    cwd: input.cwd,
                    timestamp: Date.now(),
                  };

                  this.logger.debug(
                    '[WorktreeHookHandler] Invoking worktree removed callback',
                    worktreeData,
                  );
                  try {
                    capturedRemovedCallback(worktreeData);
                  } catch (callbackError) {
                    this.logger.error(
                      '[WorktreeHookHandler] Error in worktree removed callback',
                      callbackError instanceof Error
                        ? callbackError
                        : new Error(String(callbackError)),
                    );
                  }
                }

                this.logger.debug(
                  '[WorktreeHookHandler] WorktreeRemove processed successfully',
                  { sessionId: input.session_id },
                );
              } catch (error) {
                this.logger.error(
                  '[WorktreeHookHandler] Error in WorktreeRemove hook',
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
   * (e.g., CompactionHookHandler, SubagentHookHandler) and provides
   * a hook for future cleanup needs.
   */
  dispose(): void {
    this.logger.debug('[WorktreeHookHandler] Disposed');
  }
}
