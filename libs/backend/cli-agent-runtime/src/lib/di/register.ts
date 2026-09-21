import { type DependencyContainer, Lifecycle } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
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
  logger.info('[CliAgentRuntime] CLI agent runtime services registered', {
    services: Object.keys(CLI_AGENT_RUNTIME_TOKENS),
  });
}
