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
import { GitStatusService } from '../services/git-status.service';
import { GitBranchesService } from '../services/git-branches.service';
import { BranchPickerDropdownComponent } from '../branch-picker/branch-picker-dropdown.component';
import { BranchDetailsPopoverComponent } from '../branch-picker/branch-details-popover.component';

/**
 * GitStatusBarComponent — VS Code-style status bar showing branch info,
 * stash indicator, and a push button.
 *
 * Layout (left → right):
 *   [GitBranch icon] [branchName ↑N ↓N] [stash N]   …   [Push]
 *
 * Interactions:
 *   - Click on branch segment → opens {@link BranchPickerDropdownComponent}.
 *   - Right-click on branch segment → opens
 *     {@link BranchDetailsPopoverComponent}.
 *   - Click Push → runs `git push` for the current branch; only shown when
 *     there are unpushed commits (ahead > 0).
 */
@Component({
  selector: 'ptah-git-status-bar',
  standalone: true,
  imports: [
    LucideAngularModule,
    BranchPickerDropdownComponent,
    BranchDetailsPopoverComponent,
  ],
  template: `
    @if (gitStatus.isGitRepo()) {
      <div
        class="relative flex items-center h-7 px-3 bg-base-200 border-b border-base-content/10
               text-xs select-none flex-shrink-0"
        role="status"
        aria-label="Git status"
      >
        <!-- Branch segment (click → picker, right-click → details) -->
        <div class="relative flex items-center">
          <button
            type="button"
            class="flex items-center gap-1.5 text-base-content/80
                   hover:text-base-content hover:bg-base-content/5
                   px-1.5 py-0.5 rounded transition-colors"
            [class.text-primary]="branchPickerOpen() || detailsPopoverOpen()"
            [title]="
              gitBranches.currentBranch() ||
              gitStatus.branchName() ||
              'No branch'
            "
            aria-label="Switch branch"
            (click)="onBranchClick($event)"
            (contextmenu)="onBranchContextMenu($event)"
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
                <span class="text-base-content/40">
                  @if (gitStatus.branch().ahead > 0) {
                    <span class="text-info"
                      >↑{{ gitStatus.branch().ahead }}</span
                    >
                  }
                  @if (gitStatus.branch().behind > 0) {
                    <span class="text-warning"
                      >↓{{ gitStatus.branch().behind }}</span
                    >
                  }
                </span>
              }
            }
          </button>

          <!-- Branch picker dropdown -->
          <ptah-branch-picker-dropdown
            [isOpen]="branchPickerOpen()"
            (closed)="branchPickerOpen.set(false)"
            (branchCheckedOut)="onBranchCheckedOut($event)"
          />

          <!-- Branch details popover -->
          <ptah-branch-details-popover
            [isOpen]="detailsPopoverOpen()"
            (closed)="detailsPopoverOpen.set(false)"
          />
        </div>

        <!-- Stash count -->
        @if (gitBranches.stashCount() > 0) {
          <span
            class="text-[11px] text-base-content/50 px-1 ml-0.5"
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
                   text-[11px] font-medium text-base-content/70
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
export class GitStatusBarComponent {
  protected readonly gitStatus = inject(GitStatusService);
  protected readonly gitBranches = inject(GitBranchesService);

  protected readonly GitBranchIcon = GitBranch;
  protected readonly PushIcon = ArrowUpFromLine;

  /** Whether a `git:push` RPC is currently in flight. */
  protected readonly isPushing = signal(false);

  /** Whether the branch picker dropdown is open. */
  protected readonly branchPickerOpen = signal(false);

  /** Whether the branch details popover is open. */
  protected readonly detailsPopoverOpen = signal(false);

  constructor() {
    this.gitBranches.startListening();
    void this.gitBranches.refreshBranches();
  }

  protected async onPush(): Promise<void> {
    if (this.isPushing()) return;
    this.isPushing.set(true);
    try {
      await this.gitBranches.push();
    } finally {
      this.isPushing.set(false);
    }
  }

  /**
   * Open the branch picker dropdown. Stops propagation so the document-level
   * outside-click listener on the dropdown itself doesn't immediately close
   * it before it has a chance to render.
   */
  protected onBranchClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.detailsPopoverOpen()) this.detailsPopoverOpen.set(false);
    this.branchPickerOpen.update((v) => !v);
  }

  protected onBranchContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.branchPickerOpen()) this.branchPickerOpen.set(false);
    this.detailsPopoverOpen.update((v) => !v);
  }

  protected onBranchCheckedOut(_branchName: string): void {}
}
