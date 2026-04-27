/**
 * SessionControl — owner of the lifecycle-control methods that act on a
 * registered session's `query` handle: interrupt, end, dispose-all, set
 * permission level, set model.
 *
 * Wave C7i extracts these from `SessionLifecycleManager` (originally lines
 * 395–451, 462–556, 563–610, 1110–1149, 1162–1207). The cleanup-call order
 * inside `endSession` is spec-asserted (cleanupPendingPermissions →
 * markAllInterrupted → stopAllForSession → interrupt → abort → registry
 * removal) and is preserved byte-identically.
 *
 * Plain class — NOT @injectable, NOT registered with tsyringe. Constructed
 * eagerly by the facade.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SubagentRegistryService,
  AgentSessionWatcherService,
} from '@ptah-extension/vscode-core';
import type { SessionId, ISdkPermissionHandler } from '@ptah-extension/shared';

import { SdkError } from '../../errors';
import type { ModelResolver } from '../../auth/model-resolver';
import type { SessionRegistry } from './session-registry.service';
import { PERMISSION_MODE_MAP } from './permission-mode-map';

export class SessionControl {
  constructor(
    private readonly logger: Logger,
    private readonly registry: SessionRegistry,
    private readonly permissionHandler: ISdkPermissionHandler,
    private readonly subagentRegistry: SubagentRegistryService,
    private readonly agentSessionWatcher: AgentSessionWatcherService,
    private readonly modelResolver: ModelResolver,
  ) {}

  /**
   * Interrupt the current assistant turn without ending the session.
   *
   * Unlike endSession(), this does NOT abort the session or clean up resources.
   * The session remains active for continued use — the user's follow-up message
   * will start a new turn.
   *
   * Used when the user sends a message during autopilot (yolo/auto-edit) execution.
   * In these modes, tool calls are auto-approved, so the user has no checkpoint to
   * stop the agent. Calling interrupt() forces the SDK to stop the current turn,
   * ensuring the user's message is processed in a new turn.
   *
   * @param sessionId - Session whose current turn should be interrupted
   * @returns true if interrupt was called, false if session/query not found
   */
  async interruptCurrentTurn(sessionId: SessionId): Promise<boolean> {
    // Reverse lookup: frontend may send real SDK UUID but activeSessions is keyed by tab ID.
    // Same pattern as endSession() and setSessionModel().
    const found = this.registry.findByTabOrRealId(sessionId);
    const session = found?.session;
    if (found) {
      sessionId = found.tabId as SessionId;
    }

    if (!session?.query) {
      this.logger.warn(
        `[SessionLifecycle] Cannot interrupt turn - session or query not found: ${sessionId}`,
      );
      return false;
    }

    this.logger.info(
      `[SessionLifecycle] Interrupting current turn for session: ${sessionId}`,
    );

    try {
      let timedOut = false;
      await Promise.race([
        session.query.interrupt(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, 3000),
        ),
      ]);
      if (timedOut) {
        this.logger.warn(
          `[SessionLifecycle] Turn interrupt timed out (3s) for session: ${sessionId}`,
        );
      } else {
        this.logger.info(
          `[SessionLifecycle] Turn interrupt completed for session: ${sessionId}`,
        );
      }
      return !timedOut;
    } catch (err) {
      this.logger.warn(
        `[SessionLifecycle] Turn interrupt failed for session ${sessionId}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return false;
    }
  }

  /**
   * End session and cleanup
   * TASK_2025_102: Now calls cleanupPendingPermissions to prevent unhandled promise rejections
   * TASK_2025_103: Now marks all running subagents as interrupted before session removal
   *
   * CRITICAL RISK MITIGATION: SubagentStop hook doesn't fire when a session is aborted.
   * This method is the ONLY reliable way to detect interrupted subagents. All running
   * subagents for this session are marked as 'interrupted' to enable resumption.
   */
  async endSession(sessionId: SessionId): Promise<void> {
    // TASK_2025_211: Reverse lookup - if sessionId is a real SDK UUID, find the tab ID
    // The frontend sends the real SDK UUID but activeSessions is keyed by tab ID
    const found = this.registry.findByTabOrRealId(sessionId);
    if (!found) {
      this.logger.warn(
        `[SessionLifecycle] Cannot end session - not found: ${sessionId}`,
      );
      return;
    }
    const session = found.session;
    sessionId = found.tabId as SessionId;

    this.logger.info(`[SessionLifecycle] Ending session: ${sessionId}`);

    // TASK_2025_102: Cleanup pending permissions FIRST to prevent unhandled promise rejections
    // This resolves any pending permission promises with deny before aborting the session
    this.permissionHandler.cleanupPendingPermissions(sessionId as string);

    // TASK_2025_103: Mark all running subagents as interrupted BEFORE aborting
    // This is the key mechanism for detecting interrupted subagents since
    // SubagentStop hook doesn't fire on abort. Running subagents become resumable.
    // TASK_2025_186: Use real UUID if resolved, since SubagentRegistryService records
    // may have been updated from tab ID to real UUID by resolveParentSessionId().
    const registrySessionId = this.registry.getRealOrTabId(sessionId as string);
    this.subagentRegistry.markAllInterrupted(registrySessionId);

    // TASK_2025_264: Stop all agent session file watchers for this session.
    // Prevents background agent watchers from tailing files and emitting
    // events to a dead session after abort.
    this.agentSessionWatcher.stopAllForSession(registrySessionId);

    this.logger.info(
      `[SessionLifecycle] Marked running subagents as interrupted and stopped watchers for session: ${sessionId}`,
    );

    // TASK_2025_175: Await interrupt() with timeout BEFORE abort()
    // SDK best practice: interrupt() must complete before abort() is called.
    // abort() kills the underlying process, so calling it before interrupt()
    // means the graceful stop signal is never processed.
    if (session.query) {
      try {
        let timedOut = false;
        await Promise.race([
          session.query.interrupt(),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              timedOut = true;
              resolve();
            }, 5000),
          ),
        ]);
        this.logger.info(
          `[SessionLifecycle] Interrupt ${
            timedOut ? 'timed out (5s)' : 'completed'
          } for session: ${sessionId}`,
        );
      } catch (err) {
        // TASK_2025_175: Log at WARN level so failures are visible
        this.logger.warn(
          `[SessionLifecycle] Interrupt failed for session ${sessionId}`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    // Abort the session AFTER interrupt completes or times out
    session.abortController.abort();

    // Remove from active sessions and clean up tab-to-real mapping;
    // also recomputes _lastActiveTabId fallback if needed.
    this.registry.removeSession(sessionId as string);

    this.logger.info(`[SessionLifecycle] Session ended: ${sessionId}`);
  }

  /**
   * Cleanup all active sessions
   * TASK_2025_102: Now calls cleanupPendingPermissions to prevent unhandled promise rejections
   * TASK_2025_103: Now marks all running subagents as interrupted for each session
   */
  async disposeAllSessions(): Promise<void> {
    this.logger.info('[SessionLifecycle] Disposing all active sessions...');

    // TASK_2025_102: Cleanup all pending permissions FIRST
    this.permissionHandler.cleanupPendingPermissions();

    // TASK_2025_175: Interrupt all sessions first, then abort
    const interruptPromises: Promise<void>[] = [];

    for (const [sessionId, session] of this.registry.entries()) {
      this.logger.debug(`[SessionLifecycle] Ending session: ${sessionId}`);

      // TASK_2025_103: Mark all running subagents as interrupted for this session
      // TASK_2025_186: Use real UUID if resolved
      const registryId = this.registry.getRealOrTabId(sessionId);
      this.subagentRegistry.markAllInterrupted(registryId);

      // TASK_2025_264: Stop all agent session file watchers for this session
      this.agentSessionWatcher.stopAllForSession(registryId);

      // TASK_2025_175: Interrupt BEFORE abort, with timeout
      if (session.query) {
        interruptPromises.push(
          Promise.race([
            session.query.interrupt(),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)),
          ]).catch((err) => {
            this.logger.warn(
              `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
              err instanceof Error ? err : new Error(String(err)),
            );
          }),
        );
      }
    }

    // Wait for all interrupts to complete or time out
    await Promise.allSettled(interruptPromises);

    // Now abort all sessions
    for (const [, session] of this.registry.entries()) {
      session.abortController.abort();
    }

    this.registry.clearAll();
    this.logger.info('[SessionLifecycle] All sessions disposed');
  }

  /**
   * Set session permission level
   * Extracted from SdkAgentAdapter to consolidate session control
   *
   * @param sessionId - Session to update
   * @param level - Permission level (frontend or SDK name)
   */
  async setSessionPermissionLevel(
    sessionId: SessionId,
    level:
      | 'ask'
      | 'auto-edit'
      | 'yolo'
      | 'plan'
      | 'default'
      | 'acceptEdits'
      | 'bypassPermissions',
  ): Promise<void> {
    const session = this.registry.getActiveSession(sessionId);
    if (!session) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new SdkError(`Session query not initialized: ${sessionId}`);
    }

    this.logger.info(
      `[SessionLifecycle] Setting permission level for ${sessionId}: ${level}`,
    );

    // Map frontend names to SDK mode names
    const sdkMode = PERMISSION_MODE_MAP[level] || level;

    try {
      await session.query.setPermissionMode(sdkMode);
      this.logger.info(
        `[SessionLifecycle] Permission level set for ${sessionId}`,
      );
    } catch (error) {
      this.logger.error(
        `[SessionLifecycle] Failed to set permission for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Set session model
   * Extracted from SdkAgentAdapter to consolidate session control
   *
   * Resolves bare tier names ('opus', 'sonnet', 'haiku') to full model IDs
   * before passing to the SDK. The SDK's setModel() requires full model IDs
   * like 'claude-opus-4-6' — bare tier names cause "can't access model" errors.
   *
   * @param sessionId - Session to update
   * @param model - Model ID or bare tier name to set
   */
  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    // Reverse lookup: frontend sends real SDK UUID but activeSessions is keyed by tab ID
    const found = this.registry.findByTabOrRealId(sessionId);
    if (!found) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }
    const session = found.session;

    if (!session.query) {
      throw new SdkError(`Session query not initialized: ${sessionId}`);
    }

    // Resolve model through provider overrides (e.g., claude-sonnet-4-6 → glm-5.1 on Z.AI)
    // and bare tier names (e.g., 'sonnet' → 'claude-sonnet-4-6' on direct Anthropic).
    const resolvedModel = this.modelResolver.resolve(model);
    if (resolvedModel !== model) {
      this.logger.info(
        `[SessionLifecycle] Model resolved: '${model}' → '${resolvedModel}'`,
      );
    }

    this.logger.info(
      `[SessionLifecycle] Setting model for ${sessionId}: ${resolvedModel}`,
    );

    try {
      await session.query.setModel(resolvedModel);
      session.currentModel = resolvedModel;
      this.logger.info(`[SessionLifecycle] Model set for ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `[SessionLifecycle] Failed to set model for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }
}
