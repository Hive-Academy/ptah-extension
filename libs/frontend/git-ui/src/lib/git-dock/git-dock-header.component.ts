import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  ArrowUpFromLine,
  GitBranch,
  LucideAngularModule,
} from 'lucide-angular';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';

/**
 * GitDockHeaderComponent — branch name, ahead/behind, stash count and push,
 * hosted inside {@link GitDockComponent}.
 *
 * A direct port of `git-status-bar.component.ts:40-141` (TASK_2026_385
 * Batch 3.1), minus the branch-picker dropdown and details popover — those 7
 * RPCs stay in the contract for TASK_2026_386, which adds `activeTab` /
 * `tabChange` / `openInRequested` inputs/outputs here. This component ships
 * with none: it reads its state from the two injected services only.
 *
 * Arming `GitStatusService` / `GitBranchesService` is owned by the parent
 * {@link GitDockComponent}, not this component — mirroring how
 * `GitStatusBarComponent`'s constructor used to arm `GitBranchesService`
 * before that responsibility moved up to the dock host.
 */
@Component({
  selector: 'ptah-git-dock-header',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (gitStatus.isGitRepo()) {
      <div
        class="relative flex items-center h-7 px-3 bg-base-200 border-b border-base-content/10
               text-xs select-none flex-shrink-0"
        data-testid="git-dock-header"
        role="status"
        aria-label="Git status"
      >
        <!-- Branch segment (read-only — the picker/details popover are
             TASK_2026_386) -->
        <div
          class="flex items-center gap-1.5 text-base-content-muted px-1.5 py-0.5"
        >
          <lucide-angular
            [img]="GitBranchIcon"
            class="w-3.5 h-3.5 flex-shrink-0 opacity-70"
          />
          <span class="font-medium truncate max-w-[140px]">
            {{ gitBranches.currentBranch() || gitStatus.branchName() }}
          </span>

          <!-- Sync status: ahead/behind inline -->
          @if (gitStatus.branch().upstream) {
            @if (
              gitStatus.branch().ahead > 0 || gitStatus.branch().behind > 0
            ) {
              <span class="text-base-content-muted">
                @if (gitStatus.branch().ahead > 0) {
                  <span class="text-info">↑{{ gitStatus.branch().ahead }}</span>
                }
                @if (gitStatus.branch().behind > 0) {
                  <span class="text-warning"
                    >↓{{ gitStatus.branch().behind }}</span
                  >
                }
              </span>
            }
          }
        </div>

        <!-- Stash count -->
        @if (gitBranches.stashCount() > 0) {
          <span
            class="text-[11px] text-base-content-muted px-1 ml-0.5"
            [title]="gitBranches.stashCount() + ' stash entries'"
          >
            stash {{ gitBranches.stashCount() }}
          </span>
        }

        <!-- Spacer -->
        <span class="ml-auto"></span>

        <!-- Push button (only when there are unpushed commits) -->
        @if (gitStatus.branch().ahead > 0) {
          <button
            type="button"
            data-testid="git-push-button"
            class="flex items-center gap-1.5 h-5 px-2 ml-1 rounded
                   border border-base-content/20 bg-base-100
                   text-[11px] font-medium text-base-content-muted
                   hover:bg-base-content/5 hover:text-base-content
                   active:translate-y-px transition-all disabled:opacity-50"
            [disabled]="isPushing()"
            [title]="
              'Push ' + gitStatus.branch().ahead + ' commit(s) to remote'
            "
            aria-label="Push to remote"
            (click)="onPush()"
          >
            <lucide-angular [img]="PushIcon" class="w-3.5 h-3.5" />
            <span>Push</span>
          </button>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitDockHeaderComponent {
  protected readonly gitStatus = inject(GitStatusService);
  protected readonly gitBranches = inject(GitBranchesService);

  protected readonly GitBranchIcon = GitBranch;
  protected readonly PushIcon = ArrowUpFromLine;

  /** Whether a `git:push` RPC is currently in flight. */
  protected readonly isPushing = signal(false);

  protected async onPush(): Promise<void> {
    if (this.isPushing()) return;
    this.isPushing.set(true);
    try {
      await this.gitBranches.push();
    } finally {
      this.isPushing.set(false);
    }
  }
}
