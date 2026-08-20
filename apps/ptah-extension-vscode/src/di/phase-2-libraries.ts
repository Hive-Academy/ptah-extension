/**
 * Phase 2 â€” Library Services (workspace-intelligence, vscode-lm-tools, agent-sdk,
 *                             agent-generation)
 *
 * Runs AFTER `registerPhase3Handlers` in `DIContainer.setup`. RPC handlers are
 * registered before workspace intelligence. Handler factories are lazy, so the
 * SDK / agent-generation tokens they resolve are safely supplied here before
 * any actual resolution happens via
 * `container.resolve(RPC_METHOD_REGISTRATION_SERVICE)`.
 */

import { Lifecycle } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import {
  registerTaskSpecsServices,
  startTaskSpecsIndex,
} from '@ptah-extension/task-specs';
import { registerOutputStyleServices } from '@ptah-extension/output-styles';
import {
  registerHarnessSyncServices,
  ALL_HARNESS_TARGET_FACTORIES,
  createPluginConfigSourceResolver,
  HARNESS_SYNC_TOKENS,
  type HarnessPluginConfigReader,
} from '@ptah-extension/harness-sync';
import { registerPluginMarketplaceServices } from '@ptah-extension/plugin-marketplace';
import {
  registerVsCodeLmToolsServices,
  IDE_CAPABILITIES_TOKEN,
  BROWSER_CAPABILITIES_TOKEN,
  ChromeLauncherBrowserCapabilities,
} from '@ptah-extension/vscode-lm-tools';
import { VscodeIDECapabilities } from '@ptah-extension/vscode-lm-tools/vscode';
import {
  registerSdkServices,
  wireAgentAdapterAliases,
  SDK_TOKENS,
  HARNESS_PREFLIGHT_TOKEN,
} from '@ptah-extension/agent-sdk';
import {
  registerAuthProvidersServices,
  AUTH_PROVIDERS_TOKENS,
  VscodeCopilotAuthService,
} from '@ptah-extension/auth-providers';
import {
  registerCliAgentRuntimeServices,
  createHarnessCliDetector,
  type HarnessCliDetectionReader,
} from '@ptah-extension/cli-agent-runtime';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
  EnhancedPromptsService,
} from '@ptah-extension/agent-generation';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-generation';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ContentDownloadService,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  createUserLayerRefresher,
  readManageGitignore,
  readPreflightTimeoutMs,
} from '../activation/plugin-activation';
export function registerPhase2Libraries(
  container: DependencyContainer,
  logger: Logger,
): void {
  registerWorkspaceIntelligenceServices(container, logger);
  // task-specs registered in all three hosts (G1). The SQLite-backed index
  // store is selected lazily inside registerTaskSpecsServices via
  // isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION) — VS Code registers the
  // connection later in wire-runtime, so the store choice is deferred to first
  // resolution (wire-runtime.ts:176 precedent).
  registerTaskSpecsServices(container, logger);
  // Warm the index at activation (TASK_2026_179 step 11) so `.ptah/specs/
  // README.md` lands even for a user who never opens the Tasks board. Non-
  // blocking and failure-swallowing by contract — see startTaskSpecsIndex.
  startTaskSpecsIndex(container, logger);
  // output-styles registered in all three hosts: OutputStyleRpcHandlers is a
  // `requires: []` manifest entry, so every host resolves it. Its services
  // depend only on the Phase 1 platform adapters (FILE_SYSTEM_PROVIDER,
  // WORKSPACE_PROVIDER) and are consumed by Phase 3/4 handlers.
  registerOutputStyleServices(container, logger);
  // plugin-marketplace registered in all three hosts, and BEFORE
  // registerSdkServices below, because PluginLoaderService injects the external
  // consent store as its allowlist source. Its own late `initialize()` runs
  // from plugin activation, next to `pluginLoader.initialize()`.
  registerPluginMarketplaceServices(container, logger);
  registerVsCodeLmToolsServices(container, logger);
  container.register(IDE_CAPABILITIES_TOKEN, {
    useValue: new VscodeIDECapabilities(),
  });
  {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    container.register(BROWSER_CAPABILITIES_TOKEN, {
      useValue: new ChromeLauncherBrowserCapabilities(() => {
        const configured =
          workspaceProvider.getConfiguration<string>(
            'ptah',
            'browser.recordingDir',
            '',
          ) ?? '';
        if (configured) return configured;
        const wsRoot = workspaceProvider.getWorkspaceRoot();
        if (wsRoot) return `${wsRoot}/.ptah/recordings`;
        return '';
      }),
    });
  }
  registerAuthProvidersServices(container, logger);
  registerSdkServices(container, logger);
  // harness-sync AFTER registerSdkServices so the plugin loader token exists.
  // The resolver lambda is lazy anyway — the loader is only usable after
  // `initialize()` runs in plugin activation, long after this phase.
  //
  // Every target, in every host: a workspace is populated for the tools the
  // USER has, not for the one running Ptah. Undetected CLIs are skipped at
  // reconcile time, so the detector lambda below is the only host-specific
  // part — and it is lazy too, because `registerCliAgentRuntimeServices` (which
  // owns `CLI_DETECTION_SERVICE`) runs a few lines further down.
  registerHarnessSyncServices(container, logger, {
    targets: ALL_HARNESS_TARGET_FACTORIES,
    cliDetector: createHarnessCliDetector(() =>
      container.isRegistered(TOKENS.CLI_DETECTION_SERVICE)
        ? container.resolve<HarnessCliDetectionReader>(
            TOKENS.CLI_DETECTION_SERVICE,
          )
        : null,
    ),
    sourceResolver: createPluginConfigSourceResolver(() =>
      container.isRegistered(SDK_TOKENS.SDK_PLUGIN_LOADER)
        ? container.resolve<HarnessPluginConfigReader>(
            SDK_TOKENS.SDK_PLUGIN_LOADER,
          )
        : null,
    ),
    // Batch 3. `HarnessPropagationService` runs this before each reconcile it
    // performs, so an RPC that changed an upstream source (harness-builder
    // skill, wizard agent, uninstalled plugin) is visible in `~/.ptah/user`
    // before the reconciler reads it.
    userLayerRefresher: createUserLayerRefresher(logger),
    gitignore: { readManageGitignore: () => readManageGitignore() },
    preflight: {
      readTimeoutMs: () => readPreflightTimeoutMs(),
      contentGate: {
        awaitContentReady: (timeoutMs) =>
          container
            .resolve<ContentDownloadService>(PLATFORM_TOKENS.CONTENT_DOWNLOAD)
            .awaitContentReady(timeoutMs),
      },
    },
  });
  // Lets `SessionQueryExecutor` and the rival-CLI spawn path reach the
  // reconciler without `agent-sdk` importing `harness-sync`.
  container.register(HARNESS_PREFLIGHT_TOKEN, {
    useToken: HARNESS_SYNC_TOKENS.PREFLIGHT,
  });
  registerCliAgentRuntimeServices(container, logger);
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH,
    { useClass: VscodeCopilotAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  wireAgentAdapterAliases(container);

  registerAgentGenerationServices(container, logger);
  try {
    const enhancedPrompts = container.resolve<EnhancedPromptsService>(
      AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
    );
    const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(
      AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    );
    enhancedPrompts.setAnalysisReader(analysisStorage);
  } catch (error) {
    logger.warn(
      '[DI] Failed to wire multi-phase analysis reader into EnhancedPromptsService',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  logger.info(
    '[DI] SQLite-backed services skipped â€” Electron-only by design',
  );
}
