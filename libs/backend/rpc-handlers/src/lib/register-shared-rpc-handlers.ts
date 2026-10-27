/**
 * Shared RPC handler DI registrations.
 *
 * Each app (VS Code extension, Electron, CLI) used to inline these four
 * `container.register(..., { useFactory })` blocks in its phase file. After
 * `PLATFORM_TOKENS.DI_CONTAINER` was introduced, every constructor argument is
 * `@inject`-decorated, so the factories collapse to plain
 * `registerSingleton` calls. Consolidating them here eliminates the drift
 * window that caused the Sentry NODE-NESTJS-3X bug (SetupRpcHandlers wired
 * with the wrong slot-3 token across three apps).
 */

import type { DependencyContainer } from 'tsyringe';

import {
  AttentionRpcHandlers,
  AgentOutcomeRpcHandlers,
  AnalyticsRpcHandlers,
  DecisionModelCatalogRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SessionLifecycleNotifier,
  GitChangeSetRpcHandlers,
  PlanLimitsBroadcaster,
} from './handlers';
import { LANE_ROUTING_TOKENS } from '@ptah-extension/lane-routing';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { CliModelListService } from './services/cli-model-list.service';
import { LaneModelListingAdapter } from './services/lane-model-listing.adapter';
import { PlanLimitsSnapshotService } from './services/plan-limits-snapshot.service';
import { RecentWorkspacesService } from './services/recent-workspaces.service';
import { ConnectionCheckRecorder } from './utils/connection-check-recorder';
import { TurnChangeSetRecorder } from './chat/change-set/turn-change-set-recorder.service';
import { TurnChangeSetStore } from './chat/change-set/turn-change-set.store';
import { GuidanceGenerationRunSupervisor } from './handlers/guidance-generation-run.supervisor';
import { GenerationRunSupervisor } from './handlers/wizard-generation-run.supervisor';
import { GenerationPreviewService } from './handlers/wizard-generation/generation-preview.service';
import { GenerationLibraryPassService } from './handlers/wizard-generation/generation-library-pass.service';
import { PackInstallService } from './handlers/setup/pack-install.service';
import { AgentPackDownloadService } from '@ptah-extension/platform-core';
import { ProviderAccountRpcHandlers } from './handlers/provider-account-rpc.handlers';
import { LocalItemApprovals } from './handlers/marketplace/local-item-approvals';
import { InstallLocalItemsService } from './handlers/marketplace/install-local-items.service';
import { MarketplaceLocalItemsService } from './handlers/marketplace/marketplace-local-items.service';
import { CloneRebaseService } from './handlers/skill-synthesis/clone-rebase.service';
import { CloneProvenanceResolver } from './handlers/skill-synthesis/clone-provenance.resolver';

/**
 * Register the shared RPC handler classes that every app wires the same way,
 * plus the turn-event listeners (`SessionLifecycleNotifier`,
 * `TurnChangeSetRecorder`) and the change-set store the recorder and
 * `GitChangeSetRpcHandlers` share. A single registration site keeps every app
 * in lockstep.
 *
 * Call exactly once per container, after the dependencies these handlers
 * inject (LOGGER, RPC_HANDLER, MODEL_SETTINGS, SDK_PLUGIN_LOADER,
 * WORKSPACE_PROVIDER, SENTRY_SERVICE, PLATFORM_COMMANDS,
 * SDK_ENHANCED_PROMPTS_SERVICE, LICENSE_SERVICE, SAVE_DIALOG_PROVIDER,
 * WORKSPACE_STATE_STORAGE and PLATFORM_TOKENS.DI_CONTAINER) have been
 * registered. The lane model listing adapter also needs
 * AUTH_SECRETS_SERVICE, AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS and
 * CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE. Every host
 * registers those before this function runs.
 *
 * Note: this does NOT eagerly resolve the two listeners. Both require
 * `TOKENS.WEBVIEW_MANAGER`, which is registered at different points in each
 * host (vscode-core's phase-2 in the extension, bootstrap.ts after
 * `ElectronDIContainer.setup` in Electron, container construction in the
 * CLI). Each host must call {@link activateSessionLifecycleNotifier} once
 * WEBVIEW_MANAGER is wired — otherwise neither subscribes to turn events.
 */
export function registerSharedRpcHandlers(
  container: DependencyContainer,
): void {
  container.registerSingleton(CliModelListService);
  container.registerSingleton(GuidanceGenerationRunSupervisor);
  container.registerSingleton(GenerationRunSupervisor);
  // A singleton: it holds the preview token records and the per-process
  // revision secret that `wizard:submit-selection` checks decisions against.
  container.registerSingleton(GenerationPreviewService);
  // Stateless; the post-run Library pass every wizard agents run shares.
  container.registerSingleton(GenerationLibraryPassService);
  // Singletons: the download service shares in-flight fetches and queues
  // installs per target directory; the install service holds the pack plan
  // tokens and the per-process revision secret `wizard:install-pack-agents`
  // checks Replace decisions against. A second instance of either would
  // break both.
  container.registerSingleton(AgentPackDownloadService);
  container.registerSingleton(PackInstallService);
  // Marketplace local items (TASK_2026_701 B12, A21). The approval registry
  // MUST be one instance: it holds the server-side digests behind every
  // approvalId the client was given, so a second instance would forget them
  // and every replace decision would read as unknown. The apply service and
  // the clone rebase (shared with `skillSynthesis:rebaseClone`) are
  // stateless; singletons so every caller shares one graph.
  container.registerSingleton(LocalItemApprovals);
  container.registerSingleton(CloneRebaseService);
  container.registerSingleton(InstallLocalItemsService);
  // Finds and registers the local items an install plan or kept report offers.
  container.registerSingleton(MarketplaceLocalItemsService);
  // Library provenance (B13); stateless, reads the live sources per listing.
  container.registerSingleton(CloneProvenanceResolver);
  container.registerSingleton(
    LANE_ROUTING_TOKENS.LANE_MODEL_LISTING,
    LaneModelListingAdapter,
  );
  container.registerSingleton(SetupRpcHandlers);
  container.registerSingleton(AttentionRpcHandlers);
  container.registerSingleton(WizardGenerationRpcHandlers);
  container.registerSingleton(EnhancedPromptsRpcHandlers);
  container.registerSingleton(LlmRpcHandlers);
  container.registerSingleton(SessionLifecycleNotifier);
  // Not a handler: the one in-memory store of connection checks that
  // AuthRpcHandlers (writer + route reader) and ProviderRpcHandlers (custom
  // entry test) must share. A second instance would hide their records.
  container.registerSingleton(ConnectionCheckRecorder);
  container.registerSingleton(TurnChangeSetStore);
  container.registerSingleton(TurnChangeSetRecorder);
  container.registerSingleton(GitChangeSetRpcHandlers);
  // Plan limits (TASK_2026_596): one snapshot assembler, shared by
  // `provider:getPlanLimits` (whose last scope it remembers) and the push.
  container.registerSingleton(PlanLimitsSnapshotService);
  container.registerSingleton(PlanLimitsBroadcaster);
  // Recent workspaces (TASK_2026_721). One instance owns the serialised
  // write chain; it needs only STATE_STORAGE and FILE_SYSTEM_PROVIDER, which
  // every host binds. Read by `workspace:listRecent`, written on switch.
  container.registerSingleton(RecentWorkspacesService);
  // Outcome signals (TASK_2026_646 B7). The reader token is not injected:
  // hosts register it in a later batch, and this class resolves it per call.
  container.registerSingleton(AgentOutcomeRpcHandlers);
  // Decision-model picker (TASK_2026_684, C10). The catalog is registered by
  // `registerLaneRoutingServices`; it makes no request until a call.
  container.registerSingleton(DecisionModelCatalogRpcHandlers);
  // Usage dashboard (TASK_2026_707 PR 2). Needs the usage-analytics service,
  // which every host registers in its libraries phase.
  container.registerSingleton(AnalyticsRpcHandlers);
  // Provider accounts (TASK_2026_712). A singleton because the handler keeps
  // the request ledger and snapshot revision; a second instance would forget
  // a repeated requestId. Registration is lazy: only hosts whose profile
  // enables `providerAccounts` (Electron) resolve it through the manifest.
  container.registerSingleton(ProviderAccountRpcHandlers);
}

/**
 * Eagerly resolve {@link SessionLifecycleNotifier},
 * {@link TurnChangeSetRecorder} and {@link PlanLimitsBroadcaster} so their
 * constructors subscribe immediately. Call exactly once per container, after
 * both {@link registerSharedRpcHandlers} and the host's
 * `TOKENS.WEBVIEW_MANAGER` and `TOKENS.GIT_INFO_SERVICE` registrations have
 * run.
 *
 * Resolving the broadcaster creates the plan-limit ledger
 * (`AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER`), which subscribes to the native
 * stream signals and the proxy quota store in its constructor. This function
 * is the shared startup hook on every host, and it runs after the library
 * registrations the ledger needs, so evidence is recorded from startup rather
 * than from the first lazy reader.
 *
 * Plan limits are not needed to run a session, so a failure to create them is
 * logged at error level and startup continues; the turn listeners above are
 * resolved first and still fail loudly.
 */
export function activateSessionLifecycleNotifier(
  container: DependencyContainer,
): void {
  container.resolve(SessionLifecycleNotifier);
  container.resolve(TurnChangeSetRecorder);
  try {
    container.resolve(PlanLimitsBroadcaster);
  } catch (error: unknown) {
    container
      .resolve<Logger>(TOKENS.LOGGER)
      .error(
        '[registerSharedRpcHandlers] plan-limit push not activated; limits update only on reload',
        error instanceof Error ? error : new Error(String(error)),
      );
  }
}
