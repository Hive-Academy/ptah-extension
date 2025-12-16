/**
 * Wizard Type System for Agent Generation Setup
 *
 * Defines types for managing the 6-step setup wizard that guides users through
 * intelligent agent generation. The wizard collects project context, allows
 * agent selection customization, and coordinates the generation process.
 *
 * @module @ptah-extension/agent-generation/types
 */

/**
 *  Wizard step identifiers for the 6-step setup flow.
 *
 * Flow:
 * 1. welcome - Introduction and overview
 * 2. scan - Workspace analysis in progress
 * 3. review - Display analysis results (project type, frameworks, etc.)
 * 4. select - Agent selection and customization
 * 5. generate - Agent generation in progress
 * 6. complete - Generation complete, show summary
 */
export type WizardStep =
  | 'welcome'
  | 'scan'
  | 'review'
  | 'select'
  | 'generate'
  | 'complete';

/**
 * Wizard session state tracking.
 * Maintains the current wizard instance state for cancellation/resume support.
 *
 * @example
 * ```typescript
 * const session: WizardSession = {
 *   id: 'wizard-123',
 *   workspaceRoot: '/path/to/workspace',
 *   currentStep: 'review',
 *   startedAt: new Date(),
 *   projectContext: {...},
 *   selectedAgentIds: ['backend-developer', 'frontend-developer']
 * };
 * ```
 */
export interface WizardSession {
  /**
   * Unique session identifier for tracking and resuming.
   * Generated using UUID v4.
   */
  id: string;

  /**
   * Absolute path to the workspace root directory.
   * Used for all file operations and analysis.
   */
  workspaceRoot: string;

  /**
   * Current wizard step.
   * Determines which UI view is displayed and what actions are available.
   */
  currentStep: WizardStep;

  /**
   * Timestamp when the wizard session was started.
   * Used for session expiry and metrics.
   */
  startedAt: Date;

  /**
   * Project context from workspace analysis (populated after 'scan' step).
   * Undefined until analysis completes.
   */
  projectContext?: {
    projectType: string;
    frameworks: string[];
    monorepoType?: string;
    techStack: string[];
  };

  /**
   * User-selected agent IDs (populated during 'select' step).
   * Undefined until user confirms selection.
   */
  selectedAgentIds?: string[];

  /**
   * Generation summary (populated after 'generate' step).
   * Undefined until generation completes.
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
 * Wizard state for persistence and resuming.
 * Minimal state needed to restore a wizard session.
 *
 * @example
 * ```typescript
 * // Save state for resume
 * const state: WizardState = {
 *   sessionId: session.id,
 *   currentStep: session.currentStep,
 *   workspaceRoot: session.workspaceRoot,
 *   lastActivity: new Date()
 * };
 * await storage.save('wizard-state', state);
 * ```
 */
export interface WizardState {
  /**
   * Session ID for correlation.
   */
  sessionId: string;

  /**
   * Step to resume from.
   */
  currentStep: WizardStep;

  /**
   * Workspace path for validation.
   */
  workspaceRoot: string;

  /**
   * Last activity timestamp.
   * Used to expire old sessions (e.g., > 24 hours).
   */
  lastActivity: Date;

  /**
   * Partial project context if available.
   * Allows skipping re-analysis on resume.
   */
  projectContext?: {
    projectType: string;
    frameworks: string[];
    monorepoType?: string;
    techStack: string[];
  };

  /**
   * Partial agent selection if available.
   * Preserves user choices on resume.
   */
  selectedAgentIds?: string[];
}

/**
 * Progress update payload for wizard UI.
 * Sent during long-running operations (scan, generation).
 *
 * @example
 * ```typescript
 * const progress: ProgressUpdate = {
 *   phase: 'scan',
 *   percentComplete: 45,
 *   currentOperation: 'Analyzing package.json',
 *   filesProcessed: 120,
 *   totalFiles: 350
 * };
 * webviewManager.sendMessage('wizard', 'progress-update', progress);
 * ```
 */
export interface ProgressUpdate {
  /**
   * Current operation phase.
   */
  phase: 'scan' | 'selection' | 'customization' | 'rendering' | 'writing';

  /**
   * Progress percentage (0-100).
   */
  percentComplete: number;

  /**
   * Human-readable description of current operation.
   */
  currentOperation: string;

  /**
   * Optional: Number of files processed (for scan phase).
   */
  filesProcessed?: number;

  /**
   * Optional: Total files to process (for scan phase).
   */
  totalFiles?: number;

  /**
   * Optional: Number of agents processed (for generation phase).
   */
  agentsProcessed?: number;

  /**
   * Optional: Total agents to generate (for generation phase).
   */
  totalAgents?: number;

  /**
   * Optional: Detected project characteristics (for scan phase).
   */
  detectedCharacteristics?: string[];
}

/**
 * Wizard cancellation request.
 * Sent from webview when user cancels the wizard.
 */
export interface CancelWizardRequest {
  /**
   * Session ID to cancel.
   */
  sessionId: string;

  /**
   * Whether to save progress for resume.
   */
  saveProgress: boolean;

  /**
   * Optional reason for cancellation (for analytics).
   */
  reason?: 'user-initiated' | 'error' | 'timeout';
}

/**
 * Wizard resume request.
 * Sent from webview or command to resume a saved session.
 */
export interface ResumeWizardRequest {
  /**
   * Session ID to resume.
   */
  sessionId: string;

  /**
   * Expected workspace root for validation.
   */
  workspaceRoot: string;
}

/**
 * Agent selection update from user.
 * Sent when user customizes agent selection in the wizard.
 */
export interface AgentSelectionUpdate {
  /**
   * Session ID for correlation.
   */
  sessionId: string;

  /**
   * User-selected agent IDs.
   * Replaces any previous selection.
   */
  selectedAgentIds: string[];

  /**
   * Optional: User-provided generation options.
   */
  options?: {
    threshold?: number;
    includeOptional?: boolean;
    variableOverrides?: Record<string, string>;
  };
}

// =============================================================================
// Wizard RPC Message Types (TASK_2025_078 - Type Safety Improvement)
// =============================================================================

/**
 * Base interface for all wizard RPC messages.
 */
export interface WizardRpcMessageBase {
  /** Message type identifier */
  type: string;
  /** Unique message ID for request/response correlation */
  messageId: string;
}

/**
 * Project context payload from frontend.
 * Simplified version sent by wizard UI.
 */
export interface FrontendProjectContext {
  rootPath?: string;
  workspacePath?: string;
  projectType: string;
  frameworks?: string[];
  monorepoType?: string;
  relevantFiles?: string[];
  techStack?: {
    languages?: string[];
    frameworks?: string[];
    buildTools?: string[];
    testingFrameworks?: string[];
    packageManager?: string;
  };
  codeConventions?: {
    indentation?: 'spaces' | 'tabs';
    indentSize?: number;
    quoteStyle?: 'single' | 'double';
    semicolons?: boolean;
    trailingComma?: 'none' | 'es5' | 'all';
  };
}

/**
 * Wizard start message payload.
 * Sent when user initiates workspace scan.
 */
export interface WizardStartPayload {
  projectContext: FrontendProjectContext;
  threshold?: number;
}

/**
 * Wizard start RPC message.
 */
export interface WizardStartMessage extends WizardRpcMessageBase {
  type: 'setup-wizard:start';
  payload: WizardStartPayload;
}

/**
 * Wizard selection submission payload.
 * Sent when user confirms agent selection.
 */
export interface WizardSelectionPayload {
  selectedAgentIds: string[];
  threshold?: number;
  variableOverrides?: Record<string, string>;
}

/**
 * Wizard selection RPC message.
 */
export interface WizardSelectionMessage extends WizardRpcMessageBase {
  type: 'setup-wizard:submit-selection';
  payload: WizardSelectionPayload;
}

/**
 * Wizard cancel payload.
 * Sent when user cancels the wizard.
 */
export interface WizardCancelPayload {
  saveProgress?: boolean;
}

/**
 * Wizard cancel RPC message.
 */
export interface WizardCancelMessage extends WizardRpcMessageBase {
  type: 'setup-wizard:cancel';
  payload?: WizardCancelPayload;
}

/**
 * Union type for all wizard RPC messages.
 * Use for type narrowing in message handlers.
 */
export type WizardRpcMessage =
  | WizardStartMessage
  | WizardSelectionMessage
  | WizardCancelMessage;
