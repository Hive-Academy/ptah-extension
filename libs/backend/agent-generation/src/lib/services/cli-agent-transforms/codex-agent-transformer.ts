/**
 * Codex Agent Transformer
 * Transform Claude-format agent content to Codex CLI format
 *
 * Pure transformation with no I/O or DI dependencies.
 * Uses shared transform-rules.ts for common rewrite logic.
 *
 * Target: ~/.codex/agents/ptah-{agent-id}.md
 * Codex CLI auto-discovers agents from ~/.codex/agents/ directory.
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
 * Transforms Claude-format agent markdown to Codex CLI format.
 *
 * Transformation rules:
 * 1. Frontmatter: Keep name and description (same format as Codex)
 * 2. AskUserQuestion -> "ask the user directly in your response"
 * 3. Task tool -> codex exec
 * 4. Slash commands -> codex CLI invocations
 * 5. Internal imports stripped
 * 6. STATIC/LLM markers kept as-is (Markdown comments, universal)
 */
export class CodexAgentTransformer implements ICliAgentTransformer {
  readonly target = 'codex' as const;

  transform(agent: GeneratedAgent): CliAgentTransformResult {
    // Extract agent ID using cross-platform path.basename()
    const agentId = extractAgentId(agent.filePath);

    // Extract description from agent variables
    const description = agent.variables['description'] || `${agentId} agent`;

    // Apply all transformations
    const content = transformAgentContent(
      agent.content,
      'codex',
      agentId,
      description
    );

    // Target path: ~/.codex/agents/ptah-{agent-id}.md (prefixed for cleanup)
    const filePath = join(homedir(), '.codex', 'agents', `ptah-${agentId}.md`);

    return {
      cli: this.target,
      agentId,
      content,
      filePath,
    };
  }
}
