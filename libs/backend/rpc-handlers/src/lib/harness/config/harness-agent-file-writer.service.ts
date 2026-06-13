import * as path from 'path';
import * as fs from 'fs/promises';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { HarnessSubagentDefinition } from '@ptah-extension/shared';

export interface AgentFileWriteOutcome {
  writtenPaths: string[];
  warnings: string[];
}

@injectable()
export class HarnessAgentFileWriterService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  async writeSubagentFiles(
    workspaceRoot: string,
    subagents: HarnessSubagentDefinition[],
  ): Promise<AgentFileWriteOutcome> {
    const writtenPaths: string[] = [];
    const warnings: string[] = [];

    if (subagents.length === 0) {
      return { writtenPaths, warnings };
    }

    const agentsDir = path.join(workspaceRoot, '.claude', 'agents');
    try {
      await fs.mkdir(agentsDir, { recursive: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to create .claude/agents directory: ${message}`);
      this.logger.error(
        'RPC: harness:apply failed to create agents directory',
        error instanceof Error ? error : new Error(message),
      );
      return { writtenPaths, warnings };
    }

    for (const subagent of subagents) {
      const slug = this.sanitizeId(subagent.id || subagent.name);
      if (slug.length === 0) {
        warnings.push(
          `Skipped subagent with no usable id/name: ${subagent.name || '(unnamed)'}`,
        );
        continue;
      }

      const agentPath = path.join(agentsDir, `${slug}.md`);
      try {
        const content = this.composeAgentFile(slug, subagent);
        await fs.writeFile(agentPath, content, 'utf-8');
        writtenPaths.push(agentPath);
        this.logger.debug('Wrote harness subagent file', { path: agentPath });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to write agent ${slug}.md: ${message}`);
        this.logger.error(
          'RPC: harness:apply failed to write subagent file',
          error instanceof Error ? error : new Error(message),
        );
      }
    }

    return { writtenPaths, warnings };
  }

  private composeAgentFile(
    slug: string,
    subagent: HarnessSubagentDefinition,
  ): string {
    const description = this.escapeYamlValue(
      subagent.description || subagent.name || slug,
    );
    const tools = (subagent.tools ?? [])
      .map((tool) => this.sanitizeTool(tool))
      .filter((tool) => tool.length > 0);

    const frontmatterLines = [
      '---',
      `name: ${slug}`,
      `description: ${description}`,
    ];
    if (tools.length > 0) {
      frontmatterLines.push(`tools: ${tools.join(', ')}`);
    }
    frontmatterLines.push('---', '');

    const body = this.composeBody(subagent);
    return [...frontmatterLines, body, ''].join('\n');
  }

  private composeBody(subagent: HarnessSubagentDefinition): string {
    const sections: string[] = [];
    const heading = subagent.name?.trim().length
      ? subagent.name.trim()
      : subagent.id;
    sections.push(`# ${heading}`);

    if (subagent.role?.trim().length) {
      sections.push(`## Role\n\n${subagent.role.trim()}`);
    }
    if (subagent.instructions?.trim().length) {
      sections.push(`## Instructions\n\n${subagent.instructions.trim()}`);
    }
    if (subagent.executionMode) {
      sections.push(`## Execution Mode\n\n${subagent.executionMode}`);
    }
    if (subagent.triggers && subagent.triggers.length > 0) {
      const triggerList = subagent.triggers
        .map((trigger) => `- ${trigger}`)
        .join('\n');
      sections.push(`## Triggers\n\n${triggerList}`);
    }

    return sections.join('\n\n');
  }

  private sanitizeId(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private sanitizeTool(tool: string): string {
    return tool.replace(/[^\w:/.\\-]/g, '');
  }

  private escapeYamlValue(value: string): string {
    const collapsed = value.replace(/\r?\n/g, ' ').trim();
    if (/[:#"'\][{}|>*&!%@`]/.test(collapsed) || collapsed.length === 0) {
      return `"${collapsed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return collapsed;
  }
}
