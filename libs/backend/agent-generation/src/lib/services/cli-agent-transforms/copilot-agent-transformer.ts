/**
 * Copilot Agent Transformer
 * TASK_2025_160: Transform Claude-format agent content to Copilot CLI format
 *
 * Pure transformation with no I/O or DI dependencies.
 * Uses shared transform-rules.ts for common rewrite logic.
 *
 * Target: ~/.copilot/agents/{agent-id}.md
 * Copilot CLI auto-discovers agents from ~/.copilot/agents/ directory.
 * Invoked via `copilot --agent backend-developer`.
 */

import { homedir } from 'os';
import { join } from 'path';
import type { CliAgentTransformResult } from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';
import type { ICliAgentTransformer } from './cli-agent-transformer.interface';
import { transformAgentContent } from './transform-rules';

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

  transform(agent: GeneratedAgent): CliAgentTransformResult {
    // Extract agent ID from file path (e.g., '.claude/agents/backend-developer.md' -> 'backend-developer')
    const agentId = extractAgentId(agent.filePath);

    // Extract description from agent content frontmatter or variables
    const description =
      agent.variables['description'] || `${agentId} agent`;

    // Apply all transformations
    const content = transformAgentContent(
      agent.content,
      'copilot',
      agentId,
      description
    );

    // Target path: ~/.copilot/agents/{agent-id}.md
    const filePath = join(
      homedir(),
      '.copilot',
      'agents',
      `${agentId}.md`
    );

    return {
      cli: this.target,
      agentId,
      content,
      filePath,
    };
  }
}

/**
 * Extract agent ID from file path.
 * Handles both absolute and relative paths.
 *
 * Examples:
 * - '.claude/agents/backend-developer.md' -> 'backend-developer'
 * - '/path/to/.claude/agents/backend-developer.md' -> 'backend-developer'
 */
function extractAgentId(filePath: string): string {
  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  return fileName.replace(/\.md$/i, '');
}
