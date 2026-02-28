/**
 * Agent Process Types for Async Agent Orchestration
 * TASK_2025_157: Branded AgentId, status enum, process tracking types
 */
import { v4 as uuidv4 } from 'uuid';

// ========================================
// Branded AgentId Type
// ========================================

/**
 * Branded AgentId type - prevents mixing with other string IDs
 * Pattern: libs/shared/src/lib/types/branded.types.ts:15
 */
export type AgentId = string & { readonly __brand: 'AgentId' };

/**
 * AgentId smart constructors with validation
 * Pattern: libs/shared/src/lib/types/branded.types.ts:34-66
 */
export const AgentId = {
  create(): AgentId {
    return uuidv4() as AgentId;
  },
  validate(id: string): id is AgentId {
    // AgentIds are UUIDs
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    );
  },
  from(id: string): AgentId {
    if (!AgentId.validate(id)) {
      throw new TypeError(`Invalid AgentId format: ${id}`);
    }
    return id as AgentId;
  },
  /**
   * Safely convert string to AgentId, returns null if invalid
   */
  safeParse(id: string): AgentId | null {
    return AgentId.validate(id) ? (id as AgentId) : null;
  },
};

// ========================================
// Agent Status Enum
// ========================================

export type AgentStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'stopped';

// ========================================
// CLI Type
// ========================================

export type CliType = 'gemini' | 'codex' | 'copilot';

// ========================================
// Agent Process Info (tracked per agent)
// ========================================

export interface AgentProcessInfo {
  readonly agentId: AgentId;
  readonly cli: CliType;
  readonly task: string;
  readonly workingDirectory: string;
  readonly taskFolder?: string;
  status: AgentStatus;
  readonly startedAt: string; // ISO timestamp
  exitCode?: number;
  readonly pid?: number;
  /** CLI-native session ID (e.g., Gemini's UUID from init event). Enables session resume. */
  readonly cliSessionId?: string;
  /** Parent Ptah Claude SDK session that spawned this CLI agent via ptah_agent_spawn. */
  readonly parentSessionId?: string;
}

// ========================================
// Spawn Agent Request
// ========================================

export interface SpawnAgentRequest {
  /** Task description for the CLI agent */
  readonly task: string;
  /** Which CLI to use (auto-detected if omitted) */
  readonly cli?: CliType;
  /** Working directory (defaults to workspace root) */
  readonly workingDirectory?: string;
  /** Timeout in milliseconds (default: 600000 = 10min, max: 1800000 = 30min) */
  readonly timeout?: number;
  /** Files the agent should focus on */
  readonly files?: string[];
  /** Task-tracking folder for shared workspace */
  readonly taskFolder?: string;
  /** Model identifier for CLI agents (e.g., 'gemini-2.5-pro', 'claude-sonnet-4.6'). Passed as --model flag. */
  readonly model?: string;
  /** Resume a previous CLI session by its CLI-native session ID (e.g., Gemini --resume <id>) */
  readonly resumeSessionId?: string;
  /** Parent Ptah Claude SDK session ID. Injected by MCP server, NOT set by callers. */
  readonly parentSessionId?: string;
}

// ========================================
// Agent Output
// ========================================

export interface AgentOutput {
  readonly agentId: AgentId;
  readonly stdout: string;
  readonly stderr: string;
  /** Total lines captured */
  readonly lineCount: number;
  /** Whether output was truncated due to buffer limit */
  readonly truncated: boolean;
}

// ========================================
// Spawn Agent Result
// ========================================

export interface SpawnAgentResult {
  readonly agentId: AgentId;
  readonly cli: CliType;
  readonly status: AgentStatus;
  readonly startedAt: string;
  /** CLI-native session ID captured from init event (e.g., Gemini UUID). Null if not yet available. */
  readonly cliSessionId?: string;
}

// ========================================
// CLI Detection Result
// ========================================

export interface CliDetectionResult {
  readonly cli: CliType;
  readonly installed: boolean;
  readonly path?: string;
  readonly version?: string;
  readonly supportsSteer: boolean;
}

// ========================================
// Structured CLI Output Segments
// ========================================

/**
 * Discriminator for structured CLI output segments.
 * Emitted by SDK-based adapters (Gemini, Codex) that have access
 * to structured event data. Copilot (raw text) falls back to regex parsing.
 */
export type CliOutputSegmentType =
  | 'text'
  | 'tool-call'
  | 'tool-result'
  | 'tool-result-error'
  | 'error'
  | 'info'
  | 'command'
  | 'file-change';

/**
 * A single structured output segment from a CLI agent.
 * Produced by SDK adapters alongside raw text deltas.
 */
export interface CliOutputSegment {
  readonly type: CliOutputSegmentType;
  readonly content: string;
  /** Tool name (for tool-call, tool-result, tool-result-error) */
  readonly toolName?: string;
  /** Summarized tool arguments (for tool-call) */
  readonly toolArgs?: string;
  /** Exit code (for command segments) */
  readonly exitCode?: number;
  /** File change kind: 'added', 'modified', 'deleted' (for file-change) */
  readonly changeKind?: string;
}

// ========================================
// Agent Output Delta (real-time streaming)
// ========================================

export interface AgentOutputDelta {
  readonly agentId: AgentId;
  readonly stdoutDelta: string;
  readonly stderrDelta: string;
  readonly timestamp: number;
  /** Structured output segments from SDK-based adapters (optional — absent for raw CLI adapters) */
  readonly segments?: readonly CliOutputSegment[];
}

// ========================================
// CLI Session Reference (for session metadata persistence)
// ========================================

/**
 * Reference to a CLI agent session linked to a parent Ptah session.
 * Stored in SessionMetadata.cliSessions[] for resume capability.
 */
export interface CliSessionReference {
  /** CLI-native session ID (e.g., Gemini's UUID) */
  readonly cliSessionId: string;
  /** Which CLI produced this session */
  readonly cli: CliType;
  /** Ptah's branded AgentId that ran this session */
  readonly agentId: AgentId;
  /** Task description the agent was given */
  readonly task: string;
  /** ISO timestamp when the session started */
  readonly startedAt: string;
  /** Final agent status */
  readonly status: AgentStatus;
}
