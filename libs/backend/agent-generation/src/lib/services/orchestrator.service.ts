/**
 * Agent Generation Orchestrator Service
 *
 * Coordinates the end-to-end workflow for intelligent agent generation through 4 phases:
 * 1. Analysis - Workspace and project analysis
 * 2. Selection - Template selection based on relevance
 * 3. Rendering - Template rendering with LLM-driven content generation
 * 4. Writing - Atomic file writing with rollback
 *
 * LLM Pipeline Migration:
 * Previously: 5 phases with separate Phase 3 (LLM customization via VsCodeLmService)
 * Now: 4 phases - Phase 3 removed (was dead code - its results were never used by Phase 4).
 * Content generation now routes through InternalQueryService (Agent SDK) in Phase 3 (Rendering).
 *
 * Pattern: Service Orchestration with Transaction Management
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import type { GenerationStreamPayload } from '@ptah-extension/shared';
import type * as vscode from 'vscode';
import {
  ProjectType,
  WorkspaceAnalyzerService,
  ProjectDetectorService,
  FrameworkDetectorService,
  MonorepoDetectorService,
  ProjectInfo,
} from '@ptah-extension/workspace-intelligence';
import { IAgentSelectionService } from '../interfaces/agent-selection.interface';
import { ITemplateStorageService } from '../interfaces/template-storage.interface';
import { IContentGenerationService } from '../interfaces/content-generation.interface';
import { IAgentFileWriterService } from '../interfaces/agent-file-writer.interface';
import {
  AgentProjectContext,
  GeneratedAgent,
  GenerationSummary,
} from '../types/core.types';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';

/**
 * Generation options for orchestrator.
 * Extends base options with workspace context and SDK config.
 */
export interface OrchestratorGenerationOptions {
  /**
   * Workspace URI to analyze and generate agents for.
   */
  workspaceUri: vscode.Uri;

  /**
   * Minimum relevance threshold for agent selection (0-100).
   * Default: 50
   */
  threshold?: number;

  /**
   * User-selected agent IDs (manual override).
   * If provided, skips automatic selection.
   */
  userOverrides?: string[];

  /**
   * Variable overrides for template rendering.
   */
  variableOverrides?: Record<string, string>;

  /**
   * Optional enhanced prompt content from the Prompt Designer.
   * When provided, included as context for LLM content generation.
   */
  enhancedPromptContent?: string;

  /**
   * Pre-computed project context from the wizard analysis (Step 1).
   * When provided, Phase 1 (workspace analysis) is skipped entirely
   * and this context is used as the single source of truth.
   */
  preComputedContext?: AgentProjectContext;

  /**
   * Whether user has premium features (enables MCP server + enhanced prompts in SDK calls).
   */
  isPremium?: boolean;

  /**
   * Whether the Ptah MCP server is currently running.
   */
  mcpServerRunning?: boolean;

  /**
   * Port the Ptah MCP server is listening on.
   */
  mcpPort?: number;

  /**
   * Callback for real-time stream events during content generation.
   * Receives text deltas, tool calls, and thinking events for live UI updates.
   */
  onStreamEvent?: (event: GenerationStreamPayload) => void;
}

/**
 * Progress update callback payload.
 */
export interface GenerationProgress {
  /**
   * Current phase of generation.
   */
  phase:
    | 'analysis'
    | 'selection'
    | 'customization'
    | 'rendering'
    | 'writing'
    | 'complete';

  /**
   * Progress percentage (0-100).
   */
  percentComplete: number;

  /**
   * Human-readable current operation description.
   */
  currentOperation?: string;

  /**
   * Number of agents processed (for rendering).
   */
  agentsProcessed?: number;

  /**
   * Total agents to process.
   */
  totalAgents?: number;

  /**
   * Detected project characteristics (for analysis phase).
   */
  detectedCharacteristics?: string[];
}

/**
 * Agent Generation Orchestrator Service
 *
 * Responsibilities:
 * - Coordinate 4-phase workflow sequentially
 * - Manage errors and provide graceful degradation
 * - Track and report progress to callers
 * - Delegate to specialized services for each phase
 * - Build final generation summary
 *
 * @example
 * ```typescript
 * const orchestrator = container.resolve(AgentGenerationOrchestratorService);
 * const result = await orchestrator.generateAgents(
 *   { workspaceUri, threshold: 70, isPremium: true, mcpServerRunning: true },
 *   (progress) => console.log(`${progress.phase}: ${progress.percentComplete}%`)
 * );
 * if (result.isOk()) {
 *   console.log(`Generated ${result.value.successful} agents`);
 * }
 * ```
 */
@injectable()
export class AgentGenerationOrchestratorService {
  constructor(
    @inject(AGENT_GENERATION_TOKENS.AGENT_SELECTION_SERVICE)
    private readonly agentSelector: IAgentSelectionService,
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE)
    private readonly templateStorage: ITemplateStorageService,
    @inject(AGENT_GENERATION_TOKENS.CONTENT_GENERATION_SERVICE)
    private readonly contentGenerator: IContentGenerationService,
    @inject(AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER_SERVICE)
    private readonly fileWriter: IAgentFileWriterService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)
    private readonly workspaceAnalyzer: WorkspaceAnalyzerService,
    @inject(TOKENS.PROJECT_DETECTOR_SERVICE)
    private readonly projectDetector: ProjectDetectorService,
    @inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE)
    private readonly frameworkDetector: FrameworkDetectorService,
    @inject(TOKENS.MONOREPO_DETECTOR_SERVICE)
    private readonly monorepoDetector: MonorepoDetectorService
  ) {
    this.logger.debug('AgentGenerationOrchestratorService initialized');
  }

  /**
   * Generate agents through 4-phase workflow.
   *
   * Phases:
   * 1. Analysis (0-20%): Analyze workspace and build project context
   * 2. Selection (20-30%): Select relevant agents based on context
   * 3. Rendering (30-95%): Render templates with LLM-driven content generation
   * 4. Writing (95-100%): Atomic file writing
   *
   * @param options - Generation options with workspace URI and SDK config
   * @param progressCallback - Optional progress callback for UI updates
   * @returns Result with generation summary or error
   */
  async generateAgents(
    options: OrchestratorGenerationOptions,
    progressCallback?: (progress: GenerationProgress) => void
  ): Promise<Result<GenerationSummary, Error>> {
    const startTime = Date.now();
    const warnings: string[] = [];

    try {
      this.logger.info('Starting agent generation workflow', {
        workspace: options.workspaceUri.fsPath,
        threshold: options.threshold ?? 50,
        hasOverrides: !!options.userOverrides,
        isPremium: options.isPremium,
        mcpServerRunning: options.mcpServerRunning,
      });

      // Phase 1: Workspace Analysis (0% → 20%)
      let projectContext: AgentProjectContext;

      if (options.preComputedContext) {
        // Use pre-computed context from wizard analysis — skip independent analysis
        projectContext = options.preComputedContext;
        this.logger.info(
          'Phase 1: Using pre-computed context from wizard analysis',
          {
            projectType: projectContext.projectType,
            frameworkCount: projectContext.frameworks.length,
            relevantFileCount: projectContext.relevantFiles.length,
          }
        );
        progressCallback?.({
          phase: 'analysis',
          percentComplete: 20,
          currentOperation: 'Using wizard analysis results',
          detectedCharacteristics: [
            `Project Type: ${projectContext.projectType}`,
            `Frameworks: ${projectContext.frameworks.join(', ') || 'None'}`,
            projectContext.monorepoType
              ? `Monorepo: ${projectContext.monorepoType}`
              : 'Single package',
          ],
        });
      } else {
        this.logger.info('Phase 1: Analyzing workspace');
        progressCallback?.({
          phase: 'analysis',
          percentComplete: 5,
          currentOperation: 'Detecting project type and frameworks',
        });

        const contextResult = await this.analyzeWorkspace(
          options.workspaceUri,
          progressCallback
        );

        if (contextResult.isErr()) {
          this.logger.error('Workspace analysis failed', contextResult.error!);
          return Result.err(contextResult.error!);
        }

        projectContext = contextResult.value!;
        this.logger.info('Workspace analysis complete', {
          projectType: projectContext.projectType,
          frameworkCount: projectContext.frameworks.length,
        });
      }

      // Phase 2: Agent Selection (20% → 30%)
      this.logger.info('Phase 2: Selecting agents');
      progressCallback?.({
        phase: 'selection',
        percentComplete: 25,
        currentOperation: 'Scoring and selecting agent templates',
      });

      const selectionResult = await this.selectAgents(
        projectContext,
        options.threshold ?? 50,
        options.userOverrides
      );

      if (selectionResult.isErr()) {
        this.logger.error('Agent selection failed', selectionResult.error!);
        return Result.err(selectionResult.error!);
      }

      const selections = selectionResult.value!;
      this.logger.info(`Selected ${selections.length} agents`);

      if (selections.length === 0) {
        this.logger.warn('No agents selected, aborting generation');
        return Result.ok({
          totalAgents: 0,
          successful: 0,
          failed: 0,
          durationMs: Date.now() - startTime,
          warnings: ['No agents matched selection criteria'],
          agents: [],
        });
      }

      // Phase 3: Template Rendering with LLM Content Generation (30% → 95%)
      this.logger.info(`Phase 3: Rendering ${selections.length} agents`);
      progressCallback?.({
        phase: 'rendering',
        percentComplete: 35,
        currentOperation: 'Rendering agent templates with LLM content',
        totalAgents: selections.length,
        agentsProcessed: 0,
      });

      const renderedResult = await this.renderAgents(
        selections.map((s) => s.template.id),
        projectContext,
        options,
        progressCallback,
        warnings
      );

      if (renderedResult.isErr()) {
        this.logger.error('Template rendering failed', renderedResult.error!);
        return Result.err(renderedResult.error!);
      }

      const renderedAgents = renderedResult.value!;
      this.logger.info(`Rendered ${renderedAgents.length} agents`);

      // Phase 4: Atomic File Writing (95% → 100%)
      this.logger.info('Phase 4: Writing agent files');
      progressCallback?.({
        phase: 'writing',
        percentComplete: 97,
        currentOperation: 'Writing agents to .claude directory',
      });

      const writeResult = await this.fileWriter.writeAgentsBatch(
        renderedAgents
      );

      if (writeResult.isErr()) {
        this.logger.error('File writing failed', writeResult.error!);
        // Rollback is handled by AgentFileWriterService
        return Result.err(writeResult.error!);
      }

      // Success
      const durationMs = Date.now() - startTime;
      progressCallback?.({
        phase: 'complete',
        percentComplete: 100,
        currentOperation: 'Generation complete',
      });

      const summary: GenerationSummary = {
        totalAgents: renderedAgents.length,
        successful: renderedAgents.length,
        failed: 0,
        durationMs,
        warnings,
        agents: renderedAgents,
        enhancedPromptsUsed: !!options.enhancedPromptContent,
      };

      this.logger.info('Agent generation complete', {
        successful: summary.successful,
        durationSec: (durationMs / 1000).toFixed(1),
      });

      return Result.ok(summary);
    } catch (error) {
      this.logger.error(
        'Agent generation failed with unexpected error',
        error as Error
      );
      return Result.err(
        new Error(`Agent generation failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Phase 1: Analyze workspace to build project context.
   *
   * Integrates with workspace-intelligence library to perform real workspace analysis.
   * Detects project type, frameworks, monorepo configuration, and tech stack.
   *
   * @param workspaceUri - Workspace URI to analyze
   * @param progressCallback - Progress callback for updates
   * @returns Result with AgentProjectContext or error
   * @public - Exposed for DeepProjectAnalysisService
   */
  public async analyzeWorkspace(
    workspaceUri: vscode.Uri,
    progressCallback?: (progress: GenerationProgress) => void
  ): Promise<Result<AgentProjectContext, Error>> {
    try {
      this.logger.debug('Starting workspace analysis', {
        workspace: workspaceUri.fsPath,
      });

      // Get comprehensive project info from workspace-intelligence
      const projectInfo = await this.workspaceAnalyzer.getProjectInfo();

      if (!projectInfo) {
        return Result.err(
          new Error('Could not analyze workspace - no project info available')
        );
      }

      // Get monorepo detection
      const monorepoResult = await this.monorepoDetector.detectMonorepo(
        workspaceUri
      );

      // Get framework detection (from project type)
      const detectedFramework = await this.frameworkDetector.detectFramework(
        workspaceUri,
        projectInfo.type
      );

      // Convert framework enum to arrays (Framework[] for context, string[] for techStack)
      const frameworksEnum = detectedFramework ? [detectedFramework] : [];
      const frameworksString = detectedFramework
        ? [detectedFramework as string]
        : [];

      // Report progress
      progressCallback?.({
        phase: 'analysis',
        percentComplete: 50,
        currentOperation: 'Detecting project type and frameworks',
        detectedCharacteristics: [
          `Project Type: ${projectInfo.type}`,
          `Frameworks: ${frameworksString.join(', ') || 'None'}`,
          monorepoResult.isMonorepo
            ? `Monorepo: ${monorepoResult.type}`
            : 'Single package',
        ],
      });

      // Map ProjectInfo to AgentProjectContext
      const context: AgentProjectContext = {
        rootPath: projectInfo.path,
        projectType: projectInfo.type, // Already correct ProjectType enum
        frameworks: frameworksEnum,
        monorepoType: monorepoResult.isMonorepo
          ? monorepoResult.type
          : undefined,
        relevantFiles: [], // Can be populated by FileRelevanceScorerService if needed
        techStack: {
          languages: this.detectLanguagesFromProjectType(
            projectInfo.type,
            projectInfo
          ),
          frameworks: frameworksString,
          buildTools: this.detectBuildTools(projectInfo),
          testingFrameworks: this.detectTestingFrameworks(
            projectInfo.devDependencies
          ),
          packageManager: this.detectPackageManager(projectInfo.path),
        },
        codeConventions: {
          indentation: 'spaces',
          indentSize: 2,
          quoteStyle: 'single',
          semicolons: true,
          trailingComma: 'es5',
        },
      };

      this.logger.info('Workspace analysis complete', {
        projectType: context.projectType,
        frameworks: context.frameworks,
        isMonorepo: !!context.monorepoType,
      });

      return Result.ok(context);
    } catch (error) {
      this.logger.error('Workspace analysis failed', error as Error);
      return Result.err(
        new Error(`Workspace analysis failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Phase 2: Select relevant agents based on project context.
   *
   * @param context - Project context from analysis
   * @param threshold - Minimum relevance score (0-100)
   * @param userOverrides - Optional user-selected agent IDs
   * @returns Result with selected agents or error
   * @private
   */
  private async selectAgents(
    context: AgentProjectContext,
    threshold: number,
    userOverrides?: string[]
  ): Promise<
    Result<
      Array<{
        template: any;
        relevanceScore: number;
        matchedCriteria: string[];
      }>,
      Error
    >
  > {
    try {
      // User overrides skip automatic selection
      if (userOverrides && userOverrides.length > 0) {
        this.logger.info('Using user-provided agent selection', {
          count: userOverrides.length,
          agents: userOverrides,
        });

        // Load user-selected templates
        const selections = [];
        const loadErrors: string[] = [];

        for (const agentId of userOverrides) {
          this.logger.debug(`Loading template for agent: ${agentId}`);
          const templateResult = await this.templateStorage.loadTemplate(
            agentId
          );

          if (templateResult.isOk()) {
            selections.push({
              template: templateResult.value!,
              relevanceScore: 100, // User override = max relevance
              matchedCriteria: ['User manual selection'],
            });
            this.logger.debug(`Successfully loaded template: ${agentId}`);
          } else {
            const errorMsg = templateResult.error?.message || 'Unknown error';
            loadErrors.push(`${agentId}: ${errorMsg}`);
            this.logger.error(
              `Failed to load template for agent: ${agentId}`,
              templateResult.error!
            );
          }
        }

        // Log summary
        this.logger.info('User agent selection loading complete', {
          requested: userOverrides.length,
          successful: selections.length,
          failed: loadErrors.length,
          errors: loadErrors,
        });

        // If no templates loaded successfully, return error
        if (selections.length === 0 && loadErrors.length > 0) {
          return Result.err(
            new Error(
              `Failed to load any agent templates. Errors: ${loadErrors.join(
                '; '
              )}`
            )
          );
        }

        // If some failed but others succeeded, log warning but continue
        if (loadErrors.length > 0) {
          this.logger.warn(
            `Some agent templates failed to load, continuing with ${selections.length} successful agents`,
            { errors: loadErrors }
          );
        }

        return Result.ok(selections);
      }

      // Automatic selection via AgentSelectionService
      const selectResult = await this.agentSelector.selectAgents(
        context,
        threshold
      );

      if (selectResult.isErr()) {
        return Result.err(selectResult.error!);
      }

      return Result.ok(selectResult.value!);
    } catch (error) {
      return Result.err(
        new Error(`Agent selection failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Phase 3: Render agent templates with LLM-driven content generation.
   *
   * Each template is processed by ContentGenerationService which handles:
   * - Extracting dynamic sections (LLM + VAR markers)
   * - Making SDK calls to fill sections with project-specific content
   * - Substituting remaining variables from analysis context
   *
   * @param agentIds - Agent IDs to render
   * @param context - Project context for variable substitution
   * @param options - Generation options with SDK config
   * @param progressCallback - Progress callback for updates
   * @param warnings - Warnings array to append to
   * @returns Result with rendered agents or error
   * @private
   */
  private async renderAgents(
    agentIds: string[],
    context: AgentProjectContext,
    options: OrchestratorGenerationOptions,
    progressCallback?: (progress: GenerationProgress) => void,
    warnings?: string[]
  ): Promise<Result<GeneratedAgent[], Error>> {
    try {
      const rendered: GeneratedAgent[] = [];

      // Build SDK config from options
      const sdkConfig = {
        isPremium: options.isPremium ?? false,
        mcpServerRunning: options.mcpServerRunning ?? false,
        mcpPort: options.mcpPort,
        onStreamEvent: options.onStreamEvent,
      };

      for (let i = 0; i < agentIds.length; i++) {
        const agentId = agentIds[i];
        this.logger.debug(`Rendering agent: ${agentId}`);

        // Load template
        const templateResult = await this.templateStorage.loadTemplate(agentId);
        if (templateResult.isErr()) {
          this.logger.warn(`Failed to load template for ${agentId}, skipping`);
          warnings?.push(
            `Failed to load template for ${agentId}: ${templateResult.error?.message}`
          );
          continue;
        }

        const template = templateResult.value!;

        // Generate content (handles variable substitution and LLM sections via SDK)
        const contentResult = await this.contentGenerator.generateContent(
          template,
          context,
          sdkConfig
        );

        if (contentResult.isOk()) {
          // Construct GeneratedAgent object manually
          const generatedAgent: GeneratedAgent = {
            sourceTemplateId: template.id,
            sourceTemplateVersion: template.version,
            content: contentResult.value!,
            variables: this.buildVariables(context, options.variableOverrides),
            customizations: [],
            generatedAt: new Date(),
            filePath: `.claude/agents/${template.id}.md`,
          };

          rendered.push(generatedAgent);
        } else {
          this.logger.warn(
            `Failed to generate content for ${agentId}: ${
              contentResult.error!.message
            }`
          );
          warnings?.push(
            `Content generation failed for ${agentId}: ${
              contentResult.error!.message
            }`
          );
        }

        // Progress update
        const percentComplete =
          30 + Math.floor(((i + 1) / agentIds.length) * 65);
        progressCallback?.({
          phase: 'rendering',
          percentComplete,
          currentOperation: `Rendered ${agentId}`,
          agentsProcessed: i + 1,
          totalAgents: agentIds.length,
        });
      }

      if (rendered.length === 0) {
        return Result.err(new Error('No agents were successfully rendered'));
      }

      return Result.ok(rendered);
    } catch (error) {
      return Result.err(
        new Error(`Agent rendering failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Build variable substitution map from project context.
   *
   * @param context - Project context
   * @param overrides - Optional variable overrides
   * @returns Variable map for template substitution
   * @private
   */
  private buildVariables(
    context: AgentProjectContext,
    overrides?: Record<string, string>
  ): Record<string, string> {
    const variables: Record<string, string> = {
      PROJECT_TYPE: context.projectType.toString(),
      PRIMARY_LANGUAGE: context.techStack.languages[0] || 'Unknown',
      TECH_STACK: context.techStack.frameworks.join(', ') || 'None detected',
      PACKAGE_MANAGER: context.techStack.packageManager,
      IS_MONOREPO: context.monorepoType ? 'true' : 'false',
      MONOREPO_TYPE: context.monorepoType?.toString() || '',
      INDENTATION: context.codeConventions.indentation,
      INDENT_SIZE: context.codeConventions.indentSize.toString(),
      QUOTE_STYLE: context.codeConventions.quoteStyle,
      TIMESTAMP: new Date().toISOString(),
      ...overrides,
    };

    return variables;
  }

  /**
   * Detect primary languages from project type.
   * Uses the project type string as the primary language indicator
   * and checks dependencies for TypeScript usage.
   * @private
   */
  private detectLanguagesFromProjectType(
    projectType: ProjectType,
    projectInfo?: ProjectInfo
  ): string[] {
    const languages: string[] = [];
    const typeStr = projectType.toString();

    // Use project type as primary language hint
    languages.push(typeStr);

    // Check for TypeScript in dependencies
    if (projectInfo) {
      const allDeps = [
        ...projectInfo.dependencies,
        ...projectInfo.devDependencies,
      ];
      if (allDeps.some((d) => d.includes('typescript'))) {
        if (!languages.includes('TypeScript')) {
          languages.push('TypeScript');
        }
      }
    }

    return languages.length > 0 ? languages : [typeStr];
  }

  /**
   * Detect build tools from project dependencies.
   * Filters dependencies that match known build tool patterns.
   * @private
   */
  private detectBuildTools(projectInfo: ProjectInfo): string[] {
    const allDeps = [
      ...projectInfo.dependencies,
      ...projectInfo.devDependencies,
    ];

    // Pattern-based detection — matches dependency names containing these substrings
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
      'setuptools',
    ];

    return allDeps
      .filter((dep) =>
        buildToolPatterns.some((pattern) => dep.includes(pattern))
      )
      .slice(0, 10);
  }

  /**
   * Detect testing frameworks from dev dependencies.
   * Filters dependencies that match known test framework patterns.
   * @private
   */
  private detectTestingFrameworks(devDependencies: string[]): string[] {
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
      'unittest',
      'junit',
      'cargo-test',
    ];

    return devDependencies
      .filter((dep) => testPatterns.some((pattern) => dep.includes(pattern)))
      .slice(0, 10);
  }

  /**
   * Detect package manager from workspace
   * @private
   */
  private detectPackageManager(workspacePath: string): string {
    const fs = require('fs');
    const path = require('path');

    // Check for lock files
    if (fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml')))
      return 'pnpm';
    if (fs.existsSync(path.join(workspacePath, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(workspacePath, 'package-lock.json')))
      return 'npm';
    if (fs.existsSync(path.join(workspacePath, 'bun.lockb'))) return 'bun';

    // Fallbacks based on project type
    if (fs.existsSync(path.join(workspacePath, 'requirements.txt')))
      return 'pip';
    if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) return 'cargo';
    if (fs.existsSync(path.join(workspacePath, 'go.mod'))) return 'go mod';
    if (fs.existsSync(path.join(workspacePath, 'pom.xml'))) return 'maven';
    if (fs.existsSync(path.join(workspacePath, 'build.gradle')))
      return 'gradle';
    if (fs.existsSync(path.join(workspacePath, 'Gemfile'))) return 'bundler';
    if (fs.existsSync(path.join(workspacePath, 'composer.json')))
      return 'composer';

    return 'npm'; // Default fallback
  }
}
