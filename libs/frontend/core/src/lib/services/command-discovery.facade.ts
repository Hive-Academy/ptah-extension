import { Injectable, inject, signal, computed } from '@angular/core';
import {
  type LucideIconData,
  Zap,
  Package,
  User,
  Plug,
  Puzzle,
  HelpCircle,
} from 'lucide-angular';
import { ClaudeRpcService } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';
import { pickerWorkspaceScope } from './picker-workspace-scope.util';

export interface CommandSuggestion {
  readonly name: string;
  readonly description: string;
  readonly scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
  readonly argumentHint?: string;
  readonly icon: LucideIconData;
}

@Injectable({
  providedIn: 'root',
})
export class CommandDiscoveryFacade {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly _isLoading = signal(false);
  private readonly _commands = signal<CommandSuggestion[]>([]);
  private readonly _isCached = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly isLoading = computed(() => this._isLoading());
  readonly commands = computed(() => this._commands());
  readonly isCached = computed(() => this._isCached());
  readonly error = computed(() => this._error());

  /**
   * Monotonic discovery generation, bumped by {@link clearCache}.
   *
   * The `_isCached`/`_isLoading` guards at the top of {@link fetchCommands} sit
   * ABOVE the `await`, while every write below it lands after — so before
   * TASK_2026_200 nothing checked between the RPC resolving and
   * `_commands`/`_isCached` being written. A response for workspace A landing
   * after a switch to B would repopulate A's project/plugin commands AND set
   * `_isCached = true`, which has no TTL — pinning the wrong workspace's `/`
   * menu for the rest of the process lifetime.
   *
   * Mirrors `AgentDiscoveryFacade._generation`; keep the two in step.
   */
  private _generation = 0;

  /**
   * Fetch all commands from backend
   */
  async fetchCommands(): Promise<void> {
    if (this._isCached()) {
      return;
    }
    if (this._isLoading()) {
      return;
    }
    this._isLoading.set(true);
    this._error.set(null);
    const generation = this._generation;

    try {
      const result = await this.rpc.call('autocomplete:commands', {
        query: '',
        maxResults: 100,
        // Same workspace-scoping convention as the `@` file picker
        // (TASK_2026_200). Read at call time; blank root omits the field.
        ...pickerWorkspaceScope(this.vscodeService.config().workspaceRoot),
      });

      // The workspace changed while this RPC was in flight — drop the result
      // rather than repopulating the cache that clearCache() just emptied.
      // Everything from here to the writes below is synchronous.
      if (generation !== this._generation) {
        return;
      }

      if (result.success && result.data?.commands) {
        this._commands.set(
          result.data.commands.map((c) => ({
            ...c,
            icon: this.getCommandIcon(c.scope),
          })),
        );
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch commands';
      console.error(
        '[CommandDiscoveryFacade] Failed to fetch commands:',
        error,
      );
      // Same guard: a failure for the previous workspace must not surface as
      // the new one's error state.
      if (generation === this._generation) {
        this._error.set(message);
        this._commands.set([]);
      }
    } finally {
      // Guarded too — otherwise a stale fetch settling late clears the loading
      // flag of the post-switch fetch that is still in flight.
      if (generation === this._generation) {
        this._isLoading.set(false);
      }
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

  private getCommandIcon(scope: string): LucideIconData {
    switch (scope) {
      case 'builtin':
        return Zap;
      case 'project':
        return Package;
      case 'user':
        return User;
      case 'mcp':
        return Plug;
      case 'plugin':
        return Puzzle;
      default:
        return HelpCircle;
    }
  }

  /**
   * Clear cached commands and force refetch on next request.
   *
   * Called on workspace switch (`WorkspaceCoordinatorService.switchWorkspace`,
   * TASK_2026_200) and after a plugin install changes what is discoverable
   * (`chat-input`, `chat-empty-state`, `marketplace-hub`, `plugins-surface`).
   *
   * Invalidation happens FIRST: bumping {@link _generation} makes every
   * already-awaiting {@link fetchCommands} drop its result instead of
   * repopulating what is cleared below. Load-bearing for both callers — on a
   * switch it stops the previous workspace's commands returning, and after a
   * plugin install it stops a pre-install response re-pinning `_isCached`.
   *
   * `_isLoading` MUST be reset here: with the generation guard on
   * {@link fetchCommands}'s `finally`, a fetch in flight at clear time no
   * longer clears the flag itself, and a stuck `true` would make every future
   * `fetchCommands()` early-return forever.
   */
  clearCache(): void {
    this._generation++;
    this._isCached.set(false);
    this._commands.set([]);
    this._error.set(null);
    this._isLoading.set(false);
  }
}
