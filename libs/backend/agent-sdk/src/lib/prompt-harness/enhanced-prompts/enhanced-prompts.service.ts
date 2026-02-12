/**
 * Enhanced Prompts Service
 *
 * TASK_2025_137 Batch 4: Main orchestration service for the Enhanced Prompts feature.
 *
 * This premium feature:
 * 1. Analyzes the workspace to detect technology stack
 * 2. Uses PromptDesignerAgent to build prompts + InternalQueryService for SDK calls
 * 3. Caches the generated prompt with smart invalidation
 * 4. Auto-activates for all sessions when enabled
 * 5. Provides toggle/regenerate functionality via settings
 *
 * Flow:
 * - User invokes "Setup Enhanced Prompts" from empty chat screen (premium feature)
 * - Wizard analyzes workspace and generates prompt via SDK (InternalQueryService)
 * - Generated prompt is cached and auto-applied to all future sessions
 * - Users can toggle on/off or regenerate via settings
 * - Prompt content is never shown to users (IP protection)
 *
 * LLM Pipeline Migration:
 * Previously: PromptDesignerAgent → LlmService → VsCodeLmProvider (required Copilot)
 * Now: PromptDesignerAgent builds prompts → InternalQueryService → Agent SDK (uses API key)
 */

import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  type ConfigManager,
} from '@ptah-extension/vscode-core';
import type { AnalysisStreamPayload } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../../di/tokens';
import type { PromptDesignerAgent } from '../prompt-designer/prompt-designer-agent';
import type { PromptCacheService } from '../prompt-designer/prompt-cache.service';
import type {
  PromptDesignerInput,
  PromptDesignerOutput,
  PromptGenerationProgress,
} from '../prompt-designer/prompt-designer.types';
import {
  EnhancedPromptsState,
  EnhancedPromptsStatus,
  EnhancedPromptsWizardResult,
  DetectedStack,
  EnhancedPromptsConfig,
  RegeneratePromptsRequest,
  RegeneratePromptsResponse,
  createInitialEnhancedPromptsState,
  DEFAULT_ENHANCED_PROMPTS_CONFIG,
} from './enhanced-prompts.types';
import { PTAH_CORE_SYSTEM_PROMPT } from '../ptah-core-prompt';
import type { InternalQueryService } from '../../internal-query/internal-query.service';
import type { SDKMessage } from '../../types/sdk-types/claude-sdk.types';
import {
  isContentBlockDelta,
  isContentBlockStart,
  isContentBlockStop,
  isTextDelta,
  isInputJsonDelta,
  isThinkingDelta,
} from '../../types/sdk-types/claude-sdk.types';

/**
 * SDK configuration for internal query execution
 */
export interface EnhancedPromptsSdkConfig {
  isPremium: boolean;
  mcpServerRunning: boolean;
  mcpPort?: number;
  /** Callback for real-time stream events (text, tool calls, thinking) */
  onStreamEvent?: (event: AnalysisStreamPayload) => void;
}

/**
 * VS Code ExtensionContext interface (minimal)
 */
interface IExtensionContext {
  globalState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
  };
}

/**
 * Workspace Intelligence service interface
 */
interface IWorkspaceIntelligence {
  analyzeWorkspace(workspacePath: string): Promise<WorkspaceAnalysisResult>;
}

/**
 * Result from workspace analysis
 */
interface WorkspaceAnalysisResult {
  projectType: string;
  framework?: string;
  isMonorepo: boolean;
  monorepoType?: string;
  dependencies: string[];
  devDependencies: string[];
  configFiles: string[];
  languages: string[];
}

/**
 * Storage key for enhanced prompts state
 */
const STATE_STORAGE_KEY = 'ptah.enhancedPrompts.state';

const SERVICE_TAG = '[EnhancedPrompts]';

/**
 * EnhancedPromptsService - Orchestrates the Enhanced Prompts feature
 *
 * Responsibilities:
 * - State management (enabled/disabled, generated prompt)
 * - Wizard execution flow
 * - Integration with PromptDesignerAgent and PromptCacheService
 * - SDK call via InternalQueryService for prompt generation
 * - Providing prompt content to SdkQueryOptionsBuilder
 */
/**
 * Default timeout for generation lock (5 minutes)
 * Prevents deadlock if async exception escapes try/catch
 */
const GENERATION_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

@injectable()
export class EnhancedPromptsService {
  /**
   * Map of workspace paths to their states (prevents stale state on workspace switch)
   */
  private stateByWorkspace = new Map<string, EnhancedPromptsState>();

  /**
   * Generation lock with timeout-based auto-release
   */
  private isGenerating = false;
  private generationLockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_PROMPT_DESIGNER_AGENT)
    private readonly promptDesignerAgent: PromptDesignerAgent,
    @inject(SDK_TOKENS.SDK_PROMPT_CACHE_SERVICE)
    private readonly cacheService: PromptCacheService,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: IExtensionContext,
    @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)
    private readonly workspaceIntelligence: IWorkspaceIntelligence,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly config: ConfigManager
  ) {
    // Listen for cache invalidation events
    this.cacheService.onInvalidation((event) => {
      this.logger.info(
        'EnhancedPromptsService: Cache invalidated, prompt needs regeneration',
        {
          reason: event.reason,
          workspacePath: event.workspacePath,
        }
      );
      // Mark workspace state as needing regeneration (but don't disable)
      const state = this.stateByWorkspace.get(event.workspacePath);
      if (state) {
        state.configHash = null; // Mark as stale
      }
    });
  }

  /**
   * Acquire generation lock with timeout-based auto-release
   * Prevents deadlock if async exception escapes try/catch
   */
  private acquireGenerationLock(): boolean {
    if (this.isGenerating) {
      return false;
    }

    this.isGenerating = true;

    // Set up timeout-based auto-release to prevent deadlock
    this.generationLockTimer = setTimeout(() => {
      this.logger.warn(
        'EnhancedPromptsService: Generation lock timed out, force releasing',
        { timeoutMs: GENERATION_LOCK_TIMEOUT_MS }
      );
      this.releaseGenerationLock();
    }, GENERATION_LOCK_TIMEOUT_MS);

    return true;
  }

  /**
   * Release generation lock and clear timeout
   */
  private releaseGenerationLock(): void {
    this.isGenerating = false;
    if (this.generationLockTimer) {
      clearTimeout(this.generationLockTimer);
      this.generationLockTimer = null;
    }
  }

  /**
   * Get the current status of Enhanced Prompts for a workspace
   *
   * @param workspacePath - Workspace to check
   * @returns Current status including enabled state and cache validity
   */
  async getStatus(workspacePath: string): Promise<EnhancedPromptsStatus> {
    const state = await this.loadState(workspacePath);

    // Check if cache is still valid
    let cacheValid = false;
    let invalidationReason: string | undefined;

    if (state.enabled && state.generatedPrompt) {
      const dependencyHash = await this.cacheService.computeDependencyHash(
        workspacePath
      );
      if (dependencyHash && state.configHash === dependencyHash) {
        cacheValid = true;
      } else {
        invalidationReason = 'Project configuration changed';
      }
    }

    return {
      enabled: state.enabled,
      hasGeneratedPrompt: !!state.generatedPrompt,
      generatedAt: state.generatedAt,
      detectedStack: state.detectedStack,
      cacheValid,
      invalidationReason,
    };
  }

  /**
   * Run the Enhanced Prompts wizard to generate project-specific guidance
   *
   * @param workspacePath - Workspace to analyze
   * @param config - Optional configuration overrides
   * @param onProgress - Optional progress callback
   * @param preComputedInput - Pre-computed PromptDesignerInput from wizard analysis
   * @param sdkConfig - SDK configuration (isPremium, mcpServerRunning, mcpPort)
   * @returns Wizard result with success status
   */
  async runWizard(
    workspacePath: string,
    config?: Partial<EnhancedPromptsConfig>,
    onProgress?: (progress: PromptGenerationProgress) => void,
    preComputedInput?: PromptDesignerInput,
    sdkConfig?: EnhancedPromptsSdkConfig
  ): Promise<EnhancedPromptsWizardResult> {
    if (!this.acquireGenerationLock()) {
      return {
        success: false,
        error: 'Generation already in progress',
      };
    }

    this.logger.info('EnhancedPromptsService: Starting wizard', {
      workspacePath,
      hasPreComputedInput: !!preComputedInput,
      hasSdkConfig: !!sdkConfig,
    });

    try {
      let detectedStack: DetectedStack;
      let input: PromptDesignerInput;

      if (preComputedInput) {
        // Use pre-computed input from wizard analysis — skip independent analysis
        this.logger.info(
          'EnhancedPromptsService: Using pre-computed input from wizard analysis'
        );
        input = preComputedInput;
        detectedStack = this.buildDetectedStackFromInput(preComputedInput);

        onProgress?.({
          status: 'analyzing',
          message: 'Using wizard analysis results...',
          progress: 0.3,
        });
      } else {
        // Step 1: Analyze workspace (original path)
        onProgress?.({
          status: 'analyzing',
          message: 'Analyzing workspace...',
          progress: 0.1,
        });

        const analysis = await this.workspaceIntelligence.analyzeWorkspace(
          workspacePath
        );

        // Validate workspace analysis result
        if (!analysis) {
          this.logger.error(
            'EnhancedPromptsService: Workspace analysis returned null',
            { workspacePath }
          );
          return {
            success: false,
            error:
              'Unable to analyze workspace. Please ensure the workspace contains a valid project structure.',
          };
        }

        // Step 2: Build detected stack
        detectedStack = this.buildDetectedStack(analysis);

        onProgress?.({
          status: 'analyzing',
          message: 'Preparing prompt generation...',
          progress: 0.3,
        });

        // Step 3: Build input for PromptDesignerAgent
        input = this.buildDesignerInput(workspacePath, analysis, config);
      }

      // Step 4: Generate guidance via InternalQueryService (Agent SDK)
      onProgress?.({
        status: 'generating',
        message: 'Generating project-specific guidance...',
        progress: 0.5,
      });

      const output = await this.generateGuidanceViaSdk(
        input,
        workspacePath,
        sdkConfig,
        (progress) => {
          // Map internal progress to 0.5 - 0.9 range
          const mappedProgress = 0.5 + (progress.progress || 0) * 0.004;
          onProgress?.({
            ...progress,
            progress: mappedProgress,
          });
        }
      );

      if (!output) {
        return {
          success: false,
          error: 'Failed to generate guidance - no output received',
        };
      }

      // Step 5: Build combined prompt content
      const generatedPrompt = this.buildCombinedPrompt(output);

      // Step 6: Compute dependency hash for cache validation
      const configHash = await this.cacheService.computeDependencyHash(
        workspacePath
      );

      // Step 7: Update state
      const newState: EnhancedPromptsState = {
        enabled: true,
        generatedAt: new Date().toISOString(),
        generatedPrompt,
        detectedStack,
        configHash,
        workspacePath,
      };

      await this.saveState(workspacePath, newState);

      // Step 8: Cache the output
      if (configHash) {
        await this.cacheService.set(workspacePath, configHash, output);
      }

      onProgress?.({
        status: 'complete',
        message: 'Enhanced Prompts setup complete!',
        progress: 1.0,
      });

      this.logger.info(
        'EnhancedPromptsService: Wizard completed successfully',
        {
          workspacePath,
          detectedStack,
          promptLength: generatedPrompt.length,
        }
      );

      return {
        success: true,
        state: newState,
      };
    } catch (error) {
      this.logger.error('EnhancedPromptsService: Wizard failed', {
        error: error instanceof Error ? error.message : String(error),
        workspacePath,
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    } finally {
      this.releaseGenerationLock();
    }
  }

  /**
   * Toggle Enhanced Prompts on/off for a workspace
   *
   * @param workspacePath - Workspace to toggle
   * @param enabled - New enabled state
   */
  async setEnabled(workspacePath: string, enabled: boolean): Promise<void> {
    const state = await this.loadState(workspacePath);
    state.enabled = enabled;
    await this.saveState(workspacePath, state);

    this.logger.info('EnhancedPromptsService: Toggled enabled state', {
      workspacePath,
      enabled,
    });
  }

  /**
   * Regenerate the Enhanced Prompt for a workspace
   *
   * @param workspacePath - Workspace to regenerate
   * @param request - Regeneration options
   * @param onProgress - Optional progress callback
   * @returns Regeneration result
   */
  async regenerate(
    workspacePath: string,
    request?: RegeneratePromptsRequest,
    onProgress?: (progress: PromptGenerationProgress) => void,
    sdkConfig?: EnhancedPromptsSdkConfig
  ): Promise<RegeneratePromptsResponse> {
    // Invalidate existing cache if forcing
    if (request?.force) {
      await this.cacheService.invalidate(workspacePath, 'manual');
    }

    // Run wizard again
    const result = await this.runWizard(
      workspacePath,
      request?.config,
      onProgress,
      undefined,
      sdkConfig
    );

    if (result.success) {
      const status = await this.getStatus(workspacePath);
      return {
        success: true,
        status,
      };
    }

    return {
      success: false,
      error: result.error,
    };
  }

  /**
   * Get the enhanced prompt content for a session
   *
   * This is the method called by SdkQueryOptionsBuilder to get the
   * prompt content to append to the system prompt.
   *
   * SECURITY: This method should only be called internally.
   * The returned content should never be exposed to users.
   *
   * @param workspacePath - Workspace to get prompt for
   * @returns Enhanced prompt content, or null if disabled or no generated prompt exists.
   *          When null is returned for an enabled workspace, it means no prompt has been
   *          generated yet -- the caller should fall back to PTAH_CORE_SYSTEM_PROMPT.
   */
  async getEnhancedPromptContent(
    workspacePath: string
  ): Promise<string | null> {
    const state = await this.loadState(workspacePath);

    // Return null if not enabled
    if (!state.enabled) {
      return null;
    }

    // Return cached prompt if available
    if (state.generatedPrompt) {
      return state.generatedPrompt;
    }

    // No prompt available - return null so the caller can decide what to do
    this.logger.info(
      'Enhanced prompts enabled but no generated prompt available. Run the setup wizard to generate enhanced prompts.',
      { workspacePath }
    );
    return null;
  }

  /**
   * Check if Enhanced Prompts is enabled for a workspace
   *
   * @param workspacePath - Workspace to check
   * @returns Whether Enhanced Prompts is enabled
   */
  async isEnabled(workspacePath: string): Promise<boolean> {
    const state = await this.loadState(workspacePath);
    return state.enabled;
  }

  /**
   * Check if the service is currently generating a prompt
   */
  isGeneratingPrompt(): boolean {
    return this.isGenerating;
  }

  // ==========================================================================
  // Private — SDK-based Guidance Generation
  // ==========================================================================

  /**
   * Generate guidance using InternalQueryService (Agent SDK).
   *
   * Flow:
   * 1. Build prompts via PromptDesignerAgent
   * 2. Execute SDK query with structured output
   * 3. Process stream to extract structured_output from result message
   * 4. Parse and validate output via PromptDesignerAgent
   * 5. Fall back to template-based guidance on failure
   */
  private async generateGuidanceViaSdk(
    input: PromptDesignerInput,
    workspacePath: string,
    sdkConfig?: EnhancedPromptsSdkConfig,
    onProgress?: (progress: PromptGenerationProgress) => void
  ): Promise<PromptDesignerOutput | null> {
    const isPremium = sdkConfig?.isPremium ?? false;
    const mcpServerRunning = sdkConfig?.mcpServerRunning ?? false;
    const mcpPort = sdkConfig?.mcpPort;

    try {
      // 1. Build prompts + schema via PromptDesignerAgent
      const { systemPrompt, userPrompt, outputSchema, qualityAssessment } =
        await this.promptDesignerAgent.buildPrompts(input);

      onProgress?.({
        status: 'generating',
        message: 'Calling AI agent for guidance generation...',
        progress: 40,
      });

      // 2. Get model from config
      const model = this.config.getWithDefault<string>(
        'model.selected',
        'claude-sonnet-4-5-20250929'
      );

      // 3. Execute SDK query with structured output
      const abortController = new AbortController();
      const handle = await this.internalQueryService.execute({
        cwd: workspacePath,
        model,
        prompt: userPrompt,
        systemPromptAppend: systemPrompt,
        isPremium,
        mcpServerRunning,
        mcpPort,
        maxTurns: 10,
        abortController,
        outputFormat: {
          type: 'json_schema',
          schema: outputSchema,
        },
      });

      try {
        // 4. Process stream and extract structured output
        const structuredOutput = await this.processPromptDesignerStream(
          handle.stream,
          abortController,
          sdkConfig?.onStreamEvent
        );

        if (structuredOutput) {
          // 5. Parse and validate via PromptDesignerAgent
          const output = await this.promptDesignerAgent.parseAndValidateOutput(
            structuredOutput,
            onProgress
          );

          if (output) {
            // Enhance with quality data if available
            if (qualityAssessment) {
              output.qualityScore = qualityAssessment.score;
              output.qualityAssessment = qualityAssessment;
            }
            return output;
          }
        }

        // Structured output not available — use fallback
        this.logger.warn(
          `${SERVICE_TAG} SDK query completed but no structured output, using fallback`
        );
      } finally {
        handle.close();
      }
    } catch (error) {
      this.logger.error(`${SERVICE_TAG} SDK guidance generation failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to template-based guidance
    onProgress?.({
      status: 'fallback',
      message: 'Using template-based guidance',
    });

    return this.promptDesignerAgent.generateFallbackGuidance(
      input,
      undefined,
      'SDK guidance generation failed'
    );
  }

  /**
   * Process the SDK message stream to extract structured_output.
   *
   * Follows the same pattern as AgenticAnalysisService.processStream():
   * iterates the stream looking for a 'result' message with structured_output.
   * Optionally broadcasts stream events for live UI updates.
   *
   * @param stream - SDK message async iterable
   * @param abortController - Controller for cancellation
   * @param onStreamEvent - Optional callback for real-time stream events
   */
  private async processPromptDesignerStream(
    stream: AsyncIterable<SDKMessage>,
    abortController: AbortController,
    onStreamEvent?: (event: AnalysisStreamPayload) => void
  ): Promise<unknown | null> {
    // Throttle state for text and thinking deltas (100ms)
    let lastTextEmit = 0;
    let lastThinkingEmit = 0;
    const THROTTLE_MS = 100;

    // Track active tool blocks for tool call grouping
    const activeToolBlocks = new Map<
      number,
      { name: string; inputBuffer: string; toolCallId: string }
    >();

    try {
      for await (const message of stream) {
        // ==============================================================
        // Stream events -- broadcast for live UI updates
        // ==============================================================
        if (message.type === 'stream_event' && onStreamEvent) {
          const event = message.event;

          // Content block deltas: text, tool input, thinking
          if (isContentBlockDelta(event)) {
            if (isTextDelta(event.delta)) {
              const now = Date.now();
              if (now - lastTextEmit >= THROTTLE_MS) {
                const trimmed = event.delta.text.trim();
                if (trimmed.length > 0) {
                  lastTextEmit = now;
                  try {
                    onStreamEvent({
                      kind: 'text',
                      content: event.delta.text,
                      timestamp: now,
                    });
                  } catch {
                    // Fire-and-forget: swallow callback errors
                  }
                }
              }
            }

            if (isInputJsonDelta(event.delta)) {
              const activeBlock = activeToolBlocks.get(event.index);
              if (activeBlock) {
                activeBlock.inputBuffer += event.delta.partial_json;
              }
            }

            if (isThinkingDelta(event.delta)) {
              const now = Date.now();
              if (now - lastThinkingEmit >= THROTTLE_MS) {
                lastThinkingEmit = now;
                try {
                  onStreamEvent({
                    kind: 'thinking',
                    content: event.delta.thinking,
                    timestamp: now,
                  });
                } catch {
                  // Fire-and-forget: swallow callback errors
                }
              }
            }
          }

          // Tool use start -- track active tool blocks
          if (
            isContentBlockStart(event) &&
            event.content_block.type === 'tool_use'
          ) {
            const toolCallId = `enhance-${event.index}-${Date.now()}`;
            activeToolBlocks.set(event.index, {
              name: event.content_block.name,
              inputBuffer: '',
              toolCallId,
            });

            try {
              onStreamEvent({
                kind: 'tool_start',
                content: `Calling ${event.content_block.name}`,
                toolName: event.content_block.name,
                toolCallId,
                timestamp: Date.now(),
              });
            } catch {
              // Fire-and-forget: swallow callback errors
            }
          }

          // Tool use stop -- emit accumulated tool input
          if (isContentBlockStop(event)) {
            const completedBlock = activeToolBlocks.get(event.index);
            if (completedBlock) {
              try {
                onStreamEvent({
                  kind: 'tool_input',
                  content: completedBlock.inputBuffer.substring(0, 2000),
                  toolName: completedBlock.name,
                  toolCallId: completedBlock.toolCallId,
                  timestamp: Date.now(),
                });
              } catch {
                // Fire-and-forget: swallow callback errors
              }
              activeToolBlocks.delete(event.index);
            }
          }
        }

        // ==============================================================
        // Result message -- extract structured_output
        // ==============================================================
        if (message.type === 'result') {
          if (message.subtype === 'success') {
            this.logger.info(`${SERVICE_TAG} SDK query completed`, {
              turns: message.num_turns,
              cost: message.total_cost_usd,
              hasStructuredOutput: !!message.structured_output,
            });

            if (message.structured_output) {
              return message.structured_output;
            }

            // Try to parse from result text as fallback
            if (message.result) {
              try {
                return JSON.parse(message.result);
              } catch {
                this.logger.warn(
                  `${SERVICE_TAG} Could not parse result text as JSON`
                );
              }
            }

            return null;
          }

          // Error result
          const errorResult = message as {
            subtype: string;
            errors?: string[];
          };
          this.logger.error(`${SERVICE_TAG} SDK query failed`, {
            subtype: errorResult.subtype,
            errors: errorResult.errors,
          });
          return null;
        }

        // Log assistant messages for debugging
        if (message.type === 'assistant') {
          this.logger.debug(`${SERVICE_TAG} Assistant message`, {
            contentBlocks: message.message.content.length,
          });
        }
      }

      this.logger.warn(`${SERVICE_TAG} Stream ended without result`);
      return null;
    } catch (error) {
      if (abortController.signal.aborted) {
        this.logger.warn(`${SERVICE_TAG} Stream aborted`);
        return null;
      }
      throw error;
    }
  }

  // ==========================================================================
  // Private — State Management
  // ==========================================================================

  /**
   * Load state from storage
   */
  private async loadState(
    workspacePath: string
  ): Promise<EnhancedPromptsState> {
    // Check in-memory cache first (using Map keyed by workspace path)
    const cachedState = this.stateByWorkspace.get(workspacePath);
    if (cachedState) {
      return cachedState;
    }

    // Load from persistent storage
    const storageKey = this.getStorageKey(workspacePath);
    const stored =
      this.context.globalState.get<EnhancedPromptsState>(storageKey);

    if (stored) {
      this.stateByWorkspace.set(workspacePath, stored);
      return stored;
    }

    // Return initial state
    const initial = createInitialEnhancedPromptsState(workspacePath);
    this.stateByWorkspace.set(workspacePath, initial);
    return initial;
  }

  /**
   * Save state to storage
   */
  private async saveState(
    workspacePath: string,
    state: EnhancedPromptsState
  ): Promise<void> {
    const storageKey = this.getStorageKey(workspacePath);
    await this.context.globalState.update(storageKey, state);
    this.stateByWorkspace.set(workspacePath, state);
  }

  /**
   * Get storage key for workspace
   *
   * Uses base64url encoding of the workspace path to avoid hash collisions.
   * Base64url replaces characters that are problematic in storage keys.
   */
  private getStorageKey(workspacePath: string): string {
    // Use base64url encoding for collision-free storage keys
    // This encodes the full path, eliminating hash collision risk
    const encoded = Buffer.from(workspacePath, 'utf-8')
      .toString('base64')
      // Convert base64 to base64url (URL-safe, no padding)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return `${STATE_STORAGE_KEY}.${encoded}`;
  }

  // ==========================================================================
  // Private — Stack Detection & Input Building
  // ==========================================================================

  /**
   * Build DetectedStack from pre-computed PromptDesignerInput.
   * Used when wizard analysis is threaded through instead of running independent analysis.
   *
   * Categorizes dependencies into build tools, testing frameworks, and additional tools
   * so the UI displays meaningful stack information instead of empty arrays.
   */
  private buildDetectedStackFromInput(
    input: PromptDesignerInput
  ): DetectedStack {
    const frameworks: string[] = [];
    if (input.framework) {
      frameworks.push(input.framework);
    }

    // Pattern-match dependencies for build tools
    const buildToolPatterns = [
      'webpack',
      'vite',
      'esbuild',
      'rollup',
      'parcel',
      'turbo',
      '@nx/',
      'nx',
      'gradle',
      'maven',
      'cargo',
      'gulp',
      'grunt',
    ];
    const allDeps = [...input.dependencies, ...input.devDependencies];
    const buildTools = allDeps
      .filter((dep) => buildToolPatterns.some((p) => dep.includes(p)))
      .slice(0, 10);

    // Add monorepo type as a build tool
    if (
      input.isMonorepo &&
      input.monorepoType &&
      !buildTools.includes(input.monorepoType)
    ) {
      buildTools.unshift(input.monorepoType);
    }

    // Pattern-match dev dependencies for testing frameworks
    const testPatterns = [
      'jest',
      'vitest',
      'mocha',
      'jasmine',
      'karma',
      'cypress',
      'playwright',
      'testing-library',
      'pytest',
      'junit',
      'ava',
    ];
    const testingFrameworks = input.devDependencies
      .filter((dep) => testPatterns.some((p) => dep.includes(p)))
      .slice(0, 10);

    // Remaining deps as additional tools (excluding already-categorized ones)
    const categorized = new Set([...buildTools, ...testingFrameworks]);
    const additionalTools = allDeps
      .filter(
        (dep) =>
          !dep.startsWith('@types/') &&
          !dep.startsWith('.') &&
          !categorized.has(dep)
      )
      .slice(0, 15);

    return {
      languages: input.languages ?? [],
      frameworks,
      buildTools,
      testingFrameworks,
      additionalTools,
      projectType: input.isMonorepo ? 'monorepo' : input.projectType,
      configFiles: [],
    };
  }

  /**
   * Build DetectedStack from workspace analysis.
   *
   * Uses the workspace analyzer's own detection results directly instead of
   * hard-coded regex patterns. The analyzer already identifies the primary
   * framework, languages, and project type — we pass those through and
   * extract additional info from dependency names dynamically.
   */
  private buildDetectedStack(analysis: WorkspaceAnalysisResult): DetectedStack {
    // Use the analyzer's detected framework as primary
    const frameworks: string[] = [];
    if (analysis.framework) {
      frameworks.push(analysis.framework);
    }

    // Build tools from monorepo type
    const buildTools: string[] = [];
    if (analysis.isMonorepo && analysis.monorepoType) {
      buildTools.push(analysis.monorepoType);
    }

    // Pass through all dependencies — the LLM will determine what's relevant
    // We just categorize broadly for UI display purposes
    const allDeps = [...analysis.dependencies, ...analysis.devDependencies];

    // Use dependency names directly as discovered tools (no regex matching)
    // The LLM prompt receives the full dependency list for intelligent analysis
    const additionalTools = allDeps
      .filter(
        (dep) =>
          // Filter out internal/scoped packages that are just noise for display
          !dep.startsWith('@types/') && !dep.startsWith('.')
      )
      .slice(0, 15); // Limit for display purposes

    return {
      languages: analysis.languages.length > 0 ? analysis.languages : [],
      frameworks,
      buildTools,
      testingFrameworks: [], // LLM detects from dependency list
      additionalTools,
      projectType: analysis.isMonorepo ? 'monorepo' : analysis.projectType,
      configFiles: analysis.configFiles,
    };
  }

  /**
   * Build input for PromptDesignerAgent
   */
  private buildDesignerInput(
    workspacePath: string,
    analysis: WorkspaceAnalysisResult,
    config?: Partial<EnhancedPromptsConfig>
  ): PromptDesignerInput {
    const finalConfig = { ...DEFAULT_ENHANCED_PROMPTS_CONFIG, ...config };

    return {
      workspacePath,
      projectType: analysis.projectType,
      framework: analysis.framework,
      isMonorepo: analysis.isMonorepo,
      monorepoType: analysis.monorepoType,
      dependencies: analysis.dependencies,
      devDependencies: analysis.devDependencies,
      tokenBudget: finalConfig.maxTokens,
    };
  }

  /**
   * Build combined prompt from PromptDesignerOutput
   *
   * Combines the PTAH_CORE_SYSTEM_PROMPT with generated guidance
   */
  private buildCombinedPrompt(output: PromptDesignerOutput): string {
    const sections: string[] = [];

    // Add core system prompt first
    sections.push(PTAH_CORE_SYSTEM_PROMPT);

    // Add project-specific context
    sections.push('\n## Project-Specific Guidance\n');

    if (output.projectContext) {
      sections.push(`### Project Context\n${output.projectContext}\n`);
    }

    if (output.frameworkGuidelines) {
      sections.push(
        `### Framework Guidelines\n${output.frameworkGuidelines}\n`
      );
    }

    if (output.codingStandards) {
      sections.push(`### Coding Standards\n${output.codingStandards}\n`);
    }

    if (output.architectureNotes) {
      sections.push(`### Architecture Notes\n${output.architectureNotes}\n`);
    }

    return sections.join('\n');
  }
}
