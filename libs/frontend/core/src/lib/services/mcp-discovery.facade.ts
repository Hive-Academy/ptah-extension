import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService } from './vscode.service';

export interface MCPSuggestion {
  readonly name: string;
  readonly status: 'running' | 'stopped' | 'error' | 'unknown';
  readonly type: 'stdio' | 'http' | 'sse';
  readonly icon: string;
}

@Injectable({
  providedIn: 'root',
})
export class MCPDiscoveryFacade {
  private readonly vscode = inject(VSCodeService);
  private readonly _isLoading = signal(false);
  private readonly _servers = signal<MCPSuggestion[]>([]);

  readonly isLoading = computed(() => this._isLoading());
  readonly servers = computed(() => this._servers());

  /**
   * Fetch all MCP servers from backend
   */
  async fetchServers(): Promise<void> {
    this._isLoading.set(true);

    try {
      const result = await this.vscode.sendRequest<{
        success: boolean;
        servers?: Array<{
          name: string;
          status: 'running' | 'stopped' | 'error' | 'unknown';
          type: 'stdio' | 'http' | 'sse';
        }>;
        error?: string;
      }>({
        type: 'autocomplete:mcps',
        data: { query: '', maxResults: 50, includeOffline: false },
      });

      if (result.success && result.servers) {
        this._servers.set(
          result.servers.map((s) => ({
            ...s,
            icon: s.status === 'running' ? '🔌' : '⚠️',
          }))
        );
      }
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Search MCP servers by query
   */
  searchServers(query: string): MCPSuggestion[] {
    if (!query) {
      return this._servers().slice(0, 10);
    }

    const lowerQuery = query.toLowerCase();
    return this._servers()
      .filter((s) => s.name.toLowerCase().includes(lowerQuery))
      .slice(0, 20);
  }
}
