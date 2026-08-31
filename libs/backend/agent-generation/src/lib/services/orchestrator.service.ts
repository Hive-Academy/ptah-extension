/**
 * Agent Generation Orchestrator Service
 *
 * Coordinates the end-to-end workflow for intelligent agent generation through 4 phases:
 * 1. Analysis - Workspace and project analysis
 * 2. Selection - Template selection based on relevance
 * 3. Rendering - Template rendering with LLM-driven content generation via InternalQueryService (Agent SDK)
 * 4. Writing - Atomic file writing with rollback
 *
 * Pattern: Service Orchestration with Transaction Management
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { existsSync } from 'fs';
import * as path from 'path';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import type { GenerationAgentOutcome } from '@ptah-extension/shared';
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
import {
  IContentGenerationService,
  type ContentGenerationSdkConfig,
} from '../interfaces/content-generation.interface';
import { resolveProjectType } from './wizard/analysis-schema';
import { IAgentFileWriterService } from '../interfaces/agent-file-writer.interface';
import { IOutputValidationService } from '../interfaces/output-validation.interface';
import {
  AgentProjectContext,
  AgentTemplate,
  GeneratedAgent,
  GenerationSummary,
  ValidationResult,
  type OrchestratorGenerationOptions,
} from '../types/core.types';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';

/**
 * The options contract lives with the other public types in `core.types.ts`;
 * it is re-exported here so the existing root export keeps working.
 */
export type { OrchestratorGenerationOptions } from '../types/core.types';

/** One selected agent template with the reason it was selected. */
interface AgentSelection {
  template: AgentTemplate;
  relevanceScore: number;
  matchedCriteria: string[];
}

/** Rendered content plus the honest section counts behind it. */
interface ResolvedAgentContent {
  content: string;
  rejectedSections: number;
  tailoredSections: number;
}

/** Render an `AbortSignal.reason` (string, Error, DOMException, ...) as text. */
function describeAbortReason(reason: unknown): string {
  if (reason === undefined || reason === null) return 'aborted';
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message || reason.name;
  return String(reason);
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
 * Every composition marker line: `STATIC`, `LLM` and `VAR`, open or close.
 *
 * All three are the same kind of thing — a fence around content some earlier
 * stage was supposed to act on — and all three are invisible to the agent that
 * reads the emitted file. `LLM` and `VAR` are included because the no-SDK path
 * keeps the AUTHORED text between the markers and emits it: without them here,
 * a `<!-- LLM:FRAMEWORK_CONVENTIONS -->` line ships verbatim into
 * `.claude/agents/` and every rival CLI's harness dir on every run where the SDK
 * was unavailable, which is the exact failure the STATIC half was written for.
 *
 * The id is matched loosely (`[^>]*`) rather than as `\w+` on purpose: a
 * malformed id such as `ANT I_PATTERNS` still has to be stripped here. The
 * place that REJECTS a malformed id is `TemplatePartialResolver`, at load time;
 * by the time content reaches emit, refusing to strip a marker would only mean
 * shipping it into the agent file.
 */
const COMPOSITION_MARKER_LINE =
  /^[ \t]*<!--[ \t]*\/?(?:STATIC|LLM|VAR):[^>]*-->[ \t]*$/;

/** A line with nothing on it but horizontal whitespace. */
const BLANK_LINE = /^[ \t]*$/;

/**
 * Remove the composition fences from content on its way into an agent file.
 *
 * The markers are a COMPOSITION mechanism, not content. They leaked verbatim
 * into every generated agent, every `.codex/agents/*.toml` and every
 * `.github/agents/*.agent.md` for as long as they existed, because nothing
 * resolved them and nothing stripped them.
 *
 * Only the marker LINES go. Whatever sits between a pair is content by then —
 * the expanded shared partial, the model's section, or the authored fallback the
 * template shipped — and is kept exactly as it stands.
 *
 * Two properties this works line-by-line to get right:
 *
 *  - **CRLF.** Templates are authored on Windows and reach here with `\r\n`.
 *    The previous `\n`-anchored strip left a `\r` orphaned on the line it
 *    emptied, and the `\n{3,}` collapse never matched a CRLF run at all — so
 *    the tidy-up silently did nothing on the platform this repository is
 *    developed on. Splitting on `\r?\n` and rejoining with the dominant ending
 *    makes the transform ending-agnostic.
 *
 *  - **Scope.** Blank runs collapse ONLY where a marker was actually removed.
 *    The old global `\n{3,}` → `\n\n` reflowed the entire document, including
 *    the inside of fenced code blocks, where a deliberate blank run is part of
 *    the specimen the agent is being shown. Nothing downstream could detect
 *    that the sample had been rewritten.
 *
 * Exported for its own spec: both properties above are invisible in the
 * orchestrator's end-to-end assertions, which is how a `\n`-only strip survived
 * on a Windows-authored corpus.
 */
export function stripCompositionMarkers(content: string): string {
  const lines = content.split(/\r?\n/);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';

  // Strip the marker lines, remembering where each gap opened up so the
  // blank-line tidy-up can be confined to those seams.
  const kept: string[] = [];
  const seams = new Set<number>();
  let removedAny = false;
  for (const line of lines) {
    if (COMPOSITION_MARKER_LINE.test(line)) {
      removedAny = true;
      seams.add(kept.length);
      continue;
    }
    kept.push(line);
  }
  if (!removedAny) return content;

  // Each seam sits between two kept lines. Where that leaves more than one
  // blank line, keep exactly one — an expanded block should not open with three
  // blank lines where its fence used to be.
  const drop = new Set<number>();
  for (const seam of seams) {
    let start = seam;
    while (start > 0 && BLANK_LINE.test(kept[start - 1])) start--;
    let stop = seam;
    while (stop < kept.length && BLANK_LINE.test(kept[stop])) stop++;
    // Nothing to collapse unless the run is longer than the one blank we keep.
    if (stop - start < 2) continue;
    // A seam at the very start or end of the document has no content to
    // separate, so every blank in the run goes.
    const keepOne = start > 0 && stop < kept.length;
    for (let i = start + (keepOne ? 1 : 0); i < stop; i++) drop.add(i);
  }

  return kept.filter((_, i) => !drop.has(i)).join(eol);
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
 *   { workspaceUri, threshold: 70, mcpServerRunning: true },
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
    private readonly monorepoDetector: MonorepoDetectorService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(AGENT_GENERATION_TOKENS.OUTPUT_VALIDATION_SERVICE)
    private readonly outputValidation: IOutputValidationService,
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
    progressCallback?: (progress: GenerationProgress) => void,
  ): Promise<Result<GenerationSummary, Error>> {
    const startTime = Date.now();
    const warnings: string[] = [];

    try {
      this.logger.info('Starting agent generation workflow', {
        workspace: options.workspacePath,
        threshold: options.threshold ?? 50,
        hasOverrides: !!options.userOverrides,
        mcpServerRunning: options.mcpServerRunning,
      });
      let projectContext: AgentProjectContext;

      if (options.preComputedAnalysis) {
        const analysis = options.preComputedAnalysis;
        const languages = analysis.languageDistribution?.length
          ? analysis.languageDistribution
              .sort((a, b) => b.percentage - a.percentage)
              .map((l) => l.language)
          : analysis.languages;
        let projectInfo: ProjectInfo | null = null;
        try {
          projectInfo = await this.workspaceAnalyzer.getProjectInfo();
        } catch {
          this.logger.debug(
            'Could not get projectInfo for pre-computed context',
          );
        }

        projectContext = {
          rootPath: options.workspacePath,
          projectType: resolveProjectType(analysis.projectType),
          frameworks: analysis.frameworks ?? [],
          monorepoType: undefined,
          relevantFiles: [],
          techStack: {
            languages,
            frameworks: analysis.frameworks ?? [],
            buildTools: projectInfo ? this.detectBuildTools(projectInfo) : [],
            testingFrameworks: projectInfo
              ? this.detectTestingFrameworks(projectInfo.devDependencies)
              : [],
            packageManager: this.detectPackageManager(options.workspacePath),
          },
          codeConventions: analysis.codeConventions ?? {
            indentation: 'spaces' as const,
            indentSize: 2,
            quoteStyle: 'single' as const,
            semicolons: true,
            trailingComma: 'es5' as const,
          },
          fullAnalysis: analysis,
          analysisDir: options.analysisDir,
        };

        this.logger.info(
          'Phase 1: Using pre-computed wizard analysis with full data',
          {
            projectType: analysis.projectType,
            frameworkCount: (analysis.frameworks ?? []).length,
            hasArchPatterns: (analysis.architecturePatterns ?? []).length > 0,
            hasTestCoverage: !!analysis.testCoverage,
          },
        );
        progressCallback?.({
          phase: 'analysis',
          percentComplete: 20,
          currentOperation: 'Using wizard analysis results',
          detectedCharacteristics: [
            `Project: ${
              analysis.projectTypeDescription || analysis.projectType
            }`,
            `Frameworks: ${(analysis.frameworks ?? []).join(', ') || 'None'}`,
            analysis.monorepoType
              ? `Monorepo: ${analysis.monorepoType}`
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
          options.workspacePath,
          progressCallback,
        );

        if (contextResult.isErr()) {
          this.logger.error('Workspace analysis failed', contextResult.error!);
          return Result.err(contextResult.error!);
        }

        projectContext = contextResult.value!;
        if (options.analysisDir) {
          projectContext.analysisDir = options.analysisDir;
        }
        this.logger.info('Workspace analysis complete', {
          projectType: projectContext.projectType,
          frameworkCount: projectContext.frameworks.length,
          hasAnalysisDir: !!options.analysisDir,
        });
      }
      this.logger.info('Phase 2: Selecting agents');
      progressCallback?.({
        phase: 'selection',
        percentComplete: 25,
        currentOperation: 'Scoring and selecting agent templates',
      });

      const selectionResult = await this.selectAgents(
        projectContext,
        options.threshold ?? 50,
        options.userOverrides,
      );

      if (selectionResult.isErr()) {
        this.logger.error('Agent selection failed', selectionResult.error!);
        return Result.err(selectionResult.error!);
      }

      const selections = selectionResult.value!;
      this.logger.info(`Selected ${selections.length} agents`);
      const outputDirectory = path.join(
        projectContext.rootPath,
        '.claude',
        'agents',
      );

      if (selections.length === 0) {
        this.logger.warn('No agents selected, aborting generation');
        return Result.ok({
          totalAgents: 0,
          successful: 0,
          failed: 0,
          durationMs: Date.now() - startTime,
          warnings: ['No agents matched selection criteria'],
          outputDirectory,
          writtenCount: 0,
          unchangedCount: 0,
          failedCount: 0,
          rejectedSections: 0,
          tailoredSections: 0,
          lifecycle: 'completed',
          outcomes: [],
          agents: [],
        });
      }
      this.logger.info(
        `Phase 3/4: Rendering and writing ${selections.length} agents`,
      );
      progressCallback?.({
        phase: 'rendering',
        percentComplete: 35,
        currentOperation: 'Rendering agent templates with LLM content',
        totalAgents: selections.length,
        agentsProcessed: 0,
      });

      const { outcomes, renderedAgents } = await this.produceAgents(
        selections,
        projectContext,
        outputDirectory,
        options,
        progressCallback,
        warnings,
      );

      const aborted = options.abortSignal?.aborted ?? false;
      const writtenCount = outcomes.filter(
        (o) => o.status === 'written',
      ).length;
      const unchangedCount = outcomes.filter(
        (o) => o.status === 'unchanged',
      ).length;
      const failedCount = outcomes.filter((o) => o.status === 'failed').length;
      const successful = writtenCount + unchangedCount;

      if (!aborted && renderedAgents.length === 0) {
        return Result.err(new Error('No agents were successfully rendered'));
      }
      if (!aborted && successful === 0) {
        return Result.err(new Error('All agent file writes failed'));
      }
      // There is no Phase 5. Distributing agents to rival CLIs used to happen
      // here, through `MultiCliAgentWriterService` and a caller-supplied list of
      // detected CLIs. It moved out in TASK_2026_278 Batch 2: generation writes
      // `{ws}/.claude/agents` and nothing else, the user-layer mirror picks
      // those up, and `HarnessReconciler` fans them out to every detected
      // target under one manifest. Generation no longer needs to know which
      // CLIs exist, and a CLI installed after the wizard ran is populated by
      // the next reconcile instead of never.
      const durationMs = Date.now() - startTime;
      progressCallback?.({
        phase: 'complete',
        percentComplete: 100,
        currentOperation: aborted
          ? 'Generation stopped'
          : 'Generation complete',
      });

      const abortReason = aborted
        ? describeAbortReason(options.abortSignal?.reason)
        : null;
      const lifecycle: GenerationSummary['lifecycle'] = aborted
        ? abortReason === 'generation_timeout'
          ? 'timed-out'
          : 'paused'
        : successful === 0
          ? 'failed'
          : 'completed';

      const summary: GenerationSummary = {
        totalAgents: outcomes.length,
        successful,
        failed: failedCount,
        durationMs,
        warnings,
        outputDirectory,
        writtenCount,
        unchangedCount,
        failedCount,
        rejectedSections: outcomes.reduce(
          (sum, o) => sum + o.rejectedSections,
          0,
        ),
        tailoredSections: outcomes.reduce(
          (sum, o) => sum + o.tailoredSections,
          0,
        ),
        lifecycle,
        outcomes,
        agents: renderedAgents,
        enhancedPromptsUsed: !!options.enhancedPromptContent,
      };

      this.logger.info('Agent generation settled', {
        lifecycle,
        written: writtenCount,
        unchanged: unchangedCount,
        failed: failedCount,
        durationSec: (durationMs / 1000).toFixed(1),
      });

      return Result.ok(summary);
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'AgentGenerationOrchestratorService.generateAgents' },
      );
      this.logger.error(
        'Agent generation failed with unexpected error',
        error as Error,
      );
      return Result.err(
        new Error(`Agent generation failed: ${(error as Error).message}`),
      );
    }
  }

  /**
   * Phase 1: Analyze workspace to build project context.
   *
   * Integrates with workspace-intelligence library to perform real workspace analysis.
   * Detects project type, frameworks, monorepo configuration, and tech stack.
   *
   * @param workspacePath - Workspace root path to analyze
   * @param progressCallback - Progress callback for updates
   * @returns Result with AgentProjectContext or error
   * @public - Exposed for DeepProjectAnalysisService
   */
  public async analyzeWorkspace(
    workspacePath: string,
    progressCallback?: (progress: GenerationProgress) => void,
  ): Promise<Result<AgentProjectContext, Error>> {
    try {
      this.logger.debug('Starting workspace analysis', {
        workspace: workspacePath,
      });
      const projectInfo = await this.workspaceAnalyzer.getProjectInfo();

      if (!projectInfo) {
        return Result.err(
          new Error('Could not analyze workspace - no project info available'),
        );
      }
      const monorepoResult =
        await this.monorepoDetector.detectMonorepo(workspacePath);
      const detectedFramework = await this.frameworkDetector.detectFramework(
        workspacePath,
        projectInfo.type,
      );
      const frameworksEnum = detectedFramework ? [detectedFramework] : [];
      const frameworksString = detectedFramework
        ? [detectedFramework as string]
        : [];
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
            projectInfo,
          ),
          frameworks: frameworksString,
          buildTools: this.detectBuildTools(projectInfo),
          testingFrameworks: this.detectTestingFrameworks(
            projectInfo.devDependencies,
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
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'AgentGenerationOrchestratorService.analyzeWorkspace' },
      );
      this.logger.error('Workspace analysis failed', error as Error);
      return Result.err(
        new Error(`Workspace analysis failed: ${(error as Error).message}`),
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
    userOverrides?: string[],
  ): Promise<Result<AgentSelection[], Error>> {
    try {
      if (userOverrides && userOverrides.length > 0) {
        this.logger.info('Using user-provided agent selection', {
          count: userOverrides.length,
          agents: userOverrides,
        });
        const selections: AgentSelection[] = [];
        const loadErrors: string[] = [];

        for (const agentId of userOverrides) {
          this.logger.debug(`Loading template for agent: ${agentId}`);
          const templateResult =
            await this.templateStorage.loadTemplate(agentId);

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
              templateResult.error!,
            );
          }
        }
        this.logger.info('User agent selection loading complete', {
          requested: userOverrides.length,
          successful: selections.length,
          failed: loadErrors.length,
          errors: loadErrors,
        });
        if (selections.length === 0 && loadErrors.length > 0) {
          return Result.err(
            new Error(
              `Failed to load any agent templates. Errors: ${loadErrors.join(
                '; ',
              )}`,
            ),
          );
        }
        if (loadErrors.length > 0) {
          this.logger.warn(
            `Some agent templates failed to load, continuing with ${selections.length} successful agents`,
            { errors: loadErrors },
          );
        }

        return Result.ok(selections);
      }
      const selectResult = await this.agentSelector.selectAgents(
        context,
        threshold,
      );

      if (selectResult.isErr()) {
        return Result.err(selectResult.error!);
      }

      return Result.ok(selectResult.value!);
    } catch (error) {
      return Result.err(
        new Error(`Agent selection failed: ${(error as Error).message}`),
      );
    }
  }

  /**
   * Phases 3 and 4, one agent at a time: render with LLM-driven content, then
   * write. Every selected agent ends with exactly one terminal outcome
   * (`written`, `unchanged` or `failed`) and `options.onAgentOutcome` fires
   * once per outcome so a caller can checkpoint it.
   *
   * The abort signal is checked before each agent is rendered and again
   * before each write. Once it fires, every remaining selected agent becomes
   * a `failed` outcome with error `not generated: <reason>` — nothing is
   * written after a cancel or watchdog timeout.
   */
  private async produceAgents(
    selections: AgentSelection[],
    context: AgentProjectContext,
    outputDirectory: string,
    options: OrchestratorGenerationOptions,
    progressCallback?: (progress: GenerationProgress) => void,
    warnings: string[] = [],
  ): Promise<{
    outcomes: GenerationAgentOutcome[];
    renderedAgents: GeneratedAgent[];
  }> {
    const outcomes: GenerationAgentOutcome[] = [];
    const renderedAgents: GeneratedAgent[] = [];
    const signal = options.abortSignal;
    const total = selections.length;
    const sdkConfig: ContentGenerationSdkConfig = {
      mcpServerRunning: options.mcpServerRunning ?? false,
      mcpPort: options.mcpPort,
      onStreamEvent: options.onStreamEvent,
      enhancedPromptContent: options.enhancedPromptContent,
      model: options.model,
      pluginPaths: options.pluginPaths,
      abortSignal: signal,
    };

    const record = async (outcome: GenerationAgentOutcome): Promise<void> => {
      outcomes.push(outcome);
      await options.onAgentOutcome?.(outcome);
    };
    const notGenerated = (
      agentId: string,
      filePath: string,
    ): GenerationAgentOutcome => ({
      agentId,
      filePath,
      status: 'failed',
      rejectedSections: 0,
      tailoredSections: 0,
      error: `not generated: ${describeAbortReason(signal?.reason)}`,
    });

    for (let i = 0; i < total; i++) {
      const agentId = selections[i].template.id;
      const filePath = path.join(outputDirectory, `${agentId}.md`);

      if (signal?.aborted) {
        await record(notGenerated(agentId, filePath));
        continue;
      }

      this.logger.debug(`Rendering agent: ${agentId}`);
      progressCallback?.({
        phase: 'rendering',
        percentComplete: 30 + Math.floor((i / total) * 65),
        currentOperation: agentId,
        agentsProcessed: i,
        totalAgents: total,
      });
      const templateResult = await this.templateStorage.loadTemplate(agentId);
      if (templateResult.isErr()) {
        // Genuine "cannot produce": there is no template body to fall back
        // to. Log loudly and aggregate the error so it is never swallowed.
        const message = templateResult.error?.message ?? 'Unknown error';
        this.logger.error(
          `Cannot render ${agentId}: template failed to load — agent will be missing`,
          templateResult.error!,
        );
        warnings.push(`Failed to load template for ${agentId}: ${message}`);
        await record({
          agentId,
          filePath,
          status: 'failed',
          rejectedSections: 0,
          tailoredSections: 0,
          error: `Failed to load template: ${message}`,
        });
        continue;
      }

      const template = templateResult.value!;
      // A template that parsed AND was selected must always yield a written
      // agent file. LLM content generation and output validation are quality
      // advisors here, not drop gates (see resolveAgentContent).
      let resolved: ResolvedAgentContent;
      try {
        resolved = await this.resolveAgentContent(
          template,
          context,
          sdkConfig,
          options,
          warnings,
        );
      } catch (error: unknown) {
        if (signal?.aborted) {
          await record(notGenerated(agentId, filePath));
          continue;
        }
        throw error;
      }

      const rendered: GeneratedAgent = {
        sourceTemplateId: template.id,
        sourceTemplateVersion: template.version,
        content: resolved.content,
        variables: this.buildVariables(context, options.variableOverrides),
        customizations: [],
        generatedAt: new Date(),
        filePath,
      };
      renderedAgents.push(rendered);

      if (signal?.aborted) {
        await record(notGenerated(agentId, filePath));
        continue;
      }

      progressCallback?.({
        phase: 'writing',
        percentComplete: 95 + Math.floor(((i + 1) / total) * 5),
        currentOperation: agentId,
        agentsProcessed: i + 1,
        totalAgents: total,
      });
      const writeResult = await this.fileWriter.writeAgent(rendered);
      if (writeResult.isErr()) {
        const message = writeResult.error!.message;
        this.logger.error(
          `Failed to write agent ${agentId}`,
          writeResult.error!,
        );
        warnings.push(`Failed to write ${agentId}: ${message}`);
        await record({
          agentId,
          filePath,
          status: 'failed',
          rejectedSections: resolved.rejectedSections,
          tailoredSections: resolved.tailoredSections,
          error: message,
        });
        continue;
      }

      await record({
        agentId,
        filePath: writeResult.value!.filePath,
        status: writeResult.value!.status,
        rejectedSections: resolved.rejectedSections,
        tailoredSections: resolved.tailoredSections,
      });
    }

    return { outcomes, renderedAgents };
  }

  /**
   * Resolve the final file content for a single agent, guaranteeing output.
   *
   * Reliability contract (GOAL: nothing silently dropped): a template that
   * parsed and was selected ALWAYS produces a written agent file. LLM
   * customization and output validation are quality *advisors*, never drop
   * gates:
   * - generation error  → emit the authored static-template body (loud warn)
   * - validator error   → emit the generated content anyway (loud warn)
   * - validation warning → emit the generated content, surface the warning
   * - validation invalid → emit the generated content anyway (loud warn)
   * - validation invalid *for a critical safety reason* → the ONLY case that
   *   substitutes the authored static body, so unsafe generated content is
   *   never written to disk.
   *
   * @param template - Source template (already parsed + selected)
   * @param context - Project analysis context
   * @param sdkConfig - SDK configuration for content generation
   * @param options - Generation options (for variable overrides)
   * @param warnings - Aggregated warnings surfaced in the generation summary
   * @returns Final file content (never empty) with its section counts
   * @private
   */
  private async resolveAgentContent(
    template: AgentTemplate,
    context: AgentProjectContext,
    sdkConfig: ContentGenerationSdkConfig,
    options: OrchestratorGenerationOptions,
    warnings?: string[],
  ): Promise<ResolvedAgentContent> {
    const contentResult = await this.contentGenerator.generateContent(
      template,
      context,
      sdkConfig,
    );
    const fallback = (): ResolvedAgentContent => ({
      content: this.renderStaticFallbackContent(template, context, options),
      rejectedSections: 0,
      tailoredSections: 0,
    });

    if (contentResult.isErr()) {
      this.logger.warn(
        `Content generation failed for ${template.id}; writing authored template fallback`,
        { error: contentResult.error!.message },
      );
      warnings?.push(
        `Content generation failed for ${template.id} (wrote authored template fallback): ${contentResult.error!.message}`,
      );
      return fallback();
    }

    const {
      content: rawContent,
      warnings: sectionWarnings,
      rejectedSections,
      tailoredSections,
    } = contentResult.value!;
    for (const warning of sectionWarnings) {
      warnings?.push(warning);
    }
    const candidate: ResolvedAgentContent = {
      content: this.buildAgentFileContent(rawContent, template),
      rejectedSections,
      tailoredSections,
    };

    const validationResult = await this.outputValidation.validate(
      candidate.content,
      context,
    );
    if (validationResult.isErr()) {
      // A broken validator must not cost us the agent — ship the content.
      this.logger.warn(
        `Validation errored for ${template.id}; writing generated content anyway`,
        { error: validationResult.error!.message },
      );
      warnings?.push(
        `Validation error for ${template.id} (agent still written): ${validationResult.error!.message}`,
      );
      return candidate;
    }

    const validation = validationResult.value!;
    for (const issue of validation.issues) {
      if (issue.severity === 'warning') {
        warnings?.push(`[${template.id}] ${issue.message}`);
      }
    }

    if (validation.isValid) {
      return candidate;
    }

    if (this.hasCriticalSafetyIssue(validation)) {
      // Never write unsafe generated content — fall back to authored body.
      this.logger.error(
        `Generated content for ${template.id} failed SAFETY validation (score ${validation.score}); writing authored template fallback instead`,
      );
      warnings?.push(
        `Unsafe generated content for ${template.id} — wrote authored template fallback`,
      );
      return fallback();
    }

    const criticalIssues = validation.issues
      .filter((i) => i.severity === 'error')
      .map((i) => i.message)
      .join('; ');
    this.logger.warn(
      `Generated content for ${template.id} failed validation (score ${validation.score}) but will still be written (not dropped): ${criticalIssues}`,
    );
    warnings?.push(
      `${template.id} written despite failing validation (score ${validation.score}): ${criticalIssues}`,
    );
    return candidate;
  }

  /**
   * Determine whether a failed validation result was flagged for a critical
   * safety reason (malicious code / leaked secrets), as opposed to a quality
   * or factual shortcoming. Only safety failures cause the pipeline to discard
   * the generated content in favour of the authored template body.
   *
   * @param validation - Validation result to inspect
   * @returns True if any error-severity issue is safety related
   * @private
   */
  private hasCriticalSafetyIssue(validation: ValidationResult): boolean {
    return validation.issues.some(
      (issue) =>
        issue.severity === 'error' &&
        /malicious|sensitive|credential|private key|secret|api[_\s-]?key|token|password/i.test(
          issue.message,
        ),
    );
  }

  /**
   * Render a safe, authored fallback body directly from the raw template when
   * LLM generation is unavailable or produced unsafe output. Dynamic-section
   * markers are stripped (their authored inner guidance is kept) so no raw
   * `<!-- LLM:* -->` / `<!-- VAR:* -->` markers leak into the emitted file, and
   * simple `{{VARIABLE}}` placeholders are substituted from the analysis
   * context. The result is always non-empty for a valid template.
   *
   * @param template - Source template
   * @param context - Project analysis context
   * @param options - Generation options (for variable overrides)
   * @returns Final file content built from the authored template body
   * @private
   */
  private renderStaticFallbackContent(
    template: AgentTemplate,
    context: AgentProjectContext,
    options: OrchestratorGenerationOptions,
  ): string {
    // No marker stripping here. It used to blank the `LLM`/`VAR` markers with
    // an inline `replace(..., '')`, which emptied the line instead of removing
    // it and left the seam of blank lines that `stripCompositionMarkers` exists
    // to close — and it handled `LLM`/`VAR` while `buildAgentFileContent`
    // handled `STATIC`, so the same job lived in two places with two different
    // notions of "stripped". `buildAgentFileContent` now does all three.
    const variables = this.buildVariables(context, options.variableOverrides);
    let body = template.content;
    for (const [key, value] of Object.entries(variables)) {
      body = body.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
    }
    return this.buildAgentFileContent(body, template);
  }

  /**
   * Build final agent file content with proper frontmatter.
   *
   * Strips any template output frontmatter (the second `---` block that comes
   * from the template content) and prepends a correctly constructed frontmatter
   * from actual template metadata + analysis context.
   *
   * This ensures generated agent files always have correct, predictable frontmatter
   * regardless of how template processing or LLM content generation handled it.
   *
   * @param rawContent - Content from ContentGenerationService
   * @param template - Source template with metadata
   * @returns Content with proper frontmatter prepended
   */
  private buildAgentFileContent(
    rawContent: string,
    template: AgentTemplate,
  ): string {
    // Defensive only. This used to strip the template's SECOND frontmatter
    // block (`---name/description---`), which no longer exists — templates carry
    // one block and `TemplateStorageService` consumes it. What is left is the
    // case the LLM content pass can still produce: generated content that opens
    // with its own frontmatter, which would emit an agent file with two blocks.
    const strippedContent = stripCompositionMarkers(
      rawContent.replace(/^\s*---\s*\n[\s\S]*?\n---\s*\n/, ''),
    );
    // The AUTHORED description is the only source. It is the `description:`
    // frontmatter of a hand-written template, and every harness that lists
    // subagents selects on it — the one sentence a dispatcher reads before
    // choosing. There used to be a second source: a one-liner the content pass
    // asked the model for, which replaced 400-600 characters of carefully
    // bounded "use when / not for" with a generic restatement of the role,
    // written without knowing which sibling agents it had to be distinguishable
    // from. Once the template won that contest the generated one had no
    // reachable success path, so it is gone rather than kept as a fallback.
    // What remains for a template that declares none is deterministic.
    const description =
      template.description || `${this.humanizeName(template.name)} agent`;
    // 1,024 is the harness targets' own description ceiling. It was 120, which
    // truncated all 15 shipped descriptions (417-647 chars) mid-sentence and
    // always inside the WHEN clause — the half that makes an agent selectable.
    const cappedDescription =
      description.length > 1024
        ? description.substring(0, 1021) + '...'
        : description;
    const safeDescription = cappedDescription
      .replace(/\n/g, ' ')
      .replace(/"/g, '\\"');
    const frontmatterLines = [
      '---',
      `name: ${template.name}`,
      `description: "${safeDescription}"`,
    ];
    if (template.model && template.model.trim().length > 0) {
      frontmatterLines.push(`model: ${template.model.trim()}`);
    }
    frontmatterLines.push('---', '');
    const frontmatter = frontmatterLines.join('\n');

    return frontmatter + strippedContent.trimStart();
  }

  /**
   * Convert kebab-case template name to Title Case.
   * e.g., "backend-developer" -> "Backend Developer"
   */
  private humanizeName(name: string): string {
    return name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
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
    overrides?: Record<string, string>,
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
    projectInfo?: ProjectInfo,
  ): string[] {
    const languages: string[] = [];
    const typeStr = projectType.toString();
    languages.push(typeStr);
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
  private detectBuildTools(projectInfo: ProjectInfo | undefined): string[] {
    if (!projectInfo) return [];
    const allDeps = [
      ...(projectInfo.dependencies ?? []),
      ...(projectInfo.devDependencies ?? []),
    ];
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
        buildToolPatterns.some((pattern) => dep.includes(pattern)),
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
    if (existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(path.join(workspacePath, 'yarn.lock'))) return 'yarn';
    if (existsSync(path.join(workspacePath, 'package-lock.json'))) return 'npm';
    if (existsSync(path.join(workspacePath, 'bun.lockb'))) return 'bun';
    if (existsSync(path.join(workspacePath, 'requirements.txt'))) return 'pip';
    if (existsSync(path.join(workspacePath, 'Cargo.toml'))) return 'cargo';
    if (existsSync(path.join(workspacePath, 'go.mod'))) return 'go mod';
    if (existsSync(path.join(workspacePath, 'pom.xml'))) return 'maven';
    if (existsSync(path.join(workspacePath, 'build.gradle'))) return 'gradle';
    if (existsSync(path.join(workspacePath, 'Gemfile'))) return 'bundler';
    if (existsSync(path.join(workspacePath, 'composer.json')))
      return 'composer';

    return 'npm'; // Default fallback
  }
}
