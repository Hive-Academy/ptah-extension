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
import {
  LANE_OUTCOME_TOKENS,
  type LaneOutcomeRecorder,
} from '@ptah-extension/lane-outcomes';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { IAgentAdapter } from '@ptah-extension/shared';
import { CliDetectionService } from '../cli-agents/cli-detection.service';
import { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import { AgentSpawnEnvironment } from '../cli-agents/agent-spawn-environment.service';
import { AgentOutputBuffer } from '../cli-agents/agent-output-buffer.service';
import { LaneCompletionNotifier } from '../cli-agents/lane-completion-notifier.service';
import { LaneResumeGate } from '../cli-agents/lane-resume-gate';
import { AgentReportRouter } from '../cli-agents/agent-report-router.service';
import { LaneOwnerResolver } from '../cli-agents/limits/lane-owner.resolver';
import { LaneLimitLookupService } from '../cli-agents/limits/lane-limit-lookup.service';
import { PlanLimitOwnerDiscoveryService } from '../cli-agents/limits/plan-limit-owner-discovery.service';
import { SessionChildRegistry } from '../session-children/session-child.registry';
import { ChildWorktreeProvisioner } from '../session-children/child-worktree.provisioner';
import { SessionSpawnerService } from '../session-children/session-spawner.service';
import { SessionHandoffService } from '../session-children/session-handoff.service';
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
import {
  AUTH_PROVIDERS_TOKENS,
  type ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import {
  SETTINGS_TOKENS,
  type ReasoningSettings,
} from '@ptah-extension/settings-core';
import {
  resolveSessionCapabilityPolicy,
  type SdkModuleLoader,
  type SdkModelService,
  type SdkMessageTransformer,
  type SdkPermissionHandler,
  type HarnessPolicySync,
} from '@ptah-extension/agent-sdk';
import type { ICapabilityResolver } from '@ptah-extension/shared';
import { ClaudeCliAdapter } from '../cli-agents/cli-adapters/claude-cli.adapter';
import { ClaudeSdkLaneRunner } from '../claude/claude-sdk-lane-runner';
import type { ISdkProcessSpawner } from '../spawn/sdk-process-spawner.port';
import {
  PtahCliLanePlanLimits,
  type LanePlanLimitWriter,
} from '../ptah-cli/helpers/ptah-cli-lane-plan-limits';

export function registerCliAgentRuntimeServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[CliAgentRuntime] Registering CLI agent runtime services...');

  container.register(ClaudeSdkLaneRunner, {
    useFactory: instanceCachingFactory(
      (c) =>
        new ClaudeSdkLaneRunner(
          c.resolve<Logger>(TOKENS.LOGGER),
          c.resolve<SdkMessageTransformer>(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER),
        ),
    ),
  });
  // Class tokens keep these runtime-local until the Batch 26 roster activation.
  // Resolve policy/owner services at spawn time to avoid a manager/detection cycle.
  container.register(ClaudeCliAdapter, {
    useFactory: instanceCachingFactory(
      (c) =>
        new ClaudeCliAdapter(c.resolve<Logger>(TOKENS.LOGGER), {
          loader: c.resolve<SdkModuleLoader>(SDK_TOKENS.SDK_MODULE_LOADER),
          assembly: c.resolve<PtahCliSpawnOptions>(
            CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_SPAWN_OPTIONS,
          ),
          runner: c.resolve(ClaudeSdkLaneRunner),
          permissionHandler: c.resolve<SdkPermissionHandler>(
            SDK_TOKENS.SDK_PERMISSION_HANDLER,
          ),
          processSpawner: c.resolve<ISdkProcessSpawner>(
            SDK_TOKENS.SDK_PROCESS_SPAWNER,
          ),
          models: {
            getNativeClaudeModels: () =>
              c
                .resolve<SdkModelService>(SDK_TOKENS.SDK_MODEL_SERVICE)
                .getNativeClaudeModels(),
          },
          defaults: () => ({
            chatEffort: c
              .resolve<ReasoningSettings>(SETTINGS_TOKENS.REASONING_SETTINGS)
              .effort.get(),
          }),
          admission: () =>
            c.isRegistered(
              AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION,
              true,
            )
              ? c.resolve<ProviderAccountAdmissionPort>(
                  AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION,
                )
              : null,
          policy: (cwd) =>
            resolveSessionCapabilityPolicy(
              c.resolve<ICapabilityResolver>(
                SDK_TOKENS.SDK_CAPABILITY_RESOLVER,
              ),
              cwd,
              logger,
            ),
          syncHarness: async (policy) => {
            if (
              policy.status !== 'verified' ||
              !c.isRegistered(SDK_TOKENS.SDK_HARNESS_POLICY_SYNC, true)
            )
              return;
            try {
              const result = await c
                .resolve<HarnessPolicySync>(SDK_TOKENS.SDK_HARNESS_POLICY_SYNC)
                .apply(policy.physicalRoot, policy.harnessFingerprint);
              if (!result.acknowledged)
                logger.warn(
                  '[ClaudeCliAdapter] Harness policy not acknowledged',
                );
            } catch {
              logger.warn(
                '[ClaudeCliAdapter] Harness policy sync unavailable; capability restrictions remain active',
              );
            }
          },
          planLimits: () =>
            new PtahCliLanePlanLimits({
              logger,
              ptahCliId: 'claude',
              providerId: 'claude-cli',
              ledger: c.isRegistered(
                AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER,
                true,
              )
                ? c.resolve<LanePlanLimitWriter>(
                    AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER,
                  )
                : null,
              owners: c.resolve<LaneOwnerResolver>(
                CLI_AGENT_RUNTIME_TOKENS.LANE_OWNER_RESOLVER,
              ),
              recordOwner: (id, owner) =>
                c
                  .resolve<AgentProcessManager>(TOKENS.AGENT_PROCESS_MANAGER)
                  .recordQuotaOwner(id, owner),
            }),
        }),
    ),
  });

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
  container.register(LaneCompletionNotifier, {
    useFactory: instanceCachingFactory(
      (c) =>
        new LaneCompletionNotifier(
          c.resolve<Logger>(TOKENS.LOGGER),
          c.resolve<IFileSystemProvider>(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
          c.isRegistered(TOKENS.AGENT_ADAPTER, true)
            ? c.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER)
            : null,
          () =>
            c.isRegistered(LANE_OUTCOME_TOKENS.RECORDER, true)
              ? c.resolve<LaneOutcomeRecorder>(LANE_OUTCOME_TOKENS.RECORDER)
              : null,
        ),
    ),
  });
  // A cached factory, not a class: the gate's constructor takes the output
  // channel plus spec-only seams the container cannot resolve by type. The
  // process manager below injects it.
  container.register(CLI_AGENT_RUNTIME_TOKENS.LANE_RESUME_GATE, {
    useFactory: instanceCachingFactory(
      (c) =>
        new LaneResumeGate(
          c.resolve<IOutputChannel>(PLATFORM_TOKENS.OUTPUT_CHANNEL),
        ),
    ),
  });
  // Plan limits (TASK_2026_596). The owner resolver is registered BEFORE the
  // manager that injects it. All three read the auth-providers plan-limit
  // services, which every host registers before this function.
  container.register(
    CLI_AGENT_RUNTIME_TOKENS.LANE_OWNER_RESOLVER,
    { useClass: LaneOwnerResolver },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    CLI_AGENT_RUNTIME_TOKENS.LANE_LIMIT_LOOKUP,
    { useClass: LaneLimitLookupService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    CLI_AGENT_RUNTIME_TOKENS.PLAN_LIMIT_OWNER_DISCOVERY,
    { useClass: PlanLimitOwnerDiscoveryService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.registerSingleton(
    TOKENS.AGENT_PROCESS_MANAGER,
    AgentProcessManager,
  );
  // The parent → child session link (TASK_2026_584). Registered by class,
  // BEFORE the router that injects it, so the router's optional injection
  // always finds the one shared instance rather than nothing.
  container.registerSingleton(SessionChildRegistry);
  // Registered in every host that registers this lib, so `ptah_agent_report`
  // behaves identically in VS Code, Electron and the CLI engine. A host that
  // registered the manager but not the router would have the tool succeed in
  // one product and fail in another.
  container.register(
    CLI_AGENT_RUNTIME_TOKENS.AGENT_REPORT_ROUTER,
    { useClass: AgentReportRouter },
    { lifecycle: Lifecycle.Singleton },
  );
  // Child chat sessions (TASK_2026_584). The spawner subscribes to the SDK
  // event fan-outs in its constructor, so it is constructed only when a
  // consumer resolves it; its optional `CHILD_CHAT_SESSION_HOST` is bound by
  // `registerChatServices`, which every host runs before that happens.
  container.registerSingleton(ChildWorktreeProvisioner);
  container.register(
    CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER,
    { useClass: SessionSpawnerService },
    { lifecycle: Lifecycle.Singleton },
  );
  // Session handoff (TASK_2026_655). No subscriptions; it looks the same
  // `CHILD_CHAT_SESSION_HOST` up at call time, like the spawner.
  container.register(
    CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF,
    { useClass: SessionHandoffService },
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
