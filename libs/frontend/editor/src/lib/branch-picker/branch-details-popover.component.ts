import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import {
  Database,
  GitBranch,
  GitCommit,
  Globe,
  LucideAngularModule,
} from 'lucide-angular';
import { GitBranchesService } from '../services/git-branches.service';

/**
 * BranchDetailsPopoverComponent — small absolute-positioned popover that
 * surfaces last-commit metadata, current branch, stash count, and the first
 * configured remote URL. Triggered from a right-click on the branch segment
 * in the git status bar.
 *
 * Lazy fetches: when `isOpen` becomes true, this component asks
 * `GitBranchesService` to refresh remotes (and tags) so the data is fresh
 * without paying the cost on every status update.
 */
@Component({
  selector: 'ptah-branch-details-popover',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (isOpen()) {
      <div
        class="absolute top-full right-0 mt-1 z-50 min-w-[300px] max-w-[420px]
               bg-base-200 border border-base-300 rounded shadow-lg p-3
               text-xs select-text"
        role="dialog"
        aria-label="Branch details"
      >
        <!-- Current branch -->
        <div class="flex items-center gap-2 mb-2">
          <lucide-angular
            [img]="GitBranchIcon"
            class="w-4 h-4 text-primary flex-shrink-0"
          />
          <span class="font-medium truncate">
            {{ gitBranches.currentBranch() || '(no branch)' }}
          </span>
          @if (stashCount() > 0) {
            <span
              class="ml-auto text-[10px] px-1.5 py-0.5 rounded
                     bg-base-300 text-base-content/70 flex-shrink-0"
              [title]="stashCount() + ' stash entries'"
            >
              <lucide-angular
                [img]="DatabaseIcon"
                class="w-3 h-3 inline-block mr-0.5"
              />
              stash {{ stashCount() }}
            </span>
          }
        </div>

        <!-- Last commit -->
        @if (lastCommit(); as commit) {
          <div class="border-t border-base-300 pt-2 mb-2">
            <div class="flex items-center gap-1.5 mb-1">
              <lucide-angular
                [img]="GitCommitIcon"
                class="w-3.5 h-3.5 opacity-50 flex-shrink-0"
              />
              <span
                class="text-[10px] font-mono opacity-60 flex-shrink-0"
                [title]="commit.hash"
              >
                {{ commit.shortHash }}
              </span>
              <span class="text-[10px] opacity-40 ml-auto flex-shrink-0">
                {{ formatRelativeTime(commit.time) }}
              </span>
            </div>
            <p class="text-[11px] mb-1 line-clamp-2">{{ commit.subject }}</p>
            <p class="text-[10px] opacity-60 truncate">
              {{ commit.author }}
            </p>
          </div>
        } @else {
          <div
            class="border-t border-base-300 pt-2 mb-2 text-[10px] opacity-40
                   text-center py-1"
          >
            No commits yet
          </div>
        }

        <!-- First remote -->
        @if (firstRemote(); as remote) {
          <div class="border-t border-base-300 pt-2">
            <div class="flex items-center gap-1.5">
              <lucide-angular
                [img]="GlobeIcon"
                class="w-3.5 h-3.5 opacity-50 flex-shrink-0"
              />
              <span class="text-[10px] opacity-60 flex-shrink-0">
                {{ remote.name }}
              </span>
              <span
                class="text-[10px] opacity-40 truncate ml-auto"
                [title]="remote.fetchUrl"
              >
                {{ remote.fetchUrl }}
              </span>
            </div>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class BranchDetailsPopoverComponent {
  protected readonly gitBranches = inject(GitBranchesService);
  private readonly elementRef = inject(ElementRef);

  readonly isOpen = input.required<boolean>();
  readonly closed = output<void>();

  // ============================================================================
  // ICONS
  // ============================================================================

  protected readonly GitBranchIcon = GitBranch;
  protected readonly GitCommitIcon = GitCommit;
  protected readonly GlobeIcon = Globe;
  protected readonly DatabaseIcon = Database;

  // ============================================================================
  // DATA
  // ============================================================================

  protected readonly stashCount = this.gitBranches.stashCount;
  protected readonly lastCommit = this.gitBranches.lastCommit;
  protected readonly firstRemote = computed(() => {
    const list = this.gitBranches.remotes();
    return list.length > 0 ? list[0] : null;
  });

  constructor() {
    // Lazy refresh when the popover opens — keeps the hot status-bar refresh
    // path cheap and only pulls remotes/tags on-demand.
    effect(() => {
      if (this.isOpen()) {
        void this.gitBranches.refreshRemotes();
      }
    });
  }

  // ============================================================================
  // OUTSIDE-CLICK
  // ============================================================================

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
  // FORMATTING
  // ============================================================================

  /**
   * Convert a Unix-ms timestamp into a short relative-time string. Mirrors
   * the simple "Nm/h/d ago" style used by the rest of the app — no intl
   * dependency to keep the bundle slim.
   */
  protected formatRelativeTime(ms: number | undefined): string {
    if (!ms || ms <= 0) return '';
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 0) return 'just now';
    if (diffSec < 60) return diffSec + 's ago';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return diffDay + 'd ago';
    const diffMon = Math.floor(diffDay / 30);
    if (diffMon < 12) return diffMon + 'mo ago';
    const diffYr = Math.floor(diffMon / 12);
    return diffYr + 'y ago';
  }
}
