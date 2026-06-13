/**
 * CLI Agent Transformer Interface
 *
 * Strategy interface for CLI-specific agent content transformation.
 * Each CLI target (Copilot, Cursor) has its own transformer that rewrites
 * Claude-format agent content into the CLI's expected format.
 *
 * Pattern: Strategy pattern mirroring ICliSkillInstaller in llm-abstraction.
 * Evidence: Codebase uses interfaces extensively for strategy injection
 * (IAgentFileWriterService, IContentGenerationService, IAgentSelectionService).
 */

import type {
  CliTarget,
  CliAgentTransformResult,
} from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';

/**
 * Transforms Claude-format agent content to a specific CLI format.
 *
 * Implementations handle:
 * - Frontmatter rewriting (name, description fields)
 * - Tool reference mapping (AskUserQuestion -> CLI equivalent)
 * - Slash command rewriting (/ commands -> CLI invocations)
 * - Internal import stripping (@ptah-extension/ references)
 * - CLI-specific directive replacement
 *
 * Transformers are pure functions with no I/O or DI dependencies.
 * They operate on content strings and produce transform results.
 */
export interface ICliAgentTransformer {
  /** Which CLI this transformer targets */
  readonly target: CliTarget;

  /**
   * Transform a Claude-format GeneratedAgent into CLI-specific format,
   * targeting the workspace-level agents directory for `workspaceRoot`.
   *
   * @param agent - Claude-format GeneratedAgent from orchestrator Phase 3
   * @param workspaceRoot - Workspace root the agent file is written under
   * @returns Transformed content and target file path
   */
  transform(
    agent: GeneratedAgent,
    workspaceRoot: string,
  ): CliAgentTransformResult;
}
