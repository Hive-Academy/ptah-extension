/**
 * SessionControl — owner of the lifecycle-control methods that act on a
 * registered session's `query` handle: interrupt, end, dispose-all, set
 * permission level, set model.
 *
 * Extracted from `SessionLifecycleManager` (originally lines
 * 395–451, 462–556, 563–610, 1110–1149, 1162–1207). The cleanup-call order
 * inside `endSession` is spec-asserted (cleanupPendingPermissions →
 * markAllInterrupted → interrupt → abort → registry removal) and is
 * preserved byte-identically.
 *
 * Plain class — NOT @injectable, NOT registered with tsyringe. Constructed
 * eagerly by the facade.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type {
  SessionId,
  ISdkPermissionHandler,
  EffortLevel,
  FlagEffortLevel,
} from '@ptah-extension/shared';

import { SdkError } from '../../errors';
import type { IModelResolver } from '../../auth-env.port';
import type {
  SessionRecord,
  SessionRegistry,
} from './session-registry.service';
import {
  PERMISSION_MODE_MAP,
  LEVEL_FROM_SDK_MODE,
} from './permission-mode-map';
import type { SessionEndCallbackRegistry } from '../session-end-callback-registry';

export type EndSessionOutcome = 'ended' | 'already-ended';

export class SessionControl {
  constructor(
    private readonly logger: Logger,
    private readonly registry: SessionRegistry,
    private readonly permissionHandler: ISdkPermissionHandler,
    private readonly subagentRegistry: SubagentRegistryService,
    private readonly modelResolver: IModelResolver,
    private readonly sessionEndRegistry: SessionEndCallbackRegistry,
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
    const rec = this.registry.find(sessionId as string);

    if (!rec?.query) {
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
        rec.query.interrupt(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, 3000),
        ),
      ]);
      // An interrupted turn may never emit the `result` that normally releases
      // the pump's turn claim. Release it here or the session's next follow-up
      // is held forever (TASK_2026_294).
      this.registry.markTurnEnded(sessionId as string);
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
      this.registry.markTurnEnded(sessionId as string);
      this.logger.warn(
        `[SessionLifecycle] Turn interrupt failed for session ${sessionId}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return false;
    }
  }

  /**
   * End session and cleanup
   *
   * CRITICAL RISK MITIGATION: SubagentStop hook doesn't fire when a session is aborted.
   * This method is the ONLY reliable way to detect interrupted subagents. All running
   * subagents for this session are marked as 'interrupted' to enable resumption.
   */
  async endSession(sessionId: SessionId): Promise<EndSessionOutcome> {
    const rec = this.registry.find(sessionId as string);
    if (!rec) {
      this.logger.info(
        `[SessionLifecycle] Session already ended, nothing to interrupt`,
      );
      return 'already-ended';
    }

    await this.endRecord(rec, sessionId);
    return 'ended';
  }

  /**
   * End the session ONLY if the record registered under `sessionId` is still
   * the one identified by `token`.
   *
   * The find-compare-teardown is atomic here on purpose. A caller that read the
   * token, then called `endSession` separately, would still lose the race this
   * exists to close: `executeSlashCommandQuery` ends the old record and
   * registers a NEW one under the SAME id, so a late teardown from the old
   * record's owner would abort the new record's AbortController and the fresh
   * SDK query would start already aborted.
   *
   * @returns true when this call performed the teardown; false when nothing was
   *   registered or a different record now owns the id (no side effects).
   */
  async endSessionIfTokenMatches(
    sessionId: SessionId,
    token: string,
  ): Promise<boolean> {
    const rec = this.registry.find(sessionId as string);
    if (!rec || rec.token !== token) {
      return false;
    }

    await this.endRecord(rec, sessionId);
    return true;
  }

  /**
   * The teardown itself, shared by both public entry points so the
   * spec-asserted call order (cleanupPendingPermissions → markAllInterrupted →
   * interrupt → abort → registry removal) has exactly one definition.
   *
   * The removal is unconditional (see `deregister` below): it happens on the
   * throwing path too, so a caller that awaited a rejected teardown can still
   * rely on the id being free. The SessionEnd notification is NOT — it stays
   * after the try/finally, so a failed teardown rethrows without announcing a
   * clean session end.
   */
  private async endRecord(
    rec: SessionRecord,
    sessionId: SessionId,
  ): Promise<void> {
    this.logger.info(`[SessionLifecycle] Ending session: ${sessionId}`);
    const registrySessionId = rec.realSessionId ?? rec.tabId;
    const workspaceRoot = rec.config.projectPath ?? '';

    /**
     * Abort + deregister, at most once.
     *
     * Called at its normal place below AND from the outer `finally`, because
     * everything before it can throw synchronously —
     * `cleanupPendingPermissions`, `beginSessionTeardown` and
     * `markAllInterrupted` all used to sit outside any `try`. A throw there left
     * the record REGISTERED while the caller saw a rejection, and the next
     * teardown of the same id (`executeSlashCommandQuery` always runs one)
     * would find a live `rec` and pay a second full interrupt race.
     *
     * The guard is not defensive vagueness: `registry.remove` deletes by
     * `rec.tabId` with no identity check, so calling it twice is only harmless
     * while no NEW record has taken that key. Running it once removes the
     * question.
     */
    let deregistered = false;
    const deregister = (): void => {
      if (deregistered) return;
      deregistered = true;
      rec.abortController.abort();
      this.registry.remove(rec);
    };

    try {
      this.permissionHandler.cleanupPendingPermissions(rec.tabId);
      this.subagentRegistry.beginSessionTeardown(registrySessionId);
      try {
        this.subagentRegistry.markAllInterrupted(registrySessionId);

        this.logger.info(
          `[SessionLifecycle] Marked running subagents as interrupted for session: ${sessionId}`,
        );
        if (rec.query) {
          try {
            let timedOut = false;
            await Promise.race([
              rec.query.interrupt(),
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
            this.logger.warn(
              `[SessionLifecycle] Interrupt failed for session ${sessionId}`,
              err instanceof Error ? err : new Error(String(err)),
            );
          }
        }
        deregister();
      } finally {
        this.subagentRegistry.endSessionTeardown(registrySessionId);
      }
    } finally {
      // No-op on the happy path — `deregister` already ran inside the try, and
      // this is the only other call site. It does work exactly when an earlier
      // step threw, which is the whole point: the record must not survive a
      // failed teardown.
      deregister();
    }

    this.logger.info(`[SessionLifecycle] Session ended: ${sessionId}`);
    if (workspaceRoot) {
      this.sessionEndRegistry.notifyAll({
        sessionId: registrySessionId,
        workspaceRoot,
      });
    } else {
      this.logger.debug(
        `[SessionLifecycle] Skipping session-end notification — no workspaceRoot for session: ${sessionId}`,
      );
    }
  }

  /**
   * Cleanup all active sessions
   */
  async disposeAllSessions(): Promise<void> {
    this.logger.info('[SessionLifecycle] Disposing all active sessions...');

    const records = Array.from(this.registry.entries()).map(([, rec]) => rec);

    // Scope the permission cleanup to the sessions actually being disposed.
    // The no-arg (global) form walks EVERY pending request in the process and
    // resolves it as a deny — including requests owned by sessions this call is
    // not disposing (other windows, other tabs, background subagents). That deny
    // reaches the model as a user refusal, so an auth/config change silently
    // stops unrelated agents. Mirrors the per-session cleanup `endSession` does,
    // and stays BEFORE the interrupt/abort work so in-flight permission promises
    // cannot become unhandled rejections after abort().
    for (const rec of records) {
      this.permissionHandler.cleanupPendingPermissions(rec.tabId);
      if (rec.realSessionId && rec.realSessionId !== rec.tabId) {
        this.permissionHandler.cleanupPendingPermissions(rec.realSessionId);
      }
    }

    const endedSessions: Array<{ sessionId: string; workspaceRoot: string }> =
      [];

    const interruptPromises: Promise<void>[] = [];
    const teardownIds: string[] = [];

    try {
      for (const rec of records) {
        this.logger.debug(`[SessionLifecycle] Ending session: ${rec.tabId}`);

        const registryId = rec.realSessionId ?? rec.tabId;
        this.subagentRegistry.beginSessionTeardown(registryId);
        teardownIds.push(registryId);
        this.subagentRegistry.markAllInterrupted(registryId);
        const root = rec.config.projectPath ?? '';
        if (root) {
          endedSessions.push({ sessionId: registryId, workspaceRoot: root });
        }

        if (rec.query) {
          interruptPromises.push(
            Promise.race([
              rec.query.interrupt(),
              new Promise<void>((resolve) => setTimeout(resolve, 5000)),
            ]).catch((err) => {
              this.logger.warn(
                `[SessionLifecycle] Failed to interrupt session ${rec.tabId}`,
                err instanceof Error ? err : new Error(String(err)),
              );
            }),
          );
        }
      }
      await Promise.allSettled(interruptPromises);
      for (const rec of records) {
        rec.abortController.abort();
      }
    } finally {
      for (const registryId of teardownIds) {
        this.subagentRegistry.endSessionTeardown(registryId);
      }
    }

    this.registry.clearAll();
    this.logger.info('[SessionLifecycle] All sessions disposed');
    for (const ended of endedSessions) {
      this.sessionEndRegistry.notifyAll(ended);
    }
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
    const session = this.registry.find(sessionId as string);
    if (!session) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new SdkError(`Session query not initialized: ${sessionId}`);
    }

    this.logger.info(
      `[SessionLifecycle] Setting permission level for ${sessionId}: ${level}`,
    );
    const sdkMode = PERMISSION_MODE_MAP[level] || level;
    // Update the per-session level the canUseTool callback reads (normalized
    // to the frontend naming) so a live toggle re-gates THIS session only.
    session.permissionLevel = LEVEL_FROM_SDK_MODE[level] ?? 'ask';

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
    const session = this.registry.find(sessionId as string);
    if (!session) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new SdkError(`Session query not initialized: ${sessionId}`);
    }
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

  /**
   * Change reasoning effort mid-session. `undefined` clears the override.
   * The flag-settings layer has no `max` tier, so `max` is applied as `xhigh`
   * (the persisted `max` still takes full effect on the next session start).
   *
   * @param sessionId - Session to update
   * @param effort - Effort level, or undefined to clear the override
   */
  async setSessionEffort(
    sessionId: SessionId,
    effort: EffortLevel | undefined,
  ): Promise<void> {
    const session = this.registry.find(sessionId as string);
    if (!session) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new SdkError(`Session query not initialized: ${sessionId}`);
    }

    const flagEffort: FlagEffortLevel =
      effort === undefined ? null : effort === 'max' ? 'xhigh' : effort;

    this.logger.info(
      `[SessionLifecycle] Setting effort for ${sessionId}: ${flagEffort ?? 'default'}`,
    );

    try {
      await session.query.applyFlagSettings({ effortLevel: flagEffort });
    } catch (error) {
      this.logger.error(
        `[SessionLifecycle] Failed to set effort for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }
}
