/**
 * The reconciler's RPC surface: `harness:health`, `harness:reconcile`,
 * `harness:remove` (TASK_2026_278 Batch 4).
 *
 * A collaborator rather than three more methods on `HarnessRpcHandlers`,
 * because the two share only a namespace. Everything else on that facade is the
 * setup BUILDER — a wizard that authors a harness. These three are the
 * PROPAGATION surface: they report and repair whether the authored harness
 * actually reached disk. The facade keeps the registrations (so the host
 * profile manifest, the DI wiring and the method-coverage specs need no edit)
 * and delegates the work here.
 *
 * It also owns the one push: `harness:healthChanged`. `harness-sync` cannot
 * broadcast — it depends on `shared` and `vscode-core` only, deliberately, and
 * giving it a webview messenger to satisfy a badge would be new capability in a
 * lib whose whole point is that it has none. So the reconciler exposes
 * `onHealth`, this service subscribes, and the transport concern stays on this
 * side of the boundary.
 */

import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessPropagationService,
  type HarnessReconcilerService,
} from '@ptah-extension/harness-sync';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  summarizeHarnessHealth,
  type HarnessHealth,
  type HarnessHealthParams,
  type HarnessHealthResult,
  type HarnessHealthSummary,
  type HarnessReconcileParams,
  type HarnessReconcileResult,
  type HarnessRemoveParams,
  type HarnessRemoveResult,
} from '@ptah-extension/shared';
import type { WebviewBroadcaster } from '../streaming/harness-stream-broadcaster.service';

/** The empty answer, used whenever no workspace is open. */
function noWorkspaceResult(): HarnessHealthResult {
  return {
    health: null,
    summary: summarizeHarnessHealth(null),
    cached: false,
  };
}

@injectable()
export class HarnessHealthRpcService {
  /**
   * The last summary actually pushed, as a comparison key.
   *
   * Edge-triggering the push is not an optimisation, it is what makes the
   * message affordable: preflight runs on EVERY session start and a full pass
   * on every activation, so a per-pass push would be a webview message per
   * session for a badge whose value did not change.
   */
  private lastPushedKey: string | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(HARNESS_SYNC_TOKENS.RECONCILER)
    private readonly reconciler: HarnessReconcilerService,
    @inject(HARNESS_SYNC_TOKENS.PROPAGATION)
    private readonly propagation: HarnessPropagationService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
  ) {
    this.reconciler.onHealth((health) => this.pushIfChanged(health));
  }

  /**
   * `harness:health` — what the Marketplace badge polls.
   *
   * Answers from the reconciler's cached report by default. That report is
   * produced by every activation and every session preflight, so it is both
   * current and free; re-running a pass per poll would put a directory walk of
   * `~/.ptah/user` behind a UI refresh.
   *
   * A cached report for a DIFFERENT workspace root is not a hit. The reconciler
   * is one singleton per host and its cache holds whichever workspace ran last,
   * so a two-window host would otherwise show one window the other's health
   * (E12/E13).
   */
  async health(params: HarnessHealthParams): Promise<HarnessHealthResult> {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (
      workspaceRoot === undefined ||
      workspaceRoot === null ||
      workspaceRoot === ''
    ) {
      return noWorkspaceResult();
    }

    if (params.refresh !== true) {
      const cached = this.reconciler.getLastHealth();
      if (cached !== null && cached.workspaceRoot === workspaceRoot) {
        return {
          health: cached,
          summary: summarizeHarnessHealth(cached),
          cached: true,
        };
      }
    }

    // `verify`, not `reconcile({ mode: 'preflight' })`. Preflight is a cheap
    // drift TEST that falls through to a full apply the moment it finds drift;
    // asking what state the harness is in must not change it, and a polling
    // badge must not be able to take the workspace lock out from under a
    // session that is mid-copy. A caller that wants the repair asks for
    // `harness:reconcile`.
    const health = await this.reconciler.verify(
      workspaceRoot,
      'harness:health',
    );

    return {
      health,
      summary: summarizeHarnessHealth(health),
      cached: false,
    };
  }

  /**
   * `harness:reconcile` — the manual repair, behind the panel's "Fix" button
   * and behind `ptah harness doctor --fix`.
   *
   * Goes through `HarnessPropagationService`, never the reconciler directly:
   * the desired state IS `~/.ptah/user`, so a repair that skipped the mirror
   * would re-propagate whatever the last mirror left behind and report a clean
   * pass over a stale source.
   */
  async reconcile(
    params: HarnessReconcileParams,
  ): Promise<HarnessReconcileResult> {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (
      workspaceRoot === undefined ||
      workspaceRoot === null ||
      workspaceRoot === ''
    ) {
      return { health: null, summary: summarizeHarnessHealth(null) };
    }

    const health = await this.propagation.propagate(
      workspaceRoot,
      'harness:reconcile',
      {
        mode: params.mode ?? 'full',
        ...(params.targets !== undefined && params.targets.length > 0
          ? { targets: params.targets }
          : {}),
      },
    );

    return { health, summary: summarizeHarnessHealth(health) };
  }

  /**
   * `harness:remove` — E22.
   *
   * The one removal in the product that is not driven by a source
   * disappearing. It is bounded by the manifest, so a directory Ptah did not
   * write, a server the user added by hand and the entire user layer under
   * `~/.ptah/user` all survive. `confirm` is validated at the schema
   * (`z.literal(true)`), so reaching this method IS the confirmation.
   */
  async remove(params: HarnessRemoveParams): Promise<HarnessRemoveResult> {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (
      workspaceRoot === undefined ||
      workspaceRoot === null ||
      workspaceRoot === ''
    ) {
      return {
        health: null,
        summary: summarizeHarnessHealth(null),
        removed: 0,
      };
    }
    if (params.confirm !== true) {
      // Unreachable through the RPC boundary — the schema rejects it first.
      // Kept because this method deletes files, and a second cheap check costs
      // nothing next to trusting one caller to have parsed.
      throw new Error('harness:remove requires confirm: true');
    }

    const health = await this.reconciler.remove(workspaceRoot);
    const removed = health.targets.reduce(
      (total, target) => total + target.removed.length,
      0,
    );

    return { health, summary: summarizeHarnessHealth(health), removed };
  }

  /**
   * Broadcast when, and only when, the summary changed.
   *
   * The messenger is resolved LAZILY rather than injected. Several hosts
   * register `WEBVIEW_MANAGER` after the shared RPC handlers (the ordering
   * hazard `SessionLifecycleNotifier` already documents), so an optional
   * constructor injection would capture `null` at construction and never
   * recover. Resolving per push costs a map lookup and is always correct.
   */
  private pushIfChanged(health: HarnessHealth): void {
    const summary = summarizeHarnessHealth(health);
    const key = summaryKey(health.workspaceRoot, summary);
    if (key === this.lastPushedKey) return;
    this.lastPushedKey = key;

    let messenger: WebviewBroadcaster;
    try {
      messenger = this.container.resolve<WebviewBroadcaster>(
        TOKENS.WEBVIEW_MANAGER,
      );
    } catch {
      // Headless hosts (ptah-cli one-shots) have no webview. Not an error.
      return;
    }

    void messenger
      .broadcastMessage(MESSAGE_TYPES.HARNESS_HEALTH_CHANGED, {
        health,
        summary,
      })
      .catch((error: unknown) => {
        this.logger.debug('[harness] healthChanged broadcast failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

/**
 * The comparison key for edge-triggering.
 *
 * Deliberately NOT the whole report: `generatedAt`, `durationMs` and `reason`
 * change on every pass, so hashing the report would make every pass a change.
 * It is the fields a badge renders, plus the workspace root — switching windows
 * must re-push even when both workspaces happen to be equally healthy.
 */
function summaryKey(
  workspaceRoot: string,
  summary: HarnessHealthSummary,
): string {
  return [
    workspaceRoot,
    summary.level,
    summary.detectedTargets,
    summary.expected,
    summary.found,
    summary.missing,
    summary.writeFailed,
    summary.foreign,
    summary.collisions,
    summary.sources,
  ].join('|');
}
