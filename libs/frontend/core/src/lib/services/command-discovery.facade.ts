import { Injectable, inject, signal, computed } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';

export interface CommandSuggestion {
  readonly name: string;
  readonly description: string;
  readonly scope: 'builtin' | 'project' | 'user' | 'mcp';
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

  readonly isLoading = computed(() => this._isLoading());
  readonly commands = computed(() => this._commands());

  /**
   * Fetch all commands from backend
   */
  async fetchCommands(): Promise<void> {
    this._isLoading.set(true);

    try {
      const result = await this.rpc.call<{
        commands?: Array<{
          name: string;
          description: string;
          scope: 'builtin' | 'project' | 'user' | 'mcp';
          argumentHint?: string;
        }>;
      }>('autocomplete:commands', { query: '', maxResults: 100 });

      if (result.success && result.data?.commands) {
        this._commands.set(
          result.data.commands.map((c) => ({
            ...c,
            icon: this.getCommandIcon(c.scope),
          }))
        );
      } else if (result.error) {
        console.warn('[CommandDiscoveryFacade] Discovery failed:', result.error);
        this._commands.set([]);
      }
    } catch (error) {
      console.error('[CommandDiscoveryFacade] Failed to fetch commands:', error);
      this._commands.set([]);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Search commands by query
   */
  searchCommands(query: string): CommandSuggestion[] {
    if (!query) {
      return this._commands().slice(0, 10);
    }

    const lowerQuery = query.toLowerCase();
    return this._commands()
      .filter(
        (c) =>
          c.name.toLowerCase().includes(lowerQuery) ||
          c.description.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 20);
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
      default:
        return '❓';
    }
  }
}
