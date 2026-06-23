import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Brain, LucideAngularModule } from 'lucide-angular';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import {
  WorkspaceIndexingComponent,
  WorkspaceIndexingService,
} from '@ptah-extension/workspace-indexing';

import {
  MemoryStateService,
  type MemoryScopeFilter,
  type MemoryTierFilter,
} from '../services/memory-state.service';
import { MemoryRpcService } from '../services/memory-rpc.service';

import { MemoryDiagnosticsAccordionComponent } from './diagnostics/memory-diagnostics-accordion.component';
import { TimelineViewComponent } from './timeline-view.component';
import { CorpusListComponent } from './corpus-list.component';
import { MemoryIndexingBannerComponent } from './memory-indexing-banner.component';
import { MemoryStatsStripComponent } from './memory-stats-strip.component';
import { MemorySearchBarComponent } from './memory-search-bar.component';
import { MemoryEntryListComponent } from './memory-entry-list.component';
import { MemoryIndexedCodeComponent } from './memory-indexed-code.component';
import {
  MemoryDangerZoneComponent,
  type MemoryPurgeRequest,
} from './memory-danger-zone.component';

export type MemoryTabView =
  | 'memories'
  | 'timeline'
  | 'corpus'
  | 'code'
  | 'maintenance';

interface ViewChip {
  readonly id: MemoryTabView;
  readonly label: string;
}

const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'ptah-memory-curator-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    LucideAngularModule,
    WorkspaceIndexingComponent,
    MemoryDiagnosticsAccordionComponent,
    TimelineViewComponent,
    CorpusListComponent,
    MemoryIndexingBannerComponent,
    MemoryStatsStripComponent,
    MemorySearchBarComponent,
    MemoryEntryListComponent,
    MemoryIndexedCodeComponent,
    MemoryDangerZoneComponent,
  ],
  template: `
    @if (!isElectron()) {
      <div
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
        role="status"
      >
        <lucide-angular
          [img]="BrainIcon"
          class="size-8 text-base-content/30"
          aria-hidden="true"
        />
        <p class="text-sm font-medium">Memory lives in the desktop app</p>
        <p class="text-xs text-base-content/60">
          Memory curation needs the local index and runs only in Ptah desktop.
        </p>
        <a
          class="btn btn-sm btn-primary mt-1"
          href="https://github.com/HiveAcademy/ptah-extension/releases"
          target="_blank"
          rel="noopener noreferrer"
          >Download Ptah desktop</a
        >
      </div>
    } @else {
      <div class="space-y-6">
        <header class="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-base-content/10 bg-base-200/60 text-primary"
            >
              <lucide-angular
                [img]="BrainIcon"
                class="w-5 h-5"
                aria-hidden="true"
              />
            </span>
            <div>
              <h1 class="text-xl font-semibold tracking-tight">Memory</h1>
              <p class="mt-0.5 text-sm text-base-content/60">
                Facts, events, and code Thoth has learned across sessions.
              </p>
            </div>
          </div>
          @if (view() === 'code') {
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                [disabled]="purgingJunk() || !hasWorkspace()"
                [attr.title]="
                  !hasWorkspace()
                    ? 'Open a workspace to clean its code-index junk.'
                    : 'Remove indexed code symbols from build artifacts (.angular, node_modules, dist, etc.)'
                "
                (click)="onPurgeJunk()"
                aria-label="Clean code-index junk"
              >
                @if (purgingJunk()) {
                  <span class="loading loading-spinner loading-xs"></span>
                }
                Clean junk
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                [disabled]="loading()"
                (click)="onRebuildIndex()"
              >
                @if (loading()) {
                  <span class="loading loading-spinner loading-xs"></span>
                }
                Rebuild index
              </button>
            </div>
          }
        </header>

        <ptah-memory-stats-strip
          [counts]="statCounts()"
          [lastCuratedLabel]="lastCuratedAtLabel()"
        />

        <nav
          role="tablist"
          aria-label="Memory views"
          class="tabs tabs-boxed tabs-sm w-fit bg-base-200 p-1"
        >
          @for (chip of viewChips; track chip.id) {
            <button
              type="button"
              role="tab"
              class="tab"
              [class.tab-active]="view() === chip.id"
              [attr.aria-selected]="view() === chip.id"
              (click)="onViewChange(chip.id)"
            >
              {{ chip.label }}
            </button>
          }
        </nav>

        @switch (view()) {
          @case ('timeline') {
            <div class="space-y-4">
              <ptah-timeline-view />
            </div>
          }
          @case ('corpus') {
            <div class="space-y-4">
              <ptah-corpus-list />
            </div>
          }
          @case ('code') {
            <div class="space-y-6">
              <ptah-memory-indexed-code
                [searchValue]="symbolInput()"
                [items]="state.symbolItems()"
                [total]="state.symbolTotal()"
                [loading]="state.symbolLoading()"
                [error]="state.symbolError()"
                [offset]="state.symbolOffset()"
                [prevDisabled]="symbolPrevDisabled()"
                [nextDisabled]="symbolNextDisabled()"
                [workspaceRoot]="workspaceRoot()"
                (searchInput)="onSymbolSearchInput($event)"
                (reload)="onSymbolReload()"
                (prev)="onSymbolPrev()"
                (next)="onSymbolNext()"
              />

              <section class="space-y-2">
                <h2 class="text-sm font-medium text-base-content/80">
                  Advanced indexing
                </h2>
                <ptah-workspace-indexing />
              </section>
            </div>
          }
          @case ('maintenance') {
            <div class="space-y-6">
              <section
                class="space-y-2"
                data-testid="memory-diagnostics-details"
              >
                <h2 class="text-sm font-medium text-base-content/80">
                  Diagnostics
                </h2>
                <ptah-memory-diagnostics-accordion />
              </section>

              <ptah-memory-danger-zone
                [purging]="purging()"
                [error]="purgeError()"
                [info]="purgeInfo()"
                [hasWorkspace]="hasWorkspace()"
                [scopeIsAll]="scopeFilter() === 'all'"
                (purge)="onPurge($event)"
                (inputChanged)="onPurgeInputChanged()"
                (switchScope)="onScopeFilterChange('workspace')"
              />
            </div>
          }
          @default {
            <div class="space-y-4">
              <ptah-memory-indexing-banner
                [state]="indexingUiState()"
                [hasWorkspace]="hasWorkspace()"
                [busy]="indexingBusy()"
                (indexNow)="onIndexNow()"
                (resumeIndex)="onResumeIndex()"
                (cancelIndex)="onCancelIndex()"
              />

              <ptah-memory-search-bar
                [searchValue]="searchInput()"
                [tier]="tierFilter()"
                [scope]="scopeFilter()"
                (searchInput)="onSearchInput($event)"
                (tierChange)="onTierChipClick($event)"
                (scopeChange)="onScopeFilterChange($event)"
              />

              @if (error()) {
                <div
                  class="rounded-xl border border-error/40 bg-error/5 px-4 py-3"
                  role="alert"
                >
                  <span class="text-sm text-error">{{ error() }}</span>
                </div>
              }

              <ptah-memory-entry-list
                class="mt-1 block"
                [entries]="filteredEntries()"
                [loading]="loading()"
                (pin)="onPin($event)"
                (unpin)="onUnpin($event)"
                (forget)="onForget($event)"
              />
            </div>
          }
        }
      </div>
    }
  `,
})
export class MemoryCuratorTabComponent implements OnInit {
  protected readonly state = inject(MemoryStateService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly rpcService = inject(MemoryRpcService);
  private readonly indexingService = inject(WorkspaceIndexingService);

  private readonly dangerZone = viewChild(MemoryDangerZoneComponent);

  protected readonly BrainIcon = Brain;

  protected readonly indexingUiState = this.indexingService.uiState;
  protected readonly indexingBusy = computed(() => {
    const kind = this.indexingUiState().kind;
    return kind === 'indexing' || kind === 'loading';
  });
  protected readonly purgingJunk = signal<boolean>(false);

  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  protected readonly viewChips: readonly ViewChip[] = [
    { id: 'memories', label: 'Memories' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'corpus', label: 'Corpus' },
    { id: 'code', label: 'Code index' },
    { id: 'maintenance', label: 'Maintenance' },
  ];

  private readonly _view = signal<MemoryTabView>('memories');
  public readonly view = this._view.asReadonly();

  protected readonly searchInput = signal<string>('');

  protected readonly purging = signal<boolean>(false);
  protected readonly purgeError = signal<string | null>(null);
  protected readonly purgeInfo = signal<string | null>(null);
  protected readonly hasWorkspace = computed(() =>
    Boolean(this.appState.workspaceInfo()?.path),
  );
  protected readonly workspaceRoot = computed(
    () => this.appState.workspaceInfo()?.path ?? '',
  );
  protected readonly tierFilter = this.state.tierFilter;
  protected readonly scopeFilter = this.state.scopeFilter;
  protected readonly filteredEntries = this.state.filteredEntries;
  protected readonly loading = this.state.loading;
  protected readonly error = this.state.error;

  protected readonly statCounts = computed(() => {
    const remote = this.state.stats();
    if (remote) {
      return {
        core: remote.core,
        recall: remote.recall,
        archival: remote.archival,
        codeIndex: remote.codeIndex,
      };
    }
    const totals = this.state.totalsByTier();
    return {
      core: totals.core,
      recall: totals.recall,
      archival: totals.archival,
      codeIndex: totals.codeIndex,
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
  private symbolDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly symbolInput = signal<string>('');
  protected readonly symbolPrevDisabled = computed(
    () => this.state.symbolOffset() === 0,
  );
  protected readonly symbolNextDisabled = computed(
    () =>
      this.state.symbolOffset() + this.state.symbolLimit() >=
      this.state.symbolTotal(),
  );

  public constructor() {
    effect(() => {
      this.state.tierFilter();
      if (!this.isElectron()) return;
      void this.state.refresh();
    });
    effect(() => {
      this.state.scopeFilter();
      if (!this.isElectron()) return;
      void this.state.refresh();
      void this.state.loadStats();
      void this.state.loadSymbols();
    });
    effect(() => {
      this.indexingService.completedAt();
      if (!this.isElectron()) return;
      void this.state.loadStats();
      void this.state.refresh();
      void this.state.loadSymbols();
      const root = this.appState.workspaceInfo()?.path;
      if (root) {
        void this.indexingService.loadStatus(root).catch(() => undefined);
      }
    });
  }

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.loadStats();
    void this.state.refresh();
    void this.state.loadSymbols();
    const root = this.appState.workspaceInfo()?.path;
    if (root) {
      void this.indexingService.loadStatus(root).catch(() => undefined);
    }
  }

  protected onIndexNow(): void {
    const root = this.appState.workspaceInfo()?.path;
    if (!root) return;
    void this.indexingService.start(root, false).catch(() => undefined);
  }

  protected onResumeIndex(): void {
    const root = this.appState.workspaceInfo()?.path;
    if (!root) return;
    void this.indexingService.resume(root).catch(() => undefined);
  }

  protected onCancelIndex(): void {
    const root = this.appState.workspaceInfo()?.path;
    if (!root) return;
    void this.indexingService.cancel(root).catch(() => undefined);
  }

  protected onPurgeJunk(): void {
    if (this.purgingJunk()) return;
    const root = this.appState.workspaceInfo()?.path ?? null;
    if (!root) return;
    const confirmed = window.confirm(
      'Remove indexed code symbols from build artifacts (.angular, node_modules, dist, etc.) in this workspace? This cannot be undone.',
    );
    if (!confirmed) return;
    this.purgingJunk.set(true);
    void this.runPurgeJunk(root);
  }

  private async runPurgeJunk(workspaceRoot: string): Promise<void> {
    try {
      const result = await this.rpcService.purgeJunk(workspaceRoot);
      this.purgeInfo.set(
        `Removed ${result.deleted} junk code-index ${result.deleted === 1 ? 'entry' : 'entries'}.`,
      );
      await this.state.refresh();
      await this.state.loadStats();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'memory:purgeJunk failed';
      this.purgeError.set(message);
    } finally {
      this.purgingJunk.set(false);
    }
  }

  protected onSearchInput(value: string): void {
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

  protected onViewChange(view: MemoryTabView): void {
    this._view.set(view);
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

  protected onPurgeInputChanged(): void {
    this.purgeInfo.set(null);
    this.purgeError.set(null);
  }

  protected onPurge(request: MemoryPurgeRequest): void {
    if (this.purging()) return;
    const pattern = request.pattern.trim();
    if (pattern === '') return;
    const mode = request.mode;
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
      this.dangerZone()?.clearPattern();
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

  protected onSymbolSearchInput(value: string): void {
    this.symbolInput.set(value);
    if (this.symbolDebounceTimer !== null) {
      clearTimeout(this.symbolDebounceTimer);
    }
    this.symbolDebounceTimer = setTimeout(() => {
      this.state.setSymbolQuery(value);
      this.state.setSymbolPage(0);
      void this.state.loadSymbols();
      this.symbolDebounceTimer = null;
    }, SEARCH_DEBOUNCE_MS);
  }

  protected onSymbolReload(): void {
    void this.state.loadSymbols();
  }

  protected onSymbolPrev(): void {
    const next = this.state.symbolOffset() - this.state.symbolLimit();
    this.state.setSymbolPage(next < 0 ? 0 : next);
    void this.state.loadSymbols();
  }

  protected onSymbolNext(): void {
    this.state.setSymbolPage(
      this.state.symbolOffset() + this.state.symbolLimit(),
    );
    void this.state.loadSymbols();
  }
}
