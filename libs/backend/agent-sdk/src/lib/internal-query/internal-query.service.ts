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

  /**
   * Whether this host initialized the SDK at all.
   *
   * Headless callers (`skill-synthesis`'s lane runner, the memory curator) get
   * registered this service on EVERY host, including the CLI's
   * `withEngine({ requireSdk: false })` boots where `initialize()` never runs.
   * Resolving the DI token therefore does not mean an LLM is reachable, and
   * `execute` would throw `SdkError` on every call. This is the question those
   * callers actually need answered before they spend an attempt.
   */
  isInitialized(): boolean {
    return this.runner.isInitialized();
  }

  async execute(config: InternalQueryConfig): Promise<InternalQueryHandle> {
    return this.runner.runOneShot({
      mode: 'oneShot',
      cwd: config.cwd,
      model: config.model,
      prompt: config.prompt,
      systemPromptAppend: config.systemPromptAppend,
      mcpServerRunning: config.mcpServerRunning,
      mcpPort: config.mcpPort,
      maxTurns: config.maxTurns,
      outputFormat: config.outputFormat,
      abortController: config.abortController,
      auth: config.auth,
    });
  }
}
