/**
 * Cursor Agent Transformer
 *
 * Transforms Claude-format agent content to Cursor CLI format.
 * Pure transformation with no I/O or DI dependencies.
 * Uses shared transform-rules.ts for common rewrite logic.
 *
 * Target: ~/.cursor/agents/ptah-{agent-id}.md
 * Cursor CLI auto-discovers agents from ~/.cursor/agents/ directory.
 * Invoked via `cursor agent --agent ptah-backend-developer`.
 *
 * Agent files are prefixed with `ptah-` for:
 * 1. Namespace separation from user-created agents
 * 2. Deterministic cleanup on premium expiry
 */

import { homedir } from 'os';
import { join } from 'path';
import type { CliAgentTransformResult } from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';
import type { ICliAgentTransformer } from './cli-agent-transformer.interface';
import { transformAgentContent, extractAgentId } from './transform-rules';

/**
 * Transforms Claude-format agent markdown to Cursor CLI format.
 *
 * Transformation rules:
 * 1. Frontmatter: Keep name and description (same format as Cursor)
 * 2. AskUserQuestion -> "ask the user directly in your response"
 * 3. Task tool -> cursor agent --agent NAME
 * 4. Slash commands -> Cursor CLI invocations
 * 5. Internal imports stripped
 * 6. STATIC/LLM markers kept as-is (Markdown comments, universal)
 */
export class CursorAgentTransformer implements ICliAgentTransformer {
  readonly target = 'cursor' as const;

  transform(agent: GeneratedAgent): CliAgentTransformResult {
    // Extract agent ID using cross-platform path.basename()
    const agentId = extractAgentId(agent.filePath);

    // Extract description from agent variables
    const description = agent.variables['description'] || `${agentId} agent`;

    // Apply all transformations
    const content = transformAgentContent(
      agent.content,
      'cursor',
      agentId,
      description,
    );

    // Target path: ~/.cursor/agents/ptah-{agent-id}.md (prefixed for cleanup)
    const filePath = join(homedir(), '.cursor', 'agents', `ptah-${agentId}.md`);

    return {
      cli: this.target,
      agentId,
      content,
      filePath,
    };
  }
}
