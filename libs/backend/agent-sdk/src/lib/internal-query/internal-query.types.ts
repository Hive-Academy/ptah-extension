/**
 * Internal Query Types
 *
 * Types for the one-shot internal query service.
 * Completely separate from the interactive chat types (SessionLifecycleManager, SdkQueryOptionsBuilder).
 *
 * Key differences from chat:
 * - String prompt (not AsyncIterable<SDKUserMessage>)
 * - bypassPermissions (no user to approve)
 * - Explicit maxTurns (not calculated from session config)
 * - No session persistence (internal-only, ephemeral)
 * - No permission callbacks (auto-approved)
 *
 * @module @ptah-extension/agent-sdk
 */

import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';

/**
 * Configuration for an internal one-shot query.
 *
 * The caller provides model, workspace path, prompts, and feature flags.
 * The service handles the rest (enhanced prompts, MCP, identity, hooks, compaction).
 */
export interface InternalQueryConfig {
  /** Working directory for the query */
  cwd: string;

  /** Model to use (e.g., 'claude-sonnet-4-5-20250929') */
  model: string;

  /** User prompt — the actual task instruction (string for single-shot mode) */
  prompt: string;

  /**
   * Additional instructions appended to the system prompt.
   * Appended AFTER identity prompt and enhanced prompts / PTAH_CORE_SYSTEM_PROMPT.
   * Use this for task-specific instructions (e.g., analysis schema).
   */
  systemPromptAppend?: string;

  /** Whether user has premium features (enables MCP server + enhanced prompts) */
  isPremium: boolean;

  /** Whether the Ptah MCP server is currently running */
  mcpServerRunning: boolean;

  /** Port the Ptah MCP server is listening on (default: 51820) */
  mcpPort?: number;

  /** Maximum number of agent turns (default: 25) */
  maxTurns?: number;

  /** Abort controller for cancellation (created internally if not provided) */
  abortController?: AbortController;
}

/**
 * Handle returned from executing an internal query.
 *
 * Provides access to the SDK message stream and control methods.
 * The stream yields SDKMessage events including:
 * - 'system' (init) — session initialization
 * - 'stream_event' — real-time text/tool deltas
 * - 'assistant' — complete assistant messages
 * - 'result' — final result with stats (tokens, cost, turns)
 */
export interface InternalQueryHandle {
  /** Async iterable of SDK messages */
  readonly stream: AsyncIterable<SDKMessage>;

  /** Abort the query (triggers AbortController) */
  abort(): void;

  /** Close the query gracefully */
  close(): void;
}
