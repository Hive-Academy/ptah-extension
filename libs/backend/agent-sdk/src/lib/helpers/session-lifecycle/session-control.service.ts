/**
 * SessionControl — owner of the lifecycle-control methods that act on a
 * registered session's `query` handle: interrupt, end, dispose-all, set
 * permission level, set model, set effort, apply a changed auto-compact
 * window, lower or restore one session's auto-compact window.
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
  SessionBudgetWindow,
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
import type { CompactionConfig } from '../compaction-config-provider';
import {
  autoCompactModelClass,
  isValidAutoCompactWindow,
  resolveAutoCompactControl,
} from '../auto-compact-control';

export type EndSessionOutcome = 'ended' | 'already-ended';

/** Upper bound on one session's live auto-compact window change. */
const AUTO_COMPACT_APPLY_TIMEOUT_MS = 5000;

export class SessionControl {
  constructor(
    private readonly logger: Logger,
    private readonly registry: SessionRegistry,
    private readonly permissionHandler: ISdkPermissionHandler,
    private readonly subagentRegistry: SubagentRegistryService,
    private readonly modelResolver: IModelResolver,
    private readonly sessionEndRegistry: SessionEndCallbackRegistry,
    /**
     * Current compaction config, read per call by
     * {@link applySessionAutoCompactWindow} (env skip, restore value). `null`
     * in a container without the provider: no env skip is detectable and a
     * restore sends `null` (the runtime decides).
     */
    private readonly getCompactionConfig:
      (() => CompactionConfig) | null = null,
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
      if (timedOut) {
        // No turn identifier exists on SDK hooks. Retire this query rather than
        // allowing late A hooks to acquire operation ownership during turn B.
        this.retireInterruptedRecord(rec);
      } else if (this.registry.find(sessionId as string) === rec) {
        this.registry.markTurnEnded(sessionId as string);
      }
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
      // degradation-audit: optional-capability - false is this method's
      // reported "interrupt did not take", the same value the 3s timeout
      // returns, and the turn claim is released above so the session lives on.
      this.retireInterruptedRecord(rec);
      this.logger.warn(
        `[SessionLifecycle] Turn interrupt failed for session ${sessionId}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return false;
    }
  }

  /** Retire captured ownership without paying a second interrupt wait. */
  private retireInterruptedRecord(rec: SessionRecord): void {
    const current = this.registry.find(rec.tabId) === rec;
    const id = rec.realSessionId ?? rec.tabId;
    const attempt = (operation: () => void): void => {
      try {
        operation();
      } catch (error: unknown) {
        this.logger.warn(
          '[SessionLifecycle] Interrupted-query cleanup failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    };
    // Shared registries are session-keyed: never clean up a replacement's
    // permissions or children. Its predecessor's controller is still ours.
    if (current) {
      attempt(() =>
        this.permissionHandler.cleanupPendingPermissions(rec.tabId),
      );
      attempt(() => this.subagentRegistry.beginSessionTeardown(id));
      attempt(() => this.subagentRegistry.markAllInterrupted(id));
    }
    try {
      rec.abortController.abort();
    } finally {
      if (this.registry.find(rec.tabId) === rec) this.registry.remove(rec);
      if (current) attempt(() => this.subagentRegistry.endSessionTeardown(id));
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
              // SDK 0.3.278 gave `interrupt()` a return value. Teardown only
              // needs to know that it settled, so the value is discarded here
              // to keep the race a `Promise<void>`.
              rec.query.interrupt().then(() => undefined),
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

  /**
   * Apply a changed `compaction.threshold` to every live session through the
   * flag layer, so it takes effect without a restart.
   *
   * Each session is re-resolved with its OWN model class (from the auth env
   * frozen on its record), so a class default applies exactly as it would at
   * session start. `null` clears the flag-layer window and hands the decision
   * back to the runtime. Nothing is sent while auto compaction is disabled:
   * the session already carries `autoCompactEnabled: false` and the window is
   * moot.
   *
   * One session's failure is logged and does not stop the others; the method
   * never throws.
   */
  async applyAutoCompactConfig(config: CompactionConfig): Promise<void> {
    if (!config.enabled) {
      this.logger.debug(
        '[SessionLifecycle] Auto compaction is disabled; no live window change to apply',
      );
      return;
    }

    const live = Array.from(this.registry.entries())
      .map(([, rec]) => rec)
      .filter((rec) => rec.query !== null);

    await Promise.all(
      live.map(async (rec) => {
        const query = rec.query;
        if (!query) return;
        const id = rec.realSessionId ?? rec.tabId;
        const modelClass = autoCompactModelClass(
          rec.accountingAuthEnv.ANTHROPIC_BASE_URL,
        );
        const control = resolveAutoCompactControl({
          enabled: true,
          windowTokens: config.contextTokenThreshold,
          modelClass,
          envWindow: config.envWindow ?? null,
        });
        // A session-budget override outranks the configured value for its
        // session: a settings change must not silently undo a tighten.
        const override = rec.autoCompactOverride;
        const hasOverride = typeof override === 'number';
        const autoCompactWindow = hasOverride
          ? override
          : (control.autoCompactWindow ?? null);
        try {
          await this.withApplyTimeout(
            query.applyFlagSettings({ autoCompactWindow }),
            'applyFlagSettings',
          );
          this.logger.info(
            `[SessionLifecycle] Auto-compact window applied for ${id}`,
            {
              autoCompactWindow,
              window: hasOverride ? override : control.effectiveWindow,
              source: hasOverride ? 'session-override' : control.source,
              modelClass,
            },
          );
        } catch (error) {
          // degradation-audit: optional-capability - the session keeps the
          // window it started with; the new value applies to its next start.
          this.logger.warn(
            `[SessionLifecycle] Failed to apply auto-compact window for ${id}`,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }),
    );
  }

  /**
   * Lower ONE session's auto-compact window (`window`), or restore it
   * (`null`), and report what actually happened. This is the session budget's
   * `tighten` action and its `restore-window` undo.
   *
   * It never assumes the runtime honours `autoCompactWindow` (experiment E2 is
   * unproven, which is why `A1_DEFAULT_WINDOW` stays `null`). Lowering is:
   *
   * 1. skip with `env-override` when `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set
   *    (the runtime ranks it above every setting);
   * 2. read the threshold back through `getContextUsage()`; skip with
   *    `already-lower` when it is already ≤ `window`;
   * 3. record the override on the session record (so
   *    {@link applyAutoCompactConfig} keeps it), then send it;
   * 4. read the threshold back again. If it did not move to ≤ `window`, the
   *    runtime ignored the window: send back the window the session had (the
   *    previous override, else the configured window, resolved as restore
   *    does), drop the override, report `not-honoured` and WARN with the model
   *    class. That WARN (or the INFO on success) is the E2 live result for
   *    that class.
   *
   * Restoring clears the override and sends what
   * {@link resolveAutoCompactControl} gives for the current config, or `null`
   * (the runtime decides) — never a guessed class default. With no override
   * recorded there is nothing to restore and nothing is sent. A restore that
   * cannot reach the runtime, throws or times out keeps the override and gives
   * `{ applied: true, reason: 'restore-failed' }`: the lowered window is still
   * in force.
   *
   * Any throw or timeout while lowering gives `failed`. Before the target was
   * sent the record keeps the override it had. After it was sent (a read-back or the
   * not-honoured revert failed) the previous window is put back once; when
   * that fails too the target stays recorded, because the runtime holds it.
   * Never throws.
   *
   * @returns the `window` part of `SessionBudgetState`; `undefined` after a
   *   restore that left no override in place.
   */
  async applySessionAutoCompactWindow(
    sessionId: SessionId,
    window: number | null,
  ): Promise<SessionBudgetWindow | undefined> {
    return window === null
      ? this.restoreSessionAutoCompactWindow(sessionId)
      : this.lowerSessionAutoCompactWindow(sessionId, window);
  }

  private async lowerSessionAutoCompactWindow(
    sessionId: SessionId,
    target: number,
  ): Promise<SessionBudgetWindow> {
    const failed: SessionBudgetWindow = {
      target,
      applied: false,
      reason: 'failed',
    };
    const rec = this.registry.find(sessionId as string);
    const query = rec?.query;
    if (!rec || !query) {
      this.logger.warn(
        `[SessionLifecycle] Cannot apply a session auto-compact window - session or query not found: ${sessionId}`,
      );
      return failed;
    }
    if (!isValidAutoCompactWindow(target)) {
      this.logger.warn(
        `[SessionLifecycle] Session auto-compact window ${target} is outside the runtime's accepted range; not sent for ${sessionId}`,
      );
      return failed;
    }
    const envWindow = this.getCompactionConfig?.().envWindow ?? null;
    if (envWindow !== null) {
      this.logger.info(
        `[SessionLifecycle] Session auto-compact window skipped for ${sessionId}: CLAUDE_CODE_AUTO_COMPACT_WINDOW pins the window`,
        { target, envWindow },
      );
      return { target, applied: false, reason: 'env-override' };
    }
    const readBack = query.getContextUsage?.bind(query);
    if (!readBack) {
      this.logger.warn(
        `[SessionLifecycle] Session auto-compact window not sent for ${sessionId}: the query cannot read the threshold back`,
      );
      return failed;
    }

    const modelClass = autoCompactModelClass(
      rec.accountingAuthEnv.ANTHROPIC_BASE_URL,
    );
    const previousOverride = rec.autoCompactOverride ?? null;
    // Once the target reached the runtime, the record must keep describing
    // what the runtime holds: revert it, or keep the target recorded.
    let targetSent = false;
    let revertAttempted = false;
    try {
      const before = await this.withApplyTimeout(readBack(), 'getContextUsage');
      if (isAtOrBelow(before.autoCompactThreshold, target)) {
        this.logger.info(
          `[SessionLifecycle] Session auto-compact window skipped for ${sessionId}: the threshold is already lower`,
          { target, threshold: before.autoCompactThreshold, modelClass },
        );
        return { target, applied: false, reason: 'already-lower' };
      }

      rec.autoCompactOverride = target;
      await this.withApplyTimeout(
        query.applyFlagSettings({ autoCompactWindow: target }),
        'applyFlagSettings',
      );
      targetSent = true;
      const after = await this.withApplyTimeout(readBack(), 'getContextUsage');
      if (isAtOrBelow(after.autoCompactThreshold, target)) {
        this.logger.info(
          `[SessionLifecycle] Session auto-compact window honoured for ${sessionId} (E2 passed for this model class)`,
          { target, threshold: after.autoCompactThreshold, modelClass },
        );
        return { target, applied: true };
      }

      // E2 failed for this class: the runtime ignored the window. Undo it so
      // the session is not left carrying a flag the runtime may honour later,
      // and put back the window the session had (the user's configured one).
      this.logger.warn(
        `[SessionLifecycle] Session auto-compact window NOT honoured for ${sessionId} (E2 failed for model class ${modelClass}); restoring the previous window`,
        {
          target,
          thresholdBefore: before.autoCompactThreshold,
          thresholdAfter: after.autoCompactThreshold,
          modelClass,
        },
      );
      revertAttempted = true;
      await this.revertSessionAutoCompactWindow(
        rec,
        query,
        previousOverride,
        modelClass,
      );
      return { target, applied: false, reason: 'not-honoured' };
    } catch (error) {
      // degradation-audit: optional-capability - the budget reports `failed`
      // and the session keeps the window it had; the stage still advances.
      this.logger.warn(
        `[SessionLifecycle] Failed to apply a session auto-compact window for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      if (!targetSent) {
        rec.autoCompactOverride = previousOverride;
        return failed;
      }
      if (!revertAttempted) {
        try {
          await this.revertSessionAutoCompactWindow(
            rec,
            query,
            previousOverride,
            modelClass,
          );
          return failed;
        } catch (revertError) {
          // degradation-audit: optional-capability - the target stays
          // recorded (below) because the runtime still holds it; restore and
          // the next config re-apply both see the truth.
          this.logger.warn(
            `[SessionLifecycle] Failed to put back the previous auto-compact window for ${sessionId}`,
            revertError instanceof Error
              ? revertError
              : new Error(String(revertError)),
          );
        }
      }
      // The runtime holds the target: keep it recorded so the record, the
      // config re-apply and `restore-window` match the runtime.
      rec.autoCompactOverride = target;
      return failed;
    }
  }

  /**
   * Put back the window the session had before a lowering: the previous
   * override when there was one, else the user's configured window resolved
   * exactly as {@link restoreSessionAutoCompactWindow} does. The record's
   * override changes only once the runtime accepted the value. Throws on
   * failure.
   */
  private async revertSessionAutoCompactWindow(
    rec: SessionRecord,
    query: NonNullable<SessionRecord['query']>,
    previousOverride: number | null,
    modelClass: ReturnType<typeof autoCompactModelClass>,
  ): Promise<void> {
    const autoCompactWindow =
      previousOverride ?? this.configuredAutoCompactWindow(modelClass);
    await this.withApplyTimeout(
      query.applyFlagSettings({ autoCompactWindow }),
      'applyFlagSettings',
    );
    rec.autoCompactOverride = previousOverride;
  }

  /**
   * The window the current compaction config gives this model class, or
   * `null` (the runtime decides) when none is configured or compaction is off.
   */
  private configuredAutoCompactWindow(
    modelClass: ReturnType<typeof autoCompactModelClass>,
  ): number | null {
    const config = this.getCompactionConfig?.() ?? null;
    return config?.enabled === true
      ? (resolveAutoCompactControl({
          enabled: true,
          windowTokens: config.contextTokenThreshold,
          modelClass,
          envWindow: config.envWindow ?? null,
        }).autoCompactWindow ?? null)
      : null;
  }

  private async restoreSessionAutoCompactWindow(
    sessionId: SessionId,
  ): Promise<SessionBudgetWindow | undefined> {
    const rec = this.registry.find(sessionId as string);
    const override = rec?.autoCompactOverride;
    if (!rec || typeof override !== 'number') {
      return undefined;
    }
    // `applied: true`: the lowered window is still in place after a failure.
    const failed: SessionBudgetWindow = {
      target: override,
      applied: true,
      reason: 'restore-failed',
    };
    const query = rec.query;
    if (!query) {
      this.logger.warn(
        `[SessionLifecycle] Cannot restore the auto-compact window - query not found: ${sessionId}`,
      );
      return failed;
    }

    const modelClass = autoCompactModelClass(
      rec.accountingAuthEnv.ANTHROPIC_BASE_URL,
    );
    const autoCompactWindow = this.configuredAutoCompactWindow(modelClass);
    try {
      await this.withApplyTimeout(
        query.applyFlagSettings({ autoCompactWindow }),
        'applyFlagSettings',
      );
      rec.autoCompactOverride = null;
      this.logger.info(
        `[SessionLifecycle] Session auto-compact window restored for ${sessionId}`,
        { from: override, autoCompactWindow, modelClass },
      );
      return undefined;
    } catch (error) {
      // degradation-audit: optional-capability - the session keeps its
      // lowered window and the override stays recorded; the user can retry.
      this.logger.warn(
        `[SessionLifecycle] Failed to restore the auto-compact window for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return failed;
    }
  }

  /**
   * Bound one control-channel request. A child that stopped reading its
   * control channel would leave it pending forever; the timeout bounds the
   * wait, not the request.
   */
  private async withApplyTimeout<T>(
    request: Promise<T>,
    what: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${what} timed out after ${AUTO_COMPACT_APPLY_TIMEOUT_MS}ms`,
                ),
              ),
            AUTO_COMPACT_APPLY_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** True when the runtime reported a threshold at or below `target`. */
function isAtOrBelow(threshold: number | undefined, target: number): boolean {
  return typeof threshold === 'number' && threshold <= target;
}
