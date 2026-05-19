import { type DependencyContainer, Lifecycle } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { CLI_AGENT_RUNTIME_TOKENS } from './tokens';
import { CliDetectionService } from '../cli-agents/cli-detection.service';
import { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import { CliPluginSyncService } from '../cli-agents/cli-skill-sync/cli-plugin-sync.service';
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
  container.registerSingleton(
    TOKENS.AGENT_PROCESS_MANAGER,
    AgentProcessManager,
  );
  container.registerSingleton(
    TOKENS.CLI_PLUGIN_SYNC_SERVICE,
    CliPluginSyncService,
  );

  logger.info('[CliAgentRuntime] CLI agent runtime services registered', {
    services: Object.keys(CLI_AGENT_RUNTIME_TOKENS),
  });
}
