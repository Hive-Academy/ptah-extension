import {
  type DependencyContainer,
  Lifecycle,
  instanceCachingFactory,
} from 'tsyringe';
import {
  TOKENS,
  type IAuthSecretsService,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  type McpServerBackoffService,
  type PluginLoaderService,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import { CLI_AGENT_RUNTIME_TOKENS } from './tokens';
import { CliDetectionService } from '../cli-agents/cli-detection.service';
import { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import { AgentSpawnEnvironment } from '../cli-agents/agent-spawn-environment.service';
import { AgentOutputBuffer } from '../cli-agents/agent-output-buffer.service';
import { LaneCompletionNotifier } from '../cli-agents/lane-completion-notifier.service';
import { AgentReportRouter } from '../cli-agents/agent-report-router.service';
import { AgentRoleResolver } from '../roles';
import {
  PtahCliRegistry,
  PtahCliConfigPersistence,
  PtahCliSpawnOptions,
} from '../ptah-cli';
import { CapabilityToggleStore } from '../capabilities/capability-toggle-store';
import { CapabilityResolverService } from '../capabilities/capability-resolver.service';
import { ClaudeApprovalReader } from '../capabilities/claude-approval.reader';
import {
  McpInstallService,
  type SmitheryInstalledReader,
} from '../mcp-directory/mcp-install.service';
import {
  SmitheryInstalledManifestStore,
  createSmitheryConfigSecretStore,
} from '../mcp-directory/smithery-installed-manifest';
import { McpOAuthInstalledManifestStore } from '../mcp-directory/oauth/mcp-oauth-installed-manifest';

export function registerCliAgentRuntimeServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[CliAgentRuntime] Registering CLI agent runtime services...');

  container.register(
    CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE,
    { useClass: PtahCliConfigPersistence },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_SPAWN_OPTIONS,
    { useClass: PtahCliSpawnOptions },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY,
    { useClass: PtahCliRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.registerSingleton(
    TOKENS.CLI_DETECTION_SERVICE,
    CliDetectionService,
  );
  container.registerSingleton(AgentSpawnEnvironment);
  container.registerSingleton(AgentOutputBuffer);
  // Registered by class, not by token: the only consumer is the process
  // manager in this same lib, which injects it directly. Its optional
  // `TOKENS.AGENT_ADAPTER` injection is safe because all three hosts call
  // `registerSdkServices` — which registers that token — BEFORE this function
  // (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:149`,
  // `apps/ptah-electron/src/di/phase-2-libraries.ts:183`,
  // `libs/backend/cli-engine/src/lib/container.ts:629`), so nothing can
  // construct the notifier while the adapter is still absent (TASK_2026_515).
  container.registerSingleton(LaneCompletionNotifier);
  container.registerSingleton(
    TOKENS.AGENT_PROCESS_MANAGER,
    AgentProcessManager,
  );
  // Registered in every host that registers this lib, so `ptah_agent_report`
  // behaves identically in VS Code, Electron and the CLI engine. A host that
  // registered the manager but not the router would have the tool succeed in
  // one product and fail in another.
  container.register(
    CLI_AGENT_RUNTIME_TOKENS.AGENT_REPORT_ROUTER,
    { useClass: AgentReportRouter },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    CLI_AGENT_RUNTIME_TOKENS.AGENT_ROLE_RESOLVER,
    { useClass: AgentRoleResolver },
    { lifecycle: Lifecycle.Singleton },
  );
  registerCapabilityServices(container);
  logger.info('[CliAgentRuntime] CLI agent runtime services registered', {
    services: Object.keys(CLI_AGENT_RUNTIME_TOKENS),
  });
}

/**
 * The capability policy (TASK_2026_560): the toggle store as the global layer
 * the plugin loader reads, and the resolver every enforcement point and the
 * RPC layer depend on.
 *
 * Both are cached factories rather than classes, because their constructors
 * take collaborators the container cannot resolve by type (a base directory,
 * a dependency object). Nothing is resolved until the first consumer asks, by
 * which point every host has registered the SDK, platform and auth services
 * the factories read.
 *
 * Write paths, for the Mode 3 trace (AC-2.3, AC-3.1): MCP toggles and
 * `setExplicit` write only `~/.ptah/capabilities/**` item files through the
 * store; skill/plugin workspace toggles write only the workspace
 * `PluginConfigState` through `PluginLoaderService.saveWorkspacePluginConfig`;
 * the import writes only `workspaces/<wsKey>/imported.json`. No user config
 * file (`.mcp.json`, `~/.claude.json`, `~/.codex/config.toml`, ...) is written.
 */
function registerCapabilityServices(container: DependencyContainer): void {
  container.register(SDK_TOKENS.SDK_CAPABILITY_GLOBAL_LAYER, {
    useFactory: instanceCachingFactory(
      (c) =>
        new CapabilityToggleStore(
          c.resolve<IOutputChannel>(PLATFORM_TOKENS.OUTPUT_CHANNEL),
        ),
    ),
  });

  container.register(SDK_TOKENS.SDK_CAPABILITY_RESOLVER, {
    useFactory: instanceCachingFactory((c) => {
      const backoff = c.isRegistered(
        SDK_TOKENS.SDK_MCP_SERVER_BACKOFF_SERVICE,
        true,
      )
        ? c.resolve<McpServerBackoffService>(
            SDK_TOKENS.SDK_MCP_SERVER_BACKOFF_SERVICE,
          )
        : undefined;
      return new CapabilityResolverService({
        output: c.resolve<IOutputChannel>(PLATFORM_TOKENS.OUTPUT_CHANNEL),
        store: c.resolve<CapabilityToggleStore>(
          SDK_TOKENS.SDK_CAPABILITY_GLOBAL_LAYER,
        ),
        inventory: createDeclarationInventory(c),
        approvals: new ClaudeApprovalReader(),
        plugins: c.resolve<PluginLoaderService>(SDK_TOKENS.SDK_PLUGIN_LOADER),
        ...(backoff === undefined ? {} : { backoff }),
      });
    }),
  });
}

/**
 * The resolver's own read of the declaration inventory: the same four sources
 * `listInstalled` reads. It never installs, so it needs no reconciler; the
 * Smithery manifest is read only where the auth secrets service exists,
 * because that store is constructed with it.
 */
function createDeclarationInventory(c: DependencyContainer): McpInstallService {
  let smithery: SmitheryInstalledReader | undefined;
  if (c.isRegistered(TOKENS.AUTH_SECRETS_SERVICE, true)) {
    const secrets = c.resolve<IAuthSecretsService>(TOKENS.AUTH_SECRETS_SERVICE);
    smithery = new SmitheryInstalledManifestStore(
      createSmitheryConfigSecretStore({
        getProviderKey: (id) => secrets.getProviderKey(id),
        setProviderKey: (id, value) => secrets.setProviderKey(id, value),
        deleteProviderKey: (id) => secrets.deleteProviderKey(id),
      }),
    );
  }
  return new McpInstallService(null, undefined, {
    oauth: new McpOAuthInstalledManifestStore(),
    ...(smithery === undefined ? {} : { smithery }),
  });
}
