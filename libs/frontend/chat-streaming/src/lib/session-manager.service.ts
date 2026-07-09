import { Injectable, signal, computed } from '@angular/core';
import { ExecutionNode, SessionId } from '@ptah-extension/shared';
import {
  NodeMaps,
  SessionState as SessionStateInterface,
  SessionStatus,
} from '@ptah-extension/chat-types';

/**
 * Session state machine values
 * Tracks lifecycle of session ID resolution from draft to confirmed
 */
export type SessionState = 'draft' | 'confirming' | 'confirmed' | 'failed';

/**
 * SessionManager - Manages session lifecycle and node maps
 *
 * Single Responsibility: Session state and node map management
 *
 * Key Features:
 * - Tracks session state (fresh, loaded, streaming, resuming)
 * - Manages node maps (agents, tools) for streaming bridge
 * - Determines whether to continue or start new session
 */
/**
 * Pending chunk buffer entry
 * Used to buffer summary chunks that arrive before agent node is created
 */
interface PendingChunk {
  summaryDelta: string;
  timestamp: number;
}

/**
 * How long to keep pending chunks before discarding (60 seconds)
 */
const PENDING_CHUNK_TTL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class SessionManager {
  private readonly _agentNodeMap = new Map<string, ExecutionNode>();
  private readonly _toolNodeMap = new Map<string, ExecutionNode>();
  private readonly _pendingAgentChunks = new Map<string, PendingChunk[]>();
  /**
   * Reverse index: node key (toolCallId) → owning sessionId. The node maps are
   * a global singleton keyed by globally-unique toolCallIds, so two concurrent
   * sessions' entries never collide. This owner index lets `clearNodeMaps`
   * scope its wipe to a single session, so starting a new conversation in one
   * workspace can no longer erase node/tool tracking for a session that is
   * streaming in a DIFFERENT (background) workspace (TASK_2026_154 Wave 2
   * revision). Entries without a recorded owner are only removed by a full
   * (argument-less) clear.
   */
  private readonly _nodeSessionOwner = new Map<string, string>();
  private readonly _sessionId = signal<string | null>(null);
  private readonly _status = signal<SessionStatus>('fresh');
  private readonly _sessionState = signal<SessionState>('draft');
  private readonly _draftId = signal<SessionId | null>(null);
  readonly sessionId = this._sessionId.asReadonly();
  readonly status = this._status.asReadonly();
  readonly sessionState = this._sessionState.asReadonly();
  readonly draftId = this._draftId.asReadonly();

  /**
   * Get current session state
   */
  readonly state = computed<SessionStateInterface>(() => ({
    status: this._status(),
    sessionId: this._sessionId(),
    isExistingSession:
      this._sessionId() !== null && this._status() === 'loaded',
  }));

  /**
   * Set the current session ID with optional state
   * @param sessionId - Session identifier (draft or confirmed)
   * @param state - Session state (defaults to 'draft')
   */
  setSessionId(sessionId: string | null, state: SessionState = 'draft'): void {
    if (this._sessionState() === 'confirmed' && state === 'draft') {
      console.warn(
        '[SessionManager] Invalid state transition: confirmed → draft (blocked)',
      );
      return;
    }

    this._sessionId.set(sessionId);
    this._sessionState.set(state);
    if (state === 'draft' && sessionId) {
      this._draftId.set(sessionId as SessionId);
    }
  }

  /**
   * Set the session status
   */
  setStatus(status: SessionStatus): void {
    this._status.set(status);
  }

  /**
   * Confirm session ID (after backend resolves)
   * Transitions from draft state to confirmed state
   * @param realId - The confirmed session ID from backend
   */
  confirmSessionId(realId: SessionId): void {
    if (this._sessionState() === 'confirmed') {
      console.warn(
        '[SessionManager] Session already confirmed, ignoring duplicate confirmation',
      );
      return;
    }

    this._sessionId.set(realId);
    this._sessionState.set('confirmed');
    if (this._status() === 'draft') {
      this._status.set('streaming');
    }
    if (typeof ngDevMode !== 'undefined' && ngDevMode) {
      console.log('[SessionManager] Session ID confirmed:', {
        draftId: this._draftId(),
        confirmedId: realId,
      });
    }
  }

  /**
   * Mark session as failed
   * Called when session creation fails or encounters error
   */
  failSession(): void {
    this._sessionState.set('failed');
    if (typeof ngDevMode !== 'undefined' && ngDevMode) {
      console.log('[SessionManager] Session marked as failed');
    }
  }

  /**
   * Check if session is confirmed (not draft)
   * @returns true if session state is 'confirmed'
   */
  isSessionConfirmed(): boolean {
    return this._sessionState() === 'confirmed';
  }

  /**
   * Get current session ID (regardless of state)
   * Replaces direct access to sessionId() or getClaudeSessionId()
   * @returns Current session ID or null if no session
   */
  getCurrentSessionId(): SessionId | null {
    return (this._sessionId() as SessionId) ?? null;
  }

  /**
   * Clear session state (for new session)
   */
  clearSession(): void {
    this._sessionId.set(null);
    this._status.set('fresh');
    this._sessionState.set('draft');
    this._draftId.set(null);
    this.clearNodeMaps();
  }

  /**
   * Clear node maps and pending chunk buffers.
   *
   * @param sessionId - When provided, clears ONLY the entries owned by this
   *   session (scoped clear). When omitted, clears ALL sessions (full reset —
   *   used by `clearSession`). The scoped form prevents a new conversation in
   *   one workspace from wiping a session streaming in a background workspace.
   */
  clearNodeMaps(sessionId?: string): void {
    if (sessionId === undefined) {
      this._agentNodeMap.clear();
      this._toolNodeMap.clear();
      this._pendingAgentChunks.clear();
      this._nodeSessionOwner.clear();
      return;
    }
    for (const [key, owner] of this._nodeSessionOwner) {
      if (owner !== sessionId) continue;
      this._agentNodeMap.delete(key);
      this._toolNodeMap.delete(key);
      this._pendingAgentChunks.delete(key);
      this._nodeSessionOwner.delete(key);
    }
  }

  /**
   * Set node maps from loaded session. Replaces ALL current node maps (a session
   * load is a full reset). When `sessionId` is provided the loaded entries are
   * tagged with it so a later scoped `clearNodeMaps(sessionId)` can target them.
   */
  setNodeMaps(nodeMaps: NodeMaps, sessionId?: string): void {
    this._agentNodeMap.clear();
    this._toolNodeMap.clear();
    this._nodeSessionOwner.clear();

    for (const [key, value] of nodeMaps.agents) {
      this._agentNodeMap.set(key, value);
      if (sessionId !== undefined) this._nodeSessionOwner.set(key, sessionId);
    }
    for (const [key, value] of nodeMaps.tools) {
      this._toolNodeMap.set(key, value);
      if (sessionId !== undefined) this._nodeSessionOwner.set(key, sessionId);
    }
  }

  /**
   * Register an agent node (used during streaming)
   * Returns any pending chunks that were buffered before the node existed
   *
   * @param toolCallId - The tool use ID for this agent
   * @param node - The ExecutionNode representing this agent
   * @param sessionId - Owning session id; tags the entry so a scoped
   *   `clearNodeMaps(sessionId)` can target it without wiping other sessions.
   * @returns Array of pending summary deltas to apply (may be empty)
   */
  registerAgent(
    toolCallId: string,
    node: ExecutionNode,
    sessionId?: string,
  ): string[] {
    this._agentNodeMap.set(toolCallId, node);
    if (sessionId !== undefined) {
      this._nodeSessionOwner.set(toolCallId, sessionId);
    }
    const pendingChunks = this._pendingAgentChunks.get(toolCallId);
    if (pendingChunks && pendingChunks.length > 0) {
      this._pendingAgentChunks.delete(toolCallId);
      const now = Date.now();
      const validDeltas = pendingChunks
        .filter((chunk) => now - chunk.timestamp < PENDING_CHUNK_TTL_MS)
        .map((chunk) => chunk.summaryDelta);
      if (
        validDeltas.length > 0 &&
        typeof ngDevMode !== 'undefined' &&
        ngDevMode
      ) {
        console.log(
          `[SessionManager] Flushing ${validDeltas.length} pending chunks for agent:`,
          toolCallId,
        );
      }

      return validDeltas;
    }

    return [];
  }

  /**
   * Buffer a summary chunk for an agent that doesn't exist yet
   * Called when summary chunks arrive before the agent node is registered
   *
   * @param toolCallId - The tool use ID for the agent
   * @param summaryDelta - The summary text to buffer
   */
  bufferAgentChunk(toolCallId: string, summaryDelta: string): void {
    const existing = this._pendingAgentChunks.get(toolCallId) || [];
    existing.push({
      summaryDelta,
      timestamp: Date.now(),
    });
    this._pendingAgentChunks.set(toolCallId, existing);
    if (typeof ngDevMode !== 'undefined' && ngDevMode) {
      console.log(
        `[SessionManager] Buffered chunk for pending agent:`,
        toolCallId,
        `(${existing.length} chunks buffered)`,
      );
    }
  }

  /**
   * Get an agent node by toolCallId
   */
  getAgent(toolCallId: string): ExecutionNode | undefined {
    const node = this._agentNodeMap.get(toolCallId);
    if (!node && typeof ngDevMode !== 'undefined' && ngDevMode) {
      console.log('[SessionManager] getAgent() - NOT FOUND:', {
        toolCallId,
        registeredAgentIds: Array.from(this._agentNodeMap.keys()),
      });
    }

    return node;
  }

  /**
   * Update an agent node (returns the updated node)
   */
  updateAgent(
    toolCallId: string,
    updater: (node: ExecutionNode) => ExecutionNode,
  ): ExecutionNode | undefined {
    const existing = this._agentNodeMap.get(toolCallId);
    if (!existing) return undefined;
    const updated = updater(existing);
    this._agentNodeMap.set(toolCallId, updated);
    return updated;
  }

  /**
   * Register a tool node (used during streaming)
   */
  registerTool(
    toolCallId: string,
    node: ExecutionNode,
    sessionId?: string,
  ): void {
    this._toolNodeMap.set(toolCallId, node);
    if (sessionId !== undefined) {
      this._nodeSessionOwner.set(toolCallId, sessionId);
    }
  }

  /**
   * Get a tool node by toolCallId
   */
  getTool(toolCallId: string): ExecutionNode | undefined {
    return this._toolNodeMap.get(toolCallId);
  }

  /**
   * Update a tool node (returns the updated node)
   */
  updateTool(
    toolCallId: string,
    updater: (node: ExecutionNode) => ExecutionNode,
  ): ExecutionNode | undefined {
    const existing = this._toolNodeMap.get(toolCallId);
    if (!existing) return undefined;
    const updated = updater(existing);
    this._toolNodeMap.set(toolCallId, updated);
    return updated;
  }

  /**
   * Get all registered agent IDs (for debugging)
   */
  getRegisteredAgentIds(): string[] {
    return Array.from(this._agentNodeMap.keys());
  }

  /**
   * Get all registered tool IDs (for debugging)
   */
  getRegisteredToolIds(): string[] {
    return Array.from(this._toolNodeMap.keys());
  }

  /**
   * Check if we have an existing session that should be continued
   */
  shouldContinueSession(): boolean {
    return this._sessionId() !== null && this._status() === 'loaded';
  }
}
