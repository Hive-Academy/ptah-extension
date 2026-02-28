/**
 * Gemini Agent Transformer
 * TASK_2025_160: Transform Claude-format agent content to Gemini CLI format
 *
 * Pure transformation with no I/O or DI dependencies.
 * Uses shared transform-rules.ts for common rewrite logic.
 *
 * Target: ~/.gemini/agents/{agent-id}.md
 * Gemini CLI auto-discovers agents from ~/.gemini/agents/ directory.
 * Invoked via `gemini --agent backend-developer` or `gemini -a backend-developer`.
 */

import { homedir } from 'os';
import { join } from 'path';
import type { CliAgentTransformResult } from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';
import type { ICliAgentTransformer } from './cli-agent-transformer.interface';
import { transformAgentContent } from './transform-rules';

/**
 * Transforms Claude-format agent markdown to Gemini CLI format.
 *
 * Transformation rules:
 * 1. Frontmatter: Keep name and description (same format as Gemini)
 * 2. AskUserQuestion -> "ask the user directly in your response"
 * 3. Task tool -> gemini --agent NAME / -a NAME
 * 4. Slash commands -> Gemini CLI invocations
 * 5. Internal imports stripped
 * 6. STATIC/LLM markers kept as-is (Markdown comments, universal)
 */
export class GeminiAgentTransformer implements ICliAgentTransformer {
  readonly target = 'gemini' as const;

  transform(agent: GeneratedAgent): CliAgentTransformResult {
    // Extract agent ID from file path
    const agentId = extractAgentId(agent.filePath);

    // Extract description from agent content frontmatter or variables
    const description =
      agent.variables['description'] || `${agentId} agent`;

    // Apply all transformations
    const content = transformAgentContent(
      agent.content,
      'gemini',
      agentId,
      description
    );

    // Target path: ~/.gemini/agents/{agent-id}.md
    const filePath = join(
      homedir(),
      '.gemini',
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
 */
function extractAgentId(filePath: string): string {
  const fileName =
    filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  return fileName.replace(/\.md$/i, '');
}
