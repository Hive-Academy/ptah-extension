/**
 * Codex Subagent Transformer
 * Transform Claude-format agent content to a Codex native subagent.
 *
 * Codex (GA 2026-03) supports project-scoped custom subagents as standalone
 * TOML files under `{workspaceRoot}/.codex/agents/{id}.toml`. Each file carries
 * `name`/`description` structurally and the full instructions in
 * `developer_instructions`. This replaces the earlier approach of merging every
 * agent body into a single AGENTS.md.
 *
 * Pure transformation with no I/O or DI dependencies.
 */

import { join } from 'path';
import type { CliAgentTransformResult } from '@ptah-extension/shared';
import type { GeneratedAgent } from '../../types/core.types';
import type { ICliAgentTransformer } from './cli-agent-transformer.interface';
import {
  transformAgentBody,
  extractAgentId,
  resolveAgentDescription,
} from './transform-rules';

/** Escape a value for a single-line TOML basic string. */
function tomlBasicString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * Escape a value for a multi-line TOML basic string (`"""..."""`).
 * Newlines are preserved literally; only backslashes and quotes are escaped
 * so no `"""` sequence can prematurely close the string.
 */
function tomlMultilineString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"""\n${escaped}\n"""`;
}

/**
 * Reviewer agents inspect code and must not mutate the workspace, so they run
 * in Codex's read-only sandbox. Everything else inherits the parent sandbox.
 */
function isReadOnlyAgent(agentId: string): boolean {
  return /reviewer$/.test(agentId);
}

/**
 * Transforms a Claude-format GeneratedAgent into a Codex native subagent TOML.
 *
 * Transformation rules:
 * 1. `name`/`description` become TOML fields (from frontmatter/variables)
 * 2. The agent body (frontmatter stripped) becomes `developer_instructions`,
 *    with Task tool -> `codex exec`, slash commands -> `codex ...`, etc.
 * 3. Reviewer agents get `sandbox_mode = "read-only"`
 * 4. `model` is intentionally omitted — Claude model hints (opus/sonnet) are
 *    invalid for Codex, so subagents inherit the parent session's model.
 */
export class CodexSubagentTransformer implements ICliAgentTransformer {
  readonly target = 'codex' as const;

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
    const instructions = transformAgentBody(agent.content, 'codex');

    const lines = [
      `name = ${tomlBasicString(agentId)}`,
      `description = ${tomlBasicString(description)}`,
    ];
    if (isReadOnlyAgent(agentId)) {
      lines.push('sandbox_mode = "read-only"');
    }
    lines.push(`developer_instructions = ${tomlMultilineString(instructions)}`);
    const content = `${lines.join('\n')}\n`;

    const filePath = join(workspaceRoot, '.codex', 'agents', `${agentId}.toml`);

    return {
      cli: this.target,
      agentId,
      content,
      filePath,
    };
  }
}
