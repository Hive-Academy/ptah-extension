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
  // Node maps - bridge between session loading and streaming
  private readonly _agentNodeMap = new Map<string, ExecutionNode>();
  private readonly _toolNodeMap = new Map<string, ExecutionNode>();

  // Pending summary chunks buffer (race condition fix)
  // Buffers chunks that arrive before agent node is registered
  private readonly _pendingAgentChunks = new Map<string, PendingChunk[]>();

  // Session state
  private readonly _sessionId = signal<string | null>(null);
  private readonly _status = signal<SessionStatus>('fresh');

  // Session state machine (draft → confirming → confirmed → failed)
  private readonly _sessionState = signal<SessionState>('draft');

  // Store original draft ID for reference/debugging
  private readonly _draftId = signal<SessionId | null>(null);

  // Public state
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

  // ============== Session Operations ==============

  /**
   * Set the current session ID with optional state
   * @param sessionId - Session identifier (draft or confirmed)
   * @param state - Session state (defaults to 'draft')
   */
  setSessionId(sessionId: string | null, state: SessionState = 'draft'): void {
    // Guard: Cannot transition from confirmed back to draft
    if (this._sessionState() === 'confirmed' && state === 'draft') {
      console.warn(
        '[SessionManager] Invalid state transition: confirmed → draft (blocked)',
      );
      return;
    }

    this._sessionId.set(sessionId);
    this._sessionState.set(state);

    // Store draft ID when in draft state for reference
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

    // Transition from draft to streaming when we get real ID
    if (this._status() === 'draft') {
      this._status.set('streaming');
    }

    // Dev-guard diagnostic log to reduce GC pressure in production
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
    // Dev-guard diagnostic log
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

  // ============== Node Map Operations ==============

  /**
   * Clear all node maps and pending chunk buffers
   */
  clearNodeMaps(): void {
    this._agentNodeMap.clear();
    this._toolNodeMap.clear();
    this._pendingAgentChunks.clear();
  }

  /**
   * Set node maps from loaded session
   */
  setNodeMaps(nodeMaps: NodeMaps): void {
    this._agentNodeMap.clear();
    this._toolNodeMap.clear();

    for (const [key, value] of nodeMaps.agents) {
      this._agentNodeMap.set(key, value);
    }
    for (const [key, value] of nodeMaps.tools) {
      this._toolNodeMap.set(key, value);
    }
  }

  /**
   * Register an agent node (used during streaming)
   * Returns any pending chunks that were buffered before the node existed
   *
   * @param toolCallId - The tool use ID for this agent
   * @param node - The ExecutionNode representing this agent
   * @returns Array of pending summary deltas to apply (may be empty)
   */
  registerAgent(toolCallId: string, node: ExecutionNode): string[] {
    this._agentNodeMap.set(toolCallId, node);

    // Check for and return any pending chunks
    const pendingChunks = this._pendingAgentChunks.get(toolCallId);
    if (pendingChunks && pendingChunks.length > 0) {
      // Clear the pending buffer
      this._pendingAgentChunks.delete(toolCallId);

      // Filter out stale chunks and extract deltas
      const now = Date.now();
      const validDeltas = pendingChunks
        .filter((chunk) => now - chunk.timestamp < PENDING_CHUNK_TTL_MS)
        .map((chunk) => chunk.summaryDelta);

      // Dev-guard diagnostic log (fires on every agent chunk flush)
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

    // Dev-guard diagnostic log (fires on every buffered chunk)
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

    // Dev-guard diagnostic log (fires on every agent lookup miss)
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
  registerTool(toolCallId: string, node: ExecutionNode): void {
    this._toolNodeMap.set(toolCallId, node);
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

  // ============== Decision Helpers ==============

  /**
   * Check if we have an existing session that should be continued
   */
  shouldContinueSession(): boolean {
    return this._sessionId() !== null && this._status() === 'loaded';
  }
}
