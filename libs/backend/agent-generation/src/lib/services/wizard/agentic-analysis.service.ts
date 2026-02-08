/**
 * AgenticAnalysisService - Claude Agent SDK-powered workspace analysis
 *
 * Replaces the hardcoded file-scanning approach in DeepProjectAnalysisService
 * with an intelligent Claude Agent session that uses MCP tools (ptah.* API)
 * to analyze the workspace. Streams progress in real-time to the frontend.
 *
 * Architecture:
 * - Delegates SDK query execution to InternalQueryService (agent-sdk)
 * - InternalQueryService handles all SDK plumbing: enhanced prompts, MCP,
 *   identity prompts, hooks, compaction, permissions, env vars, settings
 * - This service owns: analysis prompt, progress extraction, JSON parsing, broadcast
 *
 * @module @ptah-extension/agent-generation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import {
  Logger,
  ConfigManager,
  TOKENS,
  type WebviewManager,
} from '@ptah-extension/vscode-core';
import { Result, MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AnalysisPhase } from '@ptah-extension/shared';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  InternalQueryService,
  SDKMessage,
} from '@ptah-extension/agent-sdk';
import type { DeepProjectAnalysis } from '../../types/analysis.types';
import {
  ProjectAnalysisZodSchema,
  normalizeAgentOutput,
} from './analysis-schema';

// ============================================================================
// Constants
// ============================================================================

const SERVICE_TAG = '[AgenticAnalysis]';
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_AGENT_TURNS = 25;

/**
 * Typed abort reasons for distinguishing timeout from user cancellation.
 * Passed to AbortController.abort(reason) so the catch block can inspect
 * signal.reason and produce distinct error messages for each case.
 */
const ABORT_REASONS = {
  TIMEOUT: 'analysis_timeout',
  USER_CANCELLED: 'user_cancelled',
} as const;
type AbortReason = (typeof ABORT_REASONS)[keyof typeof ABORT_REASONS];

const PHASE_LABELS: Record<AnalysisPhase, string> = {
  discovery: 'Discovering project structure...',
  architecture: 'Analyzing architecture patterns...',
  health: 'Assessing code health...',
  quality: 'Evaluating code quality...',
};

// ============================================================================
// Analysis System Prompt
// ============================================================================

function buildAnalysisSystemPrompt(): string {
  return `You are an expert workspace analyzer. Analyze a codebase using MCP tools and produce a JSON analysis.

## Phase Markers — CRITICAL

Before starting each phase, output exactly this text as a standalone line in your direct text output (NOT inside any tool call, code block, or execute_code input):

\`[PHASE:discovery]\`
\`[PHASE:architecture]\`
\`[PHASE:health]\`
\`[PHASE:quality]\`

DO NOT put phase markers inside execute_code tool input parameters. Phase markers MUST appear as your direct text response before each phase.

Similarly, emit \`[DETECTED:X]\` (e.g. \`[DETECTED:Angular]\`) in your direct text output for each technology or framework you find.

## Phases

Phase 1 - Discovery: Output \`[PHASE:discovery]\` then:
- Call \`ptah.workspace.analyze()\` EXACTLY ONCE to get project type, frameworks, file count
- Use \`ptah.search.findFiles({pattern})\` for key files (entry points, configs, tests)
- Output \`[DETECTED:X]\` for each technology found

Phase 2 - Architecture: Output \`[PHASE:architecture]\` then:
- Examine folder structures for patterns (DDD, Layered, MVC, Microservices, Hexagonal)
- Identify monorepo type if applicable (Nx, Lerna, Turborepo)

Phase 3 - Health: Output \`[PHASE:health]\` then:
- Call \`ptah.diagnostics.getProblems()\` for error/warning counts
- Check linter/formatter configs (.eslintrc, .prettierrc)

Phase 4 - Quality: Output \`[PHASE:quality]\` then:
- Find test files and estimate coverage
- Identify test frameworks (jest, mocha, vitest, etc.)

## Tool Usage Rules

- Call each MCP tool EXACTLY ONCE. Do NOT call \`ptah.workspace.analyze()\` more than once.
- The execute_code tool returns the value of the last expression directly. Do NOT use \`console.log()\` to wrap return values.
- When analyzing results, summarize key findings concisely in your text output. Do NOT reproduce entire JSON objects in your response text.
- If a tool call fails, continue with remaining analysis.

## Final Output

After all phases, emit your result as a JSON object in a \`\`\`json code block matching this schema:

\`\`\`typescript
{
  projectType: string,
  frameworks: string[],
  monorepoType?: string,
  architecturePatterns: Array<{
    name: string, confidence: number, evidence: string[], description?: string
  }>,
  keyFileLocations: {
    entryPoints: string[], configs: string[], testDirectories: string[],
    apiRoutes: string[], components: string[], services: string[],
    models?: string[], repositories?: string[], utilities?: string[]
  },
  languageDistribution: Array<{
    language: string, percentage: number, fileCount: number, linesOfCode?: number
  }>,
  existingIssues: {
    errorCount: number, warningCount: number, infoCount: number,
    errorsByType: Record<string, number>, warningsByType: Record<string, number>,
    topErrors?: Array<{ message: string, count: number, source: string }>
  },
  codeConventions?: {
    indentation: "tabs" | "spaces", indentSize: number,
    quoteStyle: "single" | "double", semicolons: boolean,
    trailingComma?: "none" | "es5" | "all",
    namingConventions?: {
      files?: string, classes?: string, functions?: string,
      variables?: string, constants?: string, interfaces?: string, types?: string
    },
    maxLineLength?: number, usePrettier?: boolean, useEslint?: boolean,
    additionalTools?: string[]
  },
  testCoverage: {
    percentage: number, hasTests: boolean, testFramework?: string,
    hasUnitTests: boolean, hasIntegrationTests: boolean, hasE2eTests: boolean,
    testFileCount?: number, sourceFileCount?: number, testToSourceRatio?: number
  }
}
\`\`\`

If you cannot determine a value, use sensible defaults (0, [], false).`;
}

// ============================================================================
// Service
// ============================================================================

/**
 * AgenticAnalysisService
 *
 * Uses InternalQueryService (agent-sdk) for SDK execution.
 * Owns: analysis prompt, progress extraction, JSON parsing, frontend broadcast.
 */
@injectable()
export class AgenticAnalysisService {
  /**
   * Active AbortController for the currently running analysis.
   * Stored as a class member so that external callers (e.g., the cancel RPC)
   * can trigger abort on long-running SDK queries.
   */
  private activeAbortController: AbortController | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService
  ) {}

  /**
   * Analyze workspace using a Claude Agent SDK session with MCP tools.
   */
  async analyzeWorkspace(
    workspaceUri: vscode.Uri,
    options?: {
      timeout?: number;
      model?: string;
      isPremium?: boolean;
      mcpServerRunning?: boolean;
      mcpPort?: number;
    }
  ): Promise<Result<DeepProjectAnalysis, Error>> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const model =
      options?.model ||
      this.config.getWithDefault<string>(
        'model.selected',
        'claude-sonnet-4-5-20250929'
      );
    const isPremium = options?.isPremium ?? false;
    const mcpServerRunning = options?.mcpServerRunning ?? false;
    const mcpPort = options?.mcpPort;

    this.logger.info(`${SERVICE_TAG} Starting agentic analysis`, {
      workspace: workspaceUri.fsPath,
      timeout,
      model,
      isPremium,
      mcpServerRunning,
    });

    // MCP tools are required for agentic analysis
    if (!isPremium || !mcpServerRunning) {
      return Result.err(
        new Error(
          `Agentic analysis requires premium license and MCP server. isPremium=${isPremium}, mcpRunning=${mcpServerRunning}`
        )
      );
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    try {
      // Execute query via InternalQueryService
      // The service handles: enhanced prompts, MCP, identity, hooks, compaction, env, settings
      const handle = await this.internalQueryService.execute({
        cwd: workspaceUri.fsPath,
        model,
        prompt:
          'Analyze this workspace thoroughly and produce the comprehensive JSON analysis as described in your system prompt. Start with [PHASE:discovery] and work through all 4 phases.',
        systemPromptAppend: buildAnalysisSystemPrompt(),
        isPremium,
        mcpServerRunning,
        mcpPort,
        maxTurns: MAX_AGENT_TURNS,
        abortController,
      });

      // Process stream with timeout
      const result = await this.processStream(
        handle.stream,
        abortController,
        timeout
      );

      // Cleanup
      handle.close();

      return result;
    } catch (error) {
      // Inspect abort reason to produce distinct error messages for timeout vs user cancellation
      const abortReason = abortController.signal.reason as
        | AbortReason
        | undefined;

      if (abortReason === ABORT_REASONS.TIMEOUT) {
        this.logger.warn(
          `${SERVICE_TAG} Analysis timed out after ${timeout}ms`
        );
        this.broadcastProgress({
          filesScanned: 0,
          totalFiles: 0,
          detections: [],
          agentReasoning:
            'Analysis timed out. Falling back to quick analysis...',
        });
        return Result.err(new Error('Analysis timed out'));
      } else if (abortReason === ABORT_REASONS.USER_CANCELLED) {
        this.logger.info(`${SERVICE_TAG} Analysis cancelled by user`);
        return Result.err(new Error('Analysis cancelled by user'));
      }

      // Generic error (not an abort)
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`${SERVICE_TAG} Agentic analysis failed`, errorObj);
      return Result.err(errorObj);
    } finally {
      // Only clear if this call's controller is still the active one.
      // Prevents a race condition where cancel-then-retry causes the first
      // call's finally block to null out the second call's new controller.
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

  /**
   * Cancel a running workspace analysis.
   *
   * Aborts the active AbortController, which terminates the SDK query stream.
   * Safe to call even if no analysis is running (no-op in that case).
   * Handles the race condition where cancel arrives after analysis completes:
   * the activeAbortController will already be null, so abort() is never called.
   */
  cancelAnalysis(): void {
    if (this.activeAbortController) {
      this.logger.info(`${SERVICE_TAG} Cancelling active analysis`);
      this.activeAbortController.abort(ABORT_REASONS.USER_CANCELLED);
      this.activeAbortController = null;
    } else {
      this.logger.debug(
        `${SERVICE_TAG} cancelAnalysis called but no active analysis`
      );
    }
  }

  /**
   * Process the SDK message stream, extract progress, and parse the final result.
   */
  private async processStream(
    stream: AsyncIterable<SDKMessage>,
    abortController: AbortController,
    timeoutMs: number
  ): Promise<Result<DeepProjectAnalysis, Error>> {
    let fullText = '';
    const detections: string[] = [];
    const completedPhases: AnalysisPhase[] = [];
    let currentPhase: AnalysisPhase | undefined;
    let lastPhaseCheckPos = 0;
    let lastDetectionCheckPos = 0;

    const timeoutId = setTimeout(() => {
      this.logger.warn(
        `${SERVICE_TAG} Analysis timed out after ${timeoutMs}ms`
      );
      abortController.abort(ABORT_REASONS.TIMEOUT);
    }, timeoutMs);

    try {
      for await (const message of stream) {
        // Handle result message (final output)
        if (message.type === 'result') {
          clearTimeout(timeoutId);

          if (message.subtype === 'success') {
            this.logger.info(`${SERVICE_TAG} Query completed`, {
              turns: message.num_turns,
              cost: message.total_cost_usd,
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            });
            const resultText = message.result || fullText;
            return this.parseAnalysisResponse(resultText);
          }

          const errorResult = message as {
            subtype: string;
            errors?: string[];
          };
          return Result.err(
            new Error(
              `Analysis query failed: ${
                errorResult.errors?.join('; ') || errorResult.subtype
              }`
            )
          );
        }

        // Extract text from stream events for live progress
        if (message.type === 'stream_event') {
          const event = message.event;

          // Text deltas — extract progress markers
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const text = event.delta.text;
            fullText += text;

            // Phase markers: [PHASE:discovery], [PHASE:architecture], etc.
            // Match against accumulated fullText (not individual chunks) to handle
            // markers split across stream boundaries (e.g. "[PHASE:disc" + "overy]").
            // Use a cursor to avoid re-processing already-matched regions.
            const phaseSearchRegion = fullText.substring(lastPhaseCheckPos);
            const phaseMatch = phaseSearchRegion.match(/\[PHASE:(\w+)\]/);
            if (phaseMatch) {
              const phase = phaseMatch[1] as AnalysisPhase;
              lastPhaseCheckPos =
                lastPhaseCheckPos +
                (phaseMatch.index ?? 0) +
                phaseMatch[0].length;
              if (currentPhase && !completedPhases.includes(currentPhase)) {
                completedPhases.push(currentPhase);
              }
              currentPhase = phase;
              this.broadcastProgress({
                filesScanned: 0,
                totalFiles: 0,
                detections,
                currentPhase: phase,
                phaseLabel: PHASE_LABELS[phase] || `Phase: ${phase}`,
                completedPhases: [...completedPhases],
              });
            }

            // Detection markers: [DETECTED:Angular], [DETECTED:TypeScript], etc.
            // Same approach: match against accumulated fullText with cursor.
            // Collect all matches first, then update cursor to end of last match
            // to avoid stale index values when cursor moves inside the loop.
            const detectionSearchRegion = fullText.substring(
              lastDetectionCheckPos
            );
            const detectionMatches = [
              ...detectionSearchRegion.matchAll(/\[DETECTED:(.+?)\]/g),
            ];
            for (const match of detectionMatches) {
              const detection = match[1];
              if (!detections.includes(detection)) {
                detections.push(detection);
                this.broadcastProgress({
                  filesScanned: 0,
                  totalFiles: 0,
                  detections: [...detections],
                  currentPhase,
                  phaseLabel: currentPhase
                    ? PHASE_LABELS[currentPhase]
                    : undefined,
                  completedPhases: [...completedPhases],
                });
              }
            }
            if (detectionMatches.length > 0) {
              const lastMatch = detectionMatches[detectionMatches.length - 1];
              lastDetectionCheckPos =
                lastDetectionCheckPos +
                (lastMatch.index ?? 0) +
                lastMatch[0].length;
            }
          }

          // Tool use — show agent reasoning
          if (
            event.type === 'content_block_start' &&
            event.content_block.type === 'tool_use'
          ) {
            this.broadcastProgress({
              filesScanned: 0,
              totalFiles: 0,
              detections: [...detections],
              currentPhase,
              phaseLabel: currentPhase ? PHASE_LABELS[currentPhase] : undefined,
              agentReasoning: `Using: ${event.content_block.name}...`,
              completedPhases: [...completedPhases],
            });
          }
        }

        // Log assistant messages for debugging
        if (message.type === 'assistant') {
          this.logger.debug(`${SERVICE_TAG} Assistant message`, {
            contentBlocks: message.message.content.length,
            stopReason: message.message.stop_reason,
          });
        }
      }

      // Stream ended without result — try to parse accumulated text
      if (fullText.trim()) {
        this.logger.warn(
          `${SERVICE_TAG} Stream ended without result message, parsing accumulated text`
        );
        return this.parseAnalysisResponse(fullText);
      }

      return Result.err(new Error('Analysis produced no output'));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse and validate the JSON analysis from the agent's response text.
   */
  private parseAnalysisResponse(
    fullText: string
  ): Result<DeepProjectAnalysis, Error> {
    // Try 1: Extract from ```json code block (use LAST match, not first).
    // The agent may produce intermediate reasoning JSON blocks before the final answer.
    const jsonMatches = [...fullText.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
    if (jsonMatches.length > 0) {
      const lastJsonMatch = jsonMatches[jsonMatches.length - 1];
      return this.validateJson(lastJsonMatch[1]);
    }

    // Try 2: Extract from ``` code block without json tag (use LAST match).
    const codeMatches = [...fullText.matchAll(/```\s*\n([\s\S]*?)\n```/g)];
    if (codeMatches.length > 0) {
      const lastCodeMatch = codeMatches[codeMatches.length - 1];
      const parsed = this.validateJson(lastCodeMatch[1]);
      if (parsed.isOk()) return parsed;
    }

    // Try 3: Find JSON object delimiters
    const firstBrace = fullText.indexOf('{');
    const lastBrace = fullText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return this.validateJson(fullText.substring(firstBrace, lastBrace + 1));
    }

    // Try 4: Direct parse
    return this.validateJson(fullText);
  }

  /**
   * Validate and normalize JSON string into a DeepProjectAnalysis.
   *
   * Uses the shared ProjectAnalysisZodSchema for validation and
   * normalizeAgentOutput for case-insensitive enum mapping.
   */
  private validateJson(jsonStr: string): Result<DeepProjectAnalysis, Error> {
    try {
      const parsed = JSON.parse(jsonStr);
      const validation = ProjectAnalysisZodSchema.safeParse(parsed);

      if (!validation.success) {
        const errors = validation.error.issues
          .map((e) => `${String(e.path.join('.'))}: ${e.message}`)
          .join('; ');
        return Result.err(new Error(`Schema validation failed: ${errors}`));
      }

      return Result.ok(normalizeAgentOutput(validation.data));
    } catch (parseError) {
      return Result.err(
        new Error(
          `JSON parse failed: ${
            parseError instanceof Error
              ? parseError.message
              : String(parseError)
          }`
        )
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
        payload
      );
    } catch (error) {
      this.logger.debug(`${SERVICE_TAG} Failed to broadcast progress`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
