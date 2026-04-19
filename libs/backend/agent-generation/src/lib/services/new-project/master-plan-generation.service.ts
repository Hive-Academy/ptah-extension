/**
 * MasterPlanGenerationService - LLM-powered project plan generation
 *
 * Uses InternalQueryService (agent-sdk) to generate a structured MasterPlan
 * from user-provided project type and discovery answers. The LLM produces
 * a JSON plan with phases, tasks, architecture decisions, and directory structure.
 *
 * Follows the same InternalQueryService consumption pattern as MultiPhaseAnalysisService.
 *
 * @module @ptah-extension/agent-generation
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { InternalQueryService } from '@ptah-extension/agent-sdk';
import type {
  MasterPlan,
  NewProjectType,
  DiscoveryAnswers,
  AnswerValue,
} from '@ptah-extension/shared';

// ============================================================================
// Constants
// ============================================================================

const SERVICE_TAG = '[MasterPlanGeneration]';
const MAX_TURNS = 5;
const DEFAULT_MODEL = 'default';
const VALID_AGENT_TYPES = [
  'backend-developer',
  'frontend-developer',
  'devops-engineer',
  'software-architect',
];

// ============================================================================
// Service
// ============================================================================

@injectable()
export class MasterPlanGenerationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
  ) {}

  /**
   * Generate a MasterPlan from the user's project type and discovery answers.
   *
   * Builds a detailed LLM prompt, executes it via InternalQueryService,
   * and parses the JSON response into a MasterPlan.
   *
   * @param projectType - The selected project type (e.g., 'full-saas', 'nestjs-api')
   * @param answers - All user answers from the discovery questionnaire
   * @param projectName - Extracted or user-provided project name
   * @returns A structured MasterPlan ready for persistence
   * @throws Error if the LLM fails to produce valid JSON or the plan is malformed
   */
  async generatePlan(
    projectType: NewProjectType,
    answers: DiscoveryAnswers,
    projectName: string,
    workspacePath: string,
  ): Promise<MasterPlan> {
    const prompt = this.buildPrompt(projectType, answers, projectName);

    this.logger.info(`${SERVICE_TAG} Generating master plan`, {
      projectType,
      projectName,
      answerCount: Object.keys(answers).length,
      promptLength: prompt.length,
    });

    const responseText = await this.executeLlmQuery(prompt, workspacePath);

    this.logger.info(`${SERVICE_TAG} LLM response received`, {
      responseLength: responseText.length,
    });

    const plan = this.parsePlanFromResponse(responseText);

    this.logger.info(`${SERVICE_TAG} Master plan generated successfully`, {
      projectName: plan.projectName,
      phaseCount: plan.phases.length,
      totalTasks: plan.phases.reduce((sum, p) => sum + p.tasks.length, 0),
      techStackSize: plan.techStack.length,
      architectureDecisionCount: plan.architectureDecisions.length,
    });

    return plan;
  }

  // ==========================================================================
  // Private - LLM Execution
  // ==========================================================================

  /**
   * Execute the LLM query via InternalQueryService and extract the result text.
   *
   * Follows the same stream consumption pattern as MultiPhaseAnalysisService:
   * iterate the stream, capture text from 'result' messages with subtype 'success'.
   */
  private async executeLlmQuery(
    prompt: string,
    workspacePath: string,
  ): Promise<string> {
    const handle = await this.internalQueryService.execute({
      cwd: workspacePath,
      model: DEFAULT_MODEL,
      prompt,
      systemPromptAppend: this.buildSystemPrompt(),
      isPremium: false,
      mcpServerRunning: false,
      maxTurns: MAX_TURNS,
    });

    try {
      let resultText: string | null = null;
      const textChunks: string[] = [];

      for await (const message of handle.stream) {
        // Capture text from result messages (same pattern as MultiPhaseAnalysisService)
        if (
          message.type === 'result' &&
          message.subtype === 'success' &&
          'result' in message &&
          typeof (message as { result?: string }).result === 'string'
        ) {
          resultText = (message as { result: string }).result;
        }

        // Also accumulate text from assistant messages as fallback
        if (
          message.type === 'assistant' &&
          'content' in message &&
          Array.isArray((message as { content?: unknown[] }).content)
        ) {
          for (const block of (
            message as { content: Array<{ type: string; text?: string }> }
          ).content) {
            if (block.type === 'text' && block.text) {
              textChunks.push(block.text);
            }
          }
        }
      }

      const finalText =
        resultText ?? (textChunks.length > 0 ? textChunks.join('') : null);

      if (!finalText) {
        throw new Error(`${SERVICE_TAG} LLM query returned no text content`);
      }

      return finalText;
    } finally {
      handle.close();
    }
  }

  // ==========================================================================
  // Private - Prompt Building
  // ==========================================================================

  /**
   * Build the system prompt that instructs the LLM how to respond.
   */
  private buildSystemPrompt(): string {
    return `You are a senior software architect generating a structured project plan.

You MUST respond with ONLY a valid JSON object matching the MasterPlan schema below. Do NOT wrap the JSON in markdown code fences. Do NOT include any text before or after the JSON.

MasterPlan JSON Schema:
{
  "projectName": "string - the project name",
  "projectType": "string - one of: full-saas, nestjs-api, angular-app, react-app",
  "techStack": ["string[] - list of technologies used"],
  "architectureDecisions": [
    {
      "area": "string - decision area (e.g., 'State Management', 'Database', 'Authentication')",
      "decision": "string - what was decided",
      "rationale": "string - why this decision was made"
    }
  ],
  "directoryStructure": "string - ASCII tree of the project directory structure",
  "phases": [
    {
      "id": "string - unique phase ID (e.g., 'phase-1-foundation')",
      "name": "string - human-readable phase name",
      "description": "string - what this phase accomplishes",
      "tasks": [
        {
          "id": "string - unique task ID",
          "title": "string - short task title",
          "description": "string - detailed task description",
          "agentType": "string - one of: backend-developer, frontend-developer, devops-engineer, software-architect",
          "filePaths": ["string[] - files this task creates or modifies"]
        }
      ],
      "dependsOn": ["string[] - IDs of phases that must complete first (empty array for first phase)"]
    }
  ],
  "summary": "string - executive summary of the entire project plan"
}`;
  }

  /**
   * Build the user prompt with all project context and user answers.
   */
  private buildPrompt(
    type: NewProjectType,
    answers: DiscoveryAnswers,
    name: string,
  ): string {
    const answersDescription = this.formatAnswersForPrompt(answers);

    return `Generate a comprehensive project master plan for the following project:

## Project Information
- **Project Name:** ${name}
- **Project Type:** ${type}

## User Requirements
${answersDescription}

## Instructions

Create a detailed, production-ready project plan following these guidelines:

1. **Phases** should be logically ordered: foundation/setup first, then core features, then polish/deployment.
   - Each phase should have a unique ID in the format "phase-N-short-description".
   - The first phase should have an empty dependsOn array.
   - Later phases should reference the IDs of phases they depend on.

2. **Tasks** within each phase should have clear, actionable descriptions.
   - Assign the most appropriate agentType for each task:
     - "software-architect" for initial setup, configuration, and architectural scaffolding
     - "backend-developer" for API endpoints, database schemas, services, and server logic
     - "frontend-developer" for UI components, pages, state management, and client logic
     - "devops-engineer" for Docker, CI/CD, deployment configs, and infrastructure
   - Include specific filePaths that each task will create or modify.

3. **Architecture Decisions** should cover at minimum:
   - Project structure and organization
   - State management approach
   - API communication pattern
   - Authentication strategy (if applicable)
   - Database and ORM choice (if applicable)
   - Testing strategy
   - Deployment approach

4. **Directory Structure** should follow the conventions of the chosen framework(s).
   Use an ASCII tree format showing the main folders and key files.

5. **Tech Stack** should list all specific technologies, frameworks, and libraries that will be used.

6. **Summary** should be a concise paragraph explaining the overall architecture and implementation approach.

Respond with the JSON object only.`;
  }

  /**
   * Format all user answers into a human-readable description for the LLM prompt.
   */
  private formatAnswersForPrompt(answers: DiscoveryAnswers): string {
    const lines: string[] = [];

    for (const [questionId, answer] of Object.entries(answers)) {
      const formattedAnswer = this.formatAnswerValue(answer);
      const label = questionId
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      lines.push(`- **${label}:** ${formattedAnswer}`);
    }

    return lines.length > 0
      ? lines.join('\n')
      : '(No specific requirements provided)';
  }

  /**
   * Format a single answer value for display in the prompt.
   */
  private formatAnswerValue(value: AnswerValue): string {
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    return String(value);
  }

  // ==========================================================================
  // Private - Response Parsing
  // ==========================================================================

  /**
   * Parse the LLM response text into a MasterPlan.
   *
   * Handles responses that may be wrapped in markdown code fences (```json ... ```)
   * or contain leading/trailing whitespace.
   *
   * @throws Error if the response cannot be parsed as valid JSON or is missing required fields
   */
  private parsePlanFromResponse(responseText: string): MasterPlan {
    const jsonText = this.extractJsonFromResponse(responseText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      this.logger.error(`${SERVICE_TAG} Failed to parse LLM response as JSON`, {
        responseLength: responseText.length,
        firstChars: responseText.substring(0, 200),
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw new Error(
        `Failed to parse master plan from LLM response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
    }

    this.validatePlanStructure(parsed);
    return parsed as MasterPlan;
  }

  /**
   * Extract JSON content from a response that may be wrapped in markdown code fences.
   */
  private extractJsonFromResponse(responseText: string): string {
    let text = responseText.trim();

    // Try to extract from ```json ... ``` blocks
    const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonBlockMatch) {
      text = jsonBlockMatch[1].trim();
    }

    // Try to find the outermost JSON object if there's surrounding text
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1);
    }

    return text;
  }

  /**
   * Validate that the parsed object has the required MasterPlan structure.
   *
   * @throws Error if required fields are missing or have wrong types
   */
  private validatePlanStructure(parsed: unknown): void {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Parsed plan is not an object');
    }

    const plan = parsed as Record<string, unknown>;

    const requiredStringFields = [
      'projectName',
      'projectType',
      'directoryStructure',
      'summary',
    ];
    for (const field of requiredStringFields) {
      if (
        typeof plan[field] !== 'string' ||
        (plan[field] as string).trim().length === 0
      ) {
        throw new Error(
          `Master plan is missing required string field: ${field}`,
        );
      }
    }

    if (!Array.isArray(plan['techStack'])) {
      throw new Error('Master plan is missing required array field: techStack');
    }

    if (!Array.isArray(plan['architectureDecisions'])) {
      throw new Error(
        'Master plan is missing required array field: architectureDecisions',
      );
    }

    if (
      !Array.isArray(plan['phases']) ||
      (plan['phases'] as unknown[]).length === 0
    ) {
      throw new Error('Master plan must have at least one phase');
    }

    // Validate each phase has required fields
    for (const phase of plan['phases'] as Array<Record<string, unknown>>) {
      if (!phase['id'] || !phase['name'] || !Array.isArray(phase['tasks'])) {
        throw new Error(
          `Phase is missing required fields (id, name, tasks): ${JSON.stringify(phase).substring(0, 100)}`,
        );
      }

      if (!Array.isArray(phase['dependsOn'])) {
        // Auto-fix: default to empty array if missing
        phase['dependsOn'] = [];
      }

      for (const task of phase['tasks'] as Array<Record<string, unknown>>) {
        if (!task['id'] || !task['title'] || !task['agentType']) {
          throw new Error(
            `Task is missing required fields (id, title, agentType): ${JSON.stringify(task).substring(0, 100)}`,
          );
        }

        // Auto-fix: default to 'software-architect' if agentType is not a valid value
        if (!VALID_AGENT_TYPES.includes(task['agentType'] as string)) {
          this.logger.warn(
            `${SERVICE_TAG} Invalid agentType "${String(task['agentType'])}" in task "${String(task['id'])}", defaulting to software-architect`,
          );
          task['agentType'] = 'software-architect';
        }

        if (!Array.isArray(task['filePaths'])) {
          // Auto-fix: default to empty array if missing
          task['filePaths'] = [];
        }
      }
    }
  }
}
