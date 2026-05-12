/**
 * AgenticAnalysisService - Claude Agent SDK-powered workspace analysis
 *
 * Uses the Claude Agent SDK with structured output (JSON Schema) to analyze
 * a workspace. The agent uses MCP tools to inspect the codebase, and the SDK
 * constrains the final response to valid JSON matching our analysis schema.
 *
 * Architecture:
 * - Delegates SDK query execution to InternalQueryService (agent-sdk)
 * - InternalQueryService handles all SDK plumbing: enhanced prompts, MCP,
 *   identity prompts, hooks, compaction, permissions, env vars, settings
 * - SDK `outputFormat` enforces structured JSON output (no regex parsing)
 * - Zod normalization maps LLM strings to enum values (case-insensitive)
 *
 * @module @ptah-extension/agent-generation
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  type WebviewManager,
} from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import { Result, MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  AnalysisPhase,
  AnalysisStreamPayload,
} from '@ptah-extension/shared';
import { SDK_TOKENS, SdkStreamProcessor } from '@ptah-extension/agent-sdk';
import type {
  InternalQueryService,
  SDKMessage,
  StreamEventEmitter,
  PhaseTracker,
  StreamEvent,
} from '@ptah-extension/agent-sdk';
import type { DeepProjectAnalysis } from '../../types/analysis.types';
import {
  ProjectAnalysisZodSchema,
  normalizeAgentOutput,
  buildAnalysisJsonSchema,
} from './analysis-schema';

// ============================================================================
// Constants
// ============================================================================

const SERVICE_TAG = '[AgenticAnalysis]';
const DEFAULT_TIMEOUT_MS = 3_600_000; // 1 hour
const MAX_AGENT_TURNS = 25;

const ABORT_REASONS = {
  TIMEOUT: 'analysis_timeout',
  USER_CANCELLED: 'user_cancelled',
} as const;
type AbortReason = (typeof ABORT_REASONS)[keyof typeof ABORT_REASONS];

const PHASE_LABELS: Partial<Record<AnalysisPhase, string>> = {
  discovery: 'Discovering project structure...',
  architecture: 'Analyzing architecture patterns...',
  health: 'Assessing code health...',
  quality: 'Evaluating code quality...',
};

/**
 * Heuristic mapping from tool call count to implicit analysis phase.
 * Provides progress UX without requiring markers in the agent's text.
 */
const TOOL_COUNT_PHASE_HEURISTIC: Record<number, AnalysisPhase> = {
  1: 'discovery',
  2: 'discovery',
  3: 'architecture',
  4: 'architecture',
  5: 'health',
  6: 'health',
};
// 7+ defaults to 'quality'

// ============================================================================
// Analysis System Prompt
// ============================================================================

function buildAnalysisSystemPrompt(): string {
  return `You are an expert workspace analyzer and code quality assessor. Analyze the codebase using the available MCP tools and gather comprehensive information about the project, including a thorough quality assessment.

## Analysis Steps

1. **Discovery**: Call \`ptah.workspace.analyze()\` to get project type, frameworks, and file count. Use \`ptah.search.findFiles({pattern})\` to locate key files (entry points, configs, tests).

2. **Architecture**: Examine folder structures for patterns (DDD, Layered, MVC, Microservices, Hexagonal, Component-Based). Check for monorepo tools (Nx, Lerna, Turborepo, pnpm/yarn workspaces).

3. **Health**: Call \`ptah.diagnostics.getProblems()\` for error/warning counts. Check linter/formatter configs (.eslintrc, .prettierrc, biome.json).

4. **Testing**: Find test files and estimate coverage. Identify test frameworks (jest, mocha, vitest, pytest, etc.).

5. **Quality Assessment** (CRITICAL — be thorough):
   Read several representative source files using \`ptah.files.readFile()\` to assess code quality. Sample at least 3-5 key files (services, controllers, components).

   Evaluate the following quality dimensions:
   - **Type Safety**: Use of \`any\`, \`@ts-ignore\`, non-null assertions, proper interface/type usage
   - **Error Handling**: Empty catch blocks, console-only error handling, unhandled promises, proper error boundaries
   - **Architecture Adherence**: Separation of concerns, dependency direction, layer violations
   - **Code Organization**: File size, function complexity, naming conventions, dead code
   - **Security Practices**: Input validation, SQL injection risks, XSS vulnerabilities, hardcoded secrets
   - **Dependency Management**: Outdated deps, unused deps, version pinning strategy
   - **Testing Quality**: Test coverage ratio, assertion quality, mock patterns, edge case coverage
   - **Performance**: N+1 queries, unnecessary re-renders, memory leaks, missing caching

   Produce a quality score (0-100), list specific issues found with severity, and identify strengths.

## Tool Usage Rules

- Call \`ptah.workspace.analyze()\` EXACTLY ONCE.
- Read at least 3-5 representative source files for quality assessment.
- The execute_code tool returns the value of the last expression directly. Do NOT wrap return values in \`console.log()\`.
- If a tool call fails, continue with the remaining analysis.
- Be thorough but efficient — gather all needed data, then produce your final output.

Your response will be automatically constrained to the required JSON schema. Just focus on gathering accurate data.`;
}

// ============================================================================
// Service
// ============================================================================

/**
 * AgenticAnalysisService
 *
 * Uses InternalQueryService (agent-sdk) with structured output for SDK execution.
 * The SDK enforces JSON Schema on the agent's final response and auto-retries
 * on validation failure. Zod normalization handles enum resolution after.
 */
@injectable()
export class AgenticAnalysisService {
  private activeAbortController: AbortController | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
  ) {}

  /**
   * Analyze workspace using a Claude Agent SDK session with MCP tools
   * and structured output (JSON Schema).
   */
  async analyzeWorkspace(
    workspacePath: string,
    options?: {
      timeout?: number;
      model?: string;
      isPremium?: boolean;
      mcpServerRunning?: boolean;
      mcpPort?: number;
    },
  ): Promise<Result<DeepProjectAnalysis, Error>> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const model =
      options?.model || this.modelSettings.selectedModel.get() || 'default';
    const isPremium = options?.isPremium ?? false;
    const mcpServerRunning = options?.mcpServerRunning ?? false;
    const mcpPort = options?.mcpPort;

    this.logger.info(`${SERVICE_TAG} Starting agentic analysis`, {
      workspace: workspacePath,
      timeout,
      model,
      isPremium,
      mcpServerRunning,
    });

    if (!isPremium || !mcpServerRunning) {
      return Result.err(
        new Error(
          `Agentic analysis requires premium license and MCP server. isPremium=${isPremium}, mcpRunning=${mcpServerRunning}`,
        ),
      );
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    try {
      const handle = await this.internalQueryService.execute({
        cwd: workspacePath,
        model,
        prompt:
          'Analyze this workspace thoroughly. Inspect the project structure, frameworks, architecture patterns, code health, and test coverage using the available tools.',
        systemPromptAppend: buildAnalysisSystemPrompt(),
        isPremium,
        mcpServerRunning,
        mcpPort,
        maxTurns: MAX_AGENT_TURNS,
        abortController,
        outputFormat: {
          type: 'json_schema',
          schema: buildAnalysisJsonSchema(),
        },
      });

      try {
        return await this.processStream(
          handle.stream,
          abortController,
          timeout,
        );
      } finally {
        handle.close();
      }
    } catch (error) {
      const abortReason = abortController.signal.reason as
        | AbortReason
        | undefined;

      if (abortReason === ABORT_REASONS.TIMEOUT) {
        this.logger.warn(
          `${SERVICE_TAG} Analysis timed out after ${timeout}ms`,
        );
        this.broadcastStreamMessage({
          kind: 'error',
          content: `Analysis timed out after ${Math.round(
            timeout / 1000,
          )} seconds. Falling back to quick analysis...`,
          timestamp: Date.now(),
        });
        return Result.err(
          new Error(
            `Analysis timed out after ${Math.round(
              timeout / 1000,
            )}s. Quick analysis mode will be used instead.`,
          ),
        );
      } else if (abortReason === ABORT_REASONS.USER_CANCELLED) {
        this.logger.info(`${SERVICE_TAG} Analysis cancelled by user`);
        this.broadcastStreamMessage({
          kind: 'error',
          content: 'Analysis cancelled by user',
          timestamp: Date.now(),
        });
        return Result.err(new Error('Analysis cancelled by user'));
      }

      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`${SERVICE_TAG} Agentic analysis failed`, errorObj);
      return Result.err(errorObj);
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

  /**
   * Cancel a running workspace analysis.
   */
  cancelAnalysis(): void {
    if (this.activeAbortController) {
      this.logger.info(`${SERVICE_TAG} Cancelling active analysis`);
      this.activeAbortController.abort(ABORT_REASONS.USER_CANCELLED);
      this.activeAbortController = null;
    } else {
      this.logger.debug(
        `${SERVICE_TAG} cancelAnalysis called but no active analysis`,
      );
    }
  }

  /**
   * Process the SDK message stream for progress UX and extract the final result.
   *
   * With structured output, the SDK returns pre-validated JSON in
   * `result.structured_output`. This method only needs to:
   * 1. Track tool calls for progress display (phase heuristics)
   * 2. Broadcast text/thinking/tool events for the live transcript
   * 3. Read structured_output from the result message
   */
  private async processStream(
    stream: AsyncIterable<SDKMessage>,
    abortController: AbortController,
    timeoutMs: number,
  ): Promise<Result<DeepProjectAnalysis, Error>> {
    // Phase tracking state for progress heuristics
    let currentPhase: AnalysisPhase | undefined;
    const completedPhases: AnalysisPhase[] = [];

    const emitter: StreamEventEmitter = {
      emit: (event: StreamEvent) => this.broadcastStreamMessage(event),
    };

    const phaseTracker: PhaseTracker = {
      onToolStart: (toolCallCount: number, toolName: string) => {
        const newPhase = TOOL_COUNT_PHASE_HEURISTIC[toolCallCount] || 'quality';
        if (newPhase !== currentPhase) {
          if (currentPhase && !completedPhases.includes(currentPhase)) {
            completedPhases.push(currentPhase);
          }
          currentPhase = newPhase;
        }
        this.broadcastProgress({
          filesScanned: 0,
          totalFiles: 0,
          detections: [],
          currentPhase,
          phaseLabel: currentPhase ? PHASE_LABELS[currentPhase] : undefined,
          agentReasoning: `Using: ${toolName}...`,
          completedPhases: [...completedPhases],
        });
      },
      onToolStop: (_toolCallId: string, inputBuffer: string) => {
        const ptahApiMatch = inputBuffer.match(/ptah\.(\w+)\.(\w+)\(/);
        if (ptahApiMatch) {
          this.broadcastProgress({
            filesScanned: 0,
            totalFiles: 0,
            detections: [],
            currentPhase,
            phaseLabel: currentPhase ? PHASE_LABELS[currentPhase] : undefined,
            agentReasoning: `Analyzing: ptah.${ptahApiMatch[1]}.${ptahApiMatch[2]}()`,
            completedPhases: [...completedPhases],
          });
        }
      },
      onThinking: (thinkingPreview: string) => {
        this.broadcastProgress({
          filesScanned: 0,
          totalFiles: 0,
          detections: [],
          currentPhase,
          phaseLabel: currentPhase
            ? PHASE_LABELS[currentPhase]
            : 'Analyzing...',
          agentReasoning: `Thinking: ${thinkingPreview}...`,
          completedPhases: [...completedPhases],
        });
      },
    };

    const processor = new SdkStreamProcessor({
      emitter,
      timeout: { ms: timeoutMs, abortController },
      phaseTracker,
      logger: this.logger,
      serviceTag: SERVICE_TAG,
    });

    const result = await processor.process(stream);

    this.broadcastStreamMessage({
      kind: 'status',
      content: 'Analysis complete',
      timestamp: Date.now(),
    });

    if (result.structuredOutput) {
      return this.normalizeStructuredOutput(result.structuredOutput);
    }

    // No structured output — try text parsing from result meta context
    // (the processor already attempted JSON.parse on result text internally)
    return Result.err(new Error('Analysis completed but produced no output'));
  }

  /**
   * Normalize SDK structured output into a DeepProjectAnalysis.
   *
   * The SDK has already validated the JSON structure. We run Zod for:
   * - Case-insensitive enum resolution (e.g. "React" → "react")
   * - Default filling for optional fields
   * - monorepoType boolean → null conversion
   * - Percentage clamping
   */
  private normalizeStructuredOutput(
    structuredOutput: unknown,
  ): Result<DeepProjectAnalysis, Error> {
    try {
      const validation = ProjectAnalysisZodSchema.safeParse(structuredOutput);

      if (validation.success) {
        return Result.ok(normalizeAgentOutput(validation.data));
      }

      // SDK already validated structure, but Zod preprocess handles edge cases
      // (boolean monorepoType, percentage clamping, enum normalization).
      // If Zod still fails, report the issues.
      const errors = validation.error.issues
        .map((e) => `${String(e.path.join('.'))}: ${e.message}`)
        .join('; ');
      this.logger.warn(
        `${SERVICE_TAG} Structured output normalization failed: ${errors}`,
      );
      return Result.err(
        new Error(`Failed to normalize structured output: ${errors}`),
      );
    } catch (error) {
      return Result.err(
        new Error(
          `Structured output normalization failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  }

  /**
   * Fallback: parse JSON from text when structured_output is not available.
   * This should rarely be needed with outputFormat enabled.
   */
  private parseJsonFromText(text: string): Result<DeepProjectAnalysis, Error> {
    try {
      // Try to parse as direct JSON first
      const parsed = JSON.parse(text);
      return this.normalizeStructuredOutput(parsed);
    } catch {
      // Try to extract from code blocks
      const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          return this.normalizeStructuredOutput(parsed);
        } catch {
          // fall through
        }
      }

      // Try brace extraction
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));
          return this.normalizeStructuredOutput(parsed);
        } catch {
          // fall through
        }
      }

      return Result.err(
        new Error('Could not extract JSON from agent response'),
      );
    }
  }

  /**
   * Broadcast progress update to the frontend.
   */
  private broadcastProgress(payload: {
    filesScanned: number;
    totalFiles: number;
    detections: string[];
    currentPhase?: AnalysisPhase;
    phaseLabel?: string;
    agentReasoning?: string;
    completedPhases?: AnalysisPhase[];
  }): void {
    try {
      this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS,
        payload,
      );
    } catch (error) {
      this.logger.debug(`${SERVICE_TAG} Failed to broadcast progress`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Broadcast a stream message to the frontend for real-time transcript display.
   */
  private broadcastStreamMessage(payload: AnalysisStreamPayload): void {
    try {
      this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
        payload,
      );
    } catch (error) {
      this.logger.debug(`${SERVICE_TAG} Failed to broadcast stream message`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
