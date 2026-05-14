import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { WorkspaceIndexingComponent } from '@ptah-extension/workspace-indexing';
import type { MemoryWire } from '@ptah-extension/shared';

import {
  MemoryStateService,
  type MemoryScopeFilter,
  type MemoryTierFilter,
} from '../services/memory-state.service';
import { MemoryRpcService } from '../services/memory-rpc.service';

const SEARCH_DEBOUNCE_MS = 300;

interface TierChip {
  readonly id: MemoryTierFilter;
  readonly label: string;
}

/**
 * MemoryCuratorTabComponent
 *
 * Memory tab content for the Thoth hub. Renders four logical sections:
 *
 * 1. Search input + tier filter chips (debounced search at {@link SEARCH_DEBOUNCE_MS} ms).
 * 2. Stats panel with core / recall / archival counts (from `memory:stats` with
 *    a fallback to client-side totals derived from the loaded entries).
 * 3. Entry list with per-row pin / unpin / forget actions.
 * 4. Settings panel: read-only display of the current memory.* file-based
 *    settings (those settings are edited via the Settings view, not here).
 *
 * All RPC calls are routed through {@link MemoryStateService}, which in turn
 * delegates to {@link import('../services/memory-rpc.service').MemoryRpcService}.
 */
@Component({
  selector: 'ptah-memory-curator-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, WorkspaceIndexingComponent],
  template: `
    @if (!isElectron()) {
      <div role="alert" class="alert alert-info">
        <span class="text-sm">
          Memory curation is only available in the Ptah desktop app.
          <a
            class="link link-primary ml-1"
            href="https://github.com/HiveAcademy/ptah-extension/releases"
            target="_blank"
            rel="noopener noreferrer"
            >Download Ptah desktop</a
          >.
        </span>
      </div>
    } @else {
      <div class="flex h-full w-full flex-col gap-4">
        <!-- Workspace scope toggle -->
        <div
          class="join mb-2"
          role="tablist"
          aria-label="Memory workspace scope"
        >
          <button
            type="button"
            role="tab"
            class="join-item btn btn-sm"
            [class.btn-primary]="scopeFilter() === 'workspace'"
            [attr.aria-selected]="scopeFilter() === 'workspace'"
            (click)="onScopeFilterChange('workspace')"
          >
            This workspace
          </button>
          <button
            type="button"
            role="tab"
            class="join-item btn btn-sm"
            [class.btn-primary]="scopeFilter() === 'all'"
            [attr.aria-selected]="scopeFilter() === 'all'"
            (click)="onScopeFilterChange('all')"
          >
            All workspaces
          </button>
        </div>

        <!-- Search + tier filter -->
        <div class="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            type="search"
            class="input input-sm input-bordered w-full md:max-w-md"
            placeholder="Search memory (BM25 + vector hybrid)..."
            [value]="searchInput()"
            (input)="onSearchInput($event)"
            aria-label="Search memory entries"
          />
          <div
            role="tablist"
            aria-label="Memory tier filter"
            class="flex flex-wrap gap-1"
          >
            @for (chip of tierChips; track chip.id) {
              <button
                type="button"
                role="tab"
                class="btn btn-xs"
                [class.btn-primary]="tierFilter() === chip.id"
                [class.btn-ghost]="tierFilter() !== chip.id"
                [attr.aria-selected]="tierFilter() === chip.id"
                (click)="onTierChipClick(chip.id)"
              >
                {{ chip.label }}
              </button>
            }
          </div>
          <button
            type="button"
            class="btn btn-sm btn-outline ml-auto"
            [disabled]="loading()"
            (click)="onRebuildIndex()"
          >
            @if (loading()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Rebuild index
          </button>
        </div>

        @if (error()) {
          <div role="alert" class="alert alert-error">
            <span class="text-sm">{{ error() }}</span>
          </div>
        }

        <!-- Purge by pattern toolbar -->
        <section
          class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-200/40 p-3 md:flex-row md:items-center"
          aria-label="Purge memory entries by subject pattern"
        >
          <div class="flex flex-1 flex-col gap-1">
            <label
              for="memory-purge-pattern"
              class="text-xs uppercase text-base-content/60"
            >
              Purge by subject pattern
            </label>
            <input
              id="memory-purge-pattern"
              type="text"
              class="input input-sm input-bordered w-full"
              placeholder="e.g. node_modules  (substring)  or  code:function:%  (like)"
              [value]="purgePattern()"
              (input)="onPurgePatternInput($event)"
              [disabled]="purging()"
              aria-label="Pattern to match against memory subject"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="memory-purge-mode"
              class="text-xs uppercase text-base-content/60"
            >
              Mode
            </label>
            <select
              id="memory-purge-mode"
              class="select select-sm select-bordered"
              [value]="purgeMode()"
              (change)="onPurgeModeChange($event)"
              [disabled]="purging()"
              aria-label="Pattern match mode"
            >
              <option value="substring">substring</option>
              <option value="like">like</option>
            </select>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-error md:self-end"
            [disabled]="purgeDisabled()"
            [attr.title]="
              !hasWorkspace() ? 'Open a workspace to purge memory.' : null
            "
            (click)="onPurge()"
          >
            @if (purging()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Purge
          </button>
        </section>

        @if (!hasWorkspace()) {
          <p class="text-xs text-base-content/60">
            Open a workspace to purge memory.
          </p>
        }
        @if (scopeFilter() === 'all') {
          <p class="text-xs text-warning mt-1">
            Switch to 'This workspace' to purge.
            <button
              type="button"
              class="btn btn-xs btn-link p-0"
              (click)="onScopeFilterChange('workspace')"
            >
              Switch
            </button>
          </p>
        }

        @if (purgeError()) {
          <div role="alert" class="alert alert-error">
            <span class="text-sm">{{ purgeError() }}</span>
          </div>
        }
        @if (purgeInfo()) {
          <div role="status" class="alert alert-success">
            <span class="text-sm">{{ purgeInfo() }}</span>
          </div>
        }

        <!-- Stats panel -->
        <section
          class="grid grid-cols-2 gap-2 md:grid-cols-4"
          aria-label="Memory tier statistics"
        >
          <div class="rounded-lg bg-base-200 p-3">
            <div class="text-xs uppercase text-base-content/60">Core</div>
            <div class="text-2xl font-semibold text-base-content">
              {{ statCounts().core }}
            </div>
          </div>
          <div class="rounded-lg bg-base-200 p-3">
            <div class="text-xs uppercase text-base-content/60">Recall</div>
            <div class="text-2xl font-semibold text-base-content">
              {{ statCounts().recall }}
            </div>
          </div>
          <div class="rounded-lg bg-base-200 p-3">
            <div class="text-xs uppercase text-base-content/60">Archival</div>
            <div class="text-2xl font-semibold text-base-content">
              {{ statCounts().archival }}
            </div>
          </div>
          <div class="rounded-lg bg-base-200 p-3">
            <div class="text-xs uppercase text-base-content/60">
              Last curated
            </div>
            <div class="text-sm font-medium text-base-content">
              {{ lastCuratedAtLabel() }}
            </div>
          </div>
        </section>

        <!-- Entry list -->
        <section class="flex-1 overflow-auto" aria-label="Memory entries">
          @if (loading() && filteredEntries().length === 0) {
            <div class="flex items-center justify-center py-8">
              <span class="loading loading-spinner loading-md"></span>
            </div>
          } @else if (filteredEntries().length === 0) {
            <div
              class="rounded-lg border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60"
            >
              No memory entries match the current filter.
            </div>
          } @else {
            <ul class="flex flex-col gap-2">
              @for (entry of filteredEntries(); track entry.id) {
                <li
                  class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-3 md:flex-row md:items-start"
                >
                  <div class="flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        class="badge badge-sm"
                        [class]="tierBadgeClass(entry.tier)"
                      >
                        {{ entry.tier }}
                      </span>
                      <span class="badge badge-sm badge-ghost">
                        {{ entry.kind }}
                      </span>
                      @if (entry.pinned) {
                        <span class="badge badge-sm badge-warning">pinned</span>
                      }
                      <span class="text-xs text-base-content/60">
                        score {{ entry.salience.toFixed(2) }}
                      </span>
                    </div>
                    @if (entry.subject) {
                      <div class="mt-1 text-sm font-medium text-base-content">
                        {{ entry.subject }}
                      </div>
                    }
                    <div class="mt-1 line-clamp-3 text-sm text-base-content/80">
                      {{ entry.content }}
                    </div>
                  </div>
                  <div class="flex shrink-0 gap-1">
                    @if (entry.pinned) {
                      <button
                        type="button"
                        class="btn btn-xs btn-ghost"
                        (click)="onUnpin(entry.id)"
                        [attr.aria-label]="'Unpin entry ' + entry.id"
                      >
                        Unpin
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="btn btn-xs btn-ghost"
                        (click)="onPin(entry.id)"
                        [attr.aria-label]="'Pin entry ' + entry.id"
                      >
                        Pin
                      </button>
                    }
                    <button
                      type="button"
                      class="btn btn-xs btn-ghost text-error"
                      (click)="onForget(entry.id)"
                      [attr.aria-label]="'Forget entry ' + entry.id"
                    >
                      Forget
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        <!-- Workspace indexing panel (moved from Settings → Workspace Indexing) -->
        <div aria-label="Workspace indexing settings">
          <ptah-workspace-indexing />
        </div>
      </div>
    }
  `,
})
export class MemoryCuratorTabComponent implements OnInit {
  private readonly state = inject(MemoryStateService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(MemoryRpcService);

  /** Whether the webview is running inside the Electron desktop app. */
  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  protected readonly tierChips: readonly TierChip[] = [
    { id: 'all', label: 'All' },
    { id: 'core', label: 'Core' },
    { id: 'recall', label: 'Recall' },
    { id: 'archival', label: 'Archival' },
  ];

  /** Local mirror of the search input — debounced into `state.search()`. */
  protected readonly searchInput = signal<string>('');

  /** Pattern entered into the purge toolbar input. */
  protected readonly purgePattern = signal<string>('');
  /** Match mode for the purge pattern (substring → escaped LIKE, like → raw). */
  protected readonly purgeMode = signal<'substring' | 'like'>('substring');
  /** Whether a purge RPC is in flight (disables the button + input). */
  protected readonly purging = signal<boolean>(false);
  /** Error message from the most recent purge RPC, surfaced inline. */
  protected readonly purgeError = signal<string | null>(null);
  /** Info message after a successful purge (e.g. "Deleted 4 entries."). */
  protected readonly purgeInfo = signal<string | null>(null);
  /** True when a workspace is currently open (path is non-empty). */
  protected readonly hasWorkspace = computed(() =>
    Boolean(this.appState.workspaceInfo()?.path),
  );
  /** Combined disabled signal for the Purge button. */
  protected readonly purgeDisabled = computed(
    () =>
      !this.purgePattern().trim() ||
      this.purging() ||
      !this.hasWorkspace() ||
      this.scopeFilter() === 'all',
  );
  protected readonly tierFilter = this.state.tierFilter;
  protected readonly scopeFilter = this.state.scopeFilter;
  protected readonly filteredEntries = this.state.filteredEntries;
  protected readonly loading = this.state.loading;
  protected readonly error = this.state.error;

  /**
   * Counts shown in the stats panel — prefers the authoritative
   * `memory:stats` payload, falls back to client-side totals.
   */
  protected readonly statCounts = computed(() => {
    const remote = this.state.stats();
    if (remote) {
      return {
        core: remote.core,
        recall: remote.recall,
        archival: remote.archival,
      };
    }
    const totals = this.state.totalsByTier();
    return {
      core: totals.core,
      recall: totals.recall,
      archival: totals.archival,
    };
  });

  protected readonly lastCuratedAtLabel = computed(() => {
    const ts = this.state.stats()?.lastCuratedAt ?? null;
    if (ts === null) return 'never';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return 'never';
    }
  });

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    // Refresh entries whenever the tier filter flips. Skipped in non-Electron
    // hosts where memory:* RPCs are not registered (placeholder shown instead).
    effect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      this.state.tierFilter();
      if (!this.isElectron()) return;
      void this.state.refresh();
    });

    // Reactive effect: when the workspace scope toggle flips, refresh both the
    // entry list and the stats payload so the UI matches the new scope.
    effect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      this.state.scopeFilter();
      if (!this.isElectron()) return;
      void this.state.refresh();
      void this.state.loadStats();
    });
  }

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.loadStats();
    void this.state.refresh();
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchInput.set(value);
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      void this.state.search(value);
      this.debounceTimer = null;
    }, SEARCH_DEBOUNCE_MS);
  }

  protected onTierChipClick(tier: MemoryTierFilter): void {
    this.state.setTierFilter(tier);
  }

  protected onScopeFilterChange(scope: MemoryScopeFilter): void {
    this.state.setScopeFilter(scope);
  }

  protected onPin(id: string): void {
    void this.state.pin(id);
  }

  protected onUnpin(id: string): void {
    void this.state.unpin(id);
  }

  protected onForget(id: string): void {
    void this.state.forget(id);
  }

  protected onRebuildIndex(): void {
    void this.state.rebuildIndex();
  }

  protected onPurgePatternInput(event: Event): void {
    this.purgePattern.set((event.target as HTMLInputElement).value);
    this.purgeInfo.set(null);
    this.purgeError.set(null);
  }

  protected onPurgeModeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'substring' || value === 'like') {
      this.purgeMode.set(value);
    }
    this.purgeInfo.set(null);
    this.purgeError.set(null);
  }

  /**
   * Purge memory entries whose subject matches the entered pattern. Requires
   * user confirmation via `window.confirm` and refreshes the list + stats on
   * success. Errors are surfaced through the shared `state.error` signal.
   */
  protected onPurge(): void {
    if (this.purging()) return;
    const pattern = this.purgePattern().trim();
    if (pattern === '') return;
    const mode = this.purgeMode();
    const workspaceRoot = this.appState.workspaceInfo()?.path ?? null;

    if (!workspaceRoot) {
      this.purgeError.set('Open a workspace before purging memory.');
      return;
    }

    const confirmed = window.confirm(
      `Delete all memory entries whose subject matches '${pattern}' (mode: ${mode})? This cannot be undone.`,
    );
    if (!confirmed) return;

    this.purging.set(true);
    this.purgeError.set(null);
    this.purgeInfo.set(null);
    void this.runPurge(pattern, mode, workspaceRoot);
  }

  private async runPurge(
    pattern: string,
    mode: 'substring' | 'like',
    workspaceRoot: string | null,
  ): Promise<void> {
    try {
      const result = await this.rpcService.purgeBySubjectPattern(
        pattern,
        mode,
        workspaceRoot,
      );
      this.purgePattern.set('');
      this.purgeInfo.set(
        `Deleted ${result.deleted} ${result.deleted === 1 ? 'entry' : 'entries'}.`,
      );
      await this.state.refresh();
      await this.state.loadStats();
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'memory:purgeBySubjectPattern failed';
      this.purgeError.set(message);
    } finally {
      this.purging.set(false);
    }
  }

  protected tierBadgeClass(tier: MemoryWire['tier']): string {
    switch (tier) {
      case 'core':
        return 'badge-primary';
      case 'recall':
        return 'badge-info';
      case 'archival':
        return 'badge-neutral';
    }
  }
}
