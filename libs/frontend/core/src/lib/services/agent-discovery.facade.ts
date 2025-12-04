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

  readonly isLoading = computed(() => this._isLoading());
  readonly agents = computed(() => this._agents());
  readonly isCached = computed(() => this._isCached());

  /**
   * Fetch all agents from backend
   */
  async fetchAgents(): Promise<void> {
    // Cache check - skip RPC if already cached
    if (this._isCached()) {
      console.log('[AgentDiscoveryFacade] Cache hit, skipping RPC');
      return;
    }

    this._isLoading.set(true);

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
    if (!query) {
      return this._agents();
    }

    const lowerQuery = query.toLowerCase();
    return this._agents().filter(
      (a) =>
        a.name.toLowerCase().includes(lowerQuery) ||
        a.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Clear cached agents and force refetch on next request
   */
  clearCache(): void {
    this._isCached.set(false);
    this._agents.set([]);
    console.log('[AgentDiscoveryFacade] Cache cleared');
  }
}
