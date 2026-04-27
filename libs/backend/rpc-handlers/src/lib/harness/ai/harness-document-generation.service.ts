/**
 * HarnessDocumentGenerationService — Wave C7d.
 *
 * LLM-powered comprehensive PRD/requirements document generation for the
 * harness wizard. Delegates the streaming LLM call to {@link HarnessLlmRunner}
 * and falls back to a deterministic heuristic document when the LLM call does
 * not produce structured output.
 *
 * Extracted from `harness-ai-generation.service.ts`
 * (`generateComprehensiveDocument` + `parseSectionsFromDocument` +
 * `buildFallbackDocument`).
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import { DEFAULT_FALLBACK_MODEL_ID } from '@ptah-extension/agent-sdk';
import type {
  HarnessConfig,
  HarnessGenerateDocumentParams,
  HarnessGenerateDocumentResponse,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../tokens';
import { HarnessWorkspaceContextService } from '../workspace/harness-workspace-context.service';
import { HarnessLlmRunner } from './harness-llm-runner.service';

@injectable()
export class HarnessDocumentGenerationService {
  constructor(
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(HARNESS_TOKENS.WORKSPACE_CONTEXT)
    private readonly workspaceContext: HarnessWorkspaceContextService,
    @inject(HARNESS_TOKENS.LLM_RUNNER)
    private readonly llmRunner: HarnessLlmRunner,
  ) {}

  /**
   * Generate a comprehensive PRD/requirements document from the harness config.
   *
   * Uses the LLM to produce a professional-grade document that covers:
   * persona profile, subagent architecture, skill library, security
   * guardrails, MCP topology, and implementation roadmap.
   */
  async generateComprehensiveDocument(
    config: HarnessConfig,
    workspaceContext?: HarnessGenerateDocumentParams['workspaceContext'],
  ): Promise<HarnessGenerateDocumentResponse> {
    const workspaceRoot = this.workspaceContext.requireWorkspaceRoot();

    // Build a detailed config summary for the LLM
    const enabledAgents = Object.entries(config.agents.enabledAgents)
      .filter(([, v]) => v.enabled)
      .map(
        ([k, v]) =>
          `${k} (tier: ${v.modelTier ?? 'default'}, auto-approve: ${v.autoApprove ?? false})`,
      );

    const harnessSubagents = config.agents.harnessSubagents ?? [];
    const subagentSummary =
      harnessSubagents.length > 0
        ? harnessSubagents
            .map(
              (s) =>
                `- **${s.name}** (${s.executionMode}): ${s.description}\n  Tools: ${s.tools.join(', ')}\n  Triggers: ${s.triggers?.join(', ') ?? 'on-demand'}\n  Instructions: ${s.instructions}`,
            )
            .join('\n')
        : '(none designed)';

    const enabledServers = config.mcp.servers.filter((s) => s.enabled);
    const contextInfo = workspaceContext
      ? `Project: ${workspaceContext.projectName} (${workspaceContext.projectType}), Frameworks: ${workspaceContext.frameworks.join(', ')}, Languages: ${workspaceContext.languages.join(', ')}`
      : 'No workspace context';

    const prompt = `Generate a comprehensive Product Requirements Document (PRD) for an AI harness configuration. This document should be professional-grade and cover every aspect of the harness architecture.

## Harness Configuration Data

**Name**: ${config.name}
**Workspace**: ${contextInfo}

### Persona
- **Label**: ${config.persona.label}
- **Description**: ${config.persona.description}
- **Goals**: ${config.persona.goals.join(', ') || '(none)'}

### CLI Agents
${enabledAgents.length > 0 ? enabledAgents.join('\n') : '(none enabled)'}

### Custom Subagent Fleet
${subagentSummary}

### Skills
- **Selected**: ${config.skills.selectedSkills.join(', ') || '(none)'}
- **Created**: ${config.skills.createdSkills.map((s) => s.name).join(', ') || '(none)'}

### System Prompt
${config.prompt.systemPrompt || '(not configured)'}

### MCP Servers
${enabledServers.map((s) => `- ${s.name}: ${s.description ?? s.url}`).join('\n') || '(none)'}

## Document Requirements

Generate a comprehensive PRD with these sections:

1. **Objective** — 2-3 sentence summary of what this harness achieves
2. **Target User Profile** — Detailed persona analysis with platform/workflow strategy
3. **Core Harness Architecture** — How the components work together (memory, skills, agents)
4. **The Subagent Fleet** — Detailed description of each subagent's role, responsibilities, and interactions
5. **Specialized Skill Library** — Each skill with its purpose and how it fits the workflow
6. **Security & Human-in-the-Loop Guardrails** — Approval gates, runtime gatekeepers, deny-and-continue patterns, adversarial input protection
7. **MCP Server Topology** — What each server provides and how they integrate
8. **Implementation Roadmap** — Phased rollout with priorities

Write in a professional but engaging tone. Use markdown formatting with headers, bullet points, and bold emphasis. Make it feel like a real product document, not a config dump.`;

    const docOutputSchema = {
      type: 'object',
      properties: {
        document: {
          type: 'string',
          description: 'The complete markdown PRD document',
        },
      },
      required: ['document'],
      additionalProperties: false,
    };

    const { postProcessed } =
      await this.llmRunner.run<HarnessGenerateDocumentResponse>({
        operation: 'generate-document',
        serviceTag: '[HarnessGenerateDoc]',
        timeoutMs: 60_000,
        execute: {
          cwd: workspaceRoot,
          model:
            this.configManager.get<string>('model.selected') ||
            DEFAULT_FALLBACK_MODEL_ID,
          prompt:
            prompt +
            '\n\nReturn a JSON object with a single "document" field containing the full markdown PRD as a string.',
          systemPromptAppend:
            'You are a technical product manager writing a PRD. Be thorough, specific, and professional. The document should be 800-1500 words. Use the available ptah.harness tools to enhance your document: searchSkills(query?) to find existing skills relevant to the project, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed. After using tools, return valid JSON with the markdown document.',
          isPremium: true,
          mcpServerRunning: true,
          maxTurns: 6,
          outputFormat: { type: 'json_schema', schema: docOutputSchema },
        },
        postProcess: (structuredOutput) => {
          const output = structuredOutput as { document: string } | null;
          const document =
            output?.document || this.buildFallbackDocument(config);
          const sections = this.parseSectionsFromDocument(document);
          return { document, sections };
        },
      });

    return postProcessed as HarnessGenerateDocumentResponse;
  }

  /**
   * Parse section headers from a markdown document into a record.
   */
  private parseSectionsFromDocument(document: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = document.split('\n');
    let currentSection = 'header';
    let currentContent: string[] = [];

    for (const line of lines) {
      const headerMatch = /^#{1,3}\s+(?:\d+\.\s+)?(.+)$/.exec(line);
      if (headerMatch) {
        if (currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = headerMatch[1]
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return sections;
  }

  /**
   * Fallback document when LLM is unavailable.
   */
  private buildFallbackDocument(config: HarnessConfig): string {
    const lines: string[] = [];
    lines.push(`# ${config.name} — Harness Requirements Document`);
    lines.push('');
    lines.push(
      `> Generated by Ptah Harness Builder on ${new Date().toISOString().split('T')[0]}`,
    );
    lines.push('');
    lines.push('## 1. Objective');
    lines.push('');
    lines.push(
      `This harness configures an AI coding assistant for the "${config.persona.label}" persona.`,
    );
    lines.push('');
    lines.push('## 2. Persona');
    lines.push('');
    lines.push(config.persona.description || '(No description provided)');
    lines.push('');

    if (config.persona.goals.length > 0) {
      lines.push('### Goals');
      for (const goal of config.persona.goals) {
        lines.push(`- ${goal}`);
      }
      lines.push('');
    }

    const enabledAgentIds = Object.entries(config.agents.enabledAgents)
      .filter(([, v]) => v.enabled)
      .map(([k]) => k);
    if (enabledAgentIds.length > 0) {
      lines.push('## 3. Agents');
      lines.push('');
      for (const id of enabledAgentIds) {
        lines.push(`- **${id}**`);
      }
      lines.push('');
    }

    const harnessSubagents = config.agents.harnessSubagents ?? [];
    if (harnessSubagents.length > 0) {
      lines.push('## 4. Harness Subagent Fleet');
      lines.push('');
      for (const sub of harnessSubagents) {
        lines.push(`### ${sub.name}`);
        lines.push(`- **Role**: ${sub.role}`);
        lines.push(`- **Mode**: ${sub.executionMode}`);
        lines.push(`- **Tools**: ${sub.tools.join(', ')}`);
        lines.push(`- **Description**: ${sub.description}`);
        lines.push('');
      }
    }

    if (
      config.skills.selectedSkills.length > 0 ||
      config.skills.createdSkills.length > 0
    ) {
      lines.push('## 5. Skills');
      lines.push('');
      for (const skill of config.skills.selectedSkills) {
        lines.push(`- ${skill}`);
      }
      for (const skill of config.skills.createdSkills) {
        lines.push(`- ${skill.name}: ${skill.description}`);
      }
      lines.push('');
    }

    if (config.prompt.systemPrompt) {
      lines.push('## 6. System Prompt');
      lines.push('');
      lines.push(config.prompt.systemPrompt);
      lines.push('');
    }

    lines.push('## 7. Security & Guardrails');
    lines.push('');
    lines.push('- Approval gates for state-changing actions');
    lines.push('- Runtime permission checks before tool execution');
    lines.push('- Deny-and-continue fallback pattern');
    lines.push('- Adversarial input protection for external data');
    lines.push('');

    return lines.join('\n');
  }
}
