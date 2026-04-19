/**
 * IAgentAdapter - Unified contract across multiple agent runtimes.
 *
 * Superset interface that both SdkAgentAdapter (Claude SDK, in-process)
 * and DeepAgentAdapter (LangChain deep-agents, in-process) implement.
 * A runtime selector picks which concrete adapter handles each session.
 *
 * Methods not supported by a given runtime MUST throw an Error with
 * message starting with "Not supported on <runtime> runtime." so the
 * RPC layer can surface a user-friendly error.
 */
import type { IAIProvider, AISessionConfig } from './ai-provider.types';
import type { SessionId } from './branded.types';
import type { FlatStreamEventUnion } from './execution-node.types';

/**
 * Callback signatures — mirrored from agent-sdk's SdkAgentAdapter public API.
 * Defined here (in shared) so both adapters + the selector can agree on shape
 * without cross-library type imports.
 */
export type SessionIdResolvedCallback = (
  tabId: string | undefined,
  realSessionId: string,
) => void;

export interface ResultStatsPayload {
  readonly sessionId: SessionId;
  readonly cost: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheCreation?: number;
  };
  readonly duration: number;
  readonly modelUsage?: ReadonlyArray<{
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly contextWindow: number;
    readonly costUSD: number;
    readonly cacheReadInputTokens: number;
    readonly lastTurnContextTokens?: number;
  }>;
}

export type ResultStatsCallback = (stats: ResultStatsPayload) => void;

export type CompactionStartCallback = (data: {
  sessionId: string;
  trigger: 'manual' | 'auto';
  timestamp: number;
}) => void;

export type WorktreeCreatedCallback = (data: {
  sessionId: string;
  name: string;
  cwd: string;
  timestamp: number;
}) => void;

export type WorktreeRemovedCallback = (data: {
  sessionId: string;
  worktreePath: string;
  cwd: string;
  timestamp: number;
}) => void;

/**
 * Permission levels — superset of what any runtime supports.
 * Runtimes that don't understand a given level should no-op or throw.
 */
export type AgentPermissionLevel =
  | 'ask'
  | 'auto-edit'
  | 'yolo'
  | 'plan'
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions';

/**
 * Extended session config used by startChatSession — includes the fields
 * that SdkAgentAdapter's concrete implementation already accepts.
 */
export interface AgentSessionStartConfig extends AISessionConfig {
  tabId: string;
  name?: string;
  prompt?: string;
  files?: string[];
  images?: { data: string; mediaType: string }[];
  isPremium?: boolean;
  mcpServerRunning?: boolean;
  enhancedPromptsContent?: string;
  pluginPaths?: string[];
}

/**
 * Extended session config used by resumeSession.
 */
export interface AgentSessionResumeConfig extends AISessionConfig {
  isPremium?: boolean;
  mcpServerRunning?: boolean;
  enhancedPromptsContent?: string;
  pluginPaths?: string[];
  tabId?: string;
}

/**
 * Configuration for slash command execution.
 * Intentionally loose (`Record<string, unknown>`-style) because different
 * runtimes handle these fields differently. Claude SDK runtime uses all of
 * them; deep-agent runtime will reject the call entirely.
 */
export interface SlashCommandRunConfig {
  sessionConfig?: AISessionConfig;
  isPremium?: boolean;
  mcpServerRunning?: boolean;
  enhancedPromptsContent?: string;
  pluginPaths?: string[];
  tabId?: string;
}

/**
 * Model info returned by adapters. Intentionally thin — a superset that
 * works for both SDK `ModelInfo` and LangChain-style model listings.
 */
export interface AgentModelInfo {
  readonly value: string;
  readonly displayName: string;
  readonly description?: string;
}

/**
 * Unified agent adapter contract.
 *
 * This is the superset of public methods on SdkAgentAdapter. Runtimes that
 * cannot support a specific method (e.g. deep-agent has no slash commands)
 * MUST throw a runtime-specific Error rather than silently no-op.
 */
export interface IAgentAdapter extends IAIProvider {
  /** Pre-warm any heavy SDK modules (no-op if nothing to pre-load). */
  preloadSdk(): Promise<void>;

  /** Runtime-resolved path to Claude cli.js, or null if not applicable. */
  getCliJsPath(): string | null;

  /** Return supported models for the currently active provider. */
  getSupportedModels(): Promise<readonly AgentModelInfo[]>;

  /** Return the default model for the currently active provider. */
  getDefaultModel(): Promise<string>;

  /** Return dynamically-fetched API models (if the provider supports it). */
  getApiModels(): Promise<readonly AgentModelInfo[]>;

  /**
   * Start a NEW chat session.
   * Returns an AsyncIterable<FlatStreamEventUnion> streaming the response.
   */
  startChatSession(
    config: AgentSessionStartConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>>;

  /** Resume an existing session by its real SDK UUID. */
  resumeSession(
    sessionId: SessionId,
    config?: AgentSessionResumeConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>>;

  /** Whether a session is currently active in memory. */
  isSessionActive(sessionId: SessionId): boolean;

  /** Execute a slash command in an existing session. */
  executeSlashCommand(
    sessionId: SessionId,
    command: string,
    config: SlashCommandRunConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>>;

  /** Interrupt the current assistant turn; session stays alive. */
  interruptCurrentTurn(sessionId: SessionId): Promise<boolean>;

  /** Interrupt and clean up the session entirely. */
  interruptSession(sessionId: SessionId): Promise<void>;

  /** Change the permission level mid-session. */
  setSessionPermissionLevel(
    sessionId: SessionId,
    level: AgentPermissionLevel,
  ): Promise<void>;

  /** Switch models mid-session. */
  setSessionModel(sessionId: SessionId, model: string): Promise<void>;

  // ---------- Event-sink callbacks ----------
  setSessionIdResolvedCallback(cb: SessionIdResolvedCallback): void;
  setResultStatsCallback(cb: ResultStatsCallback): void;
  setCompactionStartCallback(cb: CompactionStartCallback): void;
  setWorktreeCreatedCallback(cb: WorktreeCreatedCallback): void;
  setWorktreeRemovedCallback(cb: WorktreeRemovedCallback): void;
}
