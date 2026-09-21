/**
 * Agent Process Types for Async Agent Orchestration
 *
 * Branded AgentId, status enum, process tracking types.
 */
import { v4 as uuidv4 } from 'uuid';
import type { FlatStreamEventUnion } from './execution';

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
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
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

export type AgentStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'stopped';

/**
 * Every CLI backed by a first-party adapter that spawns a real binary.
 *
 * SINGLE SOURCE OF TRUTH. `CliType` is derived from it, and so is every
 * surface that has to enumerate spawnable CLIs — the MCP `ptah_agent_spawn`
 * schema (`tool-description.builder.ts`), the stdio dispatcher's zod enum
 * (`agent-tool.dispatcher.ts`), and default-CLI selection
 * (`AgentProcessManager.getPreferredCli`). Adding a seventh adapter means
 * adding one literal HERE; the other surfaces follow automatically.
 *
 * `ptah-cli` is deliberately NOT a member: those agents are user-configured
 * Anthropic-compatible providers selected by `ptahCliId`, not a binary name.
 */
export const SYSTEM_CLI_TYPES = [
  'codex',
  'copilot',
  'cursor',
  'antigravity',
  'opencode',
  'pi',
] as const;

export type SystemCliType = (typeof SYSTEM_CLI_TYPES)[number];

export type CliType = SystemCliType | 'ptah-cli';

/**
 * A workspace role an agent can be spawned as, resolved from `.claude/agents/<name>.md`.
 *
 * `body` has the frontmatter stripped and is otherwise untransformed; adapters
 * apply their own CLI rewrite before delivery.
 */
export interface AgentRoleDefinition {
  readonly name: string;
  readonly description?: string;
  readonly body: string;
  /** Absolute path of the role file the definition was read from. */
  readonly sourcePath: string;
  /** UTF-8 byte length of `body`. */
  readonly bytes: number;
}

/**
 * How a role reached the agent.
 *
 * - `preamble` — the role body was injected into the agent's instructions.
 * - `native` — the CLI selected the role through its own agent mechanism.
 */
export type AgentRoleDelivery = 'preamble' | 'native';

/**
 * The adapter channel that carries a role to the agent.
 *
 * `agent-selection` is reserved for native role selection and is not used by
 * preamble delivery.
 */
export type AgentRoleChannel =
  | 'task-prompt'
  | 'developer-instructions'
  | 'system-prompt'
  | 'agent-selection';

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
  /** CLI-native session ID from the init event. Enables session resume. */
  readonly cliSessionId?: string;
  /** Parent Ptah Claude SDK session that spawned this CLI agent via ptah_agent_spawn.
   *  Mutable: initially set to tab ID, then resolved to real SDK UUID. */
  parentSessionId?: string;
  /** Human-readable display name for the CLI agent (e.g., 'Codex', 'Copilot SDK'). */
  readonly displayName?: string;
  /** Model identifier used by the CLI agent (e.g., 'gpt-4o'). */
  readonly model?: string;
  /** Display name of the Ptah CLI agent (only set when cli === 'ptah-cli') */
  readonly ptahCliName?: string;
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli'). Needed for resume. */
  readonly ptahCliId?: string;
  /** When set, this agent is a resumed version of the given previous agent.
   *  Frontend uses this to replace the old card instead of creating a new one. */
  readonly resumedFromAgentId?: string;
  /** Whether the agent's handle can continue the same conversation with a follow-up. */
  readonly supportsContinuation?: boolean;
  /** Workspace role name the agent was spawned as. */
  readonly role?: string;
  /** How the role was delivered (only set when `role` is set). */
  readonly roleDelivery?: AgentRoleDelivery;
  /** Adapter channel that carried the role (only set when `role` is set). */
  readonly roleChannel?: AgentRoleChannel;
  /**
   * Deliverable paths the spawner declared for this lane, as given on the
   * spawn request. Kept on the record because the completion signal is built
   * after the process is gone and the request object is not reachable there.
   */
  readonly deliverables?: readonly string[];
}

export interface SpawnAgentRequest {
  /** Task description for the CLI agent */
  readonly task: string;
  /** Which CLI to use (auto-detected if omitted) */
  readonly cli?: CliType;
  /** Working directory (defaults to workspace root) */
  readonly workingDirectory?: string;
  /**
   * Inactivity window in milliseconds — how long the agent may produce NO
   * output before it is treated as hung (default: 3600000 = 1hr). The window is
   * re-armed by every output flush, so a working agent never hits it. `0`
   * disables the watchdog. There is no maximum.
   */
  readonly timeout?: number;
  /** Files the agent should focus on */
  readonly files?: string[];
  /** Task-tracking folder for shared workspace */
  readonly taskFolder?: string;
  /**
   * The files this lane MUST write before it exits. A relative entry is
   * resolved against `taskFolder` when one is given, otherwise against
   * `workingDirectory`.
   *
   * Two things depend on it, and both are the point of declaring it:
   * the lane is told to write exactly these paths (the prompt contract), and
   * {@link LaneCompletionSignal} reports whether each one exists once the lane
   * is gone. Without it a completion signal can only say the process exited,
   * which is the failure mode TASK_2026_515 was filed for.
   */
  readonly deliverables?: readonly string[];
  /** Model identifier for CLI agents (e.g., 'claude-sonnet-4.6'). Passed as --model flag. */
  readonly model?: string;
  /** Resume a previous CLI session by its CLI-native session ID */
  readonly resumeSessionId?: string;
  /** Parent Ptah Claude SDK session ID. Injected by MCP server, NOT set by callers. */
  readonly parentSessionId?: string;
  /** Project-specific guidance (enhanced prompts). Injected by MCP server, NOT set by callers. */
  readonly projectGuidance?: string;
  /** Full system prompt content (prompt harness). Replaces projectGuidance when available.
   *  Includes core prompt, enhanced prompts, skill catalog. Injected by MCP server, NOT set by callers. */
  readonly systemPrompt?: string;
  /** Absolute paths to enabled plugin directories.
   *  Each directory contains skills/ subdirectory with SKILL.md files.
   *  Injected by MCP server, NOT set by callers. */
  readonly pluginPaths?: string[];
  /** Ptah CLI agent ID from PtahCliRegistry. When set, spawns via Ptah CLI agent instead of CLI. */
  readonly ptahCliId?: string;
  /** Model tier for Ptah CLI agents: 'opus' (most capable), 'sonnet' (balanced), 'haiku' (fastest).
   *  Controls which capability tier the spawned SDK agent uses. Only applies to ptahCliId-based spawns.
   *  The tier is resolved to the actual provider model via the agent's tier mappings.
   *  Defaults to 'sonnet' when omitted. */
  readonly modelTier?: 'opus' | 'sonnet' | 'haiku';
  /** When set, this agent is resuming a previous agent. Frontend replaces the old card in-place. */
  readonly resumedFromAgentId?: string;
  /** Workspace role name from `.claude/agents/<name>.md` the agent should act as. */
  readonly role?: string;
  /** Resolved definition of `role`. Injected by MCP server, NOT set by callers. */
  readonly roleDefinition?: AgentRoleDefinition;
}

export interface AgentOutput {
  readonly agentId: AgentId;
  readonly stdout: string;
  readonly stderr: string;
  /** Lines in the returned stdout + stderr */
  readonly lineCount: number;
  /** Whether output was truncated due to buffer limit */
  readonly truncated: boolean;
}

export interface SpawnAgentResult {
  readonly agentId: AgentId;
  readonly cli: CliType;
  readonly status: AgentStatus;
  readonly startedAt: string;
  /** CLI-native session ID captured from init event. Null if not yet available. */
  readonly cliSessionId?: string;
  /** Display name of the Ptah CLI agent (only set when cli === 'ptah-cli') */
  readonly ptahCliName?: string;
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli'). Needed for resume. */
  readonly ptahCliId?: string;
  /** Workspace role name the agent was spawned as. */
  readonly role?: string;
  /** How the role was delivered (only set when `role` is set). */
  readonly roleDelivery?: AgentRoleDelivery;
  /** Adapter channel that carried the role (only set when `role` is set). */
  readonly roleChannel?: AgentRoleChannel;
}

/**
 * The mechanism that actually delivered a message to a running agent.
 *
 * - `steer` — injected mid-turn; the current turn continues and absorbs it.
 * - `interrupt-resume` — the current turn was aborted and the message re-submitted
 *   on the SAME session. **Discards the aborted turn's partial work**, which is why
 *   the mode is always reported back to the caller rather than presented as a plain
 *   success.
 * - `queue-next-turn` — held and delivered as the next full turn.
 * - `unsupported` — nothing was delivered; `detail` carries the reason.
 */
export type AgentMessagingMode =
  | 'steer'
  | 'interrupt-resume'
  | 'queue-next-turn'
  | 'unsupported';

/**
 * The best mechanism a CLI can offer, as reported by agent listings.
 *
 * This is the declared capability, not the outcome of a delivery — see
 * {@link AgentMessagingMode} for the latter.
 */
export type AgentMessagingCapability = 'steer' | 'interrupt' | 'queue' | 'none';

/**
 * What actually happened to a message aimed at a live agent.
 *
 * `mode` is never inferred by the caller and never omitted: an `unsupported`
 * outcome means NOTHING was delivered, and `detail` carries the reason in
 * words the caller (often a model) can act on.
 */
export interface AgentMessageOutcome {
  readonly mode: AgentMessagingMode;
  readonly detail?: string;
}

export interface CliDetectionResult {
  readonly cli: CliType;
  readonly installed: boolean;
  readonly path?: string;
  readonly version?: string;
  /** Best messaging mechanism this CLI offers for a message sent to a live agent. */
  readonly messagingMode: AgentMessagingCapability;
  /** Ptah CLI agent registry ID (only set when cli === 'ptah-cli') */
  readonly ptahCliId?: string;
  /** Display name of the Ptah CLI agent (only set when cli === 'ptah-cli') */
  readonly ptahCliName?: string;
  /** Provider name (e.g., 'OpenRouter', 'Moonshot') — only set when cli === 'ptah-cli' */
  readonly providerName?: string;
  /** Provider ID (e.g., 'moonshot', 'z-ai') — only set when cli === 'ptah-cli' */
  readonly providerId?: string;
  /** User's preferred rank (1 = highest). 0 or absent means unranked. Set by ptah_agent_list. */
  readonly preferredRank?: number;
  /**
   * True when the user put this CLI in `agentOrchestration.disabledClis`.
   *
   * A disabled CLI is a HARD disable: it is skipped by default selection AND
   * an explicit `ptah_agent_spawn { cli }` for it is rejected. It is still
   * reported by `ptah_agent_list` (rather than omitted) so the restriction is
   * discoverable before a spawn fails. Never set for `ptah-cli` agents — those
   * are switched off with their own `enabled: false` registry field.
   */
  readonly disabled?: boolean;
  /** How a role given to this CLI is delivered. */
  readonly roleDelivery?: AgentRoleDelivery;
  /** Adapter channel this CLI uses to carry a role. */
  readonly roleChannel?: AgentRoleChannel;
}

/**
 * Discriminator for structured CLI output segments.
 * Emitted by SDK-based adapters (Codex) that have access
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

/**
 * Reference to a CLI agent session linked to a parent Ptah session.
 * Stored in SessionMetadata.cliSessions[] for resume capability.
 */
export interface CliSessionReference {
  /** CLI-native session ID */
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

/* ---------------------------------------------------------------------------
 * Lane completion signal (TASK_2026_515)
 *
 * A lane spawned through `ptah_agent_spawn` used to end in silence: the
 * orchestrator either polled `ptah_agent_status` in a loop or waited with no
 * information at all. These types describe the signal the agent process
 * manager pushes into the spawning session when a lane reaches a terminal
 * status.
 *
 * The signal deliberately carries MORE than the process outcome. An exit code
 * of 0 with no deliverable written is the exact failure the task was filed
 * for, so the verdict is derived from the declared deliverables as well as the
 * status.
 * ------------------------------------------------------------------------- */

/** One declared deliverable, as observed on disk after the lane finished. */
export interface LaneDeliverableCheck {
  /** Absolute path the check was made against. */
  readonly path: string;
  readonly exists: boolean;
  /** Size in bytes. Present only when the file exists. */
  readonly bytes?: number;
  /**
   * True when the file was written after the lane started, so an artifact left
   * behind by an earlier run is not read as this lane's work. Absent when the
   * modification time could not be read.
   */
  readonly writtenAfterSpawn?: boolean;
}

/**
 * What the orchestrator should conclude about the lane.
 *
 * - `delivered` — terminal status `completed` AND every declared deliverable
 *   exists.
 * - `no-deliverable` — terminal status `completed` but at least one declared
 *   deliverable is missing or empty. The lane exited cleanly without doing the
 *   work it was given.
 * - `unverified` — terminal status `completed` and nothing was declared, so
 *   there is nothing to check. Read the output before you trust it.
 * - `failed` — any other terminal status (`failed`, `timeout`, `stopped`).
 */
export type LaneCompletionVerdict =
  | 'delivered'
  | 'no-deliverable'
  | 'unverified'
  | 'failed';

/** The payload pushed to the session that spawned the lane. */
export interface LaneCompletionSignal {
  readonly agentId: string;
  readonly cli: CliType;
  /** The label a person recognizes the lane by. */
  readonly agentLabel: string;
  /** Workspace role the lane ran as, when it was spawned with one. */
  readonly role?: string;
  /** Terminal status. Never `running`. */
  readonly status: AgentStatus;
  readonly exitCode?: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly taskFolder?: string;
  /** First line of the task the lane was given, for recognition only. */
  readonly taskHeadline: string;
  readonly deliverables: readonly LaneDeliverableCheck[];
  readonly verdict: LaneCompletionVerdict;
  /**
   * How many `ptah_agent_report` bodies this lane delivered before it exited.
   * `0` means the lane never reported, so the only account of its work is its
   * output buffer and whatever it wrote to disk.
   */
  readonly reportsDelivered: number;
  /** CLI-native session id, when the adapter reported one. Enables a resume. */
  readonly cliSessionId?: string;
}

/** Why a completion signal was not delivered. */
export type LaneCompletionRefusalReason =
  /** The lane was spawned with no parent session recorded. */
  | 'no-parent-recorded'
  /** The parent session is recorded but is no longer live in this host. */
  | 'parent-session-not-active'
  /** No chat runtime is registered in this host. */
  | 'chat-runtime-unavailable'
  /** The chat runtime rejected the injected turn. */
  | 'delivery-failed'
  /** A signal for this same terminal transition was already delivered. */
  | 'already-signalled';

export interface LaneCompletionDelivery {
  readonly delivered: boolean;
  /** Present exactly when `delivered` is false. */
  readonly reason?: LaneCompletionRefusalReason;
  /** The session the signal reached. Present only on a delivery. */
  readonly parentSessionId?: string;
  /** The signal that was built, delivered or not. Absent only for a duplicate. */
  readonly signal?: LaneCompletionSignal;
}
