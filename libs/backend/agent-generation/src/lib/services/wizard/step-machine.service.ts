/**
 * WizardStepMachineService - Step State Machine Service
 * TASK_2025_115: Setup Wizard Service Decomposition
 *
 * Responsibility:
 * - Define wizard step order (welcome → scan → review → select → generate → complete)
 * - Validate step transitions
 * - Determine next step based on current step
 * - Extract step-specific data during transitions
 *
 * Pattern Source: setup-wizard.service.ts:349-485
 * Extracted from: SetupWizardService.handleStepTransition()
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { WizardStep } from '../../types/wizard.types';
import type {
  AgentProjectContext,
  GenerationSummary,
} from '../../types/core.types';

/**
 * Step data extraction result.
 * Contains optional fields for each step's data payload.
 */
export interface StepDataResult {
  /**
   * Project context from 'scan' step.
   * Populated when transitioning from scan → review.
   */
  projectContext?: {
    projectType: string;
    frameworks: string[];
    monorepoType?: string;
    techStack: string[];
  };

  /**
   * Selected agent IDs from 'select' step.
   * Populated when transitioning from select → generate.
   */
  selectedAgentIds?: string[];

  /**
   * Generation summary from 'generate' step.
   * Populated when transitioning from generate → complete.
   */
  generationSummary?: {
    totalAgents: number;
    successful: number;
    failed: number;
    durationMs: number;
    warnings: string[];
  };
}

/**
 * Service responsible for managing wizard step state machine.
 *
 * The wizard follows a strict 6-step flow:
 * 1. welcome - Introduction and overview
 * 2. scan - Workspace analysis in progress
 * 3. review - Display analysis results
 * 4. select - Agent selection and customization
 * 5. generate - Agent generation in progress
 * 6. complete - Generation complete, show summary
 *
 * This service ensures transitions follow the defined order and extracts
 * step-specific data during transitions.
 *
 * @injectable
 */
@injectable()
export class WizardStepMachineService {
  /**
   * Immutable step order definition.
   * All transitions must follow this sequence.
   */
  private readonly STEP_ORDER: WizardStep[] = [
    'welcome',
    'scan',
    'review',
    'select',
    'generate',
    'complete',
  ];

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.debug('[WizardStepMachine] Service initialized', {
      stepOrder: this.STEP_ORDER,
    });
  }

  /**
   * Get the next step in the wizard flow.
   *
   * Determines the next step based on the current step following the STEP_ORDER sequence.
   * The 'complete' step is terminal and returns itself.
   *
   * @param currentStep - Current wizard step
   * @returns Next wizard step in sequence
   * @throws Error if current step is unknown
   *
   * @example
   * ```typescript
   * const nextStep = stepMachine.getNextStep('welcome');
   * // Returns: 'scan'
   *
   * const finalStep = stepMachine.getNextStep('complete');
   * // Returns: 'complete' (terminal state)
   * ```
   */
  getNextStep(currentStep: WizardStep): WizardStep {
    this.logger.debug('[WizardStepMachine] Determining next step', {
      currentStep,
    });

    switch (currentStep) {
      case 'welcome':
        // Welcome → Scan: Start workspace analysis
        return 'scan';

      case 'scan':
        // Scan → Review: Analysis complete, show results
        return 'review';

      case 'review':
        // Review → Select: User confirmed analysis, proceed to agent selection
        return 'select';

      case 'select':
        // Select → Generate: User confirmed agent selection, start generation
        return 'generate';

      case 'generate':
        // Generate → Complete: Generation complete, show summary
        return 'complete';

      case 'complete':
        // Complete → (terminal): No automatic transition, user closes wizard
        return 'complete';

      default: {
        const errorMsg = `Unknown wizard step: ${currentStep}`;
        this.logger.error('[WizardStepMachine] Invalid step', {
          currentStep,
          validSteps: this.STEP_ORDER,
        });
        throw new Error(errorMsg);
      }
    }
  }

  /**
   * Validate that a step transition is correct.
   *
   * Checks that the actual step matches the expected step.
   * Used to prevent invalid state transitions and ensure UI consistency.
   *
   * @param expectedStep - Expected current step
   * @param actualStep - Actual step from request
   * @returns True if steps match, false otherwise
   *
   * @example
   * ```typescript
   * const isValid = stepMachine.validateTransition('scan', 'scan');
   * // Returns: true
   *
   * const isInvalid = stepMachine.validateTransition('scan', 'review');
   * // Returns: false
   * ```
   */
  validateTransition(
    expectedStep: WizardStep,
    actualStep: WizardStep
  ): boolean {
    const isValid = expectedStep === actualStep;

    if (!isValid) {
      this.logger.warn(
        '[WizardStepMachine] Step transition validation failed',
        {
          expectedStep,
          actualStep,
          message: `Expected ${expectedStep}, got ${actualStep}`,
        }
      );
    }

    return isValid;
  }

  /**
   * Extract step-specific data from raw step data payload.
   *
   * Each wizard step may provide different data structures.
   * This method extracts and transforms the data based on the current step.
   *
   * Extraction logic:
   * - 'scan' step: Extracts projectContext from AgentProjectContext
   * - 'select' step: Extracts selectedAgentIds array
   * - 'generate' step: Extracts generationSummary from GenerationSummary
   * - Other steps: Returns empty object
   *
   * @param step - Current wizard step
   * @param rawData - Raw data from step transition request
   * @returns Extracted step data with typed fields
   *
   * @example
   * ```typescript
   * const stepData = stepMachine.extractStepData('scan', {
   *   projectContext: { projectType: 'NodeJS', frameworks: ['NestJS'], ... }
   * });
   * // Returns: { projectContext: { projectType: 'NodeJS', frameworks: ['NestJS'], ... } }
   * ```
   */
  extractStepData(
    step: WizardStep,
    rawData: Record<string, unknown>
  ): StepDataResult {
    this.logger.debug('[WizardStepMachine] Extracting step data', {
      step,
      hasRawData: Object.keys(rawData).length > 0,
    });

    const result: StepDataResult = {};

    switch (step) {
      case 'scan':
        // Extract project context from scan step
        if ('projectContext' in rawData && rawData['projectContext']) {
          const fullContext = rawData['projectContext'] as AgentProjectContext;

          // Convert AgentProjectContext to simplified WizardSession.projectContext
          result.projectContext = {
            projectType: fullContext.projectType.toString(),
            frameworks: fullContext.frameworks.map((f) => f.toString()),
            monorepoType: fullContext.monorepoType?.toString(),
            techStack: fullContext.techStack.frameworks,
          };

          this.logger.debug(
            '[WizardStepMachine] Extracted project context from scan',
            {
              projectType: result.projectContext.projectType,
              frameworkCount: result.projectContext.frameworks.length,
            }
          );
        }
        break;

      case 'select':
        // Extract selected agent IDs from select step
        if ('selectedAgentIds' in rawData && rawData['selectedAgentIds']) {
          result.selectedAgentIds = rawData['selectedAgentIds'] as string[];

          this.logger.debug(
            '[WizardStepMachine] Extracted selected agent IDs from select',
            {
              agentCount: result.selectedAgentIds.length,
              agentIds: result.selectedAgentIds,
            }
          );
        }
        break;

      case 'generate':
        // Extract generation summary from generate step
        if ('generationSummary' in rawData && rawData['generationSummary']) {
          const fullSummary = rawData['generationSummary'] as GenerationSummary;

          // Convert GenerationSummary to simplified WizardSession.generationSummary
          result.generationSummary = {
            totalAgents: fullSummary.totalAgents,
            successful: fullSummary.successful,
            failed: fullSummary.failed,
            durationMs: fullSummary.durationMs,
            warnings: fullSummary.warnings,
          };

          this.logger.debug(
            '[WizardStepMachine] Extracted generation summary from generate',
            {
              totalAgents: result.generationSummary.totalAgents,
              successful: result.generationSummary.successful,
              failed: result.generationSummary.failed,
            }
          );
        }
        break;

      default:
        // Other steps (welcome, review, complete) don't extract data
        this.logger.debug('[WizardStepMachine] No data extraction for step', {
          step,
        });
        break;
    }

    return result;
  }

  /**
   * Get the complete step order array.
   *
   * Useful for UI rendering and validation.
   *
   * @returns Immutable copy of step order
   */
  getStepOrder(): readonly WizardStep[] {
    return [...this.STEP_ORDER];
  }

  /**
   * Get the step index (0-based) for a given step.
   *
   * Useful for progress indicators.
   *
   * @param step - Wizard step
   * @returns Zero-based index of step, or -1 if not found
   *
   * @example
   * ```typescript
   * const index = stepMachine.getStepIndex('review');
   * // Returns: 2
   *
   * const progress = (index + 1) / stepMachine.getStepOrder().length;
   * // Returns: 0.5 (50% progress)
   * ```
   */
  getStepIndex(step: WizardStep): number {
    return this.STEP_ORDER.indexOf(step);
  }
}
