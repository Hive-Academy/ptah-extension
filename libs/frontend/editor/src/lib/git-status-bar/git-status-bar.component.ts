import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  GitBranch,
  ArrowUp,
  ArrowDown,
  FileEdit,
  GitFork,
  Plus,
} from 'lucide-angular';
import { GitStatusService } from '../services/git-status.service';
import { WorktreeService } from '../services/worktree.service';
import { AddWorktreeDialogComponent } from '../worktree/add-worktree-dialog.component';

/**
 * GitStatusBarComponent - Horizontal bar showing git branch info, ahead/behind counts,
 * changed file count, worktree indicator, and add-worktree action.
 *
 * Complexity Level: 2 (Medium - delegates to two services, toggles dialog visibility)
 * Patterns: Standalone component, OnPush, signal-based delegation, composition
 *
 * Renders only when the active workspace is a git repository (isGitRepo guard).
 * Placed between the editor toolbar and the content area in EditorPanelComponent.
 *
 * Worktree integration (TASK_2025_227 Batch 6):
 * - Loads worktrees on init via WorktreeService
 * - Shows worktree count with GitFork icon when > 1
 * - Provides "Add Worktree" button that toggles the AddWorktreeDialogComponent
 */
@Component({
  selector: 'ptah-git-status-bar',
  standalone: true,
  imports: [LucideAngularModule, AddWorktreeDialogComponent],
  template: `
    @if (gitStatus.isGitRepo()) {
      <div
        class="flex items-center gap-3 h-7 px-3 bg-base-200 border-b border-base-content/10
               text-xs select-none flex-shrink-0"
        role="status"
        aria-label="Git status"
      >
        <!-- Branch name -->
        <div class="flex items-center gap-1 opacity-80">
          <lucide-angular
            [img]="GitBranchIcon"
            class="w-3.5 h-3.5"
            aria-hidden="true"
          />
          <span
            class="font-medium truncate max-w-[160px]"
            [title]="gitStatus.branchName()"
          >
            {{ gitStatus.branchName() }}
          </span>
        </div>

        <!-- Worktree count indicator (only when more than 1 worktree) -->
        @if (worktreeCount() > 1) {
          <div
            class="flex items-center gap-0.5 opacity-60"
            [title]="worktreeCount() + ' active worktrees'"
          >
            <lucide-angular
              [img]="GitForkIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            <span>{{ worktreeCount() }}</span>
          </div>
        }

        <!-- Ahead/Behind indicators (only when tracking an upstream) -->
        @if (gitStatus.branch().upstream) {
          @if (gitStatus.branch().ahead > 0) {
            <div
              class="flex items-center gap-0.5 text-info"
              [title]="
                gitStatus.branch().ahead +
                ' commit(s) ahead of ' +
                gitStatus.branch().upstream
              "
            >
              <lucide-angular
                [img]="ArrowUpIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              <span>{{ gitStatus.branch().ahead }}</span>
            </div>
          }
          @if (gitStatus.branch().behind > 0) {
            <div
              class="flex items-center gap-0.5 text-warning"
              [title]="
                gitStatus.branch().behind +
                ' commit(s) behind ' +
                gitStatus.branch().upstream
              "
            >
              <lucide-angular
                [img]="ArrowDownIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              <span>{{ gitStatus.branch().behind }}</span>
            </div>
          }
        }

        <!-- Changed files count -->
        @if (gitStatus.hasChanges()) {
          <div
            class="flex items-center gap-1 ml-auto opacity-80"
            [title]="gitStatus.changedFileCount() + ' changed file(s)'"
          >
            <lucide-angular
              [img]="FileEditIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            <span>{{ gitStatus.changedFileCount() }}</span>
          </div>
        }

        <!-- Add Worktree button (pushed to the right if no changed files) -->
        <button
          type="button"
          class="btn btn-ghost btn-xs h-5 min-h-0 px-1 opacity-60 hover:opacity-100"
          [class.ml-auto]="!gitStatus.hasChanges()"
          title="Add worktree"
          aria-label="Add worktree"
          (click)="toggleAddWorktreeDialog()"
        >
          <lucide-angular [img]="PlusIcon" class="w-3 h-3" aria-hidden="true" />
          <lucide-angular
            [img]="GitForkIcon"
            class="w-3 h-3"
            aria-hidden="true"
          />
        </button>
      </div>

      <!-- Add Worktree Dialog (conditionally rendered) -->
      @if (showAddWorktreeDialog()) {
        <ptah-add-worktree-dialog
          (worktreeCreated)="onWorktreeCreated()"
          (cancelled)="onWorktreeDialogCancelled()"
        />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitStatusBarComponent {
  protected readonly gitStatus = inject(GitStatusService);
  private readonly worktreeService = inject(WorktreeService);

  // ============================================================================
  // ICONS
  // ============================================================================

  protected readonly GitBranchIcon = GitBranch;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly ArrowDownIcon = ArrowDown;
  protected readonly FileEditIcon = FileEdit;
  protected readonly GitForkIcon = GitFork;
  protected readonly PlusIcon = Plus;

  // ============================================================================
  // WORKTREE STATE
  // ============================================================================

  /** Whether the add-worktree dialog is visible. */
  readonly showAddWorktreeDialog = signal(false);

  /** Number of active worktrees, derived from WorktreeService. */
  readonly worktreeCount = computed(
    () => this.worktreeService.worktrees().length,
  );

  constructor() {
    // Load worktrees on init so the count indicator is populated
    this.worktreeService.loadWorktrees();
  }

  // ============================================================================
  // DIALOG ACTIONS
  // ============================================================================

  /** Toggle the add-worktree dialog visibility. */
  toggleAddWorktreeDialog(): void {
    this.showAddWorktreeDialog.update((v) => !v);
  }

  /** Handle successful worktree creation: close dialog and refresh list. */
  onWorktreeCreated(): void {
    this.showAddWorktreeDialog.set(false);
    // WorktreeService already refreshed the list in addWorktree()
  }

  /** Handle dialog cancellation: close dialog. */
  onWorktreeDialogCancelled(): void {
    this.showAddWorktreeDialog.set(false);
  }
}
