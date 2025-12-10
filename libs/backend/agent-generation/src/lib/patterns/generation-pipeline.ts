import { Result } from '@ptah-extension/shared';

/**
 * A single phase in the generation pipeline.
 *
 * Each phase is a pure, composable transformation that can be
 * executed sequentially with other phases.
 *
 * @template TInput - Input type for this phase
 * @template TOutput - Output type for this phase (becomes input to next phase)
 */
export interface GenerationPhase<TInput, TOutput> {
  /** Human-readable name for logging/debugging */
  name: string;
  /** Execute the phase transformation */
  execute: (input: TInput) => Promise<Result<TOutput, Error>>;
}

/**
 * Pipeline context that flows through all phases.
 *
 * Provides metadata about the pipeline execution and storage for
 * intermediate results that later phases may need to reference.
 */
export interface PipelineContext {
  /** Unique identifier for this pipeline run */
  runId: string;
  /** Start timestamp */
  startedAt: Date;
  /** Accumulated results from previous phases */
  results: Record<string, unknown>;
}

/**
 * Result of pipeline execution.
 *
 * Provides both the final result and metadata about the execution,
 * including which phase failed (if any) and total duration.
 */
export interface PipelineResult<TFinal> {
  /** Final result if successful */
  result?: TFinal;
  /** Error if failed */
  error?: Error;
  /** Phase where failure occurred (if any) */
  failedPhase?: string;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Multi-phase generation pipeline with sequential execution.
 * Each phase can access results from previous phases via context.
 *
 * **Use Case**: When generation requires multiple sequential steps that each
 * depend on the previous step's output. Fails fast on first error.
 *
 * **Pattern Origin**: Extracted from roocode-generator's MemoryBankOrchestrator
 * which executes: template-processing → content-generation → file-writing phases.
 *
 * @example
 * ```typescript
 * interface ProjectContext {
 *   projectPath: string;
 *   analysisResult: AnalysisData;
 * }
 *
 * const pipeline = new GenerationPipeline<ProjectContext>()
 *   .addPhase({
 *     name: 'analyze',
 *     execute: async (ctx) => {
 *       const analysis = await analyzeProject(ctx.projectPath);
 *       return Result.ok({ ...ctx, analysisResult: analysis });
 *     }
 *   })
 *   .addPhase({
 *     name: 'template',
 *     execute: async (ctx) => {
 *       const templates = await loadTemplates(ctx.analysisResult);
 *       return Result.ok({ ...ctx, templates });
 *     }
 *   })
 *   .addPhase({
 *     name: 'generate',
 *     execute: async (ctx) => {
 *       const content = await generateContent(ctx.templates, ctx.analysisResult);
 *       return Result.ok({ ...ctx, content });
 *     }
 *   });
 *
 * const result = await pipeline.execute({ projectPath: '/path/to/project' });
 * if (result.error) {
 *   console.error(`Failed at phase ${result.failedPhase}: ${result.error.message}`);
 * } else {
 *   console.log(`Success in ${result.durationMs}ms`, result.result);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Real-world usage: Memory bank file generation
 * type FileGenerationContext = {
 *   fileType: string;
 *   template?: string;
 *   content?: string;
 *   filePath?: string;
 * };
 *
 * const filePipeline = new GenerationPipeline<FileGenerationContext>()
 *   .addPhase({
 *     name: 'load-template',
 *     execute: async (ctx) => {
 *       const template = await templateLoader.load(ctx.fileType);
 *       return template.isOk()
 *         ? Result.ok({ ...ctx, template: template.value })
 *         : Result.err(template.error);
 *     }
 *   })
 *   .addPhase({
 *     name: 'generate-content',
 *     execute: async (ctx) => {
 *       const content = await llm.generate(ctx.template!);
 *       return content.isOk()
 *         ? Result.ok({ ...ctx, content: content.value })
 *         : Result.err(content.error);
 *     }
 *   })
 *   .addPhase({
 *     name: 'write-file',
 *     execute: async (ctx) => {
 *       const result = await fs.writeFile(ctx.filePath!, ctx.content!);
 *       return result.isOk()
 *         ? Result.ok(ctx)
 *         : Result.err(result.error);
 *     }
 *   });
 *
 * // Execute for one file
 * const result = await filePipeline.execute({
 *   fileType: 'architecture',
 *   filePath: './memory-bank/architecture.md'
 * });
 * ```
 *
 * @template TContext - The context type that flows through all phases
 */
export class GenerationPipeline<TContext> {
  private phases: GenerationPhase<any, any>[] = [];

  /**
   * Add a phase to the pipeline.
   * Phases are executed in the order they are added.
   *
   * @param phase - The phase to add
   * @returns This pipeline instance for method chaining
   */
  addPhase<TIn, TOut>(phase: GenerationPhase<TIn, TOut>): this {
    this.phases.push(phase);
    return this;
  }

  /**
   * Execute all phases sequentially.
   * Stops on first error and reports which phase failed.
   *
   * @param initialContext - Initial context to start the pipeline
   * @returns Pipeline result with final context or error details
   */
  async execute(initialContext: TContext): Promise<PipelineResult<TContext>> {
    const startTime = Date.now();
    let currentContext: unknown = initialContext;

    for (const phase of this.phases) {
      const result = await phase.execute(currentContext);
      if (result.isErr()) {
        return {
          error: result.error!,
          failedPhase: phase.name,
          durationMs: Date.now() - startTime,
        };
      }
      currentContext = result.value;
    }

    return {
      result: currentContext as TContext,
      durationMs: Date.now() - startTime,
    };
  }
}
