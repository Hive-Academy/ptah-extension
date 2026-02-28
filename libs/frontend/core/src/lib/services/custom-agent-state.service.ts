/**
 * CustomAgentStateService - Signal-based state management for custom agent selection
 * TASK_2025_167 Batch 4: Tracks selected custom agent for chat routing
 *
 * Manages:
 * - List of enabled custom agents (fetched via RPC)
 * - Currently selected custom agent ID (null = use default provider)
 * - Integration with chat:start RPC via customAgentId param
 *
 * Pattern: Follows ModelStateService pattern (private _signal, public asReadonly)
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import type { CustomAgentSummary } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class CustomAgentStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // Private mutable signals
  private readonly _agents = signal<CustomAgentSummary[]>([]);
  private readonly _selectedAgentId = signal<string | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _isLoaded = signal(false);

  // Public readonly signals

  /** All custom agents (enabled and disabled) */
  readonly agents = this._agents.asReadonly();

  /** Only enabled custom agents (shown in agent selector dropdown) */
  readonly enabledAgents = computed(() =>
    this._agents().filter((a) => a.enabled && a.status === 'available')
  );

  /** Currently selected custom agent ID (null = default provider) */
  readonly selectedAgentId = this._selectedAgentId.asReadonly();

  /** Whether a custom agent is currently selected */
  readonly hasCustomAgentSelected = computed(
    () => this._selectedAgentId() !== null
  );

  /** The selected custom agent summary (null if none selected) */
  readonly selectedAgent = computed(() => {
    const id = this._selectedAgentId();
    if (!id) return null;
    return this._agents().find((a) => a.id === id) ?? null;
  });

  /** Display name for the selected custom agent */
  readonly selectedAgentName = computed(() => {
    const agent = this.selectedAgent();
    return agent?.name ?? null;
  });

  /** Whether loading is in progress */
  readonly isLoading = this._isLoading.asReadonly();

  /** Whether initial load is complete */
  readonly isLoaded = this._isLoaded.asReadonly();

  constructor() {
    // Load custom agents on initialization
    this.loadAgents();
  }

  /**
   * Select a custom agent for chat routing
   * @param agentId - Custom agent ID, or null to deselect
   */
  selectAgent(agentId: string | null): void {
    this._selectedAgentId.set(agentId);
  }

  /**
   * Clear the custom agent selection (revert to default provider)
   */
  clearSelection(): void {
    this._selectedAgentId.set(null);
  }

  /**
   * Load custom agents from backend
   */
  async loadAgents(): Promise<void> {
    if (this._isLoading()) return;

    this._isLoading.set(true);
    try {
      const result = await this.rpc.call(
        'customAgent:list',
        {} as Record<string, never>
      );
      if (result.isSuccess()) {
        this._agents.set(result.data.agents);

        // If selected agent was deleted or disabled, clear selection
        const selectedId = this._selectedAgentId();
        if (selectedId) {
          const stillValid = result.data.agents.some(
            (a) => a.id === selectedId && a.enabled && a.status === 'available'
          );
          if (!stillValid) {
            this._selectedAgentId.set(null);
          }
        }
      }
    } catch {
      console.error('[CustomAgentStateService] Failed to load custom agents');
    } finally {
      this._isLoading.set(false);
      this._isLoaded.set(true);
    }
  }

  /**
   * Refresh the agents list (e.g., after creating/deleting an agent in settings)
   */
  async refresh(): Promise<void> {
    this._isLoaded.set(false);
    await this.loadAgents();
  }
}
