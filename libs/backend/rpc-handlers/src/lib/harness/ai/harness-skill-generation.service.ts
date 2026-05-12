/**
 * HarnessSkillGenerationService — Wave C7d.
 *
 * LLM-powered skill specification generation for the harness wizard. Delegates
 * the streaming LLM call to {@link HarnessLlmRunner} and validates / sanitises
 * the resulting SKILL.md drafts.
 *
 * Extracted from `harness-ai-generation.service.ts` (`generateSkillSpecs`).
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import { DEFAULT_FALLBACK_MODEL_ID } from '@ptah-extension/agent-sdk';
import type {
  GeneratedSkillSpec,
  HarnessGenerateSkillsParams,
  HarnessGenerateSkillsResponse,
  HarnessSubagentDefinition,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../tokens';
import { HarnessWorkspaceContextService } from '../workspace/harness-workspace-context.service';
import { HarnessLlmRunner } from './harness-llm-runner.service';

/** Structured output shape from the LLM skill generation call */
interface LlmSkillGenerationOutput {
  skills: Array<{
    name: string;
    description: string;
    content: string;
    requiredTools?: string[];
    reasoning: string;
  }>;
  reasoning: string;
}

@injectable()
export class HarnessSkillGenerationService {
  constructor(
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(HARNESS_TOKENS.WORKSPACE_CONTEXT)
    private readonly workspaceContext: HarnessWorkspaceContextService,
    @inject(HARNESS_TOKENS.LLM_RUNNER)
    private readonly llmRunner: HarnessLlmRunner,
  ) {}

  /**
   * Generate specialized skill specifications using the LLM.
   *
   * Creates complete SKILL.md content tailored to the persona's workflow.
   * If custom subagents are provided, skills are designed to support them.
   */
  async generateSkillSpecs(
    persona: HarnessGenerateSkillsParams['persona'],
    existingSkills: string[],
    harnessSubagents?: HarnessSubagentDefinition[],
  ): Promise<HarnessGenerateSkillsResponse> {
    const workspaceRoot = this.workspaceContext.requireWorkspaceRoot();

    const subagentContext =
      harnessSubagents && harnessSubagents.length > 0
        ? `\n## Harness Subagent Fleet\nThese subagents are designed for this persona — create skills that support their workflows:\n${harnessSubagents.map((s) => `- **${s.name}** (${s.executionMode}): ${s.description}`).join('\n')}`
        : '';

    const prompt = `You are creating specialized skill files for an AI coding harness. Skills are markdown instruction sets that give agents domain expertise.

## User Persona
**Name**: ${persona.label}
**Description**: ${persona.description}
**Goals**: ${persona.goals.length > 0 ? persona.goals.join(', ') : 'General development assistance'}
${subagentContext}

## Already Available Skills
${existingSkills.length > 0 ? existingSkills.join(', ') : '(none)'}

## Your Task
Design 2-4 specialized skills that would be most valuable for this persona. Each skill should:

1. **Solve a specific workflow problem** — not generic, but targeted
2. **Include complete instructions** — the full markdown content for SKILL.md
3. **Be actionable** — give the AI clear steps, constraints, and output formats

For each skill, provide:
- **name**: Skill name (kebab-case, e.g., "podcast-transcript-analyzer")
- **description**: What this skill does (1 sentence)
- **content**: Complete SKILL.md markdown content including:
  - A clear title and description
  - Step-by-step instructions for the AI
  - Input/output format specifications
  - Constraints and guardrails
  - Example usage scenarios
- **requiredTools**: Tools this skill needs (e.g., ["web-search", "file-read"])
- **reasoning**: Why this skill is valuable for this persona (1-2 sentences)

Return ONLY the JSON object matching the schema.`;

    const outputSchema = {
      type: 'object',
      properties: {
        skills: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              content: { type: 'string' },
              requiredTools: { type: 'array', items: { type: 'string' } },
              reasoning: { type: 'string' },
            },
            required: ['name', 'description', 'content', 'reasoning'],
          },
        },
        reasoning: { type: 'string' },
      },
      required: ['skills', 'reasoning'],
      additionalProperties: false,
    };

    const { postProcessed } =
      await this.llmRunner.run<HarnessGenerateSkillsResponse>({
        operation: 'generate-skills',
        serviceTag: '[HarnessGenerateSkills]',
        timeoutMs: 45_000,
        execute: {
          cwd: workspaceRoot,
          model:
            this.modelSettings.selectedModel.get() || DEFAULT_FALLBACK_MODEL_ID,
          prompt,
          systemPromptAppend:
            "You are a skill designer. Create practical, detailed skills that automate high-value workflows. Include complete SKILL.md content — not stubs. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.",
          isPremium: true,
          mcpServerRunning: true,
          maxTurns: 6,
          outputFormat: { type: 'json_schema', schema: outputSchema },
        },
        postProcess: (structuredOutput) => {
          const output = structuredOutput as LlmSkillGenerationOutput | null;

          if (!output?.skills || !Array.isArray(output.skills)) {
            throw new Error('LLM did not return valid skill specifications');
          }

          const skills: GeneratedSkillSpec[] = output.skills
            .filter((s) => s.name && s.description && s.content)
            .map((s) => ({
              name: s.name,
              description: s.description,
              content: s.content,
              requiredTools: Array.isArray(s.requiredTools)
                ? s.requiredTools
                : undefined,
              reasoning: s.reasoning || 'Designed for persona workflow.',
            }));

          return {
            skills,
            reasoning:
              output.reasoning || 'Skills designed based on persona analysis.',
          };
        },
      });

    return postProcessed as HarnessGenerateSkillsResponse;
  }
}
