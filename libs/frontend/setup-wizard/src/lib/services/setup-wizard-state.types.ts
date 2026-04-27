import type { StreamingState } from '@ptah-extension/chat-types';
import type { AnalysisPhase } from '@ptah-extension/shared';

/**
 * Wizard state types extracted from `setup-wizard-state.service.ts` (Wave C7h).
 *
 * These 12 type declarations describe the public state surface of the setup
 * wizard. They live in this sibling file so the coordinator stays under the
 * 800-LOC ceiling, and are re-exported from the coordinator file path so that
 * existing consumer imports (`from '.../setup-wizard-state.service'`) continue
 * to resolve unchanged.
 */

/**
 * Wizard step identifiers matching the 7-step setup flow
 * Includes premium-check step for license verification before wizard access
 */
export type WizardStep =
  | 'premium-check'
  | 'welcome'
  | 'scan'
  | 'analysis'
  | 'selection'
  | 'enhance'
  | 'generation'
  | 'completion'
  // New project path
  | 'project-type'
  | 'discovery'
  | 'plan-generation'
  | 'plan-review';

/**
 * Wizard path discriminator.
 * 'existing' = analyze existing project, 'new' = start new project, null = not yet chosen.
 */
export type WizardPath = 'existing' | 'new' | null;

/**
 * Project context detected during workspace scan
 */
export interface ProjectContext {
  type: string;
  techStack: string[];
  architecture?: string;
  isMonorepo: boolean;
  monorepoType?: string;
  packageCount?: number;
}

/**
 * Agent selection with relevance scoring
 */
export interface AgentSelection {
  id: string;
  name: string;
  selected: boolean;
  score: number;
  reason: string;
  autoInclude: boolean;
}

/**
 * Generation progress tracking
 */
export interface GenerationProgress {
  phase: 'analysis' | 'selection' | 'customization' | 'rendering' | 'complete';
  percentComplete: number;
  filesScanned?: number;
  totalFiles?: number;
  detections?: string[];
  agents?: AgentProgress[];
  currentAgent?: string;
}

export interface AgentProgress {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'complete' | 'error';
  currentTask?: string;
  duration?: number;
  customizationSummary?: string;
  errorMessage?: string;
}

/**
 * Scan progress tracking.
 * Extended with agentic analysis fields for phase stepper and reasoning display.
 */
export interface ScanProgress {
  filesScanned: number;
  totalFiles: number;
  detections: string[];
  /** Current analysis phase (agentic analysis only) */
  currentPhase?: AnalysisPhase;
  /** Human-readable label for the current phase (agentic analysis only) */
  phaseLabel?: string;
  /** Agent reasoning/activity description (agentic analysis only) */
  agentReasoning?: string;
  /** List of completed phase identifiers (agentic analysis only) */
  completedPhases?: AnalysisPhase[];
}

/**
 * Analysis results payload
 */
export interface AnalysisResults {
  projectContext: ProjectContext;
}

/**
 * Completion data payload
 */
export interface CompletionData {
  success: boolean;
  generatedCount: number;
  duration?: number;
  errors?: string[];
  warnings?: string[];
  enhancedPromptsUsed?: boolean;
}

/**
 * Error state
 */
export interface ErrorState {
  message: string;
  details?: string;
}

/**
 * Generation progress item.
 * Tracks progress of individual items during agent generation.
 */
export interface SkillGenerationProgressItem {
  /** Unique item identifier */
  id: string;
  /** Display name */
  name: string;
  /** Item type: agent or enhanced-prompt */
  type: 'agent' | 'enhanced-prompt';
  /** Current status */
  status: 'pending' | 'in-progress' | 'complete' | 'error';
  /** Progress percentage 0-100 (optional) */
  progress?: number;
  /** Error message if status is 'error' */
  errorMessage?: string;
}

/**
 * Enhanced Prompts generation status for the wizard.
 * Tracks the state of Enhanced Prompts generation during setup.
 */
export type EnhancedPromptsWizardStatus =
  | 'idle'
  | 'generating'
  | 'complete'
  | 'error'
  | 'skipped';

/**
 * Per-phase entry for the immutable wizard streaming-state list.
 *
 * TASK_2026_103 Wave F2 — replaces `Map<string, StreamingState>` storage.
 * The list shape gives deterministic iteration order, makes "always replace"
 * the only valid update path (no silent in-place mutation bug), and keeps
 * O(1) lookup through a derived `byId` computed.
 */
export interface PhaseStreamingEntry {
  readonly phaseKey: string;
  readonly state: StreamingState;
}
