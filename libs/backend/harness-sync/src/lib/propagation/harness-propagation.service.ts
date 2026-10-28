/**
 * The ONE function every "something changed upstream" trigger calls.
 *
 * Before TASK_2026_278 Batch 3 there were four shapes of emit site, and each
 * had picked a different subset of the same three steps:
 *
 * - `plugins:save-config` reconciled without refreshing the user layer, which
 *   is correct only because enable/disable changes the FILTER and not the
 *   sources.
 * - `plugins:uninstall-external` did the same — and there it was wrong: the
 *   plugin tree was gone but its user-layer clones were not, so `reconcile`
 *   still saw them in the desired state and kept copying a deleted plugin's
 *   skills into every target forever (defect 7).
 * - `harness:create-skill` mirrored one plugin dir and never reconciled at all,
 *   so a skill the user had just authored did not exist for the model until the
 *   next activation.
 * - `wizard:submit-selection` had the full sequence, spelled out inline and
 *   private to one handler.
 *
 * `propagate()` is that sequence, once: **refresh the user layer, then
 * reconcile every target.** Emit sites choose a `reason`, not an order.
 *
 * Why the refresh comes first is not stylistic. The reconciler's desired state
 * IS `~/.ptah/user`, so a trigger that changed an upstream source — a promoted
 * synth skill under `~/.ptah/skills`, a `ptah-harness-*` plugin dir, a
 * hand-edited `{ws}/.claude/agents/x.md` — has changed nothing the reconciler
 * can see until the mirror has run. Reconciling first and refreshing after
 * would propagate the PREVIOUS state and report success.
 *
 * Never throws. A propagation that fails has still committed whatever change
 * triggered it, and every host reconciles again at its next activation.
 */

import type { HarnessHealth, HarnessTargetId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import type {
  IUserLayerRefresher,
  UserLayerRefreshStatus,
} from '../sources/user-layer-refresher.port';

export interface HarnessPropagateOptions {
  /**
   * Skip the user-layer refresh.
   *
   * For triggers that changed only which sources are ENABLED and not what the
   * sources contain — `plugins:save-config` is the whole of that category. The
   * refresh is a directory walk plus a hash per clone; skipping it where it
   * provably cannot matter keeps a toggle in the Plugins panel cheap.
   */
  skipUserLayerRefresh?: boolean;
  /** Reporting only: an empty user layer means "download in flight" (E2). */
  downloadPending?: boolean;
  /**
   * Reconcile mode. Defaults to `full`, which is what an emit site wants: the
   * source it just changed has to actually reach disk.
   *
   * `preflight` exists for the ONE caller that is inspecting rather than
   * propagating — `harness:health` with no cached report. Routing it through
   * here rather than letting it reach for the reconciler keeps the rule in the
   * lib's CLAUDE.md intact: callers use propagation, full stop.
   */
  mode?: 'full' | 'preflight';
  /**
   * Restrict the pass to these targets. Absent or empty means every target.
   *
   * Only the manual `harness:reconcile` RPC passes this; a trigger must never
   * narrow the pass, because it cannot know which targets the change affects.
   */
  targets?: HarnessTargetId[];
  /**
   * The label handed to {@link IUserLayerRefresher.refresh}. Absent — every
   * caller but one — leaves the host's default propagation label, which a host
   * never holds.
   *
   * Only a background skill re-propagation sets it (TASK_2026_437 FU-17b), so
   * the host can hold that refresh while a turn is generating. Distinct from
   * `reason`, which labels the reconcile and is free text per emit site.
   */
  userLayerRefreshReason?: string;
}

/**
 * What one propagation did: the reconcile's health report, and what the
 * user-layer refresh in front of it did.
 *
 * `userLayer` is `skipped` whenever no refresh ran — no workspace, a caller
 * that passed {@link HarnessPropagateOptions.skipUserLayerRefresh}, or a host
 * whose refresher declined the pass.
 */
export interface HarnessPropagationReport {
  /** The health report, or `null` when the reconcile could not run. */
  health: HarnessHealth | null;
  userLayer: UserLayerRefreshStatus;
}

export class HarnessPropagationService {
  constructor(
    private readonly logger: Logger,
    private readonly reconciler: HarnessReconcilerService,
    private readonly refresher: IUserLayerRefresher,
  ) {}

  /**
   * {@link propagateWithReport} for a caller that needs only the health.
   *
   * @returns The health report, or `null` when the pass could not run.
   */
  async propagate(
    cwd: string | undefined,
    reason: string,
    options: HarnessPropagateOptions = {},
  ): Promise<HarnessHealth | null> {
    const report = await this.propagateWithReport(cwd, reason, options);
    return report.health;
  }

  /**
   * Refresh the user layer, then reconcile every target, and report both.
   *
   * @param cwd Any directory inside the workspace; the reconciler normalizes it
   *   to the real root (E14). `undefined` when no workspace is open, in which
   *   case there is nothing to populate and the call is a logged no-op.
   */
  async propagateWithReport(
    cwd: string | undefined,
    reason: string,
    options: HarnessPropagateOptions = {},
  ): Promise<HarnessPropagationReport> {
    if (cwd === undefined || cwd === null || cwd.trim() === '') {
      this.logger.debug('[harness-sync] Propagation skipped — no workspace', {
        reason,
      });
      return { health: null, userLayer: 'skipped' };
    }

    // An absent label is `undefined`, which every refresher treats as "no
    // label" (the port contract): the host applies its own default.
    const userLayer: UserLayerRefreshStatus =
      options.skipUserLayerRefresh === true
        ? 'skipped'
        : await this.refreshUserLayer(
            cwd,
            options.userLayerRefreshReason,
            reason,
          );

    try {
      const health = await this.reconciler.reconcile(cwd, {
        mode: options.mode ?? 'full',
        reason,
        ...(options.downloadPending === true ? { downloadPending: true } : {}),
        ...(options.targets !== undefined && options.targets.length > 0
          ? { targets: options.targets }
          : {}),
      });
      return { health, userLayer };
    } catch (error: unknown) {
      // Propagation is best effort at trigger sites: the warning reports the
      // failure and a null health is the documented no-report result.
      this.logger.warn('[harness-sync] Propagation reconcile failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return { health: null, userLayer };
    }
  }

  /**
   * Refresh the user layer without reconciling, and without making the caller
   * wait.
   *
   * For a trigger whose reconcile already ran (or needs none) but whose
   * Library copy must still catch up — `plugins:save-config` toggling a
   * plugin that owns agents. A `failed` status and a rejected refresher are
   * both logged; neither reaches the caller.
   */
  refreshUserLayerInBackground(cwd: string | undefined, reason: string): void {
    if (cwd === undefined || cwd === null || cwd.trim() === '') {
      this.logger.debug(
        '[harness-sync] Background user-layer refresh skipped — no workspace',
        { reason },
      );
      return;
    }
    void this.refreshUserLayer(cwd, reason, reason);
  }

  /**
   * One refresh, settled to a status. A refresher that breaks the port
   * contract by rejecting is reported as `failed`, never propagated: a stale
   * user layer still reconciles every target that drifted for an unrelated
   * reason, which is most of them.
   */
  private async refreshUserLayer(
    cwd: string,
    refreshReason: string | undefined,
    reason: string,
  ): Promise<UserLayerRefreshStatus> {
    try {
      const status = await this.refresher.refresh(cwd, refreshReason);
      if (status === 'failed') {
        this.logger.warn(
          '[harness-sync] User-layer refresh failed; reconciling the layer as it stands',
          { reason },
        );
      }
      return status;
    } catch (error: unknown) {
      // degradation-audit: reported - the warning records the rejection and
      // 'failed' is the port's own status for a refresh that did not complete.
      this.logger.warn(
        '[harness-sync] User-layer refresh failed; reconciling the layer as it stands',
        {
          reason,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return 'failed';
    }
  }
}
