/**
 * PluginLocalItemsService - the local-item steps of the plugin RPCs
 * (TASK_2026_701 B12, A17).
 *
 * `PluginRpcHandlers` only delegates here. Three steps, one per RPC moment:
 *
 * - {@link planForInstall}: the local items an external install plan would
 *   affect, registered for the consent token's lifetime and attached to the
 *   pending plan, so the confirm acts only on ids this plan issued.
 * - {@link applyPlanDecisions}: after a SUCCESSFUL confirm, apply the replace
 *   decisions for the plan's own ids and report every other item as kept.
 * - {@link keptForSave}: after `plugins:save-config`, the kept report for the
 *   plugins the save turned on.
 *
 * None of these fails the action it serves: the primary write (the plan, the
 * install, the save) already decided the RPC's outcome, and a missing offer is
 * safe because the item simply stays the user's.
 */
import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  type SentryService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS, type PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  ExternalPluginInstallerService,
  PLUGIN_INSTALL_PLAN_TTL_MS,
  PLUGIN_MARKETPLACE_TOKENS,
} from '@ptah-extension/plugin-marketplace';
import type {
  ExternalInstallPlan,
  ExternalLocalItem,
  FileDecision,
  HarnessHealth,
  KeptItem,
  LocalItemFamily,
  PluginInfo,
} from '@ptah-extension/shared';
import {
  InstallLocalItemsService,
  type ApplyLocalItemsReport,
} from './install-local-items.service';
import {
  MarketplaceLocalItemsService,
  keptReasonFor,
} from './marketplace-local-items.service';

/** What a confirm's decisions did to its plan's items. */
export interface PlanDecisionsReport {
  kept: KeptItem[];
  replaced: ExternalLocalItem[];
}

/** The configuration before and after a `plugins:save-config`. */
export interface KeptForSaveRequest {
  harnessRoot: string;
  previous: { enabledPluginIds: string[]; disabledPluginIds?: string[] };
  enabledPluginIds: readonly string[];
  /** Undefined: the save preserved the persisted denylist. */
  disabledPluginIds: readonly string[] | undefined;
  /** Health of the save's reconcile; `null` reports no file items. */
  health: HarnessHealth | null;
}

@injectable()
export class PluginLocalItemsService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(PLUGIN_MARKETPLACE_TOKENS.INSTALLER)
    private readonly externalInstaller: ExternalPluginInstallerService,
    /** Finds and registers the local items a plan or kept report offers. */
    @inject(MarketplaceLocalItemsService)
    private readonly localItems: MarketplaceLocalItemsService,
    /** Applies replace decisions, each through its own family's route. */
    @inject(InstallLocalItemsService)
    private readonly installLocalItems: InstallLocalItemsService,
  ) {}

  /**
   * The local items standing where `plan` would land, registered for approval
   * with the consent token's lifetime and attached to the pending plan
   * (A-plan). Without a harness root there is nothing to list.
   *
   * Never fails the plan: without a list the dialog offers no replace, and
   * the reconciler's own keep rule still leaves every edited file in place.
   */
  async planForInstall(
    harnessRoot: string | undefined,
    plan: ExternalInstallPlan,
  ): Promise<ExternalLocalItem[]> {
    if (harnessRoot === undefined) return [];
    try {
      const slugs = this.externalInstaller.planItemSlugs(plan.consentToken) ?? {
        skills: plan.skills,
        commands: [],
        agents: [],
      };
      const items = await this.localItems.planLocalItems({
        family: 'external',
        harnessRoot,
        sourceRef: plan.pluginId,
        slugs,
        ttlMs: PLUGIN_INSTALL_PLAN_TTL_MS,
      });
      this.externalInstaller.attachLocalItems(plan.consentToken, items);
      return items;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the plan is still shown and
      // installable; with no list the dialog offers no replace and every
      // local item stays the user's (B9 keep). Logged for diagnosis.
      this.logger.warn(
        'RPC: plugins:install-external local items unavailable',
        {
          pluginId: plan.pluginId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return [];
    }
  }

  /**
   * Apply the confirm's replace decisions to the plan's own items. A decision
   * naming an id the plan did not issue is ignored; a missing decision is
   * keep. Items left in place are reported as kept with their reason.
   */
  async applyPlanDecisions(
    harnessRoot: string | undefined,
    planItems: readonly ExternalLocalItem[],
    decisions: Readonly<Record<string, FileDecision>>,
  ): Promise<PlanDecisionsReport> {
    const replaceIds = planItems
      .filter((item) => decisions[item.approvalId] === 'replace')
      .map((item) => item.approvalId);
    const report =
      harnessRoot === undefined || replaceIds.length === 0
        ? emptyApplyReport()
        : await this.applyLocalItems({
            family: 'external',
            harnessRoot,
            approvalIds: replaceIds,
          });

    const replacedIds = new Set(report.replaced.map((item) => item.approvalId));
    const reported = new Map<string, KeptItem>(
      report.kept.map((item) => [item.approvalId, item]),
    );
    const unknown = new Set(report.unknown);
    const kept: KeptItem[] = [];
    for (const item of planItems) {
      if (replacedIds.has(item.approvalId)) continue;
      const fromApply = reported.get(item.approvalId);
      if (fromApply !== undefined) {
        kept.push(fromApply);
        continue;
      }
      kept.push({
        approvalId: item.approvalId,
        family: item.family,
        ...(item.target !== undefined ? { target: item.target } : {}),
        relPath: item.relPath,
        // A replace whose approval was gone by the time it ran (expired or
        // evicted) no longer matches what the user approved.
        reason: unknown.has(item.approvalId)
          ? 'changed-since-approval'
          : keptReasonFor(item.kind),
      });
    }
    return {
      kept,
      replaced: planItems.filter((item) => replacedIds.has(item.approvalId)),
    };
  }

  /**
   * The kept report for the plugins a save just turned on: their destinations
   * the pass left as the user's (`plugin-enable`) and the workspace agents
   * that shadow their agents (`plugin-agent`). Never fails the save.
   */
  async keptForSave(request: KeptForSaveRequest): Promise<KeptItem[]> {
    const pluginIds = newlyEnabledPluginIds(
      request.previous,
      request.enabledPluginIds,
      request.disabledPluginIds,
    );
    if (pluginIds.length === 0) return [];
    try {
      const plugins = this.pluginLoader
        .getAvailablePlugins()
        .filter((plugin) => pluginIds.includes(plugin.id));
      const descriptors = Object.values(
        this.pluginLoader.getPluginSourceDescriptors(),
      );
      const kept: KeptItem[] = [];
      for (const plugin of plugins) {
        kept.push(
          ...(await this.localItems.keptReport({
            harnessRoot: request.harnessRoot,
            sourceRef: sourceRefFor(plugin, descriptors),
            slugs: {
              skills: plugin.skillNames ?? [],
              commands: plugin.commandNames ?? [],
              agents: plugin.agentNames ?? [],
            },
            health: request.health,
            fileFamily: 'plugin-enable',
            agentFamily: 'plugin-agent',
          })),
        );
      }
      return kept;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the save succeeded; without
      // a report nothing is offered for replace and every kept item stays
      // the user's. Logged for diagnosis.
      this.logger.warn('RPC: plugins:save-config kept report unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * `InstallLocalItemsService.apply` reports per item and is not expected to
   * throw; if it does, every requested item is reported kept rather than
   * failing an action whose primary write already succeeded.
   */
  private async applyLocalItems(request: {
    family: LocalItemFamily;
    harnessRoot: string;
    approvalIds: readonly string[];
  }): Promise<ApplyLocalItemsReport> {
    try {
      return await this.installLocalItems.apply(request);
    } catch (error: unknown) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error('RPC: plugins local-item replace failed', normalized);
      this.sentryService.captureException(normalized, {
        errorSource: 'PluginRpcHandlers.applyLocalItems',
      });
      return emptyApplyReport();
    }
  }
}

/** An apply report in which nothing ran. */
function emptyApplyReport(): ApplyLocalItemsReport {
  return { replaced: [], kept: [], unknown: [] };
}

/**
 * The plugins a save turns on: newly enabled bundled or external ids, and
 * harness plugins taken off the denylist. Only these can bring new items.
 */
export function newlyEnabledPluginIds(
  previous: { enabledPluginIds: string[]; disabledPluginIds?: string[] },
  enabledPluginIds: readonly string[],
  disabledPluginIds: readonly string[] | undefined,
): string[] {
  const before = new Set(previous.enabledPluginIds);
  const ids = enabledPluginIds.filter((id) => !before.has(id));
  if (disabledPluginIds !== undefined) {
    const stillDisabled = new Set(disabledPluginIds);
    ids.push(
      ...(previous.disabledPluginIds ?? []).filter(
        (id) => !stillDisabled.has(id),
      ),
    );
  }
  return [...new Set(ids)];
}

/**
 * The durable source identity (A28) of `plugin`, matched against the live
 * descriptors by every ref shape a plugin id maps to; `ptah:<id>` when none
 * is described.
 */
export function sourceRefFor(
  plugin: PluginInfo,
  descriptors: ReadonlyArray<{ sourceRef: string }>,
): string {
  const candidates = new Set([
    plugin.id,
    `ptah:${plugin.id}`,
    `harness:${plugin.id}`,
    `skills-sh:${plugin.id}`,
  ]);
  return (
    descriptors.find((descriptor) => candidates.has(descriptor.sourceRef))
      ?.sourceRef ?? `ptah:${plugin.id}`
  );
}
