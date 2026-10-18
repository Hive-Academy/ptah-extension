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
  AgentOutcomeRpcHandlers,
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
import { ConnectionCheckRecorder } from './utils/connection-check-recorder';
import { TurnChangeSetRecorder } from './chat/change-set/turn-change-set-recorder.service';
import { TurnChangeSetStore } from './chat/change-set/turn-change-set.store';
import { GuidanceGenerationRunSupervisor } from './handlers/guidance-generation-run.supervisor';
import { GenerationRunSupervisor } from './handlers/wizard-generation-run.supervisor';

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
  container.registerSingleton(
    LANE_ROUTING_TOKENS.LANE_MODEL_LISTING,
    LaneModelListingAdapter,
  );
  container.registerSingleton(SetupRpcHandlers);
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
  // Outcome signals (TASK_2026_646 B7). The reader token is not injected:
  // hosts register it in a later batch, and this class resolves it per call.
  container.registerSingleton(AgentOutcomeRpcHandlers);
  // Decision-model picker (TASK_2026_684, C10). The catalog is registered by
  // `registerLaneRoutingServices`; it makes no request until a call.
  container.registerSingleton(DecisionModelCatalogRpcHandlers);
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
