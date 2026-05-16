/**
 * HarnessSubagentDesignService.
 *
 * LLM-powered subagent fleet design for the harness wizard. Delegates the
 * streaming LLM call to {@link HarnessLlmRunner} and validates / sanitises the
 * resulting subagent definitions.
 *
 * Extracted from `harness-ai-generation.service.ts` (`designSubagentFleet`).
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import { DEFAULT_FALLBACK_MODEL_ID } from '@ptah-extension/agent-sdk';
import type {
  HarnessDesignAgentsParams,
  HarnessDesignAgentsResponse,
  HarnessSubagentDefinition,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../tokens';
import { HarnessWorkspaceContextService } from '../workspace/harness-workspace-context.service';
import { HarnessLlmRunner } from './harness-llm-runner.service';

/** Structured output shape from the LLM subagent design call */
interface LlmSubagentDesignOutput {
  subagents: Array<{
    id: string;
    name: string;
    description: string;
    role: string;
    tools: string[];
    executionMode: 'background' | 'on-demand' | 'scheduled';
    triggers?: string[];
    instructions: string;
  }>;
  reasoning: string;
}

@injectable()
export class HarnessSubagentDesignService {
  constructor(
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(HARNESS_TOKENS.WORKSPACE_CONTEXT)
    private readonly workspaceContext: HarnessWorkspaceContextService,
    @inject(HARNESS_TOKENS.LLM_RUNNER)
    private readonly llmRunner: HarnessLlmRunner,
  ) {}

  /**
   * Design 2–5 custom subagents tailored to the user's persona and workflow.
   *
   * Streams SDK events via HarnessStreamBroadcaster (through the LLM runner)
   * so the webview can render real-time execution visualization.
   */
  async designSubagentFleet(
    persona: HarnessDesignAgentsParams['persona'],
    existingAgents: string[],
    workspaceContext?: HarnessDesignAgentsParams['workspaceContext'],
  ): Promise<HarnessDesignAgentsResponse> {
    const workspaceRoot = this.workspaceContext.requireWorkspaceRoot();

    const contextInfo = workspaceContext
      ? `\n## Workspace Context\n- Project: ${workspaceContext.projectName}\n- Type: ${workspaceContext.projectType}\n- Frameworks: ${workspaceContext.frameworks.join(', ') || 'none detected'}\n- Languages: ${workspaceContext.languages.join(', ') || 'none detected'}`
      : '';

    const prompt = `You are designing a custom subagent fleet for an AI coding harness. Each subagent is a specialized worker with a distinct role in the user's workflow.

## User Persona
**Name**: ${persona.label}
**Description**: ${persona.description}
**Goals**: ${persona.goals.length > 0 ? persona.goals.join(', ') : 'General development assistance'}
${contextInfo}

## Existing CLI Agents Already Enabled
${existingAgents.length > 0 ? existingAgents.join(', ') : '(none)'}

## Your Task
Design 2-5 custom subagents that would transform this user's workflow. Each subagent should be:

1. **Specialized** — one clear responsibility, not a generalist
2. **Actionable** — has specific tools and triggers
3. **Complementary** — works with other subagents, not redundant

Think creatively based on the persona. Examples of great subagent designs:
- "Sentiment Watchdog" — monitors social media comments, categorizes by sentiment
- "Code Quality Guardian" — runs on every commit, flags regressions
- "Documentation Sync Agent" — detects code changes, updates docs automatically
- "Dependency Scout" — monitors package updates, flags security advisories
- "Performance Monitor" — tracks build times, bundle sizes, lighthouse scores

For each subagent, specify:
- **id**: kebab-case identifier
- **name**: Human-readable name
- **description**: What it does (1-2 sentences)
- **role**: The specialized persona prompt for this subagent
- **tools**: Array of tool names it needs (e.g., "web-search", "file-read", "git-log", "browser", "code-execute")
- **executionMode**: "background" (always running), "on-demand" (user-triggered), or "scheduled" (periodic)
- **triggers**: When this agent activates (e.g., "on-commit", "every-4-hours", "on-user-request")
- **instructions**: Detailed behavior instructions (3-5 sentences)

Return ONLY the JSON object matching the schema.`;

    const outputSchema = {
      type: 'object',
      properties: {
        subagents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              role: { type: 'string' },
              tools: { type: 'array', items: { type: 'string' } },
              executionMode: {
                type: 'string',
                enum: ['background', 'on-demand', 'scheduled'],
              },
              triggers: { type: 'array', items: { type: 'string' } },
              instructions: { type: 'string' },
            },
            required: [
              'id',
              'name',
              'description',
              'role',
              'tools',
              'executionMode',
              'instructions',
            ],
          },
        },
        reasoning: { type: 'string' },
      },
      required: ['subagents', 'reasoning'],
      additionalProperties: false,
    };

    const { postProcessed } =
      await this.llmRunner.run<HarnessDesignAgentsResponse>({
        operation: 'design-agents',
        serviceTag: '[HarnessDesignAgents]',
        timeoutMs: 45_000,
        execute: {
          cwd: workspaceRoot,
          model:
            this.modelSettings.selectedModel.get() || DEFAULT_FALLBACK_MODEL_ID,
          prompt,
          systemPromptAppend:
            "You are a subagent fleet architect. Design creative, practical subagents that automate the user's most valuable workflows. Be specific about tools and triggers. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.",
          isPremium: true,
          mcpServerRunning: true,
          maxTurns: 6,
          outputFormat: { type: 'json_schema', schema: outputSchema },
        },
        postProcess: (structuredOutput) => {
          const output = structuredOutput as LlmSubagentDesignOutput | null;

          if (!output?.subagents || !Array.isArray(output.subagents)) {
            throw new Error('LLM did not return valid subagent designs');
          }

          // Validate and sanitize each subagent
          const subagents: HarnessSubagentDefinition[] = output.subagents
            .filter((s) => s.id && s.name && s.description)
            .map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              role: s.role || s.description,
              tools: Array.isArray(s.tools) ? s.tools : [],
              executionMode: (['background', 'on-demand', 'scheduled'].includes(
                s.executionMode,
              )
                ? s.executionMode
                : 'on-demand') as HarnessSubagentDefinition['executionMode'],
              triggers: Array.isArray(s.triggers) ? s.triggers : undefined,
              instructions: s.instructions || '',
            }));

          return {
            subagents,
            reasoning:
              output.reasoning ||
              'Subagent fleet designed based on persona analysis.',
          };
        },
      });

    // postProcessed is non-undefined when postProcess is supplied.
    return postProcessed as HarnessDesignAgentsResponse;
  }
}
