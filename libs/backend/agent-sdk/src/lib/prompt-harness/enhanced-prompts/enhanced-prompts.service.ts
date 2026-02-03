/**
 * Enhanced Prompts Service
 *
 * TASK_2025_137 Batch 4: Main orchestration service for the Enhanced Prompts feature.
 *
 * This premium feature:
 * 1. Analyzes the workspace to detect technology stack
 * 2. Uses PromptDesignerAgent to generate project-specific guidance
 * 3. Caches the generated prompt with smart invalidation
 * 4. Auto-activates for all sessions when enabled
 * 5. Provides toggle/regenerate functionality via settings
 *
 * Flow:
 * - User invokes "Setup Enhanced Prompts" from empty chat screen (premium feature)
 * - Wizard analyzes workspace and generates prompt via PromptDesignerAgent
 * - Generated prompt is cached and auto-applied to all future sessions
 * - Users can toggle on/off or regenerate via settings
 * - Prompt content is never shown to users (IP protection)
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
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

/**
 * EnhancedPromptsService - Orchestrates the Enhanced Prompts feature
 *
 * Responsibilities:
 * - State management (enabled/disabled, generated prompt)
 * - Wizard execution flow
 * - Integration with PromptDesignerAgent and PromptCacheService
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
    private readonly workspaceIntelligence: IWorkspaceIntelligence
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
   * @returns Wizard result with success status
   */
  async runWizard(
    workspacePath: string,
    config?: Partial<EnhancedPromptsConfig>,
    onProgress?: (progress: PromptGenerationProgress) => void
  ): Promise<EnhancedPromptsWizardResult> {
    if (!this.acquireGenerationLock()) {
      return {
        success: false,
        error: 'Generation already in progress',
      };
    }

    this.logger.info('EnhancedPromptsService: Starting wizard', {
      workspacePath,
    });

    try {
      // Step 1: Analyze workspace
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
      const detectedStack = this.buildDetectedStack(analysis);

      onProgress?.({
        status: 'analyzing',
        message: 'Preparing prompt generation...',
        progress: 0.3,
      });

      // Step 3: Build input for PromptDesignerAgent
      const input = this.buildDesignerInput(workspacePath, analysis, config);

      // Step 4: Generate guidance
      onProgress?.({
        status: 'generating',
        message: 'Generating project-specific guidance...',
        progress: 0.5,
      });

      const output = await this.promptDesignerAgent.generateGuidance(
        input,
        (progress) => {
          // Map internal progress to 0.5 - 0.9 range
          const mappedProgress = 0.5 + (progress.progress || 0) * 0.4;
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
    onProgress?: (progress: PromptGenerationProgress) => void
  ): Promise<RegeneratePromptsResponse> {
    // Invalidate existing cache if forcing
    if (request?.force) {
      await this.cacheService.invalidate(workspacePath, 'manual');
    }

    // Run wizard again
    const result = await this.runWizard(
      workspacePath,
      request?.config,
      onProgress
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
   * @returns Enhanced prompt content or null if not available
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

    // No prompt available - return core system prompt as fallback
    // (Premium users without generated prompt still get core prompt)
    return PTAH_CORE_SYSTEM_PROMPT;
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

  /**
   * Build DetectedStack from workspace analysis
   */
  private buildDetectedStack(analysis: WorkspaceAnalysisResult): DetectedStack {
    // Extract frameworks from dependencies
    const frameworks: string[] = [];
    if (analysis.framework) {
      frameworks.push(analysis.framework);
    }

    // Common framework detection
    const allDeps = [...analysis.dependencies, ...analysis.devDependencies];
    const frameworkPatterns = {
      Angular: /@angular\/core/,
      React: /^react$/,
      Vue: /^vue$/,
      NestJS: /@nestjs\/core/,
      Express: /^express$/,
      Next: /^next$/,
      Nuxt: /^nuxt$/,
    };

    for (const [name, pattern] of Object.entries(frameworkPatterns)) {
      if (
        allDeps.some((dep) => pattern.test(dep)) &&
        !frameworks.includes(name)
      ) {
        frameworks.push(name);
      }
    }

    // Extract build tools
    const buildTools: string[] = [];
    if (analysis.isMonorepo && analysis.monorepoType) {
      buildTools.push(analysis.monorepoType);
    }
    const buildToolPatterns = {
      Webpack: /webpack/,
      Vite: /vite/,
      esbuild: /esbuild/,
      Rollup: /rollup/,
      Turbo: /turbo/,
    };

    for (const [name, pattern] of Object.entries(buildToolPatterns)) {
      if (allDeps.some((dep) => pattern.test(dep))) {
        buildTools.push(name);
      }
    }

    // Extract testing frameworks
    const testingFrameworks: string[] = [];
    const testPatterns = {
      Jest: /jest/,
      Mocha: /mocha/,
      Vitest: /vitest/,
      Cypress: /cypress/,
      Playwright: /playwright/,
    };

    for (const [name, pattern] of Object.entries(testPatterns)) {
      if (allDeps.some((dep) => pattern.test(dep))) {
        testingFrameworks.push(name);
      }
    }

    // Extract notable tools
    const additionalTools: string[] = [];
    const toolPatterns = {
      Prisma: /prisma/,
      TypeORM: /typeorm/,
      TailwindCSS: /tailwindcss/,
      DaisyUI: /daisyui/,
      Storybook: /storybook/,
      Langchain: /langchain/,
    };

    for (const [name, pattern] of Object.entries(toolPatterns)) {
      if (allDeps.some((dep) => pattern.test(dep))) {
        additionalTools.push(name);
      }
    }

    return {
      languages:
        analysis.languages.length > 0 ? analysis.languages : ['TypeScript'],
      frameworks,
      buildTools,
      testingFrameworks,
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
