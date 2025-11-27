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

  readonly isLoading = computed(() => this._isLoading());
  readonly agents = computed(() => this._agents());

  /**
   * Fetch all agents from backend
   */
  async fetchAgents(): Promise<void> {
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
      return this._agents().slice(0, 10);
    }

    const lowerQuery = query.toLowerCase();
    return this._agents()
      .filter(
        (a) =>
          a.name.toLowerCase().includes(lowerQuery) ||
          a.description.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 20);
  }
}
