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
  McpCallerWorkspaceResolver,
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
  // task-specs registered in all three hosts (G1). The index store is selected
  // lazily inside registerTaskSpecsServices via
  // isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION).
  //
  // In THIS host that check is always false: nothing under
  // apps/ptah-extension-vscode calls registerPersistenceSqliteServices, and the
  // one helper that does (cli-engine's registerThothLibraries) is structurally
  // off-limits here — the Thoth-free invariant is lint-enforced. VS Code
  // therefore runs on InMemoryTaskIndexStore. (Corrected TASK_2026_306 task
  // 4.3; the previous comment claimed the connection was registered later in
  // wire-runtime, which reads SQLITE_CONNECTION but never registers it.)
  registerTaskSpecsServices(container, logger);
  // Warm the index at activation (TASK_2026_179 step 11) so `.ptah/specs/
  // README.md` lands even for a user who never opens the Tasks board. Non-
  // blocking and failure-swallowing by contract — see startTaskSpecsIndex.
  //
  // Unaffected by TASK_2026_306 defect E: the in-memory store needs no open
  // step, so the warm-up here writes successfully on the first attempt. The
  // ordering fix is entirely lib-side (startTaskSpecsIndex subscribes to the
  // connection's onDidOpen), so this call site needs no change and none of the
  // three hosts got a bespoke remedy.
  //
  // The sentence above used to hide a requirement: defect E's fix held only
  // while a host registered SQLITE_CONNECTION BEFORE this call, and nothing
  // enforced that. It no longer matters in either direction (TASK_2026_314) —
  // the helper arms a deferred subscription when the token is absent, so this
  // call may sit anywhere in phase 2. This host registers no connection at all
  // and the armed hook simply never fires.
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
  // The caller-workspace port (TASK_2026_364): lets AgentProcessManager scope
  // spawns and status reads to the calling MCP request's workspace without
  // importing vscode-lm-tools. Registered only by hosts that run the
  // in-process HTTP MCP server — the CLI host stays unregistered and falls
  // back to the platform provider.
  container.registerSingleton(
    PLATFORM_TOKENS.CALLER_WORKSPACE_RESOLVER,
    McpCallerWorkspaceResolver,
  );
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
