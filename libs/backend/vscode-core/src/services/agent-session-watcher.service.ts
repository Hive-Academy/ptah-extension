/**
 * Agent Session Watcher Service — NO-OP SHELL (TASK_2026_109 Fix 2)
 *
 * The original implementation tail-watched per-agent JSONL files written by
 * the Claude Agent SDK at `~/.claude/projects/{slug}/{sessionId}/subagents/agent-{id}.jsonl`
 * and re-emitted their text deltas as `summary-chunk` events so the chat UI
 * could show subagent thinking inline.
 *
 * That mechanism is now obsolete: `SdkQueryOptionsBuilder` enables
 * `forwardSubagentText: true` on every SDK query, which causes subagent text
 * blocks to stream inline through the parent message stream. The
 * `SdkMessageTransformer` (and downstream consumers) see those blocks
 * directly — no out-of-band file watching is required.
 *
 * This file retains the class shell, public method signatures, and
 * EventEmitter surface so existing consumers (chat-stream-broadcaster,
 * chat-session.service, chat-subagent-context-injector,
 * chat-slash-command-router, chat-ptah-cli.service, session-control.service,
 * session-lifecycle-manager, subagent-hook-handler) keep compiling without a
 * coordinated cross-library refactor. All methods are now no-ops; no events
 * are emitted; no file system watchers are created.
 *
 * Future work: a follow-up task should drop these call sites entirely and
 * delete this file.
 */

import { injectable, inject } from 'tsyringe';
import { EventEmitter } from 'events';
import type { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';

/**
 * Structural type kept for barrel-export compatibility. Previously sourced
 * from `./agent-session-watcher/agent-jsonl-parser`; that helper is gone.
 */
export interface AgentContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
}

/**
 * Summary chunk shape preserved for downstream type imports. No instances
 * are emitted by this stub.
 */
export interface AgentSummaryChunk {
  toolUseId: string;
  /** @deprecated kept for type compatibility; never populated by stub */
  summaryDelta: string;
  contentBlocks?: AgentContentBlock[];
  agentId: string;
  sessionId: string;
}

/**
 * Agent start event shape preserved for downstream type imports. No
 * instances are emitted by this stub.
 */
export interface AgentStartEvent {
  toolUseId: string;
  agentType: string;
  agentDescription: string;
  timestamp: number;
  sessionId: string;
  agentId: string;
}

@injectable()
export class AgentSessionWatcherService extends EventEmitter {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    super();
    this.logger.debug(
      '[AgentSessionWatcher] Stub instantiated — JSONL tail-watching disabled (forwardSubagentText handles subagent text inline now)',
    );
  }

  /**
   * No-op. Subagent text now arrives inline via `forwardSubagentText: true`
   * on the parent SDK stream — no file watching is needed.
   */
  async startWatching(
    _agentId: string,
    _sessionId: string,
    _workspacePath: string,
    _agentType: string,
    _toolUseId?: string,
  ): Promise<void> {
    return;
  }

  /** No-op. Late toolUseId binding is irrelevant without file watchers. */
  setToolUseId(_agentId: string, _toolUseId: string): void {
    return;
  }

  /** No-op. Nothing is being watched. */
  stopWatching(_agentId: string): void {
    return;
  }

  /** No-op. Nothing is being watched per session. */
  stopAllForSession(_sessionId: string): void {
    return;
  }

  /** No-op. Background-state tracking moved to SubagentRegistryService. */
  markAsBackground(_agentId: string): void {
    return;
  }

  /**
   * No-op. Background completion is observed through the SubagentStop hook
   * and SubagentRegistryService directly — this event path is dormant.
   */
  emitBackgroundAgentCompleted(
    _agentId: string,
    _toolCallId: string,
    _agentType?: string,
  ): void {
    return;
  }

  /** No-op. No watchers, no intervals, no timers to clean up. */
  dispose(): void {
    return;
  }
}
