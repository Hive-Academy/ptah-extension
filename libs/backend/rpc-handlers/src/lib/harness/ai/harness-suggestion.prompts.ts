/**
 * Prompt templates and JSON output schemas for {@link HarnessSuggestionService}.
 *
 * Extracted to keep `harness-suggestion.service.ts` below the 600-LOC review
 * threshold. The strings/objects here are intentionally export-only (no class)
 * so they can be tree-shaken and unit-tested in isolation.
 *
 * Wave C7d follow-up — content is byte-identical to the inlined originals.
 */

import type {
  AvailableAgent,
  HarnessAnalyzeIntentParams,
  SkillSummary,
} from '@ptah-extension/shared';

const formatAgentList = (agents: AvailableAgent[]): string =>
  agents
    .map(
      (a) =>
        `- id: "${a.id}" | name: "${a.name}" | type: ${a.type} | description: ${a.description}`,
    )
    .join('\n');

const formatSkillList = (skills: SkillSummary[]): string =>
  skills
    .slice(0, 50)
    .map(
      (s) =>
        `- id: "${s.id}" | name: "${s.name}" | description: ${s.description}`,
    )
    .join('\n');

/**
 * Build the persona-driven suggestion prompt forwarded to the LLM.
 */
export function buildSuggestionPrompt(args: {
  description: string;
  goals: string[];
  availableAgents: AvailableAgent[];
  availableSkills: SkillSummary[];
}): string {
  const { description, goals, availableAgents, availableSkills } = args;
  const agentList = formatAgentList(availableAgents);
  const skillList = formatSkillList(availableSkills);

  return `You are configuring an AI coding assistant harness for a user. Analyze their persona and select the most appropriate configuration.

## User Persona
**Description:** ${description}
**Goals:** ${goals.length > 0 ? goals.join(', ') : 'General development assistance'}

## Available Agents
These are the CLI/subagent tools the user can enable:
${agentList}

## Available Skills
These are plugin skills that can be activated:
${skillList || '(no skills available)'}

## Your Task
Based on the persona description and goals, return a JSON object with:

1. **selectedAgentIds**: Array of agent IDs to enable. Pick agents whose capabilities best match the persona's workflow. Enable at least 1 agent.
2. **selectedSkillIds**: Array of skill IDs to activate. Pick skills whose descriptions match the persona's needs. Can be empty if no skills are relevant.
3. **mcpSearchTerms**: Array of 3-6 specific technology keywords to search the MCP Server Registry for relevant tools (e.g., "github", "postgresql", "docker", "playwright"). These should be concrete technology names, not generic terms.
4. **systemPrompt**: A concise system prompt (2-4 sentences) tailored to this persona that instructs the AI assistant on how to behave.
5. **reasoning**: A brief explanation (2-3 sentences) of why you chose these specific agents, skills, and tools for this persona.

Return ONLY the JSON object matching the schema.`;
}

/** JSON schema for the suggestion output structure. */
export const SUGGESTION_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    selectedAgentIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Agent IDs to enable',
    },
    selectedSkillIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Skill IDs to activate',
    },
    mcpSearchTerms: {
      type: 'array',
      items: { type: 'string' },
      description: 'Technology keywords for MCP Registry search',
    },
    systemPrompt: {
      type: 'string',
      description: 'Tailored system prompt for the persona',
    },
    reasoning: {
      type: 'string',
      description: 'Explanation of the suggestions',
    },
  },
  required: [
    'selectedAgentIds',
    'selectedSkillIds',
    'mcpSearchTerms',
    'systemPrompt',
    'reasoning',
  ],
  additionalProperties: false,
} as const;

/** System prompt appended to the persona-suggestion LLM call. */
export const SUGGESTION_SYSTEM_PROMPT_APPEND =
  "You are a configuration advisor. Analyze the user persona and select the best agents, skills, and tools. Be specific and practical in your choices. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.";

/**
 * Build the freeform-intent analysis prompt forwarded to the LLM.
 */
export function buildIntentAnalysisPrompt(args: {
  input: string;
  availableAgents: AvailableAgent[];
  availableSkills: SkillSummary[];
  workspaceContext?: HarnessAnalyzeIntentParams['workspaceContext'];
}): string {
  const { input, availableAgents, availableSkills, workspaceContext } = args;
  const agentList = formatAgentList(availableAgents);
  const skillList = formatSkillList(availableSkills);
  const contextInfo = workspaceContext
    ? `\n## Workspace Context\n- Project: ${workspaceContext.projectName}\n- Type: ${workspaceContext.projectType}\n- Frameworks: ${workspaceContext.frameworks.join(', ') || 'none detected'}\n- Languages: ${workspaceContext.languages.join(', ') || 'none detected'}`
    : '';

  return `You are an AI harness architect. The user has provided freeform input describing what they want to build. Your job is to analyze this input — whether it's a PRD document, a simple instruction, or a detailed description — and architect a COMPLETE harness configuration.

## User Input
${input}
${contextInfo}

## Available CLI Agents
${agentList}

## Available Skills
${skillList || '(no skills available)'}

## Your Task
Analyze the user's input and generate a comprehensive harness blueprint. You must figure out:

1. **persona**: The user's role/persona derived from their input
   - **label**: Short role name (e.g., "Real Estate Marketing Lead", "Full-Stack Developer")
   - **description**: Detailed description of the persona and workflow (2-4 sentences)
   - **goals**: Array of 3-6 specific goals extracted from the input

2. **selectedAgentIds**: Which CLI agents to enable from the available list

3. **subagents**: Design 2-5 custom subagents tailored to the input. Each subagent should be:
   - Specialized with one clear responsibility
   - Have specific tools and triggers
   - Complement other subagents in the fleet
   Include: id (kebab-case), name, description, role, tools[], executionMode (background/on-demand/scheduled), triggers[], instructions

4. **selectedSkillIds**: Which existing skills to activate (from the available list)

5. **skillSpecs**: Design 1-3 NEW skills that don't exist yet. Each needs:
   - name (kebab-case), description, content (complete SKILL.md markdown), requiredTools[], reasoning

6. **systemPrompt**: A comprehensive system prompt (4-8 sentences) tailored to the user's needs

7. **mcpSearchTerms**: Array of 3-6 technology keywords for MCP server discovery (concrete tech names like "github", "postgresql", "slack")

8. **summary**: A 1-2 sentence summary of what you understood from the input and what you've architected

9. **reasoning**: Detailed explanation (3-5 sentences) of your design decisions

Be creative and thorough. If the input is a PRD, extract everything. If it's a simple instruction, infer intelligently. Return ONLY the JSON object matching the schema.`;
}

/** JSON schema for the intent-analysis output structure. */
export const INTENT_ANALYSIS_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    persona: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        description: { type: 'string' },
        goals: { type: 'array', items: { type: 'string' } },
      },
      required: ['label', 'description', 'goals'],
    },
    selectedAgentIds: {
      type: 'array',
      items: { type: 'string' },
    },
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
    selectedSkillIds: {
      type: 'array',
      items: { type: 'string' },
    },
    skillSpecs: {
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
    systemPrompt: { type: 'string' },
    mcpSearchTerms: {
      type: 'array',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: [
    'persona',
    'selectedAgentIds',
    'subagents',
    'selectedSkillIds',
    'skillSpecs',
    'systemPrompt',
    'mcpSearchTerms',
    'summary',
    'reasoning',
  ],
  additionalProperties: false,
} as const;

/** System prompt appended to the intent-analysis LLM call. */
export const INTENT_ANALYSIS_SYSTEM_PROMPT_APPEND =
  "You are a harness architect. Analyze the user's freeform input and design a complete AI coding harness. Be creative but practical. Extract maximum value from whatever input format the user provides — PRD, instruction, or description. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace, createSkill(name, description, content, allowedTools?) to create custom skills. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.";
