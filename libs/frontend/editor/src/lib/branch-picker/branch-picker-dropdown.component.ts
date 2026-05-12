import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  LucideAngularModule,
  Plus,
  Search,
  X,
} from 'lucide-angular';
import type { BranchRef, GitCheckoutResult } from '@ptah-extension/shared';
import { GitBranchesService } from '../services/git-branches.service';

/**
 * BranchPickerDropdownComponent — VS Code-style branch picker shown when the
 * user clicks the branch segment of the git status bar.
 *
 * Sections (top to bottom):
 *   1. Search input
 *   2. Recent branches (top 5, when search is empty)
 *   3. Local branches (collapsible, current marked, ahead/behind badge)
 *   4. Remote branches (collapsible, grouped by remote name)
 *   5. Inline "Create new branch" affordance
 *
 * Checkout flow:
 *   - First click: `gitBranches.checkout({ branch, force: false })`.
 *   - If `result.dirty === true` → show inline dirty-warning confirm UI.
 *   - On confirm-force → call again with `force: true`.
 *   - On success → record the branch in `recentBranches`, emit
 *     `branchCheckedOut` and `closed`.
 *
 * Outside-click closes the dropdown via the `(document:click)` host listener.
 *
 * Wave: TASK_2026_111 Batch 4.
 */
@Component({
  selector: 'ptah-branch-picker-dropdown',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  template: `
    @if (isOpen()) {
      <div
        class="absolute top-full left-0 mt-1 z-50 min-w-[320px] max-w-[420px]
               bg-base-200 border border-base-300 rounded shadow-lg
               text-xs select-text"
        role="dialog"
        aria-label="Branch picker"
      >
        <!-- Search -->
        <div
          class="flex items-center gap-1.5 px-2 py-1.5 border-b border-base-300"
        >
          <lucide-angular
            [img]="SearchIcon"
            class="w-3.5 h-3.5 text-base-content/40 flex-shrink-0"
          />
          <input
            type="text"
            class="input input-ghost input-xs flex-1 px-1 h-6 min-h-0
                   focus:outline-none focus:bg-transparent"
            placeholder="Search branches..."
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            aria-label="Search branches"
          />
          @if (searchQuery()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0"
              title="Clear search"
              aria-label="Clear search"
              (click)="searchQuery.set('')"
            >
              <lucide-angular [img]="XIcon" class="w-3 h-3" />
            </button>
          }
        </div>

        <!-- Dirty-tree confirm warning -->
        @if (showDirtyWarning(); as branchName) {
          <div class="p-2 bg-warning/10 border-b border-warning/30">
            <p class="text-[11px] mb-1.5">
              Working tree has uncommitted changes. Force checkout
              <strong>{{ branchName }}</strong
              >? Local changes will be lost.
            </p>
            <div class="flex gap-1">
              <button
                class="btn btn-warning btn-xs flex-1"
                [disabled]="isCheckingOut()"
                (click)="confirmForceCheckout(branchName)"
              >
                @if (isCheckingOut()) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else {
                  Force checkout
                }
              </button>
              <button
                class="btn btn-ghost btn-xs"
                [disabled]="isCheckingOut()"
                (click)="cancelDirtyWarning()"
              >
                Cancel
              </button>
            </div>
          </div>
        }

        <!-- Checkout error -->
        @if (checkoutError()) {
          <div class="p-2 bg-error/10 border-b border-error/30">
            <p class="text-[11px] text-error">{{ checkoutError() }}</p>
          </div>
        }

        <!-- Body: scrollable list -->
        <div class="max-h-[360px] overflow-y-auto scrollbar-thin">
          <!-- Recent branches (only when search is empty) -->
          @if (!searchQuery() && filteredRecent().length > 0) {
            <div class="py-0.5">
              <div
                class="px-2 py-0.5 text-[10px] font-semibold uppercase
                       tracking-wider opacity-50"
              >
                Recent
              </div>
              @for (name of filteredRecent(); track name) {
                <button
                  type="button"
                  class="flex items-center gap-1.5 w-full px-2 py-1
                         hover:bg-base-content/10 transition-colors text-left"
                  [disabled]="isCheckingOut()"
                  (click)="onCheckoutClick(name)"
                >
                  <lucide-angular
                    [img]="GitBranchIcon"
                    class="w-3.5 h-3.5 opacity-50 flex-shrink-0"
                  />
                  <span class="truncate">{{ name }}</span>
                </button>
              }
            </div>
          }

          <!-- Local branches -->
          <div class="py-0.5">
            <button
              type="button"
              class="flex items-center gap-1 w-full px-2 py-1
                     text-[10px] font-semibold uppercase tracking-wider
                     opacity-70 hover:opacity-100 transition-opacity"
              (click)="localExpanded.set(!localExpanded())"
              [attr.aria-expanded]="localExpanded()"
              aria-label="Toggle local branches"
            >
              <lucide-angular
                [img]="localExpanded() ? ChevronDownIcon : ChevronRightIcon"
                class="w-3 h-3 flex-shrink-0"
              />
              <span>Local ({{ filteredLocal().length }})</span>
            </button>
            @if (localExpanded()) {
              @for (b of filteredLocal(); track b.name) {
                <button
                  type="button"
                  class="flex items-center gap-1.5 w-full px-2 py-1
                         hover:bg-base-content/10 transition-colors text-left"
                  [class.bg-base-content/5]="b.isCurrent"
                  [disabled]="isCheckingOut()"
                  (click)="onCheckoutClick(b.name)"
                >
                  <lucide-angular
                    [img]="b.isCurrent ? CheckIcon : GitBranchIcon"
                    class="w-3.5 h-3.5 flex-shrink-0"
                    [class.text-primary]="b.isCurrent"
                    [class.opacity-50]="!b.isCurrent"
                  />
                  <span
                    class="truncate flex-1"
                    [class.font-medium]="b.isCurrent"
                  >
                    {{ b.name }}
                  </span>
                  @if (b.ahead > 0 || b.behind > 0) {
                    <span
                      class="text-[10px] text-base-content/50 flex-shrink-0"
                    >
                      @if (b.ahead > 0) {
                        <span class="text-info">↑{{ b.ahead }}</span>
                      }
                      @if (b.behind > 0) {
                        <span class="text-warning">↓{{ b.behind }}</span>
                      }
                    </span>
                  }
                </button>
              }
              @if (filteredLocal().length === 0) {
                <div class="px-3 py-1.5 text-[10px] opacity-40 text-center">
                  No matching local branches
                </div>
              }
            }
          </div>

          <!-- Remote branches -->
          <div class="py-0.5 border-t border-base-300">
            <button
              type="button"
              class="flex items-center gap-1 w-full px-2 py-1
                     text-[10px] font-semibold uppercase tracking-wider
                     opacity-70 hover:opacity-100 transition-opacity"
              (click)="remoteExpanded.set(!remoteExpanded())"
              [attr.aria-expanded]="remoteExpanded()"
              aria-label="Toggle remote branches"
            >
              <lucide-angular
                [img]="remoteExpanded() ? ChevronDownIcon : ChevronRightIcon"
                class="w-3 h-3 flex-shrink-0"
              />
              <span>Remote ({{ filteredRemote().length }})</span>
            </button>
            @if (remoteExpanded()) {
              @for (group of remoteGroups(); track group.remote) {
                <div
                  class="px-2 py-0.5 text-[9px] font-semibold uppercase
                         tracking-wider opacity-40"
                >
                  {{ group.remote }}
                </div>
                @for (b of group.branches; track b.name) {
                  <button
                    type="button"
                    class="flex items-center gap-1.5 w-full px-2 py-1
                           hover:bg-base-content/10 transition-colors text-left"
                    [disabled]="isCheckingOut()"
                    (click)="onCheckoutClick(b.name)"
                  >
                    <lucide-angular
                      [img]="GitBranchIcon"
                      class="w-3.5 h-3.5 opacity-40 flex-shrink-0"
                    />
                    <span class="truncate">{{ b.name }}</span>
                  </button>
                }
              }
              @if (filteredRemote().length === 0) {
                <div class="px-3 py-1.5 text-[10px] opacity-40 text-center">
                  No matching remote branches
                </div>
              }
            }
          </div>
        </div>

        <!-- Create new branch -->
        <div class="border-t border-base-300 p-1.5 bg-base-300/30">
          @if (creatingBranch()) {
            <div class="flex items-center gap-1">
              <input
                type="text"
                class="input input-bordered input-xs flex-1 h-6 min-h-0"
                placeholder="New branch name"
                [ngModel]="newBranchName()"
                (ngModelChange)="newBranchName.set($event)"
                (keydown.enter)="onCreateBranch()"
                (keydown.escape)="cancelCreateBranch()"
                aria-label="New branch name"
              />
              <button
                class="btn btn-primary btn-xs"
                [disabled]="!newBranchName().trim() || isCheckingOut()"
                (click)="onCreateBranch()"
              >
                @if (isCheckingOut()) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else {
                  Create
                }
              </button>
              <button
                class="btn btn-ghost btn-xs"
                [disabled]="isCheckingOut()"
                (click)="cancelCreateBranch()"
              >
                Cancel
              </button>
            </div>
          } @else {
            <button
              type="button"
              class="btn btn-ghost btn-xs w-full justify-start gap-1.5"
              (click)="creatingBranch.set(true)"
            >
              <lucide-angular [img]="PlusIcon" class="w-3 h-3" />
              Create new branch
            </button>
          }
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class BranchPickerDropdownComponent {
  protected readonly gitBranches = inject(GitBranchesService);
  private readonly elementRef = inject(ElementRef);

  // ============================================================================
  // INPUTS / OUTPUTS
  // ============================================================================

  readonly isOpen = input.required<boolean>();
  readonly closed = output<void>();
  readonly branchCheckedOut = output<string>();

  // ============================================================================
  // ICONS
  // ============================================================================

  protected readonly GitBranchIcon = GitBranch;
  protected readonly SearchIcon = Search;
  protected readonly CheckIcon = Check;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;

  // ============================================================================
  // STATE
  // ============================================================================

  protected readonly searchQuery = signal('');
  protected readonly isCheckingOut = signal(false);
  protected readonly checkoutError = signal<string | null>(null);
  /** When set to a branch name, the dirty-tree confirm panel is shown. */
  protected readonly showDirtyWarning = signal<string | null>(null);
  protected readonly localExpanded = signal(true);
  protected readonly remoteExpanded = signal(false);
  protected readonly creatingBranch = signal(false);
  protected readonly newBranchName = signal('');

  // ============================================================================
  // FILTERED VIEWS
  // ============================================================================

  /**
   * Lower-case search query used for case-insensitive substring matching.
   * Empty string when no filter is active.
   */
  private readonly searchLc = computed(() =>
    this.searchQuery().trim().toLowerCase(),
  );

  protected readonly filteredLocal = computed<BranchRef[]>(() => {
    const q = this.searchLc();
    const list = this.gitBranches.localBranches();
    if (!q) return list;
    return list.filter((b) => b.name.toLowerCase().includes(q));
  });

  protected readonly filteredRemote = computed<BranchRef[]>(() => {
    const q = this.searchLc();
    const list = this.gitBranches.remoteBranches();
    if (!q) return list;
    return list.filter((b) => b.name.toLowerCase().includes(q));
  });

  protected readonly filteredRecent = computed<string[]>(() => {
    const q = this.searchLc();
    const list = this.gitBranches.recentBranches().slice(0, 5);
    if (!q) return list;
    return list.filter((n) => n.toLowerCase().includes(q));
  });

  /** Group remote branches by their `remote` field for the section headers. */
  protected readonly remoteGroups = computed<
    Array<{ remote: string; branches: BranchRef[] }>
  >(() => {
    const groups = new Map<string, BranchRef[]>();
    for (const b of this.filteredRemote()) {
      const key = b.remote ?? 'origin';
      const existing = groups.get(key);
      if (existing) {
        existing.push(b);
      } else {
        groups.set(key, [b]);
      }
    }
    return Array.from(groups.entries()).map(([remote, branches]) => ({
      remote,
      branches,
    }));
  });

  // ============================================================================
  // OUTSIDE-CLICK
  // ============================================================================

  /**
   * Close the dropdown when the user clicks anywhere outside its host element.
   * The host listener fires on every document click so we only act when the
   * dropdown is currently open.
   */
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target;
    if (
      target instanceof Node &&
      !this.elementRef.nativeElement.contains(target)
    ) {
      this.closed.emit();
    }
  }

  // ============================================================================
  // CHECKOUT FLOW
  // ============================================================================

  protected async onCheckoutClick(branchName: string): Promise<void> {
    if (!branchName) return;
    this.checkoutError.set(null);
    this.isCheckingOut.set(true);
    const result = await this.gitBranches.checkout({
      branch: branchName,
      force: false,
    });
    this.isCheckingOut.set(false);
    this.handleCheckoutResult(result, branchName, /* wasForce */ false);
  }

  protected async confirmForceCheckout(branchName: string): Promise<void> {
    this.checkoutError.set(null);
    this.isCheckingOut.set(true);
    const result = await this.gitBranches.checkout({
      branch: branchName,
      force: true,
    });
    this.isCheckingOut.set(false);
    this.handleCheckoutResult(result, branchName, /* wasForce */ true);
  }

  protected cancelDirtyWarning(): void {
    this.showDirtyWarning.set(null);
  }

  protected async onCreateBranch(): Promise<void> {
    const name = this.newBranchName().trim();
    if (!name) return;
    this.checkoutError.set(null);
    this.isCheckingOut.set(true);
    const result = await this.gitBranches.checkout({
      branch: name,
      createNew: true,
    });
    this.isCheckingOut.set(false);
    if (result.success) {
      this.newBranchName.set('');
      this.creatingBranch.set(false);
    }
    this.handleCheckoutResult(result, name, /* wasForce */ false);
  }

  protected cancelCreateBranch(): void {
    this.creatingBranch.set(false);
    this.newBranchName.set('');
  }

  /**
   * Common post-checkout handling. Surfaces the dirty-tree confirm UI when the
   * backend reports the working tree was dirty and the user did not pass
   * `force=true`. On success, records the branch as recently visited and emits
   * the close + checkedOut outputs.
   */
  private handleCheckoutResult(
    result: GitCheckoutResult,
    branchName: string,
    wasForce: boolean,
  ): void {
    if (result.success) {
      this.gitBranches.recordVisitedBranch(branchName);
      this.showDirtyWarning.set(null);
      this.branchCheckedOut.emit(branchName);
      this.closed.emit();
      return;
    }
    if (result.dirty && !wasForce) {
      this.showDirtyWarning.set(branchName);
      return;
    }
    this.checkoutError.set(result.error ?? 'Failed to checkout');
  }
}
