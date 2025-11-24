import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService } from './vscode.service';

export interface AgentSuggestion {
  readonly name: string;
  readonly description: string;
  readonly scope: 'project' | 'user';
  readonly icon: string;
}

@Injectable({
  providedIn: 'root',
})
export class AgentDiscoveryFacade {
  private readonly vscode = inject(VSCodeService);
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
      const result = await this.vscode.sendRequest<{
        success: boolean;
        agents?: Array<{
          name: string;
          description: string;
          scope: 'project' | 'user';
        }>;
        error?: string;
      }>({
        type: 'autocomplete:agents',
        data: { query: '', maxResults: 100 },
      });

      if (result.success && result.agents) {
        this._agents.set(
          result.agents.map((a) => ({
            ...a,
            icon: a.scope === 'project' ? '🤖' : '👤',
          }))
        );
      }
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
