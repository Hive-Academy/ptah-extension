import { Injectable, signal, computed } from '@angular/core';
import { ExecutionNode } from '@ptah-extension/shared';
import { NodeMaps, SessionState, SessionStatus } from './chat.types';

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
@Injectable({ providedIn: 'root' })
export class SessionManager {
  // Node maps - bridge between session loading and streaming
  private readonly _agentNodeMap = new Map<string, ExecutionNode>();
  private readonly _toolNodeMap = new Map<string, ExecutionNode>();

  // Session state
  private readonly _sessionId = signal<string | null>(null);
  private readonly _status = signal<SessionStatus>('fresh');

  // Public state
  readonly sessionId = this._sessionId.asReadonly();
  readonly status = this._status.asReadonly();

  /**
   * Get current session state
   */
  readonly state = computed<SessionState>(() => ({
    status: this._status(),
    sessionId: this._sessionId(),
    isExistingSession: this._sessionId() !== null && this._status() === 'loaded',
  }));

  // ============== Session Operations ==============

  /**
   * Set the current session ID
   */
  setSessionId(sessionId: string | null): void {
    this._sessionId.set(sessionId);
  }

  /**
   * Set the session status
   */
  setStatus(status: SessionStatus): void {
    this._status.set(status);
  }

  /**
   * Clear session state (for new session)
   */
  clearSession(): void {
    this._sessionId.set(null);
    this._status.set('fresh');
    this.clearNodeMaps();
  }

  // ============== Node Map Operations ==============

  /**
   * Clear all node maps
   */
  clearNodeMaps(): void {
    this._agentNodeMap.clear();
    this._toolNodeMap.clear();
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
   */
  registerAgent(toolCallId: string, node: ExecutionNode): void {
    this._agentNodeMap.set(toolCallId, node);
  }

  /**
   * Get an agent node by toolCallId
   */
  getAgent(toolCallId: string): ExecutionNode | undefined {
    return this._agentNodeMap.get(toolCallId);
  }

  /**
   * Update an agent node (returns the updated node)
   */
  updateAgent(
    toolCallId: string,
    updater: (node: ExecutionNode) => ExecutionNode
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
    updater: (node: ExecutionNode) => ExecutionNode
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
