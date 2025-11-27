import { Injectable, inject, signal, computed } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';

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
  private readonly rpc = inject(ClaudeRpcService);
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
      const result = await this.rpc.call<{
        servers?: Array<{
          name: string;
          status: 'running' | 'stopped' | 'error' | 'unknown';
          type: 'stdio' | 'http' | 'sse';
        }>;
      }>('autocomplete:mcps', {
        query: '',
        maxResults: 50,
        includeOffline: false,
      });

      if (result.success && result.data?.servers) {
        this._servers.set(
          result.data.servers.map((s) => ({
            ...s,
            icon: s.status === 'running' ? '🔌' : '⚠️',
          }))
        );
      } else if (result.error) {
        console.warn('[MCPDiscoveryFacade] Discovery failed:', result.error);
        this._servers.set([]);
      }
    } catch (error) {
      console.error('[MCPDiscoveryFacade] Failed to fetch MCP servers:', error);
      this._servers.set([]);
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
