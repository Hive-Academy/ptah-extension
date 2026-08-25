/**
 * The per-workspace skill selection surface: `harness:get-skill-selection` and
 * `harness:set-skill-selection` (TASK_2026_316 Batch 3).
 *
 * A collaborator beside `health/harness-health-rpc.service.ts` for that file's
 * reason: it shares the `harness:` namespace with the setup BUILDER and nothing
 * else. The builder authors a harness; the health service reports whether the
 * authored harness reached disk; this one records WHICH of it this project
 * wants. `HarnessRpcHandlers` keeps the registrations, so the host-profile
 * manifest, both app DI bundles and the method-coverage specs need no edit.
 *
 * ## Two rules, and both are the same rule the reconciler already follows
 *
 * **`get` is READ-ONLY.** `SkillSyncGate.resolve` can DERIVE a mode from
 * manifest evidence when `state.json` records none, and the reconciler persists
 * that derivation so the evidence walk runs exactly once. This method
 * deliberately does not. It is `verify()`'s rule verbatim: a derived decision is
 * a write, and asking what state the harness is in must not change it. A
 * selection dialog that polls on open — or a card that renders a count — must
 * not be able to record a consent decision on the user's behalf, and the answer
 * `get` returns is identical either way.
 *
 * **`set` propagates through `HarnessPropagationService`, with
 * `skipUserLayerRefresh`.** `reconcile` is the primitive and `propagate` is the
 * operation; a bare `reconcile` from a trigger propagates the PREVIOUS state
 * and reports a clean pass. There are exactly two documented exceptions to the
 * user-layer refresh — host activation, and `plugins:save-config`, which takes
 * it "because enabling a plugin changes the FILTER and never a source's
 * contents". A skill selection is the same shape and takes the same exception:
 * `~/.ptah/user/skills` holds exactly the same bytes after the save as before
 * it, and the refresh is a directory walk plus a hash per clone.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  HARNESS_SYNC_TOKENS,
  resolveHarnessWorkspaceRoot,
  type HarnessPropagationService,
  type IHarnessSourceResolver,
  type SkillSyncGate,
} from '@ptah-extension/harness-sync';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  summarizeHarnessHealth,
  type HarnessGetSkillSelectionResult,
  type HarnessSetSkillSelectionParams,
  type HarnessSetSkillSelectionResult,
} from '@ptah-extension/shared';
import { readSkillCandidates } from './skill-catalog';

@injectable()
export class HarnessSkillSelectionRpcService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(HARNESS_SYNC_TOKENS.SKILL_SYNC_GATE)
    private readonly gate: SkillSyncGate,
    @inject(HARNESS_SYNC_TOKENS.SOURCE_RESOLVER)
    private readonly sourceResolver: IHarnessSourceResolver,
    @inject(HARNESS_SYNC_TOKENS.PROPAGATION)
    private readonly propagation: HarnessPropagationService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * `harness:get-skill-selection` — what the selection surface renders.
   *
   * Writes nothing. See the class comment: `SkillSyncGate.persist` exists and
   * is deliberately not called from here.
   *
   * With no workspace open the honest answer is `'all'` with an empty catalog
   * rather than `'selected'`: there is no workspace whose selection could be
   * narrower than everything, and returning the gated mode would render a
   * surface claiming this project propagates nothing.
   */
  getSelection(): HarnessGetSkillSelectionResult {
    const workspaceRoot = this.resolveWorkspaceRoot();
    const available = readSkillCandidates(this.sourceResolver.resolve());

    if (workspaceRoot === null) {
      return { mode: 'all', slugs: [], available, derived: true };
    }

    const decision = this.gate.resolve(workspaceRoot);
    return {
      mode: decision.mode,
      slugs: [...decision.slugs],
      available,
      derived: decision.derived,
    };
  }

  /**
   * `harness:set-skill-selection` — the user's explicit choice.
   *
   * `'all'` clears the allowlist rather than keeping it, which is
   * `SkillSyncGate.enableAll`'s rule: a stale list surviving the switch would
   * read as a selection nobody made the next time the mode was narrowed again.
   *
   * A failed write short-circuits before the pass. The previous selection is
   * still what `state.json` records and therefore still what the reconciler
   * will honour, so propagating would apply the OLD selection under a result
   * that told the user their new one had taken effect.
   */
  async setSelection(
    params: HarnessSetSkillSelectionParams,
  ): Promise<HarnessSetSkillSelectionResult> {
    const workspaceRoot = this.resolveWorkspaceRoot();
    if (workspaceRoot === null) {
      this.logger.warn(
        '[harness] Skill selection ignored: no workspace is open',
      );
      return {
        saved: false,
        mode: params.mode,
        slugs: [],
        health: null,
        summary: summarizeHarnessHealth(null),
      };
    }

    const saved =
      params.mode === 'all'
        ? this.gate.enableAll(workspaceRoot)
        : this.gate.select(workspaceRoot, params.slugs ?? []);

    // Read back rather than echo. The gate trims, deduplicates and sorts before
    // it writes, so the caller's list and the recorded one are routinely
    // different, and the surface must render what is actually in force.
    const recorded = this.gate.resolve(workspaceRoot);
    const slugs = [...recorded.slugs];

    if (!saved) {
      this.logger.error(
        '[harness] Could not record the skill selection; harness left unchanged',
      );
      return {
        saved: false,
        mode: recorded.mode,
        slugs,
        health: null,
        summary: summarizeHarnessHealth(null),
      };
    }

    const health = await this.propagation.propagate(
      workspaceRoot,
      'harness:set-skill-selection',
      { skipUserLayerRefresh: true },
    );

    this.logger.info('[harness] Skill selection saved', {
      mode: recorded.mode,
      selected: slugs.length,
    });

    return {
      saved: true,
      mode: recorded.mode,
      slugs,
      health,
      summary: summarizeHarnessHealth(health),
    };
  }

  /**
   * The open workspace, NORMALIZED, or `null` when there is none.
   *
   * `SkillSyncGate.resolve` documents that its argument must already be the
   * real root — the reconciler resolves once at its entry point (E14) and every
   * collaborator below it assumes that. `IWorkspaceProvider.getWorkspaceRoot()`
   * makes no such promise, so the resolve happens here.
   * `resolveHarnessWorkspaceRoot` is a fixed point, which is why `select` and
   * `enableAll` can take the same already-resolved value and normalize it again
   * for free.
   */
  private resolveWorkspaceRoot(): string | null {
    const root = this.workspaceProvider.getWorkspaceRoot();
    if (root === undefined || root === null || root === '') return null;
    return resolveHarnessWorkspaceRoot(root);
  }
}
