import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService } from './vscode.service';

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
  private readonly vscode = inject(VSCodeService);
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
      const result = await this.vscode.sendRequest<{
        success: boolean;
        commands?: Array<{
          name: string;
          description: string;
          scope: 'builtin' | 'project' | 'user' | 'mcp';
          argumentHint?: string;
        }>;
        error?: string;
      }>({
        type: 'autocomplete:commands',
        data: { query: '', maxResults: 100 },
      });

      if (result.success && result.commands) {
        this._commands.set(
          result.commands.map((c) => ({
            ...c,
            icon: this.getCommandIcon(c.scope),
          }))
        );
      }
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
