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

export type CliType = 'gemini' | 'codex' | 'copilot' | 'vscode-lm';

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
  /** Model identifier for SDK-based agents (e.g., 'claude-3.5-sonnet', 'gpt-4o'). Used by vscode-lm to filter selectChatModels(). */
  readonly model?: string;
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
// Agent Output Delta (real-time streaming)
// ========================================

export interface AgentOutputDelta {
  readonly agentId: AgentId;
  readonly stdoutDelta: string;
  readonly stderrDelta: string;
  readonly timestamp: number;
}
