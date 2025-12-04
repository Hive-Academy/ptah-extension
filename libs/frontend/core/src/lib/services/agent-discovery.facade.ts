import { Injectable, inject, signal, computed } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';

export interface AgentSuggestion {
  readonly name: string;
  readonly description: string;
  readonly scope: 'project' | 'user' | 'builtin';
  readonly icon: string;
}

@Injectable({
  providedIn: 'root',
})
export class AgentDiscoveryFacade {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);
  private readonly _isCached = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly isLoading = computed(() => this._isLoading());
  readonly agents = computed(() => this._agents());
  readonly isCached = computed(() => this._isCached());
  readonly error = computed(() => this._error());

  /**
   * Fetch all agents from backend
   */
  async fetchAgents(): Promise<void> {
    // Cache check - skip RPC if already cached
    if (this._isCached()) {
      console.log('[AgentDiscoveryFacade] Cache hit, skipping RPC');
      return;
    }

    // Prevent duplicate in-flight requests
    if (this._isLoading()) {
      console.log(
        '[AgentDiscoveryFacade] Request in-flight, skipping duplicate'
      );
      return;
    }

    console.log('[AgentDiscoveryFacade] fetchAgents called');
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const result = await this.rpc.call<{
        agents?: Array<{
          name: string;
          description: string;
          scope: 'project' | 'user' | 'builtin';
        }>;
      }>('autocomplete:agents', { query: '', maxResults: 100 });

      if (result.success && result.data?.agents) {
        this._agents.set(
          result.data.agents.map((a) => ({
            ...a,
            icon:
              a.scope === 'builtin'
                ? '🤖'
                : a.scope === 'project'
                ? '📁'
                : '👤',
          }))
        );
        // Only mark cache as valid when we have actual data
        if (result.data.agents.length > 0) {
          this._isCached.set(true);
        }
      } else if (result.error) {
        console.warn('[AgentDiscoveryFacade] Discovery failed:', result.error);
        this._agents.set([]);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch agents';
      this._error.set(message);
      console.error('[AgentDiscoveryFacade] Failed to fetch agents:', error);
      this._agents.set([]);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Search agents by query
   */
  searchAgents(query: string): AgentSuggestion[] {
    const allAgents = this._agents();
    console.log('[AgentDiscoveryFacade] searchAgents called', {
      query,
      totalAgents: allAgents.length,
    });

    if (!query) {
      console.log('[AgentDiscoveryFacade] Returning all agents', {
        count: allAgents.length,
      });
      return allAgents;
    }

    const lowerQuery = query.toLowerCase();
    const results = allAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(lowerQuery) ||
        a.description.toLowerCase().includes(lowerQuery)
    );

    console.log('[AgentDiscoveryFacade] Filtered results', {
      count: results.length,
    });
    return results;
  }

  /**
   * Clear cached agents and force refetch on next request
   */
  clearCache(): void {
    this._isCached.set(false);
    this._agents.set([]);
    this._error.set(null);
    console.log('[AgentDiscoveryFacade] Cache cleared');
  }
}
