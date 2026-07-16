/**
 * Copilot Agent Transformer
 *
 * Transforms Claude-format agent content to Copilot CLI format.
 * Pure transformation with no I/O or DI dependencies.
 * Uses shared transform-rules.ts for common rewrite logic.
 */

import { join } from 'path';
import type { CliAgentTransformResult } from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';
import type { ICliAgentTransformer } from './cli-agent-transformer.interface';
import {
  transformAgentContent,
  extractAgentId,
  resolveAgentDescription,
} from './transform-rules';

/**
 * Transforms Claude-format agent markdown to Copilot CLI format.
 *
 * Transformation rules:
 * 1. Frontmatter: Keep name and description (same format as Copilot)
 * 2. AskUserQuestion -> ask_followup_question
 * 3. Task tool -> copilot --agent NAME
 * 4. Slash commands -> copilot CLI invocations
 * 5. Internal imports stripped
 * 6. STATIC/LLM markers kept as-is (Markdown comments, universal)
 */
export class CopilotAgentTransformer implements ICliAgentTransformer {
  readonly target = 'copilot' as const;

  transform(
    agent: GeneratedAgent,
    workspaceRoot: string,
  ): CliAgentTransformResult {
    const agentId = extractAgentId(agent.filePath);
    const description = resolveAgentDescription(
      agent.content,
      agent.variables,
      agentId,
    );
    const content = transformAgentContent(
      agent.content,
      'copilot',
      agentId,
      description,
    );
    const filePath = join(
      workspaceRoot,
      '.github',
      'agents',
      `${agentId}.agent.md`,
    );

    return {
      cli: this.target,
      agentId,
      content,
      filePath,
    };
  }
}
