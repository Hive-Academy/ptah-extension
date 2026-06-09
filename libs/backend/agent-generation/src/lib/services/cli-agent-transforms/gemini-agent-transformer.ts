/**
 * Gemini Agent Transformer
 *
 * Transforms Claude-format agent content to Gemini CLI format.
 * Pure transformation with no I/O or DI dependencies.
 * Uses shared transform-rules.ts for common rewrite logic.
 */

import { join } from 'path';
import type { CliAgentTransformResult } from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';
import type { ICliAgentTransformer } from './cli-agent-transformer.interface';
import { transformAgentContent, extractAgentId } from './transform-rules';

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

  transform(
    agent: GeneratedAgent,
    workspaceRoot: string,
  ): CliAgentTransformResult {
    const agentId = extractAgentId(agent.filePath);
    const description = agent.variables['description'] || `${agentId} agent`;
    const content = transformAgentContent(
      agent.content,
      'gemini',
      agentId,
      description,
    );
    const filePath = join(workspaceRoot, '.gemini', 'agents', `${agentId}.md`);

    return {
      cli: this.target,
      agentId,
      content,
      filePath,
    };
  }
}
