/**
 * Agent Generation Orchestrator Service
 *
 * Coordinates the end-to-end workflow for intelligent agent generation through 5 phases:
 * 1. Analysis - Workspace and project analysis
 * 2. Selection - Template selection based on relevance
 * 3. Customization - LLM-powered content customization
 * 4. Rendering - Template rendering with variables
 * 5. Writing - Atomic file writing with rollback
 *
 * Pattern: Service Orchestration with Transaction Management
 * Reference: TemplateGeneratorService patterns
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import type * as vscode from 'vscode';
import { ProjectType } from '@ptah-extension/workspace-intelligence';
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
import {
  VsCodeLmService,
  LlmValidationFallbackError,
} from './vscode-lm.service';
import { SectionCustomizationRequest } from '../interfaces/vscode-lm.interface';

/**
 * Generation options for orchestrator.
 * Extends base options with workspace context.
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
   * Number of agents processed (for customization/rendering).
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
 * - Coordinate 5-phase workflow sequentially
 * - Manage errors and provide graceful degradation
 * - Track and report progress to callers
 * - Delegate to specialized services for each phase
 * - Build final generation summary
 *
 * @example
 * ```typescript
 * const orchestrator = container.resolve(AgentGenerationOrchestratorService);
 * const result = await orchestrator.generateAgents(
 *   { workspaceUri, threshold: 70 },
 *   (progress) => console.log(`${progress.phase}: ${progress.percentComplete}%`)
 * );
 * if (result.isOk()) {
 *   console.log(`Generated ${result.value.successful} agents`);
 * }
 * ```
 */
@injectable()
export class AgentGenerationOrchestratorService {
  /**
   * Phase 3 timeout limit in milliseconds (5 minutes).
   * Prevents wizard from appearing frozen during long LLM operations.
   */
  private readonly PHASE_3_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(
    @inject(AGENT_GENERATION_TOKENS.AGENT_SELECTION_SERVICE)
    private readonly agentSelector: IAgentSelectionService,
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE)
    private readonly templateStorage: ITemplateStorageService,
    @inject(AGENT_GENERATION_TOKENS.VSCODE_LM_SERVICE)
    private readonly llmService: VsCodeLmService,
    @inject(AGENT_GENERATION_TOKENS.CONTENT_GENERATION_SERVICE)
    private readonly contentGenerator: IContentGenerationService,
    @inject(AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER_SERVICE)
    private readonly fileWriter: IAgentFileWriterService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('AgentGenerationOrchestratorService initialized');
  }

  /**
   * Generate agents through 5-phase workflow.
   *
   * Phases:
   * 1. Analysis (0-20%): Analyze workspace and build project context
   * 2. Selection (20-30%): Select relevant agents based on context
   * 3. Customization (30-80%): LLM-customize agent sections
   * 4. Rendering (80-95%): Render templates with variables
   * 5. Writing (95-100%): Atomic file writing
   *
   * @param options - Generation options with workspace URI
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
      });

      // Phase 1: Workspace Analysis (0% → 20%)
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

      const projectContext = contextResult.value!;
      this.logger.info('Workspace analysis complete', {
        projectType: projectContext.projectType,
        frameworkCount: projectContext.frameworks.length,
      });

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

      // Phase 3: LLM Customization (30% → 80%) with timeout protection
      this.logger.info(`Phase 3: Customizing ${selections.length} agents`);
      progressCallback?.({
        phase: 'customization',
        percentComplete: 35,
        currentOperation: 'Preparing LLM customization requests',
        totalAgents: selections.length,
        agentsProcessed: 0,
      });

      // Wrap Phase 3 with timeout to prevent indefinite waiting
      const customizationsResult = await this.executeWithTimeout(
        this.customizeAgents(
          selections.map((s) => s.template.id),
          projectContext,
          progressCallback
        ),
        this.PHASE_3_TIMEOUT_MS,
        'Phase 3 (LLM Customization)'
      );

      if (customizationsResult.isErr()) {
        // Customization failures are non-fatal - use fallback
        this.logger.warn(
          'LLM customization failed, using generic content',
          customizationsResult.error!
        );
        warnings.push(
          `LLM customization failed: ${customizationsResult.error!.message}`
        );
      }

      const customizations = customizationsResult.isOk()
        ? customizationsResult.value!
        : new Map();

      // Phase 4: Template Rendering (80% → 95%)
      this.logger.info('Phase 4: Rendering templates');
      progressCallback?.({
        phase: 'rendering',
        percentComplete: 85,
        currentOperation: 'Rendering agent templates with variables',
      });

      const renderedResult = await this.renderAgents(
        selections.map((s) => s.template.id),
        projectContext,
        customizations,
        options.variableOverrides
      );

      if (renderedResult.isErr()) {
        this.logger.error('Template rendering failed', renderedResult.error!);
        return Result.err(renderedResult.error!);
      }

      const renderedAgents = renderedResult.value!;
      this.logger.info(`Rendered ${renderedAgents.length} agents`);

      // Phase 5: Atomic File Writing (95% → 100%)
      this.logger.info('Phase 5: Writing agent files');
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
   * Note: For now, this creates a simplified context.
   * In future integration batches, this will delegate to WorkspaceAnalyzerService.
   *
   * @param workspaceUri - Workspace URI to analyze
   * @param progressCallback - Progress callback for updates
   * @returns Result with AgentProjectContext or error
   * @private
   */
  private async analyzeWorkspace(
    workspaceUri: vscode.Uri,
    progressCallback?: (progress: GenerationProgress) => void
  ): Promise<Result<AgentProjectContext, Error>> {
    try {
      // TODO: Integration with WorkspaceAnalyzerService (future batch)
      // For now, create basic context for testing

      progressCallback?.({
        phase: 'analysis',
        percentComplete: 10,
        currentOperation: 'Scanning workspace files',
      });

      // Simulate workspace analysis
      // TODO: Replace with WorkspaceAnalyzerService in Integration Batch
      const context: AgentProjectContext = {
        projectType: ProjectType.Node, // Temporary placeholder
        frameworks: [],
        monorepoType: undefined,
        rootPath: workspaceUri.fsPath,
        relevantFiles: [],
        techStack: {
          languages: ['TypeScript'],
          frameworks: [],
          buildTools: [],
          testingFrameworks: [],
          packageManager: 'npm',
        },
        codeConventions: {
          indentation: 'spaces',
          indentSize: 2,
          quoteStyle: 'single',
          semicolons: true,
          trailingComma: 'es5',
        },
      };

      progressCallback?.({
        phase: 'analysis',
        percentComplete: 20,
        detectedCharacteristics: [
          `Detected ${context.projectType}`,
          `Primary language: ${context.techStack.languages[0]}`,
        ],
      });

      return Result.ok(context);
    } catch (error) {
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
        for (const agentId of userOverrides) {
          const templateResult = await this.templateStorage.loadTemplate(
            agentId
          );
          if (templateResult.isOk()) {
            selections.push({
              template: templateResult.value!,
              relevanceScore: 100, // User override = max relevance
              matchedCriteria: ['User manual selection'],
            });
          }
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
   * Phase 3: Customize agents with LLM-generated content.
   *
   * @param agentIds - Selected agent IDs to customize
   * @param context - Project context for customization
   * @param progressCallback - Progress callback for updates
   * @returns Result with customizations map or error
   * @private
   */
  private async customizeAgents(
    agentIds: string[],
    context: AgentProjectContext,
    progressCallback?: (progress: GenerationProgress) => void
  ): Promise<Result<Map<string, Map<string, string>>, Error>> {
    try {
      const customizations = new Map<string, Map<string, string>>();

      for (let i = 0; i < agentIds.length; i++) {
        const agentId = agentIds[i];

        this.logger.debug(`Customizing agent: ${agentId}`);

        // Load template to get LLM sections
        const templateResult = await this.templateStorage.loadTemplate(agentId);
        if (templateResult.isErr()) {
          this.logger.warn(
            `Failed to load template for ${agentId}, skipping customization`
          );
          continue;
        }

        const template = templateResult.value!;
        const llmSections = template.llmSections || [];

        if (llmSections.length === 0) {
          this.logger.debug(
            `No LLM sections for ${agentId}, skipping customization`
          );
          customizations.set(agentId, new Map());
          continue;
        }

        // Build customization requests for all sections
        const sectionRequests: SectionCustomizationRequest[] = llmSections.map(
          (section) => ({
            id: section.id,
            topic: section.topic,
            projectContext: context,
            fileSamples: this.selectFileSamples(context, section.topic),
          })
        );

        // Batch customize all sections
        const sectionResults = await this.llmService.batchCustomize(
          sectionRequests
        );

        // Collect results
        const agentCustomizations = new Map<string, string>();
        for (const [sectionId, result] of sectionResults.entries()) {
          if (result.isOk()) {
            agentCustomizations.set(sectionId, result.value!);
          } else {
            // Check if error is fallback error (validation failed) vs real error
            if (result.error instanceof LlmValidationFallbackError) {
              this.logger.warn(
                `LLM customization validation failed for section ${sectionId}, using generic content`,
                {
                  attempts: result.error.attempts,
                  lastScore: result.error.lastValidationScore,
                }
              );
              agentCustomizations.set(sectionId, ''); // Fallback to generic content
            } else {
              // Real error (infrastructure, API failure) - still fallback but log as error
              this.logger.error(
                `LLM customization error for section ${sectionId}, using generic content`,
                result.error!
              );
              agentCustomizations.set(sectionId, ''); // Fallback to generic content
            }
          }
        }

        customizations.set(agentId, agentCustomizations);

        // Progress update
        const percentComplete =
          30 + Math.floor(((i + 1) / agentIds.length) * 50);
        progressCallback?.({
          phase: 'customization',
          percentComplete,
          currentOperation: `Customized ${agentId}`,
          agentsProcessed: i + 1,
          totalAgents: agentIds.length,
        });
      }

      return Result.ok(customizations);
    } catch (error) {
      return Result.err(
        new Error(`Agent customization failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Phase 4: Render agent templates with variables and customizations.
   *
   * @param agentIds - Agent IDs to render
   * @param context - Project context for variable substitution
   * @param customizations - LLM customizations map
   * @param variableOverrides - Optional variable overrides
   * @returns Result with rendered agents or error
   * @private
   */
  private async renderAgents(
    agentIds: string[],
    context: AgentProjectContext,
    customizations: Map<string, Map<string, string>>,
    variableOverrides?: Record<string, string>
  ): Promise<Result<GeneratedAgent[], Error>> {
    try {
      const rendered: GeneratedAgent[] = [];

      for (const agentId of agentIds) {
        this.logger.debug(`Rendering agent: ${agentId}`);

        // Load template
        const templateResult = await this.templateStorage.loadTemplate(agentId);
        if (templateResult.isErr()) {
          this.logger.warn(`Failed to load template for ${agentId}, skipping`);
          continue;
        }

        const template = templateResult.value!;

        // Generate content (this handles variable substitution and LLM sections)
        const contentResult = await this.contentGenerator.generateContent(
          template,
          context
        );

        if (contentResult.isOk()) {
          // Construct GeneratedAgent object manually
          const generatedAgent: GeneratedAgent = {
            sourceTemplateId: template.id,
            sourceTemplateVersion: template.version,
            content: contentResult.value!,
            variables: this.buildVariables(context, variableOverrides),
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
        }
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
   * Select relevant file samples for LLM context.
   *
   * @param context - Project context with file index
   * @param topic - LLM section topic
   * @returns Array of file content samples
   * @private
   */
  private selectFileSamples(
    context: AgentProjectContext,
    topic: string
  ): string[] {
    // TODO: Implement intelligent file selection based on topic
    // For now, return empty array (generic customization)
    return [];
  }

  /**
   * Execute a promise with a timeout.
   * Races the promise against a timeout, returning an error if timeout is reached.
   *
   * @param promise - Promise to execute
   * @param timeoutMs - Timeout in milliseconds
   * @param phaseName - Human-readable phase name for error messages
   * @returns Result from promise or timeout error
   * @private
   */
  private async executeWithTimeout<T>(
    promise: Promise<Result<T, Error>>,
    timeoutMs: number,
    phaseName: string
  ): Promise<Result<T, Error>> {
    const timeoutPromise = new Promise<Result<T, Error>>((resolve) => {
      setTimeout(() => {
        this.logger.error(`${phaseName} timeout exceeded`, {
          timeoutMs,
          timeoutMinutes: (timeoutMs / 1000 / 60).toFixed(1),
        });
        resolve(
          Result.err(
            new Error(
              `${phaseName} timeout exceeded (${(timeoutMs / 1000 / 60).toFixed(
                1
              )} minutes). Please try again with fewer agents.`
            )
          )
        );
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }
}
