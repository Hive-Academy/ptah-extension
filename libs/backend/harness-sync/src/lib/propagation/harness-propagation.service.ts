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
import type { IUserLayerRefresher } from '../sources/user-layer-refresher.port';

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
}

export class HarnessPropagationService {
  constructor(
    private readonly logger: Logger,
    private readonly reconciler: HarnessReconcilerService,
    private readonly refresher: IUserLayerRefresher,
  ) {}

  /**
   * @param cwd Any directory inside the workspace; the reconciler normalizes it
   *   to the real root (E14). `undefined` when no workspace is open, in which
   *   case there is nothing to populate and the call is a logged no-op.
   * @returns The health report, or `null` when the pass could not run.
   */
  async propagate(
    cwd: string | undefined,
    reason: string,
    options: HarnessPropagateOptions = {},
  ): Promise<HarnessHealth | null> {
    if (cwd === undefined || cwd === null || cwd.trim() === '') {
      this.logger.debug('[harness-sync] Propagation skipped — no workspace', {
        reason,
      });
      return null;
    }

    if (options.skipUserLayerRefresh !== true) {
      try {
        await this.refresher.refresh(cwd);
      } catch (error: unknown) {
        // Deliberately non-fatal and deliberately NOT a return: reconciling a
        // stale user layer still heals every target that drifted for an
        // unrelated reason, which is most of them.
        this.logger.warn(
          '[harness-sync] User-layer refresh failed; reconciling the layer as it stands',
          {
            reason,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    try {
      return await this.reconciler.reconcile(cwd, {
        mode: options.mode ?? 'full',
        reason,
        ...(options.downloadPending === true ? { downloadPending: true } : {}),
        ...(options.targets !== undefined && options.targets.length > 0
          ? { targets: options.targets }
          : {}),
      });
    } catch (error: unknown) {
      this.logger.warn('[harness-sync] Propagation reconcile failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
