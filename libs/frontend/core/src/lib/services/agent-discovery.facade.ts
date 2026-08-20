import { Injectable, inject, signal, computed } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';
import { pickerWorkspaceScope } from './picker-workspace-scope.util';

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
  private readonly vscodeService = inject(VSCodeService);
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);
  private readonly _isCached = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly isLoading = computed(() => this._isLoading());
  readonly agents = computed(() => this._agents());
  readonly isCached = computed(() => this._isCached());
  readonly error = computed(() => this._error());

  /**
   * Monotonic discovery generation, bumped by {@link clearCache}.
   *
   * The `_isCached`/`_isLoading` guards at the top of {@link fetchAgents} sit
   * ABOVE the `await`, while every write below it lands after — so before
   * TASK_2026_200 there was no check at all between the RPC resolving and
   * `_agents`/`_isCached` being written. A response for workspace A landing
   * after a switch to B would repopulate A's project-scoped agents AND set
   * `_isCached = true`.
   *
   * That last part is why this needs a generation and not just a clear:
   * `_isCached` has no TTL (unlike `FilePickerService`'s five-minute stamp), so
   * a stale response pins the wrong workspace's agents for the rest of the
   * process lifetime — nothing would ever refetch.
   */
  private _generation = 0;

  /**
   * Fetch all agents from backend
   */
  async fetchAgents(): Promise<void> {
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
      const result = await this.rpc.call('autocomplete:agents', {
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

      if (result.success && result.data?.agents) {
        this._agents.set(
          result.data.agents.map((a) => ({
            ...a,
            icon:
              a.scope === 'builtin'
                ? '🤖'
                : a.scope === 'project'
                  ? '🛠️'
                  : '👤',
          })),
        );
        if (result.data.agents.length > 0) {
          this._isCached.set(true);
        }
      } else if (result.error) {
        console.warn('[AgentDiscoveryFacade] Discovery failed:', result.error);
        this._agents.set([]);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch agents';
      console.error('[AgentDiscoveryFacade] Failed to fetch agents:', error);
      // Same guard: a failure for the previous workspace must not surface as
      // the new one's error state.
      if (generation === this._generation) {
        this._error.set(message);
        this._agents.set([]);
      }
    } finally {
      // Guarded too — otherwise a stale fetch settling late clears the loading
      // flag of the post-switch fetch that is still in flight, letting a third
      // caller past the `_isLoading` guard and issue a duplicate RPC.
      if (generation === this._generation) {
        this._isLoading.set(false);
      }
    }
  }

  /**
   * Search agents by query
   */
  searchAgents(query: string): AgentSuggestion[] {
    const allAgents = this._agents();

    if (!query) {
      return allAgents;
    }

    const lowerQuery = query.toLowerCase();
    return allAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(lowerQuery) ||
        a.description.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Clear cached agents and force refetch on next request.
   *
   * Called on workspace switch (`WorkspaceCoordinatorService.switchWorkspace`,
   * TASK_2026_200) and after a plugin install changes what is discoverable.
   *
   * Invalidation happens FIRST: bumping {@link _generation} makes every
   * already-awaiting {@link fetchAgents} drop its result instead of
   * repopulating what is cleared below. That is load-bearing for both callers —
   * on a switch it prevents the previous workspace's project agents coming
   * back, and after a plugin install it prevents a pre-install response
   * re-pinning `_isCached` with the stale list.
   *
   * `_isLoading` MUST be reset here: with the generation guard on
   * {@link fetchAgents}'s `finally`, a fetch in flight at clear time no longer
   * clears the flag itself, and a stuck `true` would make every future
   * `fetchAgents()` early-return forever.
   */
  clearCache(): void {
    this._generation++;
    this._isCached.set(false);
    this._agents.set([]);
    this._error.set(null);
    this._isLoading.set(false);
  }
}
