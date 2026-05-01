/**
 * HarnessChatService — Wave C7d.
 *
 * LLM-powered conversational surfaces for the harness wizard:
 *   - `buildIntelligentChatReply` → step-aware chat reply with suggested
 *     click-to-apply actions (`harness:chat`).
 *   - `converseWithUser` → freeform back-and-forth that produces partial
 *     HarnessConfig updates (`harness:converse`).
 *
 * Both methods delegate the streaming LLM call to {@link HarnessLlmRunner}.
 *
 * Extracted from `harness-rpc.handlers.ts` (lines 2404–2654 + the body of
 * `registerConverse`, lines 3583–3789).
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import { DEFAULT_FALLBACK_MODEL_ID } from '@ptah-extension/agent-sdk';
import type {
  HarnessChatAction,
  HarnessChatResponse,
  HarnessConfig,
  HarnessConverseParams,
  HarnessConverseResponse,
  HarnessWizardStep,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../tokens';
import { HarnessWorkspaceContextService } from '../workspace/harness-workspace-context.service';
import { HarnessLlmRunner } from './harness-llm-runner.service';

/** Structured output shape from the chat LLM call */
interface LlmChatOutput {
  reply: string;
  suggestedActions?: Array<{
    type: string;
    label: string;
    payload: Record<string, unknown>;
  }>;
}

/** Structured output shape from the converse LLM call */
interface LlmConverseOutput {
  reply: string;
  configUpdates?: Partial<HarnessConfig>;
  isConfigComplete?: boolean;
}

@injectable()
export class HarnessChatService {
  constructor(
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(HARNESS_TOKENS.WORKSPACE_CONTEXT)
    private readonly workspaceContext: HarnessWorkspaceContextService,
    @inject(HARNESS_TOKENS.LLM_RUNNER)
    private readonly llmRunner: HarnessLlmRunner,
  ) {}

  // ─── Step-Aware Chat Reply ────────────────────────────

  /**
   * Build an intelligent chat reply for the current wizard step, with
   * optional click-to-apply actions (toggle-agent, add-skill, etc.).
   *
   * Falls back to a static step guidance string when the LLM does not
   * produce a structured reply.
   */
  async buildIntelligentChatReply(
    step: HarnessWizardStep,
    message: string,
    context: Partial<HarnessConfig>,
  ): Promise<HarnessChatResponse> {
    const workspaceRoot = this.workspaceContext.requireWorkspaceRoot();

    const stepContext = this.buildStepContextSummary(step, context);

    const prompt = `You are an AI harness architect collaborating with a user to build their perfect AI coding assistant configuration. You're helping them in the "${step}" step of a 6-step wizard (Persona → Agents → Skills → Prompts → MCP → Review).

## Current Configuration State
${stepContext}

## User's Message
${message}

## Your Role
You are a collaborative partner, not just an advisor. Based on the current step and their message:

**Persona step**: Help them articulate their role, workflow, and goals. Ask clarifying questions. Suggest goals they might not have considered. If they describe a complex workflow, suggest breaking it into subagent roles.

**Agents step**: Help them design their agent architecture. Go beyond the 4 CLI agents — suggest custom subagent roles with specific responsibilities, tools, and execution modes. Think like the PRD example: "Sentiment Watchdog", "Lead Router", "Market Intelligence Scout".

**Skills step**: Help them design specialized skills. Each skill should be a specific capability — like "podcast-transcript-analyzer", "vibe-mimic-writing", "intent-scorer". Suggest skills that would automate their repetitive workflows.

**Prompts step**: Help refine the system prompt. Include voice/tone guidelines, approval gates, security guardrails, and workflow-specific instructions.

**MCP step**: Recommend MCP servers based on their actual workflow needs. Explain what each server provides and why it's relevant.

**Review step**: Help them evaluate completeness. Identify gaps. Suggest improvements. Offer to generate a comprehensive requirements document.

## Response Format
Return a JSON object with:
- "reply": Your markdown-formatted response (be conversational but specific, include concrete suggestions)
- "suggestedActions": Optional array of actions the user can apply with one click. Each action has:
  - "type": One of "toggle-agent", "add-skill", "update-prompt", "add-mcp-server", "add-subagent", "create-skill"
  - "label": Short button text (e.g., "Add Sentiment Watchdog agent")
  - "payload": Data for the action (agent details, skill content, etc.)

Keep suggestedActions to 2-4 maximum. Only suggest actions that are directly relevant to the user's message.`;

    const outputSchema = {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Markdown-formatted response' },
        suggestedActions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              label: { type: 'string' },
              payload: { type: 'object' },
            },
            required: ['type', 'label', 'payload'],
          },
          description: 'Optional clickable actions',
        },
      },
      required: ['reply'],
      additionalProperties: false,
    };

    const { postProcessed } = await this.llmRunner.run<HarnessChatResponse>({
      operation: 'chat',
      serviceTag: '[HarnessChat]',
      timeoutMs: 30_000,
      execute: {
        cwd: workspaceRoot,
        model:
          this.configManager.get<string>('model.selected') ||
          DEFAULT_FALLBACK_MODEL_ID,
        prompt,
        systemPromptAppend:
          "You are a harness architect. Be specific, practical, and collaborative. Always suggest concrete next steps. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace. Actively search for and recommend relevant skills and MCP servers beyond what the user explicitly asked for. After using tools, return valid JSON matching the schema.",
        isPremium: true,
        mcpServerRunning: true,
        maxTurns: 10,
        outputFormat: { type: 'json_schema', schema: outputSchema },
      },
      postProcess: (structuredOutput) => {
        const output = structuredOutput as LlmChatOutput | null;

        if (!output?.reply) {
          return { reply: this.buildChatReplyFallback(step, message) };
        }

        // Validate and filter suggested actions to valid types
        const validTypes = new Set([
          'toggle-agent',
          'add-skill',
          'update-prompt',
          'add-mcp-server',
          'add-subagent',
          'create-skill',
        ]);

        const suggestedActions: HarnessChatAction[] = (
          output.suggestedActions ?? []
        )
          .filter((a) => validTypes.has(a.type))
          .map((a) => ({
            type: a.type as HarnessChatAction['type'],
            label: a.label,
            payload: a.payload ?? {},
          }));

        return {
          reply: output.reply,
          suggestedActions:
            suggestedActions.length > 0 ? suggestedActions : undefined,
        };
      },
    });

    return postProcessed as HarnessChatResponse;
  }

  /**
   * Build a summary of the current step's state for AI context.
   */
  private buildStepContextSummary(
    step: HarnessWizardStep,
    context: Partial<HarnessConfig>,
  ): string {
    const parts: string[] = [];

    if (context.persona) {
      parts.push(
        `**Persona**: "${context.persona.label}" — ${context.persona.description}`,
      );
      if (context.persona.goals.length > 0) {
        parts.push(`**Goals**: ${context.persona.goals.join(', ')}`);
      }
    }

    if (context.agents?.enabledAgents) {
      const enabled = Object.entries(context.agents.enabledAgents)
        .filter(([, v]) => v.enabled)
        .map(([k]) => k);
      if (enabled.length > 0) {
        parts.push(`**Enabled Agents**: ${enabled.join(', ')}`);
      }
    }

    if (
      context.agents?.harnessSubagents &&
      context.agents.harnessSubagents.length > 0
    ) {
      const subagents = context.agents.harnessSubagents.map(
        (s) => `${s.name} (${s.executionMode})`,
      );
      parts.push(`**Harness Subagents**: ${subagents.join(', ')}`);
    }

    if (
      context.skills?.selectedSkills &&
      context.skills.selectedSkills.length > 0
    ) {
      parts.push(
        `**Selected Skills**: ${context.skills.selectedSkills.join(', ')}`,
      );
    }

    if (context.prompt?.systemPrompt) {
      parts.push(
        `**System Prompt**: ${context.prompt.systemPrompt.slice(0, 200)}...`,
      );
    }

    if (context.mcp?.servers && context.mcp.servers.length > 0) {
      const servers = context.mcp.servers
        .filter((s) => s.enabled)
        .map((s) => s.name);
      parts.push(`**MCP Servers**: ${servers.join(', ')}`);
    }

    parts.push(`**Current Step**: ${step}`);

    return parts.length > 0 ? parts.join('\n') : '(No configuration yet)';
  }

  /**
   * Fallback chat reply when the LLM is unavailable.
   *
   * Public so the `harness:chat` RPC handler can use it as a last-resort
   * payload when `buildIntelligentChatReply` throws (the webview relies on
   * a non-error response to keep the conversation alive).
   */
  buildChatReplyFallback(step: HarnessWizardStep, _message: string): string {
    const stepGuidance: Record<HarnessWizardStep, string> = {
      persona:
        "Describe your role, workflow, and goals. I'll help you design a custom agent fleet with specialized subagents, skills, and tools tailored to your work. The more detail you provide, the better the harness I can help you build.",
      agents:
        'Beyond the CLI agents, I can help you design **custom subagents** — specialized agents with distinct roles, tools, and trigger conditions. Click "Design Agent Fleet" to have AI architect your subagent team, or describe the kind of agents you need.',
      skills:
        'I can help you create **specialized skills** — markdown instruction sets that give your agents domain expertise. Click "Generate Skills" to have AI design skills for your workflow, or describe what capabilities you need.',
      prompts:
        'I can help refine your system prompt with voice/tone guidelines, approval gates, security guardrails, and workflow-specific instructions. Describe how you want your agents to behave.',
      mcp: 'I can help you find and configure MCP servers that match your workflow. Describe the tools and integrations you need.',
      review:
        'Your configuration is ready for review. I can generate a comprehensive requirements document from your harness. Click "Generate Document" to produce a full PRD.',
    };

    return stepGuidance[step] ?? 'How can I help you build your harness?';
  }

  // ─── Conversational Config Builder ────────────────────

  /**
   * Freeform conversation that yields `{ reply, configUpdates?, isConfigComplete? }`
   * — the LLM acts as a harness architect, proposing partial configuration
   * updates that the webview merges into the live draft.
   */
  async converseWithUser(
    params: HarnessConverseParams,
  ): Promise<HarnessConverseResponse> {
    const { message, history, config, workspaceContext } = params;

    const workspaceRoot = this.workspaceContext.requireWorkspaceRoot();

    const availableAgents = this.workspaceContext.getAvailableAgents();
    const availableSkills = this.workspaceContext.discoverAvailableSkills();

    const agentList = availableAgents
      .map(
        (a) =>
          `- ${a.id}: ${a.name} (${a.type}, ${a.available ? 'available' : 'unavailable'})`,
      )
      .join('\n');

    const skillList = availableSkills
      .map((s) => `- ${s.id}: ${s.name} — ${s.description}`)
      .join('\n');

    const contextBlock = workspaceContext
      ? `Project: ${workspaceContext.projectName} (${workspaceContext.projectType})\nFrameworks: ${workspaceContext.frameworks.join(', ')}\nLanguages: ${workspaceContext.languages.join(', ')}`
      : 'No workspace context available.';

    const historyBlock =
      history.length > 0
        ? history
            .map(
              (m) =>
                `**${m.role === 'user' ? 'User' : 'Assistant'}**: ${m.content}`,
            )
            .join('\n\n')
        : '(No prior messages — this is the start of the conversation.)';

    const prompt = `You are a harness architect having a conversation with a user to build their AI coding assistant configuration.

## Conversation History
${historyBlock}

## Current Configuration
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## Available Agents
${agentList}

## Available Skills
${skillList}

## Workspace
${contextBlock}

## User's Message
${message}

## Instructions
Respond conversationally. Ask clarifying questions when the user's intent is unclear.
When you understand what the user needs, include configUpdates with the changes.
configUpdates is a partial HarnessConfig — only include fields you want to change.
Set isConfigComplete to true when you believe the configuration is ready to apply.
Be proactive: suggest agents, skills, subagents, system prompts, and MCP servers.
If this is the first message, analyze the user's intent and propose a complete initial configuration.`;

    const outputSchema = {
      type: 'object' as const,
      properties: {
        reply: {
          type: 'string',
          description: 'Conversational reply to the user',
        },
        configUpdates: {
          type: 'object',
          description: 'Partial HarnessConfig updates to merge',
          properties: {
            persona: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
                goals: { type: 'array', items: { type: 'string' } },
              },
            },
            agents: {
              type: 'object',
              properties: {
                enabledAgents: { type: 'object' },
                harnessSubagents: { type: 'array' },
              },
            },
            skills: {
              type: 'object',
              properties: {
                selectedSkills: {
                  type: 'array',
                  items: { type: 'string' },
                },
                createdSkills: { type: 'array' },
              },
            },
            prompt: {
              type: 'object',
              properties: {
                systemPrompt: { type: 'string' },
                enhancedSections: { type: 'object' },
              },
            },
            mcp: {
              type: 'object',
              properties: {
                servers: { type: 'array' },
                enabledTools: { type: 'object' },
              },
            },
          },
        },
        isConfigComplete: { type: 'boolean' },
      },
      required: ['reply'],
      additionalProperties: false,
    };

    const { postProcessed } = await this.llmRunner.run<HarnessConverseResponse>(
      {
        operation: 'converse',
        serviceTag: '[HarnessConverse]',
        timeoutMs: 300_000,
        execute: {
          cwd: workspaceRoot,
          model:
            this.configManager.get<string>('model.selected') ||
            DEFAULT_FALLBACK_MODEL_ID,
          prompt,
          systemPromptAppend:
            "You are a harness architect. Be conversational, specific, and proactive. Propose complete configurations when you have enough context. Ask clarifying questions when you need more information. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace, createSkill(name, description, content, allowedTools?) to create custom skills. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.",
          isPremium: true,
          mcpServerRunning: true,
          maxTurns: 8,
          outputFormat: { type: 'json_schema', schema: outputSchema },
        },
        postProcess: (structuredOutput) => {
          const output = structuredOutput as LlmConverseOutput | null;
          return {
            reply:
              output?.reply ??
              'I understand. Could you tell me more about what you want to build?',
            configUpdates: output?.configUpdates,
            isConfigComplete: output?.isConfigComplete,
          };
        },
      },
    );

    return postProcessed as HarnessConverseResponse;
  }
}
