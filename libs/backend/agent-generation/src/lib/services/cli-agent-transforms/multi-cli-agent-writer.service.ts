/**
 * Multi-CLI Agent Writer Service
 * TASK_2025_160: Orchestrates agent transformation and writing for all target CLIs
 *
 * Called by AgentGenerationOrchestratorService after Phase 4 (Claude agent writing).
 * Transforms GeneratedAgent[] from Claude format to each target CLI format and
 * writes to user-level directories.
 *
 * Pattern: @injectable() singleton. Uses ICliAgentTransformer strategy instances.
 * Evidence: AgentFileWriterService (file-writer.service.ts:49) handles Claude writes;
 * this service handles non-Claude writes.
 *
 * Security: Uses fs.promises directly (NOT AgentFileWriterService) because target
 * paths are outside .claude/. Paths are computed from homedir() (not user input),
 * so there is no path traversal risk.
 */

import { injectable, inject } from 'tsyringe';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type {
  CliTarget,
  CliGenerationResult,
} from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';
import type { ICliAgentTransformer } from './cli-agent-transformer.interface';
import { CopilotAgentTransformer } from './copilot-agent-transformer';
import { GeminiAgentTransformer } from './gemini-agent-transformer';

@injectable()
export class MultiCliAgentWriterService {
  /** Transformers indexed by CLI target */
  private readonly transformers: Map<CliTarget, ICliAgentTransformer> =
    new Map();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    // Instantiate transformers internally (not DI-injected, they are pure functions)
    this.transformers.set('copilot', new CopilotAgentTransformer());
    this.transformers.set('gemini', new GeminiAgentTransformer());

    this.logger.debug('[MultiCliWriter] Service initialized');
  }

  /**
   * Transform and write agents for multiple CLI targets.
   *
   * Does NOT use AgentFileWriterService (targets are outside .claude/).
   * Uses fs.promises directly for user-level directory writes.
   *
   * @param agents - Claude-format GeneratedAgent[] from orchestrator Phase 3
   * @param targetClis - CLI targets to write for (filtered by detection + premium)
   * @returns Per-CLI generation results
   */
  async writeForClis(
    agents: GeneratedAgent[],
    targetClis: CliTarget[]
  ): Promise<CliGenerationResult[]> {
    const results: CliGenerationResult[] = [];

    for (const cli of targetClis) {
      const transformer = this.transformers.get(cli);
      if (!transformer) {
        this.logger.warn(`[MultiCliWriter] No transformer for ${cli}`);
        results.push({
          cli,
          agentsWritten: 0,
          agentsFailed: agents.length,
          paths: [],
          errors: [`No transformer registered for ${cli}`],
        });
        continue;
      }

      const result = await this.writeForSingleCli(
        agents,
        cli,
        transformer
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Transform and write agents for a single CLI target.
   */
  private async writeForSingleCli(
    agents: GeneratedAgent[],
    cli: CliTarget,
    transformer: ICliAgentTransformer
  ): Promise<CliGenerationResult> {
    let agentsWritten = 0;
    let agentsFailed = 0;
    const paths: string[] = [];
    const errors: string[] = [];

    this.logger.info(`[MultiCliWriter] Writing ${agents.length} agents for ${cli}`);

    for (const agent of agents) {
      try {
        // Transform agent content for this CLI
        const transformResult = transformer.transform(agent);

        // Ensure target directory exists
        await mkdir(dirname(transformResult.filePath), { recursive: true });

        // Write transformed content
        await writeFile(transformResult.filePath, transformResult.content, 'utf8');

        paths.push(transformResult.filePath);
        agentsWritten++;

        this.logger.debug(
          `[MultiCliWriter] Wrote ${transformResult.agentId} for ${cli}`,
          { path: transformResult.filePath }
        );
      } catch (error) {
        agentsFailed++;
        const errorMsg = `Failed to write ${agent.sourceTemplateId} for ${cli}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        errors.push(errorMsg);
        this.logger.warn(`[MultiCliWriter] ${errorMsg}`);
      }
    }

    this.logger.info(`[MultiCliWriter] ${cli} complete`, {
      written: agentsWritten,
      failed: agentsFailed,
    });

    return {
      cli,
      agentsWritten,
      agentsFailed,
      paths,
      errors,
    };
  }
}
