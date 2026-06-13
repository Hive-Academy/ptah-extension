/**
 * Multi-CLI Agent Writer Service
 *
 * Transforms Claude-format agents and writes them to each rival CLI's
 * WORKSPACE-level agents directory (decision #4):
 * - Cursor:        per-file {ws}/.cursor/agents/{slug}.md (bare-name)
 * - Copilot:       per-file {ws}/.github/agents/{slug}.agent.md + home-copy reap
 * - Codex:         merged into a delimited Ptah region inside {ws}/AGENTS.md
 *
 * Security: Uses fs.promises directly (NOT AgentFileWriterService) because the
 * target paths are outside .claude/. Paths derive from workspaceRoot (not user
 * input), so there is no path-traversal risk.
 */

import { injectable, inject } from 'tsyringe';
import { homedir } from 'os';
import { mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import {
  mergeAgentsRegion,
  type CliTarget,
  type CliGenerationResult,
} from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';
import type { ICliAgentTransformer } from './cli-agent-transformer.interface';
import { CopilotAgentTransformer } from './copilot-agent-transformer';
import { CodexAgentTransformer } from './codex-agent-transformer';
import { CursorAgentTransformer } from './cursor-agent-transformer';

const LEGACY_HOME_PREFIXES = ['ptah-', 'ptahsynth-'];

@injectable()
export class MultiCliAgentWriterService {
  private readonly transformers: Map<CliTarget, ICliAgentTransformer> =
    new Map();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.transformers.set('copilot', new CopilotAgentTransformer());
    this.transformers.set('codex', new CodexAgentTransformer());
    this.transformers.set('cursor', new CursorAgentTransformer());

    this.logger.debug('[MultiCliWriter] Service initialized');
  }

  /**
   * Transform and write agents for multiple CLI targets at the workspace level.
   *
   * @param agents - Claude-format GeneratedAgent[] from orchestrator Phase 3
   * @param targetClis - CLI targets to write for (filtered by detection + premium)
   * @param workspaceRoot - Workspace root the rival agent dirs are written under
   */
  async writeForClis(
    agents: GeneratedAgent[],
    targetClis: CliTarget[],
    workspaceRoot: string,
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

      if (cli === 'codex') {
        results.push(
          await this.writeCodexMerged(agents, transformer, workspaceRoot),
        );
        continue;
      }

      const result = await this.writeForSingleCli(
        agents,
        cli,
        transformer,
        workspaceRoot,
      );
      if (cli === 'copilot') {
        await this.reapCopilotHomeAgents();
      }
      results.push(result);
    }

    return results;
  }

  private async writeForSingleCli(
    agents: GeneratedAgent[],
    cli: CliTarget,
    transformer: ICliAgentTransformer,
    workspaceRoot: string,
  ): Promise<CliGenerationResult> {
    let agentsWritten = 0;
    let agentsFailed = 0;
    const paths: string[] = [];
    const errors: string[] = [];

    this.logger.info(
      `[MultiCliWriter] Writing ${agents.length} agents for ${cli}`,
    );

    for (const agent of agents) {
      try {
        const transformResult = transformer.transform(agent, workspaceRoot);
        await mkdir(dirname(transformResult.filePath), { recursive: true });
        await writeFile(
          transformResult.filePath,
          transformResult.content,
          'utf8',
        );

        paths.push(transformResult.filePath);
        agentsWritten++;
      } catch (error: unknown) {
        agentsFailed++;
        const errorMsg = `Failed to write ${
          agent.sourceTemplateId
        } for ${cli}: ${
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

    return { cli, agentsWritten, agentsFailed, paths, errors };
  }

  private async writeCodexMerged(
    agents: GeneratedAgent[],
    transformer: ICliAgentTransformer,
    workspaceRoot: string,
  ): Promise<CliGenerationResult> {
    const errors: string[] = [];
    const agentsFilePath = join(workspaceRoot, 'AGENTS.md');

    if (agents.length === 0) {
      return {
        cli: 'codex',
        agentsWritten: 0,
        agentsFailed: 0,
        paths: [],
        errors,
      };
    }

    try {
      const bodies = agents.map((agent) => {
        const result = transformer.transform(agent, workspaceRoot);
        return { name: result.agentId, content: result.content };
      });

      let existing = '';
      try {
        existing = await readFile(agentsFilePath, 'utf8');
      } catch {
        existing = '';
      }

      const merged = mergeAgentsRegion(existing, bodies);
      await mkdir(dirname(agentsFilePath), { recursive: true });
      await writeFile(agentsFilePath, merged, 'utf8');

      this.logger.info('[MultiCliWriter] codex AGENTS.md merge complete', {
        agents: agents.length,
        path: agentsFilePath,
      });

      return {
        cli: 'codex',
        agentsWritten: agents.length,
        agentsFailed: 0,
        paths: [agentsFilePath],
        errors,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn('[MultiCliWriter] codex AGENTS.md merge failed', {
        error: msg,
      });
      return {
        cli: 'codex',
        agentsWritten: 0,
        agentsFailed: agents.length,
        paths: [],
        errors: [`Failed to merge AGENTS.md: ${msg}`],
      };
    }
  }

  private async reapCopilotHomeAgents(): Promise<void> {
    const homeAgentsDir = join(homedir(), '.copilot', 'agents');
    let entries: string[];
    try {
      entries = await readdir(homeAgentsDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (LEGACY_HOME_PREFIXES.some((p) => entry.startsWith(p))) {
        await rm(join(homeAgentsDir, entry), { force: true }).catch(
          () => undefined,
        );
      }
    }
  }
}
