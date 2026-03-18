/**
 * Agent Process Types for Async Agent Orchestration
 * TASK_2025_157: Branded AgentId, status enum, process tracking types
 */
import { v4 as uuidv4 } from 'uuid';
import type { FlatStreamEventUnion } from './execution-node.types';

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

export type CliType = 'gemini' | 'codex' | 'copilot' | 'ptah-cli';

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
  /** ISO timestamp when agent finished (completed/failed/stopped/timeout). Used to freeze timer display. */
  completedAt?: string;
  exitCode?: number;
  readonly pid?: number;
  /** CLI-native session ID (e.g., Gemini's UUID from init event). Enables session resume. */
  readonly cliSessionId?: string;
  /** Parent Ptah Claude SDK session that spawned this CLI agent via ptah_agent_spawn.
   *  Mutable: initially set to tab ID, then resolved to real SDK UUID. */
  parentSessionId?: string;
  /** Human-readable display name for the CLI agent (e.g., 'Gemini CLI', 'Codex', 'Copilot SDK'). */
  readonly displayName?: string;
  /** Model identifier used by the CLI agent (e.g., 'gemini-2.5-pro', 'gpt-4o'). */
  readonly model?: string;
  /** Display name of the Ptah CLI agent (only set when cli === 'ptah-cli') */
  readonly ptahCliName?: string;
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli'). Needed for resume. */
  readonly ptahCliId?: string;
  /** When set, this agent is a resumed version of the given previous agent.
   *  Frontend uses this to replace the old card instead of creating a new one. */
  readonly resumedFromAgentId?: string;
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
  /** Timeout in milliseconds (default: 3600000 = 1hr, max: 3600000 = 1hr) */
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
  /** Project-specific guidance (enhanced prompts). Injected by MCP server, NOT set by callers. */
  readonly projectGuidance?: string;
  /** Full system prompt content (prompt harness). Replaces projectGuidance for premium users.
   *  Includes core prompt, enhanced prompts, skill catalog. Injected by MCP server, NOT set by callers. */
  readonly systemPrompt?: string;
  /** Absolute paths to enabled plugin directories. Premium-gated.
   *  Each directory contains skills/ subdirectory with SKILL.md files.
   *  Injected by MCP server, NOT set by callers. */
  readonly pluginPaths?: string[];
  /** Ptah CLI agent ID from PtahCliRegistry. When set, spawns via Ptah CLI agent instead of CLI. */
  readonly ptahCliId?: string;
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
  /** Display name of the Ptah CLI agent (only set when cli === 'ptah-cli') */
  readonly ptahCliName?: string;
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli'). Needed for resume. */
  readonly ptahCliId?: string;
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
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli') */
  readonly ptahCliId?: string;
  /** Display name of the Ptah CLI agent (only set when cli === 'ptah-cli') */
  readonly ptahCliName?: string;
  /** Provider name (e.g., 'OpenRouter', 'Moonshot') — only set when cli === 'ptah-cli' */
  readonly providerName?: string;
  /** Provider ID (e.g., 'moonshot', 'z-ai') — only set when cli === 'ptah-cli' */
  readonly providerId?: string;
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
  | 'thinking'
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
  /** Raw tool input object (for tool-call) — enables structured rendering in UI */
  readonly toolInput?: Record<string, unknown>;
  /** Exit code (for command segments) */
  readonly exitCode?: number;
  /** File change kind: 'added', 'modified', 'deleted' (for file-change) */
  readonly changeKind?: string;
  /** Links a tool-call segment to its corresponding tool-result segment */
  readonly toolCallId?: string;
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
  /** Rich streaming events from Ptah CLI adapter (optional — only ptah-cli uses this) */
  readonly streamEvents?: readonly FlatStreamEventUnion[];
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
  /** Persisted raw stdout output (capped at 100KB). Absent in older sessions. */
  readonly stdout?: string;
  /** Persisted structured output segments. Absent in older sessions. */
  readonly segments?: readonly CliOutputSegment[];
  /** Persisted rich streaming events (Ptah CLI only). Absent in older sessions. */
  readonly streamEvents?: readonly FlatStreamEventUnion[];
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli'). Needed for resume. */
  readonly ptahCliId?: string;
  /** Real SDK session UUID. Enables the SessionImporterService to cross-reference
   *  JSONL files against known child sessions and skip re-importing them. */
  readonly sdkSessionId?: string;
}
