/**
 * Setup Wizard Orchestrator Interface
 *
 * Service interface for orchestrating the agent setup wizard workflow.
 * Manages the end-to-end wizard experience from project analysis to agent generation.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import {
  GenerationOptions,
  GenerationSummary,
  AgentProjectContext,
} from '../types/core.types';

/**
 * Orchestrator for the agent setup wizard workflow.
 *
 * Responsibilities:
 * - Coordinate 6-step wizard flow (Welcome → Scan → Review → Select → Generate → Complete)
 * - Manage wizard state and progress tracking
 * - Orchestrate backend services (analysis, selection, generation)
 * - Handle cancellation with progress save/resume
 * - Provide real-time progress updates to UI
 * - Error recovery and graceful degradation
 *
 * @example
 * ```typescript
 * // Start wizard
 * const contextResult = await orchestrator.startWizard('/workspace/my-project');
 * if (contextResult.isOk()) {
 *   const context = contextResult.value;
 *   console.log(`Project type: ${context.projectType}`);
 *
 *   // Generate agents
 *   const options: GenerationOptions = { threshold: 70, includeOptional: true, autoApprove: false };
 *   const summaryResult = await orchestrator.generateAgents(context, options);
 * }
 * ```
 */
export interface ISetupWizardOrchestrator {
  /**
   * Start the setup wizard workflow.
   *
   * Performs initial project analysis and returns extended project context
   * for display in the Review step. Analysis includes:
   * - Project type detection (13 types supported)
   * - Framework identification
   * - Monorepo detection
   * - Tech stack analysis
   * - Code conventions detection
   * - Relevant file indexing
   *
   * This is a long-running operation (target: <30s) that should show progress
   * to the user during execution.
   *
   * @param rootPath - Absolute path to project root directory
   * @returns Result containing extended project context, or Error if analysis fails
   *
   * @example
   * ```typescript
   * const result = await service.startWizard('/workspace/ptah-extension');
   * if (result.isErr()) {
   *   console.error('Analysis failed:', result.error);
   *   return;
   * }
   *
   * const context = result.value;
   * console.log('Project Analysis:');
   * console.log(`- Type: ${context.projectType}`);
   * console.log(`- Frameworks: ${context.frameworks.join(', ')}`);
   * console.log(`- Monorepo: ${context.monorepoType || 'No'}`);
   * console.log(`- Languages: ${context.techStack.languages.join(', ')}`);
   * ```
   */
  startWizard(rootPath: string): Promise<Result<AgentProjectContext, Error>>;

  /**
   * Execute agent generation with options.
   *
   * Orchestrates the complete agent generation workflow:
   *
   * 1. **Agent Selection** (5s target)
   *    - Score all templates against project context
   *    - Apply threshold filtering
   *    - Include user overrides
   *
   * 2. **Content Customization** (10s per agent target)
   *    - Generate LLM customizations for each selected agent
   *    - Substitute variables with project values
   *    - Validate generated content
   *
   * 3. **Template Rendering** (<1s per agent)
   *    - Assemble final agent content
   *    - Apply code style conventions
   *    - Format markdown
   *
   * 4. **File Writing** (atomic)
   *    - Backup existing files
   *    - Write all agents
   *    - Verify writes
   *    - Rollback on failure
   *
   * Progress updates should be emitted during each phase for UI display.
   *
   * @param context - Extended project context from startWizard()
   * @param options - Generation options (threshold, overrides, auto-approve)
   * @returns Result containing generation summary with results, or Error if generation fails
   *
   * @example
   * ```typescript
   * const options: GenerationOptions = {
   *   threshold: 70,
   *   includeOptional: true,
   *   autoApprove: false,
   *   variableOverrides: { projectName: 'Custom Name' }
   * };
   *
   * const result = await service.generateAgents(projectContext, options);
   * if (result.isErr()) {
   *   console.error('Generation failed:', result.error);
   *   return;
   * }
   *
   * const summary = result.value;
   * console.log('Generation Summary:');
   * console.log(`- Total: ${summary.totalAgents}`);
   * console.log(`- Success: ${summary.successful}`);
   * console.log(`- Failed: ${summary.failed}`);
   * console.log(`- Duration: ${summary.durationMs}ms`);
   *
   * if (summary.warnings.length > 0) {
   *   console.warn('Warnings:', summary.warnings);
   * }
   * ```
   */
  generateAgents(
    context: AgentProjectContext,
    options: GenerationOptions
  ): Promise<Result<GenerationSummary, Error>>;

  /**
   * Cancel an in-progress generation.
   *
   * Attempts to gracefully cancel the current generation workflow. If generation
   * has already started writing files, it will complete the current batch write
   * (to maintain atomicity) before cancelling.
   *
   * Cancellation saves progress state for potential resume:
   * - Completed analysis results
   * - Selected agents
   * - Any completed customizations
   *
   * Note: Cancellation is best-effort. Some operations (like LLM requests) may
   * complete even after cancellation is requested.
   *
   * @returns Result containing void on successful cancellation, or Error if cancellation fails
   *
   * @example
   * ```typescript
   * // In response to user clicking "Cancel" button
   * const result = await service.cancel();
   * if (result.isOk()) {
   *   console.log('Generation cancelled successfully');
   *   console.log('Progress saved for resume');
   * } else {
   *   console.error('Failed to cancel:', result.error);
   * }
   * ```
   */
  cancel(): Promise<Result<void, Error>>;
}
