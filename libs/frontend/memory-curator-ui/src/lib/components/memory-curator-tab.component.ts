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

import type { MemoryWire } from '@ptah-extension/shared';

import {
  MemoryStateService,
  type MemoryTierFilter,
} from '../services/memory-state.service';

const SEARCH_DEBOUNCE_MS = 300;

interface TierChip {
  readonly id: MemoryTierFilter;
  readonly label: string;
}

/**
 * MemoryCuratorTabComponent
 *
 * Memory tab content for the Hermes hub. Renders four logical sections:
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
  imports: [CommonModule],
  template: `
    <div class="flex h-full w-full flex-col gap-4">
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
          <div class="text-xs uppercase text-base-content/60">Last curated</div>
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

      <!-- Settings panel (read-only) -->
      <section
        class="rounded-lg border border-base-300 bg-base-200/40 p-3"
        aria-label="Memory settings (read-only)"
      >
        <div class="text-xs uppercase text-base-content/60">
          Memory settings (edit in Settings → Hermes)
        </div>
        <dl class="mt-2 grid grid-cols-1 gap-1 text-xs md:grid-cols-3">
          <div>
            <dt class="text-base-content/60">Tier limits</dt>
            <dd class="font-mono text-base-content">
              core / recall / archival
            </dd>
          </div>
          <div>
            <dt class="text-base-content/60">Decay halflife</dt>
            <dd class="font-mono text-base-content">
              memory.decayHalflifeDays
            </dd>
          </div>
          <div>
            <dt class="text-base-content/60">Search top-K</dt>
            <dd class="font-mono text-base-content">memory.searchTopK</dd>
          </div>
        </dl>
      </section>
    </div>
  `,
})
export class MemoryCuratorTabComponent implements OnInit {
  private readonly state = inject(MemoryStateService);

  protected readonly tierChips: readonly TierChip[] = [
    { id: 'all', label: 'All' },
    { id: 'core', label: 'Core' },
    { id: 'recall', label: 'Recall' },
    { id: 'archival', label: 'Archival' },
  ];

  /** Local mirror of the search input — debounced into `state.search()`. */
  protected readonly searchInput = signal<string>('');
  protected readonly tierFilter = this.state.tierFilter;
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
    // Refresh entries whenever the tier filter flips.
    effect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      this.state.tierFilter();
      void this.state.refresh();
    });
  }

  public ngOnInit(): void {
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
