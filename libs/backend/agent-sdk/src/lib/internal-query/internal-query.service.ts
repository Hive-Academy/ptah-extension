/**
 * InternalQueryService â€” one-shot SDK query faÃ§ade.
 *
 * Thin faÃ§ade over `SdkQueryRunner.runOneShot`. Public API
 * (`execute`, `InternalQueryConfig`, `InternalQueryHandle`) preserved verbatim;
 * consumers (`SdkInternalQueryCuratorLlm`, `agent-generation`, `skill-synthesis`,
 * `memory-curator`) require zero migration.
 *
 * Generation-vs-usage invariant preserved: InternalQueryService NEVER resolves
 * `EnhancedPromptsService` â€” the runner exposes no `enhancedPromptsContent`
 * input on the oneShot path, so the cycle stays broken at the type level.
 *
 * The constructor signature is unchanged so that the existing unit spec
 * (`internal-query.service.spec.ts`) â€” which instantiates this class with eight
 * positional dependencies and asserts the type-level isolation property â€” keeps
 * passing. `SdkQueryRunner` is constructed eagerly inside the body using those
 * same dependencies, mirroring the `SessionLifecycleManager â†’ SessionQueryExecutor`
 * pattern (sub-service constructed in the facade constructor, not injected).
 *
 * @module @ptah-extension/agent-sdk
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { SdkModuleLoader } from '../helpers/sdk-module-loader';
import { SdkModelService } from '../helpers/sdk-model-service';
import { SdkRuntimeStateService } from '../helpers/sdk-runtime-state.service';
import { SubagentHookHandler } from '../helpers/subagent-hook-handler';
import { CompactionConfigProvider } from '../helpers/compaction-config-provider';
import { CompactionHookHandler } from '../helpers/compaction-hook-handler';
import { SdkQueryRunner } from '../helpers/sdk-query-runner.service';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './internal-query.types';

@injectable()
export class InternalQueryService {
  private readonly runner: SdkQueryRunner;

  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(SDK_TOKENS.SDK_RUNTIME_STATE)
    runtimeState: SdkRuntimeStateService,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
    subagentHookHandler: SubagentHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    compactionConfigProvider: CompactionConfigProvider,
    @inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
    compactionHookHandler: CompactionHookHandler,
    @inject(SDK_TOKENS.SDK_AUTH_ENV)
    authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_MODEL_SERVICE)
    modelService: SdkModelService,
  ) {
    this.runner = new SdkQueryRunner(
      logger,
      runtimeState,
      moduleLoader,
      subagentHookHandler,
      compactionConfigProvider,
      compactionHookHandler,
      authEnv,
      modelService,
    );
  }

  async execute(config: InternalQueryConfig): Promise<InternalQueryHandle> {
    return this.runner.runOneShot({
      mode: 'oneShot',
      cwd: config.cwd,
      model: config.model,
      prompt: config.prompt,
      systemPromptAppend: config.systemPromptAppend,
      isPremium: config.isPremium,
      mcpServerRunning: config.mcpServerRunning,
      mcpPort: config.mcpPort,
      maxTurns: config.maxTurns,
      outputFormat: config.outputFormat,
      abortController: config.abortController,
      pluginPaths: config.pluginPaths,
    });
  }
}
