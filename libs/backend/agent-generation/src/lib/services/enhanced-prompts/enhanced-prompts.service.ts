/**
 * Enhanced Prompts Service
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
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import type { AnalysisStreamPayload } from '@ptah-extension/shared';
import {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
  SDK_TOKENS,
  SdkStreamProcessor,
  discoverPluginSkills,
  formatSkillsForPrompt,
} from '@ptah-extension/agent-sdk';
import type {
  InternalQueryService,
  SDKMessage,
  StreamEventEmitter,
  StreamEvent,
} from '@ptah-extension/agent-sdk';
import { AGENT_GENERATION_TOKENS } from '../../di/tokens';
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
  EnhancedPromptsSummary,
  DetectedStack,
  EnhancedPromptsConfig,
  RegeneratePromptsRequest,
  RegeneratePromptsResponse,
  DEFAULT_ENHANCED_PROMPTS_CONFIG,
} from '../../types/enhanced-prompts.types';
import { EnhancedPromptsStateStore } from './enhanced-prompts-state-store';

/**
 * SDK configuration for internal query execution
 */
export interface EnhancedPromptsSdkConfig {
  isPremium: boolean;
  mcpServerRunning: boolean;
  mcpPort?: number;
  /** Model to use for generation. Overrides the `model.selected` config when provided. */
  model?: string;
  /** Callback for real-time stream events (text, tool calls, thinking) */
  onStreamEvent?: (event: AnalysisStreamPayload) => void;
  /** Absolute paths to plugin directories */
  pluginPaths?: string[];
}

/**
 * Minimal interface for reading multi-phase analysis data.
 * Avoids tight coupling to AnalysisStorageService from agent-generation.
 */
export interface IMultiPhaseAnalysisReader {
  findLatestMultiPhaseAnalysis(workspacePath: string): Promise<{
    slugDir: string;
    manifest: {
      phases: Record<string, { status: string; file: string }>;
    };
  } | null>;
  readPhaseFile(slugDir: string, filename: string): Promise<string | null>;
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
 * Workspace Intelligence service interface.
 *
 * Maps to WorkspaceAnalyzerService which exposes getProjectInfo() and
 * getCurrentWorkspaceInfo() — NOT analyzeWorkspace().
 */
interface IWorkspaceIntelligence {
  getProjectInfo(): Promise<{
    name: string;
    type: string;
    path: string;
    dependencies: string[];
    devDependencies: string[];
    fileStatistics: Record<string, number>;
    totalFiles: number;
  }>;
  getCurrentWorkspaceInfo():
    | {
        name: string;
        path: string;
        projectType: string;
        frameworks?: readonly string[];
      }
    | undefined;
}

/**
 * Result from workspace analysis (assembled from getProjectInfo + getCurrentWorkspaceInfo)
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
   * Workspace-keyed state persistence (in-memory + globalState).
   */
  private readonly stateStore: EnhancedPromptsStateStore;

  /**
   * Generation lock with timeout-based auto-release
   */
  private isGenerating = false;
  private generationLockTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Optional multi-phase analysis reader for enriching prompts with
   * quality audit and elevation plan data. Set via setAnalysisReader()
   * from the application's DI setup to avoid cross-library constructor coupling.
   */
  private analysisReader: IMultiPhaseAnalysisReader | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AGENT_GENERATION_TOKENS.PROMPT_DESIGNER_AGENT)
    private readonly promptDesignerAgent: PromptDesignerAgent,
    @inject(AGENT_GENERATION_TOKENS.PROMPT_CACHE_SERVICE)
    private readonly cacheService: PromptCacheService,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: IExtensionContext,
    @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)
    private readonly workspaceIntelligence: IWorkspaceIntelligence,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
  ) {
    this.stateStore = new EnhancedPromptsStateStore(this.context);
    this.cacheService.onInvalidation((event) => {
      this.logger.info(
        'EnhancedPromptsService: Cache invalidated, prompt needs regeneration',
        {
          reason: event.reason,
          workspacePath: event.workspacePath,
        },
      );
      const state = this.stateStore.peek(event.workspacePath);
      if (state) {
        state.configHash = null; // Mark as stale
      }
    });
  }

  /**
   * Set the optional multi-phase analysis reader.
   * Called from the application's DI container setup after both agent-sdk
   * and agent-generation services are registered.
   *
   * @param reader - AnalysisStorageService instance (or compatible reader)
   */
  setAnalysisReader(reader: IMultiPhaseAnalysisReader): void {
    this.analysisReader = reader;
    this.logger.info(`${SERVICE_TAG} Multi-phase analysis reader configured`);
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
    this.generationLockTimer = setTimeout(() => {
      this.logger.warn(
        'EnhancedPromptsService: Generation lock timed out, force releasing',
        { timeoutMs: GENERATION_LOCK_TIMEOUT_MS },
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
    const state = await this.stateStore.load(workspacePath);
    let cacheValid = false;
    let invalidationReason: string | undefined;

    if (state.enabled && state.generatedPrompt) {
      const baseDependencyHash =
        await this.cacheService.computeDependencyHash(workspacePath);
      const dependencyHash = baseDependencyHash
        ? `${baseDependencyHash}:pt${PTAH_CORE_SYSTEM_PROMPT_TOKENS}`
        : null;
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
    sdkConfig?: EnhancedPromptsSdkConfig,
    analysisDir?: string,
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
        this.logger.info(
          'EnhancedPromptsService: Using pre-computed input from wizard analysis',
        );
        input = preComputedInput;
        detectedStack = this.buildDetectedStackFromInput(preComputedInput);

        onProgress?.({
          status: 'analyzing',
          message: 'Using wizard analysis results...',
          progress: 0.3,
        });
      } else {
        onProgress?.({
          status: 'analyzing',
          message: 'Analyzing workspace...',
          progress: 0.1,
        });

        let analysis: WorkspaceAnalysisResult;
        try {
          const projectInfo = await this.workspaceIntelligence.getProjectInfo();
          const wsInfo = this.workspaceIntelligence.getCurrentWorkspaceInfo();
          const languageMap: Record<string, string> = {
            '.ts': 'TypeScript',
            '.tsx': 'TypeScript',
            '.js': 'JavaScript',
            '.jsx': 'JavaScript',
            '.py': 'Python',
            '.java': 'Java',
            '.rs': 'Rust',
            '.go': 'Go',
            '.cs': 'C#',
            '.php': 'PHP',
            '.rb': 'Ruby',
          };
          const detectedLangs = new Set<string>();
          for (const ext of Object.keys(projectInfo.fileStatistics)) {
            const lang = languageMap[ext];
            if (lang) detectedLangs.add(lang);
          }

          analysis = {
            projectType: String(projectInfo.type),
            framework: wsInfo?.frameworks?.[0],
            isMonorepo: projectInfo.dependencies.some(
              (d) =>
                d.includes('nx') || d.includes('lerna') || d.includes('turbo'),
            ),
            monorepoType: undefined,
            dependencies: projectInfo.dependencies,
            devDependencies: projectInfo.devDependencies,
            configFiles: [],
            languages: [...detectedLangs],
          };
        } catch (err) {
          this.logger.error(
            'EnhancedPromptsService: Workspace analysis failed',
            {
              workspacePath,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          return {
            success: false,
            error:
              'Unable to analyze workspace. Please ensure the workspace contains a valid project structure.',
          };
        }
        detectedStack = this.buildDetectedStack(analysis);

        onProgress?.({
          status: 'analyzing',
          message: 'Preparing prompt generation...',
          progress: 0.3,
        });
        input = this.buildDesignerInput(workspacePath, analysis, config);
      }
      await this.enrichWithMultiPhaseAnalysis(
        input,
        workspacePath,
        analysisDir,
      );
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
          const mappedProgress = 0.5 + (progress.progress || 0) * 0.004;
          onProgress?.({
            ...progress,
            progress: mappedProgress,
          });
        },
      );

      if (!output) {
        return {
          success: false,
          error: 'Failed to generate guidance - no output received',
        };
      }
      const generatedPrompt = this.buildCombinedPrompt(output, sdkConfig);
      const baseHash =
        await this.cacheService.computeDependencyHash(workspacePath);
      const configHash = baseHash
        ? `${baseHash}:pt${PTAH_CORE_SYSTEM_PROMPT_TOKENS}`
        : null;
      const newState: EnhancedPromptsState = {
        enabled: true,
        generatedAt: new Date().toISOString(),
        generatedPrompt,
        detectedStack,
        configHash,
        workspacePath,
      };

      await this.stateStore.save(workspacePath, newState);
      if (configHash) {
        await this.cacheService.set(workspacePath, configHash, output);
      }

      onProgress?.({
        status: 'complete',
        message: 'Enhanced Prompts setup complete!',
        progress: 1.0,
      });
      const summary = this.buildSummary(output);

      this.logger.info(
        'EnhancedPromptsService: Wizard completed successfully',
        {
          workspacePath,
          detectedStack,
          promptLength: generatedPrompt.length,
        },
      );

      return {
        success: true,
        state: newState,
        summary,
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
    const state = await this.stateStore.load(workspacePath);
    state.enabled = enabled;
    await this.stateStore.save(workspacePath, state);

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
    sdkConfig?: EnhancedPromptsSdkConfig,
  ): Promise<RegeneratePromptsResponse> {
    let analysisDir: string | undefined;
    if (this.analysisReader) {
      const analysis =
        await this.analysisReader.findLatestMultiPhaseAnalysis(workspacePath);
      if (analysis) {
        analysisDir = analysis.slugDir;
        this.logger.info(
          'EnhancedPromptsService: Regenerate using existing analysis',
          { analysisDir },
        );
      }
    }

    if (!analysisDir) {
      return {
        success: false,
        error:
          'No existing workspace analysis found. Please run the Setup Wizard first to analyze your workspace, then regenerate.',
      };
    }
    if (request?.force) {
      await this.cacheService.invalidate(workspacePath, 'manual');
    }
    const result = await this.runWizard(
      workspacePath,
      request?.config,
      onProgress,
      undefined,
      sdkConfig,
      analysisDir,
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
    workspacePath: string,
  ): Promise<string | null> {
    const state = await this.stateStore.load(workspacePath);
    if (!state.enabled) {
      return null;
    }
    if (state.generatedPrompt) {
      return state.generatedPrompt;
    }
    this.logger.info(
      'Enhanced prompts enabled but no generated prompt available. Run the setup wizard to generate enhanced prompts.',
      { workspacePath },
    );
    return null;
  }

  /**
   * Get the full combined system prompt as it appears at runtime.
   *
   * Combines PTAH_CORE_SYSTEM_PROMPT (base behavioral guidance) with the
   * project-specific enhanced prompt content. This is what the settings UI
   * shows for preview and what gets exported on download.
   *
   * @param workspacePath - Workspace to get prompt for
   * @returns Full combined prompt, or null if disabled or no generated prompt exists
   */
  async getFullCombinedPromptContent(
    workspacePath: string,
  ): Promise<string | null> {
    const enhancedContent = await this.getEnhancedPromptContent(workspacePath);

    if (!enhancedContent) {
      return null;
    }

    return `${PTAH_CORE_SYSTEM_PROMPT}\n\n${enhancedContent}`;
  }

  /**
   * Check if Enhanced Prompts is enabled for a workspace
   *
   * @param workspacePath - Workspace to check
   * @returns Whether Enhanced Prompts is enabled
   */
  async isEnabled(workspacePath: string): Promise<boolean> {
    const state = await this.stateStore.load(workspacePath);
    return state.enabled;
  }

  /**
   * Get only the project-specific guidance content from the enhanced prompt.
   *
   * Extracts the "## Project-Specific Guidance" section and all its subsections
   * (Project Context, Framework Guidelines, Coding Standards, Architecture Notes)
   * while excluding PTAH_CORE_SYSTEM_PROMPT and PTAH_SYSTEM_PROMPT which are
   * Claude-specific and not applicable to CLI agents (Codex, Copilot).
   *
   * @param workspacePath - Workspace to get guidance for
   * @returns Project-specific guidance content, or null if disabled/unavailable
   */
  async getProjectGuidanceContent(
    workspacePath: string,
  ): Promise<string | null> {
    const state = await this.stateStore.load(workspacePath);
    if (!state.enabled || !state.generatedPrompt) return null;
    const marker = '## Project-Specific Guidance';
    const idx = state.generatedPrompt.indexOf(marker);
    if (idx === -1) return null;

    return state.generatedPrompt.substring(idx).trim();
  }

  /**
   * Check if the service is currently generating a prompt
   */
  isGeneratingPrompt(): boolean {
    return this.isGenerating;
  }

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
    onProgress?: (progress: PromptGenerationProgress) => void,
  ): Promise<PromptDesignerOutput | null> {
    const isPremium = sdkConfig?.isPremium ?? false;
    const mcpServerRunning = false;
    const mcpPort = undefined;

    try {
      const {
        systemPrompt: baseSystemPrompt,
        userPrompt,
        outputSchema,
        qualityAssessment,
      } = await this.promptDesignerAgent.buildPrompts(input);
      let systemPrompt = baseSystemPrompt;
      if (sdkConfig?.pluginPaths && sdkConfig.pluginPaths.length > 0) {
        const skills = discoverPluginSkills(sdkConfig.pluginPaths);
        if (skills.length > 0) {
          systemPrompt += `\n\n## Available Plugin Skills\nThe enhanced prompts should reference these skills where relevant:\n${formatSkillsForPrompt(
            skills,
          )}`;
        }
      }

      onProgress?.({
        status: 'generating',
        message: 'Calling AI agent for guidance generation...',
        progress: 40,
      });
      const configModel = this.modelSettings.selectedModel.get();
      const model = sdkConfig?.model || configModel || 'default';
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
        pluginPaths: sdkConfig?.pluginPaths,
      });

      try {
        const structuredOutput = await this.processPromptDesignerStream(
          handle.stream,
          abortController,
          sdkConfig?.onStreamEvent,
        );

        if (structuredOutput) {
          const output = await this.promptDesignerAgent.parseAndValidateOutput(
            structuredOutput,
            onProgress,
          );

          if (output) {
            if (qualityAssessment) {
              output.qualityScore = qualityAssessment.score;
              output.qualityAssessment = qualityAssessment;
            }
            return output;
          }
        }
        this.logger.warn(
          `${SERVICE_TAG} SDK query completed but no structured output, using fallback`,
        );
      } finally {
        handle.close();
      }
    } catch (error) {
      const errMsg =
        error instanceof Error
          ? error.message || error.constructor.name
          : String(error) || 'unknown error';
      this.logger.error(`${SERVICE_TAG} SDK guidance generation failed`, {
        error: errMsg,
        stack:
          error instanceof Error
            ? error.stack?.split('\n')[1]?.trim()
            : undefined,
      });
    }
    onProgress?.({
      status: 'fallback',
      message: 'Using template-based guidance',
    });

    return this.promptDesignerAgent.generateFallbackGuidance(
      input,
      undefined,
      'SDK guidance generation failed',
    );
  }

  /**
   * Process the SDK message stream to extract structured_output.
   *
   * Delegates to SdkStreamProcessor for stream iteration, throttling,
   * and event emission. Optionally broadcasts stream events for live UI updates.
   *
   * @param stream - SDK message async iterable
   * @param abortController - Controller for cancellation
   * @param onStreamEvent - Optional callback for real-time stream events
   */
  private async processPromptDesignerStream(
    stream: AsyncIterable<SDKMessage>,
    abortController: AbortController,
    onStreamEvent?: (event: AnalysisStreamPayload) => void,
  ): Promise<unknown | null> {
    const emitter: StreamEventEmitter = {
      emit: (event: StreamEvent) => {
        if (onStreamEvent) {
          onStreamEvent(event);
        }
      },
    };

    const processor = new SdkStreamProcessor({
      emitter,
      toolCallIdFactory: (_name, index) => `enhance-${index}-${Date.now()}`,
      logger: this.logger,
      serviceTag: SERVICE_TAG,
    });

    try {
      const result = await processor.process(stream);
      return result.structuredOutput;
    } catch (error) {
      if (abortController.signal.aborted) {
        this.logger.warn(`${SERVICE_TAG} Stream aborted`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Enrich PromptDesignerInput with multi-phase analysis data when available.
   *
   * Reads all 4 LLM-generated phase files from the multi-phase analysis:
   * - 01-project-profile.md: Project type, stack, architecture overview
   * - 02-architecture-assessment.md: Patterns, boundaries, dependency flow
   * - 03-quality-audit.md: Code quality findings, anti-patterns
   * - 04-elevation-plan.md: Improvement priorities and recommendations
   *
   * These are set as `additionalContext` on the input, giving the
   * PromptDesignerAgent much richer context for generating project-specific
   * enhanced prompts.
   *
   * Non-critical: any failure is logged and the flow continues without enrichment.
   *
   * @param input - PromptDesignerInput to enrich (mutated in place)
   * @param workspacePath - Workspace path to search for analysis data
   * @param explicitAnalysisDir - Optional explicit analysis directory path (from wizard state)
   */
  private async enrichWithMultiPhaseAnalysis(
    input: PromptDesignerInput,
    workspacePath: string,
    explicitAnalysisDir?: string,
  ): Promise<void> {
    if (!this.analysisReader) {
      return;
    }

    try {
      let slugDir: string;
      let manifest: {
        phases: Record<string, { status: string; file: string }>;
      };

      if (explicitAnalysisDir) {
        const manifestContent = await this.analysisReader.readPhaseFile(
          explicitAnalysisDir,
          'manifest.json',
        );
        if (!manifestContent) {
          this.logger.warn(
            `${SERVICE_TAG} No manifest found in explicit analysis dir`,
            { explicitAnalysisDir },
          );
          return;
        }
        slugDir = explicitAnalysisDir;
        manifest = JSON.parse(manifestContent);
      } else {
        const multiPhase =
          await this.analysisReader.findLatestMultiPhaseAnalysis(workspacePath);
        if (!multiPhase) {
          return;
        }
        slugDir = multiPhase.slugDir;
        manifest = multiPhase.manifest;
      }
      const phaseFiles = [
        { key: 'project-profile', label: 'Project Profile', limit: 8_000 },
        {
          key: 'architecture-assessment',
          label: 'Architecture Assessment',
          limit: 8_000,
        },
        {
          key: 'quality-audit',
          label: 'Quality Audit Findings',
          limit: 10_000,
        },
        {
          key: 'elevation-plan',
          label: 'Elevation Plan Priorities',
          limit: 5_000,
        },
      ];

      const sections: string[] = [];

      for (const phase of phaseFiles) {
        const phaseEntry = manifest.phases?.[phase.key];
        if (!phaseEntry || phaseEntry.status !== 'completed') {
          continue;
        }

        const content = await this.analysisReader.readPhaseFile(
          slugDir,
          phaseEntry.file,
        );

        if (content) {
          sections.push(
            `## ${phase.label}\n${content.substring(0, phase.limit)}`,
          );
        }
      }

      if (sections.length > 0) {
        const newContext = sections.join('\n\n');
        input.additionalContext = input.additionalContext
          ? `${input.additionalContext}\n\n${newContext}`
          : newContext;

        this.logger.info(
          `${SERVICE_TAG} Enriched input with multi-phase analysis`,
          {
            phasesLoaded: sections.length,
            usedExplicitDir: !!explicitAnalysisDir,
            additionalContextLength: input.additionalContext.length,
          },
        );
      }
    } catch (error) {
      this.logger.warn(`${SERVICE_TAG} Failed to read multi-phase analysis`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Build DetectedStack from pre-computed PromptDesignerInput.
   * Used when wizard analysis is threaded through instead of running independent analysis.
   *
   * Categorizes dependencies into build tools, testing frameworks, and additional tools
   * so the UI displays meaningful stack information instead of empty arrays.
   */
  private buildDetectedStackFromInput(
    input: PromptDesignerInput,
  ): DetectedStack {
    const frameworks: string[] = [];
    if (input.framework) {
      frameworks.push(input.framework);
    }
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
    if (
      input.isMonorepo &&
      input.monorepoType &&
      !buildTools.includes(input.monorepoType)
    ) {
      buildTools.unshift(input.monorepoType);
    }
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
    const categorized = new Set([...buildTools, ...testingFrameworks]);
    const additionalTools = allDeps
      .filter(
        (dep) =>
          !dep.startsWith('@types/') &&
          !dep.startsWith('.') &&
          !categorized.has(dep),
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
    const frameworks: string[] = [];
    if (analysis.framework) {
      frameworks.push(analysis.framework);
    }
    const buildTools: string[] = [];
    if (analysis.isMonorepo && analysis.monorepoType) {
      buildTools.push(analysis.monorepoType);
    }
    const allDeps = [...analysis.dependencies, ...analysis.devDependencies];
    const additionalTools = allDeps
      .filter((dep) => !dep.startsWith('@types/') && !dep.startsWith('.'))
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
    config?: Partial<EnhancedPromptsConfig>,
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
   * Build a summary of what was generated for frontend display.
   * Never includes actual prompt content (IP protection).
   */
  private buildSummary(output: PromptDesignerOutput): EnhancedPromptsSummary {
    const wordCount = (text: string) =>
      text.split(/\s+/).filter(Boolean).length;

    const sections: EnhancedPromptsSummary['sections'] = [
      {
        name: 'Project Context',
        wordCount: wordCount(output.projectContext),
        generated: !!output.projectContext,
      },
      {
        name: 'Framework Guidelines',
        wordCount: wordCount(output.frameworkGuidelines),
        generated: !!output.frameworkGuidelines,
      },
      {
        name: 'Coding Standards',
        wordCount: wordCount(output.codingStandards),
        generated: !!output.codingStandards,
      },
      {
        name: 'Architecture Notes',
        wordCount: wordCount(output.architectureNotes),
        generated: !!output.architectureNotes,
      },
    ];

    if (output.qualityGuidance) {
      sections.push({
        name: 'Quality Guidance',
        wordCount: wordCount(output.qualityGuidance),
        generated: true,
      });
    }

    return {
      sections,
      totalTokens: output.totalTokens,
      qualityScore: output.qualityScore,
      usedFallback: output.usedFallback ?? false,
    };
  }

  /**
   * Build combined prompt from PromptDesignerOutput
   *
   * Builds the project-specific guidance content from PromptDesignerOutput.
   * MCP documentation now appears only in tool descriptions, not in the system prompt.
   *
   * @param output - PromptDesignerOutput from generation
   * @param sdkConfig - SDK configuration (unused after MCP docs removal, kept for API stability)
   * @returns Combined prompt string with all sections
   */
  private buildCombinedPrompt(
    output: PromptDesignerOutput,
    _sdkConfig?: EnhancedPromptsSdkConfig,
  ): string {
    const sections: string[] = [];
    sections.push('## Project-Specific Guidance\n');

    if (output.projectContext) {
      sections.push(`### Project Context\n${output.projectContext}\n`);
    }

    if (output.frameworkGuidelines) {
      sections.push(
        `### Framework Guidelines\n${output.frameworkGuidelines}\n`,
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
