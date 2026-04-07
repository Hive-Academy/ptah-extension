import { Injectable, inject, signal, computed } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';

export interface CommandSuggestion {
  readonly name: string;
  readonly description: string;
  readonly scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
  readonly argumentHint?: string;
  readonly icon: string;
}

@Injectable({
  providedIn: 'root',
})
export class CommandDiscoveryFacade {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly _isLoading = signal(false);
  private readonly _commands = signal<CommandSuggestion[]>([]);
  private readonly _isCached = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly isLoading = computed(() => this._isLoading());
  readonly commands = computed(() => this._commands());
  readonly isCached = computed(() => this._isCached());
  readonly error = computed(() => this._error());

  /**
   * Fetch all commands from backend
   */
  async fetchCommands(): Promise<void> {
    // Cache check - skip RPC if already cached
    if (this._isCached()) {
      return;
    }

    // Prevent duplicate in-flight requests
    if (this._isLoading()) {
      return;
    }
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const result = await this.rpc.call('autocomplete:commands', {
        query: '',
        maxResults: 100,
      });

      if (result.success && result.data?.commands) {
        this._commands.set(
          result.data.commands.map((c) => ({
            ...c,
            icon: this.getCommandIcon(c.scope),
          })),
        );
        // Only mark cache as valid when we have actual data
        if (result.data.commands.length > 0) {
          this._isCached.set(true);
        }
      } else if (result.error) {
        console.warn(
          '[CommandDiscoveryFacade] Discovery failed:',
          result.error,
        );
        this._commands.set([]);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch commands';
      this._error.set(message);
      console.error(
        '[CommandDiscoveryFacade] Failed to fetch commands:',
        error,
      );
      this._commands.set([]);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Search commands by query
   */
  searchCommands(query: string): CommandSuggestion[] {
    const allCommands = this._commands();

    if (!query) {
      return allCommands;
    }

    const lowerQuery = query.toLowerCase();
    return allCommands.filter(
      (c) =>
        c.name.toLowerCase().includes(lowerQuery) ||
        c.description.toLowerCase().includes(lowerQuery),
    );
  }

  private getCommandIcon(scope: string): string {
    switch (scope) {
      case 'builtin':
        return '⚡';
      case 'project':
        return '📦';
      case 'user':
        return '👤';
      case 'mcp':
        return '🔌';
      case 'plugin':
        return '🧩';
      default:
        return '❓';
    }
  }

  /**
   * Clear cached commands and force refetch on next request
   */
  clearCache(): void {
    this._isCached.set(false);
    this._commands.set([]);
    this._error.set(null);
  }
}
