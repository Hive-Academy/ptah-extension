import { Injectable, signal, inject } from '@angular/core';
import { SessionReplayService } from '@ptah-extension/chat';
import { ExecutionChatMessage, JSONLMessage } from '@ptah-extension/shared';

/**
 * StaticSessionProvider - Provides pre-loaded demo session data for the landing page
 *
 * Single Responsibility: Load and parse static demo session data from JSON assets
 *
 * Key Features:
 * - Signal-based state management for reactive UI updates
 * - Uses SessionReplayService to parse JSONL data into ExecutionChatMessage format
 * - Decouples landing page demo from VS Code dependencies
 * - Graceful error handling with user-friendly messages
 *
 * Complexity Level: 2 (Medium - state management, async loading, error handling)
 *
 * Architecture Pattern: Signal-Based Service
 * - Private writable signals
 * - Public readonly signal exposure
 * - Stateless SessionReplayService injection
 *
 * IMPORTANT: This service must NOT import from @ptah-extension/core
 * (VS Code dependencies). It uses only @ptah-extension/chat which is
 * VS Code-agnostic.
 *
 * @example
 * ```typescript
 * const provider = inject(StaticSessionProvider);
 * await provider.loadSession('/assets/demo-sessions/sample.json');
 * const messages = provider.messages(); // ExecutionChatMessage[]
 * ```
 */
@Injectable({ providedIn: 'root' })
export class StaticSessionProvider {
  // ============================================================================
  // PRIVATE STATE SIGNALS
  // ============================================================================
  // Pattern: Signal-based state management
  // Evidence: libs/frontend/chat/src/lib/services/chat.store.ts:58-59

  private readonly _messages = signal<readonly ExecutionChatMessage[]>([]);
  private readonly _isLoading = signal(true);
  private readonly _error = signal<string | null>(null);

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================
  // Pattern: Readonly signal exposure for reactive consumers
  // Evidence: libs/frontend/chat/src/lib/services/chat.store.ts:58-59

  readonly messages = this._messages.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  // ============================================================================
  // SERVICE DEPENDENCIES
  // ============================================================================
  // Pattern: inject() function in class body (not constructor injection)
  // Evidence: libs/frontend/chat/src/lib/services/chat.store.ts:52

  private readonly replayService = inject(SessionReplayService);

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Load and parse demo session data from a static JSON asset
   *
   * Expected JSON format:
   * {
   *   "mainMessages": JSONLMessage[],  // Main session messages
   *   "agentSessions": []               // Empty for simple demos (no nested agents)
   * }
   *
   * @param assetPath - Path to JSON asset (e.g., '/assets/demo-sessions/sample.json')
   * @throws Sets error signal if loading or parsing fails
   */
  async loadSession(assetPath: string): Promise<void> {
    try {
      this._isLoading.set(true);
      this._error.set(null);

      // Fetch the JSON asset
      const response = await fetch(assetPath);
      if (!response.ok) {
        throw new Error(
          `Failed to load session: ${response.status} ${response.statusText}`
        );
      }

      const jsonData = await response.json();

      // Validate expected structure
      if (!jsonData.mainMessages || !Array.isArray(jsonData.mainMessages)) {
        throw new Error(
          'Invalid session format: expected "mainMessages" array'
        );
      }

      // Parse session data using SessionReplayService
      // SessionReplayService.replaySession signature:
      //   replaySession(mainMessages: JSONLMessage[], agentSessions: AgentSessionData[])
      //   returns: { messages: ExecutionChatMessage[], nodeMaps: NodeMaps }
      const messages = this.parseSessionData(
        jsonData.mainMessages,
        jsonData.agentSessions || []
      );

      this._messages.set(messages);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Failed to load demo session. Please refresh the page.';
      this._error.set(errorMessage);
      console.error('[StaticSessionProvider] Load session failed:', err);
    } finally {
      this._isLoading.set(false);
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Parse raw JSONL messages into ExecutionChatMessage format
   *
   * Uses SessionReplayService to handle the complex parsing logic:
   * - Groups agent sessions by agentId
   * - Correlates agents to parent Task tool_use
   * - Builds unified execution trees
   * - Links tool_use to tool_result
   *
   * @param mainMessages - Main session JSONL messages
   * @param agentSessions - Agent session data (optional)
   * @returns Parsed ExecutionChatMessage array
   */
  private parseSessionData(
    mainMessages: JSONLMessage[],
    agentSessions: unknown[]
  ): ExecutionChatMessage[] {
    try {
      // SessionReplayService handles all the complex parsing
      // Returns: { messages: ExecutionChatMessage[], nodeMaps: NodeMaps }
      const result = this.replayService.replaySession(
        mainMessages,
        agentSessions as never[] // Type assertion for agent sessions
      );

      return result.messages;
    } catch (err) {
      console.error('[StaticSessionProvider] Parse session data failed:', err);
      throw new Error(
        `Failed to parse session data: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Reset service state (useful for testing or reloading)
   */
  reset(): void {
    this._messages.set([]);
    this._isLoading.set(true);
    this._error.set(null);
  }
}
