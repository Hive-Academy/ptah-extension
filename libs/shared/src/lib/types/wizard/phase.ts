/**
 * Setup Wizard message types, analysis phases, and payload types.
 *
 * Extracted from setup-wizard.types.ts — zero behavior change.
 */

// ============================================================================
// Wizard Message Types
// ============================================================================

/**
 * Wizard message types for type-safe message handling.
 * Used by the discriminated union for exhaustive switch checking.
 */
export type WizardMessageType =
  | 'setup-wizard:scan-progress'
  | 'setup-wizard:analysis-stream'
  | 'setup-wizard:analysis-complete'
  | 'setup-wizard:available-agents'
  | 'setup-wizard:generation-progress'
  | 'setup-wizard:generation-complete'
  | 'setup-wizard:generation-stream'
  | 'setup-wizard:enhance-stream'
  | 'setup-wizard:error';

// ============================================================================
// Wizard Message Payload Types
// ============================================================================

/**
 * Analysis phase identifiers for agentic workspace analysis.
 * Used by the frontend to display phase stepper progress.
 */
export type AnalysisPhase =
  | 'discovery'
  | 'architecture'
  | 'health'
  | 'quality' // v1 phases (kept for backward compat)
  | 'project-profile'
  | 'architecture-assessment'
  | 'quality-audit'
  | 'elevation-plan'; // v2 multi-phase

/**
 * Payload for scan progress updates.
 * Sent during workspace scanning phase.
 *
 * Extended with agentic analysis fields (currentPhase, phaseLabel,
 * agentReasoning, completedPhases) that are populated when using
 * the Claude Agent SDK-based analysis path.
 */
export interface ScanProgressPayload {
  /** Number of files scanned so far */
  filesScanned: number;
  /** Total number of files to scan */
  totalFiles: number;
  /** Detected technologies/frameworks so far */
  detections: string[];
  /** Current analysis phase (agentic analysis only) */
  currentPhase?: AnalysisPhase;
  /** Human-readable label for the current phase (agentic analysis only) */
  phaseLabel?: string;
  /** Agent reasoning/activity description (agentic analysis only) */
  agentReasoning?: string;
  /** List of completed phase identifiers (agentic analysis only) */
  completedPhases?: AnalysisPhase[];
  /** Multi-phase analysis: current phase number (1-based) */
  currentPhaseNumber?: number;
  /** Multi-phase analysis: total phase count */
  totalPhaseCount?: number;
  /** Multi-phase analysis: per-phase status tracking */
  phaseStatuses?: Array<{
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  }>;
}

/**
 * Payload for streaming analysis messages to the frontend transcript.
 * Sent from AgenticAnalysisService during SDK stream processing.
 */
export interface AnalysisStreamPayload {
  /** Message type discriminator */
  kind:
    | 'text'
    | 'tool_start'
    | 'tool_input'
    | 'tool_result'
    | 'thinking'
    | 'error'
    | 'status';
  /** Text content (text output, thinking preview, error message, or status) */
  content: string;
  /** Tool name (for tool_start, tool_input, tool_result) */
  toolName?: string;
  /** Tool call ID (for correlating tool_start with tool_result) */
  toolCallId?: string;
  /** Whether this is an error result (for tool_result) */
  isError?: boolean;
  /** Timestamp */
  timestamp: number;
  /**
   * Optional flat stream event for ExecutionNode rendering pipeline.
   * When present, the setup-wizard frontend accumulates these into a StreamingState
   * and renders via ExecutionTreeBuilderService + ExecutionNodeComponent.
   * Backward compatible: old payloads without this field still work.
   */
  flatEvent?: import('../execution').FlatStreamEventUnion;
}

/**
 * Payload for streaming generation events to the frontend transcript.
 * Extends AnalysisStreamPayload with an optional agent identifier
 * to distinguish which agent template is being processed.
 *
 * Used by ContentGenerationService during SDK stream processing
 * and broadcast via 'setup-wizard:generation-stream' messages.
 */
export interface GenerationStreamPayload extends AnalysisStreamPayload {
  /** Which agent template is currently being processed */
  agentId?: string;
}

/**
 * Payload for analysis completion.
 * Sent when workspace analysis is complete.
 */
export interface AnalysisCompletePayload {
  /** Project context extracted from analysis */
  projectContext: {
    /** Project type (e.g., 'Angular', 'Node.js') */
    type: string;
    /** Detected tech stack */
    techStack: string[];
    /** Detected architecture pattern */
    architecture?: string;
    /** Whether this is a monorepo */
    isMonorepo: boolean;
    /** Monorepo type if applicable */
    monorepoType?: string;
    /** Number of packages in monorepo */
    packageCount?: number;
  };
}

/**
 * Payload for available agents list.
 * Sent after agent recommendations are calculated.
 */
export interface AvailableAgentsPayload {
  /** List of available agents with selection state */
  agents: Array<{
    /** Agent identifier */
    id: string;
    /** Agent display name */
    name: string;
    /** Whether agent is selected */
    selected: boolean;
    /** Relevance score (0-100) */
    score: number;
    /** Reason for recommendation */
    reason: string;
    /** Whether agent should be auto-included */
    autoInclude: boolean;
  }>;
}

/**
 * Payload for generation progress updates.
 * Sent during agent generation phase.
 */
export interface GenerationProgressPayload {
  /** Current generation progress */
  progress: {
    /** Current phase of generation */
    phase:
      | 'analysis'
      | 'selection'
      | 'customization'
      | 'rendering'
      | 'complete';
    /** Percentage complete (0-100) */
    percentComplete: number;
    /** Files scanned (during analysis phase) */
    filesScanned?: number;
    /** Total files to scan */
    totalFiles?: number;
    /** Currently generating agent */
    currentAgent?: string;
  };
}

/**
 * Payload for generation completion.
 * Sent when agent generation is finished.
 */
export interface GenerationCompletePayload {
  /** Whether generation was successful */
  success: boolean;
  /** Number of agents generated */
  generatedCount: number;
  /** Generation duration in milliseconds */
  duration?: number;
  /** Error messages if any */
  errors?: string[];
  /** Warning messages from Phase 3 customization failures */
  warnings?: string[];
  /** Whether enhanced prompts were used during generation */
  enhancedPromptsUsed?: boolean;
}

/**
 * Payload for error messages.
 * Sent when an error occurs during wizard flow.
 */
export interface WizardErrorPayload {
  /** Error message */
  message: string;
  /** Additional error details */
  details?: string;
  /** Error type: 'error' for real errors, 'fallback-warning' for degraded-mode warnings */
  type?: 'error' | 'fallback-warning';
}

// ============================================================================
// Wizard Message Discriminated Union
// ============================================================================

/**
 * Discriminated union for wizard messages.
 * Enables exhaustive type checking in message handlers.
 *
 * @example
 * ```typescript
 * function handleMessage(message: WizardMessage): void {
 *   switch (message.type) {
 *     case 'setup-wizard:scan-progress':
 *       console.log(`Scanned ${message.payload.filesScanned} files`);
 *       break;
 *     case 'setup-wizard:analysis-complete':
 *       console.log(`Project type: ${message.payload.projectContext.type}`);
 *       break;
 *     // ... handle all message types
 *     default:
 *       // TypeScript ensures this is unreachable if all cases handled
 *       const _exhaustive: never = message;
 *   }
 * }
 * ```
 */
export type WizardMessage =
  | { type: 'setup-wizard:scan-progress'; payload: ScanProgressPayload }
  | { type: 'setup-wizard:analysis-stream'; payload: AnalysisStreamPayload }
  | { type: 'setup-wizard:analysis-complete'; payload: AnalysisCompletePayload }
  | { type: 'setup-wizard:available-agents'; payload: AvailableAgentsPayload }
  | {
      type: 'setup-wizard:generation-progress';
      payload: GenerationProgressPayload;
    }
  | {
      type: 'setup-wizard:generation-complete';
      payload: GenerationCompletePayload;
    }
  | { type: 'setup-wizard:generation-stream'; payload: GenerationStreamPayload }
  | { type: 'setup-wizard:enhance-stream'; payload: AnalysisStreamPayload }
  | { type: 'setup-wizard:error'; payload: WizardErrorPayload };
