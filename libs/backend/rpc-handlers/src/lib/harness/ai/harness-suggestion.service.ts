/**
 * HarnessSuggestionService.
 *
 * LLM-powered persona analysis + intent analysis surfaces:
 *   - `buildSuggestionFromPersona` → persona→config suggestion with heuristic fallback.
 *   - `analyzeIntent` → freeform-input→complete-harness blueprint with heuristic fallback.
 *
 * Owns the live `McpRegistryProvider` used to surface concrete MCP server
 * recommendations from AI-selected keywords.
 *
 * Streaming-LLM boilerplate is delegated to {@link HarnessLlmRunner}; prompt
 * strings and JSON output schemas live in `./harness-suggestion.prompts.ts`.
 *
 * Extracted from `harness-rpc.handlers.ts` (lines 1459–1998, 3274–3582).
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import {
  McpRegistryProvider,
  DEFAULT_FALLBACK_MODEL_ID,
} from '@ptah-extension/agent-sdk';
import type {
  AgentOverride,
  AvailableAgent,
  GeneratedSkillSpec,
  HarnessAnalyzeIntentParams,
  HarnessAnalyzeIntentResponse,
  HarnessSubagentDefinition,
  HarnessSuggestConfigResponse,
  McpServerSuggestion,
  SkillSummary,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../tokens';
import { HarnessWorkspaceContextService } from '../workspace/harness-workspace-context.service';
import { HarnessLlmRunner } from './harness-llm-runner.service';
import {
  buildIntentAnalysisPrompt,
  buildSuggestionPrompt,
  INTENT_ANALYSIS_OUTPUT_SCHEMA,
  INTENT_ANALYSIS_SYSTEM_PROMPT_APPEND,
  SUGGESTION_OUTPUT_SCHEMA,
  SUGGESTION_SYSTEM_PROMPT_APPEND,
} from './harness-suggestion.prompts';

/** Structured output shape from the LLM suggestion call */
interface LlmSuggestionOutput {
  selectedAgentIds: string[];
  selectedSkillIds: string[];
  mcpSearchTerms: string[];
  systemPrompt: string;
  reasoning: string;
}

/** Structured output shape from the LLM intent analysis call */
interface LlmIntentAnalysisOutput {
  persona: {
    label: string;
    description: string;
    goals: string[];
  };
  selectedAgentIds: string[];
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
  selectedSkillIds: string[];
  skillSpecs: Array<{
    name: string;
    description: string;
    content: string;
    requiredTools?: string[];
    reasoning: string;
  }>;
  systemPrompt: string;
  mcpSearchTerms: string[];
  summary: string;
  reasoning: string;
}

export interface AnalyzeIntentOptions {
  input: string;
  availableSkills: SkillSummary[];
  availableAgents: AvailableAgent[];
  workspaceContext?: HarnessAnalyzeIntentParams['workspaceContext'];
}

@injectable()
export class HarnessSuggestionService {
  private readonly registryProvider = new McpRegistryProvider();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(HARNESS_TOKENS.WORKSPACE_CONTEXT)
    private readonly workspaceContext: HarnessWorkspaceContextService,
    @inject(HARNESS_TOKENS.LLM_RUNNER)
    private readonly llmRunner: HarnessLlmRunner,
  ) {}

  /**
   * Build a config suggestion by asking the AI to analyze the persona
   * and select the most appropriate agents, skills, and MCP servers.
   */
  async buildSuggestionFromPersona(
    description: string,
    goals: string[],
    availableSkills: SkillSummary[],
    availableAgents: AvailableAgent[],
  ): Promise<HarnessSuggestConfigResponse> {
    try {
      return await this.buildSuggestionViaAgent(
        description,
        goals,
        availableSkills,
        availableAgents,
      );
    } catch (error) {
      this.logger.warn(
        'LLM-powered suggestion failed, falling back to heuristic',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return this.buildSuggestionFallback(description, goals);
    }
  }

  /**
   * Analyze freeform user intent into a complete harness blueprint.
   * Falls back to heuristic if the LLM is unavailable.
   */
  async analyzeIntent(
    opts: AnalyzeIntentOptions,
  ): Promise<HarnessAnalyzeIntentResponse> {
    try {
      return await this.analyzeIntentViaAgent(
        opts.input,
        opts.availableSkills,
        opts.availableAgents,
        opts.workspaceContext,
      );
    } catch (llmError) {
      this.logger.warn(
        'LLM-powered intent analysis failed, falling back to heuristic',
        {
          error:
            llmError instanceof Error ? llmError.message : String(llmError),
        },
      );
      return this.buildAnalyzeIntentFallback(
        opts.input,
        opts.availableAgents,
        opts.availableSkills,
      );
    }
  }

  // ── LLM-backed suggestion ────────────────────────────────

  private async buildSuggestionViaAgent(
    description: string,
    goals: string[],
    availableSkills: SkillSummary[],
    availableAgents: AvailableAgent[],
  ): Promise<HarnessSuggestConfigResponse> {
    const workspaceRoot = this.workspaceContext.requireWorkspaceRoot();

    // No `postProcess` — broadcast fires immediately after streaming, then
    // validation/agent-filter/MCP-search runs OUTSIDE the runner so that
    // the broadcast timing matches the pre-extraction behaviour.
    const { structuredOutput } = await this.llmRunner.run({
      operation: 'suggest-config',
      serviceTag: '[HarnessSuggest]',
      timeoutMs: 45_000,
      execute: {
        cwd: workspaceRoot,
        model:
          this.modelSettings.selectedModel.get() || DEFAULT_FALLBACK_MODEL_ID,
        prompt: buildSuggestionPrompt({
          description,
          goals,
          availableAgents,
          availableSkills,
        }),
        systemPromptAppend: SUGGESTION_SYSTEM_PROMPT_APPEND,
        isPremium: true,
        mcpServerRunning: true,
        maxTurns: 6,
        outputFormat: { type: 'json_schema', schema: SUGGESTION_OUTPUT_SCHEMA },
      },
    });

    const output = this.validateSuggestionOutput(structuredOutput);

    const validAgentIds = new Set(availableAgents.map((a) => a.id));
    const suggestedAgents: Record<string, AgentOverride> = {};
    for (const agentId of output.selectedAgentIds) {
      if (validAgentIds.has(agentId)) {
        suggestedAgents[agentId] = { enabled: true };
      }
    }
    if (Object.keys(suggestedAgents).length === 0) {
      suggestedAgents['ptah-cli'] = { enabled: true };
    }

    const validSkillIds = new Set(availableSkills.map((s) => s.id));
    const suggestedSkills = output.selectedSkillIds.filter((id) =>
      validSkillIds.has(id),
    );

    const suggestedMcpServers = await this.suggestMcpServersFromRegistry(
      output.mcpSearchTerms,
    );

    this.logger.info('LLM-powered suggestion completed', {
      agentCount: Object.keys(suggestedAgents).length,
      skillCount: suggestedSkills.length,
      mcpCount: suggestedMcpServers.length,
      searchTerms: output.mcpSearchTerms,
    });

    return {
      suggestedAgents,
      suggestedSkills,
      suggestedMcpServers,
      suggestedPrompt: output.systemPrompt,
      reasoning: output.reasoning,
    };
  }

  private validateSuggestionOutput(raw: unknown): LlmSuggestionOutput {
    if (!raw || typeof raw !== 'object') {
      throw new Error('LLM did not return structured output');
    }

    const obj = raw as Record<string, unknown>;

    if (
      !Array.isArray(obj['selectedAgentIds']) ||
      !Array.isArray(obj['selectedSkillIds']) ||
      !Array.isArray(obj['mcpSearchTerms']) ||
      typeof obj['systemPrompt'] !== 'string' ||
      typeof obj['reasoning'] !== 'string'
    ) {
      throw new Error(
        'LLM returned malformed structured output: missing or wrong-typed fields',
      );
    }

    return {
      selectedAgentIds: obj['selectedAgentIds'] as string[],
      selectedSkillIds: obj['selectedSkillIds'] as string[],
      mcpSearchTerms: obj['mcpSearchTerms'] as string[],
      systemPrompt: obj['systemPrompt'] as string,
      reasoning: obj['reasoning'] as string,
    };
  }

  private async buildSuggestionFallback(
    description: string,
    goals: string[],
  ): Promise<HarnessSuggestConfigResponse> {
    const text = `${description} ${goals.join(' ')}`.toLowerCase();

    const suggestedAgents: Record<string, AgentOverride> = {
      'ptah-cli': { enabled: true },
      copilot: { enabled: true },
    };

    const keywords = this.extractSearchableKeywords(text);
    const suggestedMcpServers =
      await this.suggestMcpServersFromRegistry(keywords);

    const suggestedPrompt = `You are a ${description || 'helpful assistant'}. Your goals are: ${goals.length > 0 ? goals.join(', ') : 'assist with development tasks'}.`;

    return {
      suggestedAgents,
      suggestedSkills: [],
      suggestedMcpServers,
      suggestedPrompt,
      reasoning:
        'Using default configuration (AI suggestion unavailable). Enabled Ptah CLI and Copilot as a balanced starting point. Adjust agents and skills in subsequent steps.',
    };
  }

  private buildAnalyzeIntentFallback(
    input: string,
    availableAgents: AvailableAgent[],
    availableSkills: SkillSummary[],
  ): HarnessAnalyzeIntentResponse {
    const firstSentence =
      input
        .split(/[.!?\n]/)
        .find((s) => s.trim().length > 0)
        ?.trim() || input.trim();
    const labelWords = firstSentence.split(/\s+/).slice(0, 4).join(' ');
    const label =
      labelWords.length > 50 ? labelWords.substring(0, 50) + '...' : labelWords;

    const goalKeywords = [
      'build',
      'create',
      'develop',
      'test',
      'deploy',
      'automate',
      'analyze',
      'optimize',
      'monitor',
      'integrate',
      'design',
      'implement',
      'migrate',
      'refactor',
    ];
    const inputLower = input.toLowerCase();
    const goals = goalKeywords
      .filter((kw) => inputLower.includes(kw))
      .map((kw) => `${kw.charAt(0).toUpperCase() + kw.slice(1)} as described`);
    if (goals.length === 0) {
      goals.push('Assist with development tasks');
    }

    const suggestedAgents: Record<string, AgentOverride> = {};
    for (const agent of availableAgents) {
      suggestedAgents[agent.id] = { enabled: true };
    }
    if (Object.keys(suggestedAgents).length === 0) {
      suggestedAgents['ptah-cli'] = { enabled: true };
    }

    const description =
      firstSentence.length > 200
        ? firstSentence.substring(0, 200) + '...'
        : firstSentence;

    const suggestedPrompt = `You are a coding assistant. The user described their needs as: "${description}". Help them accomplish their goals effectively.`;

    return {
      persona: {
        label,
        description,
        goals,
      },
      suggestedAgents,
      suggestedSubagents: [],
      suggestedSkills: availableSkills.map((s) => s.id),
      suggestedSkillSpecs: [],
      suggestedPrompt,
      suggestedMcpServers: [],
      summary: 'Basic configuration generated (AI analysis unavailable)',
      reasoning:
        'AI-powered intent analysis was unavailable. A basic configuration has been generated using heuristics. You can refine each section in the subsequent wizard steps.',
    };
  }

  private async suggestMcpServersFromRegistry(
    keywords: string[],
  ): Promise<McpServerSuggestion[]> {
    if (keywords.length === 0) return [];

    const searchResults = await Promise.allSettled(
      keywords.slice(0, 6).map(async (keyword) => {
        const result = await this.registryProvider.listServers({
          query: keyword,
          limit: 3,
        });
        return { keyword, servers: result.servers };
      }),
    );

    const seen = new Set<string>();
    const suggestions: McpServerSuggestion[] = [];

    for (const outcome of searchResults) {
      if (outcome.status !== 'fulfilled') continue;

      const { keyword, servers } = outcome.value;
      for (const server of servers) {
        if (seen.has(server.name)) continue;
        seen.add(server.name);

        const displayName =
          server.name?.split('/').pop() || server.name || 'Unknown Server';

        suggestions.push({
          query: server.name,
          displayName,
          reason:
            server.description || `Matched your persona keyword "${keyword}"`,
        });
      }
    }

    return suggestions.slice(0, 8);
  }

  private extractSearchableKeywords(text: string): string[] {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'from',
      'your',
      'have',
      'are',
      'was',
      'will',
      'can',
      'want',
      'need',
      'work',
      'help',
      'use',
      'like',
      'also',
      'make',
      'get',
      'set',
      'new',
      'all',
      'any',
      'but',
      'not',
      'our',
      'out',
      'who',
      'how',
      'its',
      'may',
      'more',
      'most',
      'been',
      'such',
      'than',
      'them',
      'then',
      'some',
      'into',
      'over',
      'just',
      'about',
      'would',
      'could',
      'should',
      'being',
      'other',
      'each',
      'which',
      'their',
      'there',
      'developer',
      'engineer',
      'architect',
      'designer',
      'manager',
      'lead',
      'senior',
      'junior',
      'mid',
      'level',
      'full',
      'stack',
      'fullstack',
      'full-stack',
      'software',
      'coding',
      'programming',
      'building',
      'working',
      'projects',
      'applications',
      'systems',
      'team',
      'role',
      'goal',
      'goals',
      'experience',
      'focus',
      'responsible',
      'creating',
      'developing',
      'using',
      'tools',
      'looking',
      'assist',
      'tasks',
      'write',
      'code',
    ]);

    return text
      .split(/[\s,./;:!?()[\]{}]+/)
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 3 && !stopWords.has(w))
      .filter((w, i, arr) => arr.indexOf(w) === i);
  }

  // ── LLM-backed intent analysis ───────────────────────────

  private async analyzeIntentViaAgent(
    input: string,
    availableSkills: SkillSummary[],
    availableAgents: AvailableAgent[],
    workspaceContext?: HarnessAnalyzeIntentParams['workspaceContext'],
  ): Promise<HarnessAnalyzeIntentResponse> {
    const workspaceRoot = this.workspaceContext.requireWorkspaceRoot();

    const { postProcessed } =
      await this.llmRunner.run<HarnessAnalyzeIntentResponse>({
        operation: 'analyze-intent',
        serviceTag: '[HarnessAnalyzeIntent]',
        timeoutMs: 150_000,
        execute: {
          cwd: workspaceRoot,
          model:
            this.modelSettings.selectedModel.get() || DEFAULT_FALLBACK_MODEL_ID,
          prompt: buildIntentAnalysisPrompt({
            input,
            availableAgents,
            availableSkills,
            workspaceContext,
          }),
          systemPromptAppend: INTENT_ANALYSIS_SYSTEM_PROMPT_APPEND,
          isPremium: true,
          mcpServerRunning: true,
          maxTurns: 10,
          outputFormat: {
            type: 'json_schema',
            schema: INTENT_ANALYSIS_OUTPUT_SCHEMA,
          },
        },
        postProcess: async (structuredOutput) => {
          const output = structuredOutput as LlmIntentAnalysisOutput | null;

          if (!output?.persona || !output?.systemPrompt) {
            throw new Error('LLM did not return a valid intent analysis');
          }

          const validAgentIds = new Set(availableAgents.map((a) => a.id));
          const suggestedAgents: Record<string, AgentOverride> = {};
          for (const agentId of output.selectedAgentIds ?? []) {
            if (validAgentIds.has(agentId)) {
              suggestedAgents[agentId] = { enabled: true };
            }
          }
          if (Object.keys(suggestedAgents).length === 0) {
            suggestedAgents['ptah-cli'] = { enabled: true };
          }

          const suggestedSubagents: HarnessSubagentDefinition[] = (
            output.subagents ?? []
          )
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

          const validSkillIds = new Set(availableSkills.map((s) => s.id));
          const suggestedSkills = (output.selectedSkillIds ?? []).filter((id) =>
            validSkillIds.has(id),
          );

          const suggestedSkillSpecs: GeneratedSkillSpec[] = (
            output.skillSpecs ?? []
          )
            .filter((s) => s.name && s.content)
            .map((s) => ({
              name: s.name,
              description: s.description || '',
              content: s.content,
              requiredTools: Array.isArray(s.requiredTools)
                ? s.requiredTools
                : undefined,
              reasoning: s.reasoning || '',
            }));

          let suggestedMcpServers: McpServerSuggestion[] = [];
          try {
            suggestedMcpServers = await this.suggestMcpServersFromRegistry(
              output.mcpSearchTerms ?? [],
            );
          } catch (mcpError) {
            this.logger.warn(
              'MCP registry search failed during intent analysis, continuing without MCP suggestions',
              {
                error:
                  mcpError instanceof Error
                    ? mcpError.message
                    : String(mcpError),
              },
            );
          }

          return {
            persona: {
              label: output.persona.label || 'Custom Persona',
              description: output.persona.description || '',
              goals: Array.isArray(output.persona.goals)
                ? output.persona.goals
                : [],
            },
            suggestedAgents,
            suggestedSubagents,
            suggestedSkills,
            suggestedSkillSpecs,
            suggestedPrompt: output.systemPrompt,
            suggestedMcpServers,
            summary:
              output.summary ||
              'Harness configuration generated from your input.',
            reasoning: output.reasoning || '',
          };
        },
      });

    return postProcessed as HarnessAnalyzeIntentResponse;
  }
}
