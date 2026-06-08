import { injectable, inject } from 'tsyringe';
import { SDK_TOKENS } from '../di/tokens';
import { SdkQueryRunner } from '../helpers/sdk-query-runner.service';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './internal-query.types';

@injectable()
export class InternalQueryService {
  constructor(
    @inject(SDK_TOKENS.SDK_QUERY_RUNNER)
    private readonly runner: SdkQueryRunner,
  ) {}

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
      auth: config.auth,
    });
  }
}
