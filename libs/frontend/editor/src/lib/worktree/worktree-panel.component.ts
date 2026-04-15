import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  GitBranch,
  GitFork,
  FolderOpen,
  Plus,
  Trash2,
  RotateCw,
} from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';
import { WorktreeService } from '../services/worktree.service';
import { EditorService } from '../services/editor.service';
import type { GitWorktreeInfo } from '@ptah-extension/shared';

/**
 * WorktreePanelComponent - Sidebar tab showing all git worktrees with CRUD actions.
 *
 * Complexity Level: 2 (Medium - service injection, dialog state, worktree operations)
 * Patterns: Standalone, OnPush, signal-based state, self-contained dialogs
 *
 * Displays:
 * - List of all worktrees with branch, path, HEAD hash, main/active indicators
 * - Click to switch workspace to that worktree
 * - "Add Worktree" inline form
 * - Remove button per worktree (non-main only, with confirmation)
 * - Refresh button to reload worktree list
 */
@Component({
  selector: 'ptah-worktree-panel',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div
      class="flex flex-col h-full overflow-y-auto scrollbar-thin"
      role="region"
      aria-label="Git Worktrees"
    >
      <!-- Header with actions -->
      <div
        class="flex items-center gap-1 px-2 py-1.5 border-b border-base-300 flex-shrink-0"
      >
        <span
          class="text-[10px] font-semibold uppercase tracking-wider opacity-50 flex-1"
        >
          Worktrees ({{ worktreeService.worktreeCount() }})
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0"
          title="Refresh worktrees"
          aria-label="Refresh worktrees"
          [disabled]="worktreeService.isLoading()"
          (click)="onRefresh()"
        >
          <lucide-angular
            [img]="RefreshIcon"
            class="w-3.5 h-3.5"
            [class.animate-spin]="worktreeService.isLoading()"
          />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0"
          title="Add worktree"
          aria-label="Add worktree"
          (click)="showAddForm.set(!showAddForm())"
        >
          <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Add worktree inline form -->
      @if (showAddForm()) {
        <div class="p-2 border-b border-base-300 flex-shrink-0 bg-base-300/30">
          <input
            type="text"
            class="input input-bordered input-xs w-full mb-1.5"
            placeholder="Branch name"
            [ngModel]="newBranch()"
            (ngModelChange)="newBranch.set($event)"
            (keydown.enter)="onAddWorktree()"
            (keydown.escape)="closeAddForm()"
          />
          <input
            type="text"
            class="input input-bordered input-xs w-full mb-1.5"
            placeholder="Custom path (optional)"
            [ngModel]="newPath()"
            (ngModelChange)="newPath.set($event)"
            (keydown.enter)="onAddWorktree()"
            (keydown.escape)="closeAddForm()"
          />
          <label
            class="flex items-center gap-1.5 text-[10px] mb-2 cursor-pointer"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              [ngModel]="newCreateBranch()"
              (ngModelChange)="newCreateBranch.set($event)"
            />
            Create new branch
          </label>
          @if (addError()) {
            <p class="text-error text-[10px] mb-1">{{ addError() }}</p>
          }
          <div class="flex gap-1">
            <button
              class="btn btn-primary btn-xs flex-1"
              [disabled]="!newBranch().trim() || isAdding()"
              (click)="onAddWorktree()"
            >
              @if (isAdding()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                Create
              }
            </button>
            <button class="btn btn-ghost btn-xs" (click)="closeAddForm()">
              Cancel
            </button>
          </div>
        </div>
      }

      <!-- Worktree list -->
      @if (
        worktreeService.isLoading() && worktreeService.worktrees().length === 0
      ) {
        <div class="flex items-center justify-center py-6">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      } @else if (worktreeService.worktrees().length === 0) {
        <div class="px-3 py-4 text-xs opacity-40 text-center">
          No worktrees found
        </div>
      } @else {
        @for (wt of worktreeService.worktrees(); track wt.path) {
          <button
            type="button"
            class="group flex items-start gap-2 w-full px-2 py-2 text-left
                   hover:bg-base-content/10 transition-colors border-b border-base-content/5"
            [class.bg-primary/10]="isActiveWorktree(wt)"
            [title]="'Switch to ' + wt.path"
            (click)="onWorktreeSelect(wt)"
          >
            <lucide-angular
              [img]="wt.isMain ? GitBranchIcon : FolderOpenIcon"
              class="w-4 h-4 flex-shrink-0 mt-0.5"
              [class.text-primary]="isActiveWorktree(wt)"
              [class.opacity-50]="!isActiveWorktree(wt)"
              aria-hidden="true"
            />
            <div class="flex flex-col min-w-0 flex-1 gap-0.5">
              <div class="flex items-center gap-1">
                <span
                  class="text-xs font-medium truncate"
                  [class.text-primary]="isActiveWorktree(wt)"
                >
                  {{ extractBranchName(wt.branch) }}
                </span>
                @if (wt.isMain) {
                  <span
                    class="text-[9px] px-1 py-0.5 rounded bg-base-content/10 text-base-content/50 flex-shrink-0"
                    >main</span
                  >
                }
                @if (isActiveWorktree(wt)) {
                  <span
                    class="text-[9px] px-1 py-0.5 rounded bg-primary/20 text-primary flex-shrink-0"
                    >active</span
                  >
                }
              </div>
              <span class="text-[10px] opacity-40 truncate">{{ wt.path }}</span>
              @if (wt.head) {
                <span class="text-[10px] font-mono opacity-30 truncate">
                  {{ wt.head }}
                </span>
              }
            </div>

            <!-- Remove button (hidden for main worktree) -->
            @if (!wt.isMain) {
              <button
                type="button"
                class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0
                       opacity-0 group-hover:opacity-60 hover:!opacity-100
                       hover:text-error transition-all flex-shrink-0 mt-0.5"
                title="Remove worktree"
                aria-label="Remove worktree"
                (click)="onRemoveClick($event, wt)"
              >
                <lucide-angular [img]="TrashIcon" class="w-3.5 h-3.5" />
              </button>
            }
          </button>
        }
      }

      <!-- Remove confirmation -->
      @if (removeTarget()) {
        <div class="p-2 border-t border-base-300 bg-error/5 flex-shrink-0">
          <p class="text-[10px] text-error mb-2">
            Remove worktree
            <strong>{{ extractBranchName(removeTarget()!.branch) }}</strong
            >?
          </p>
          @if (removeError()) {
            <p class="text-error text-[10px] mb-1">{{ removeError() }}</p>
          }
          <div class="flex gap-1">
            <button
              class="btn btn-error btn-xs flex-1"
              [disabled]="isRemoving()"
              (click)="onConfirmRemove(false)"
            >
              @if (isRemoving()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                Remove
              }
            </button>
            <button
              class="btn btn-warning btn-xs flex-1"
              [disabled]="isRemoving()"
              (click)="onConfirmRemove(true)"
            >
              Force
            </button>
            <button
              class="btn btn-ghost btn-xs"
              (click)="removeTarget.set(null)"
            >
              Cancel
            </button>
          </div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreePanelComponent {
  protected readonly worktreeService = inject(WorktreeService);
  private readonly editorService = inject(EditorService);
  private readonly layoutService = inject(ElectronLayoutService);

  // Icons
  protected readonly GitBranchIcon = GitBranch;
  protected readonly GitForkIcon = GitFork;
  protected readonly FolderOpenIcon = FolderOpen;
  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;
  protected readonly RefreshIcon = RotateCw;

  // Add form state
  protected readonly showAddForm = signal(false);
  protected readonly newBranch = signal('');
  protected readonly newPath = signal('');
  protected readonly newCreateBranch = signal(false);
  protected readonly isAdding = signal(false);
  protected readonly addError = signal('');

  // Remove state
  protected readonly removeTarget = signal<GitWorktreeInfo | null>(null);
  protected readonly isRemoving = signal(false);
  protected readonly removeError = signal('');

  protected isActiveWorktree(wt: GitWorktreeInfo): boolean {
    const activeRoot = this.editorService.activeWorkspacePath;
    if (!activeRoot) return wt.isMain;
    const normalizedActive = activeRoot.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedWt = wt.path.replace(/\\/g, '/').replace(/\/$/, '');
    return normalizedActive === normalizedWt;
  }

  protected extractBranchName(branch: string | undefined): string {
    if (!branch) return '(detached)';
    return branch;
  }

  protected onWorktreeSelect(wt: GitWorktreeInfo): void {
    void this.layoutService.addFolderByPath(wt.path);
  }

  protected onRefresh(): void {
    void this.worktreeService.loadWorktrees();
  }

  // Add worktree
  protected async onAddWorktree(): Promise<void> {
    const branch = this.newBranch().trim();
    if (!branch) return;

    this.isAdding.set(true);
    this.addError.set('');

    const result = await this.worktreeService.addWorktree(branch, {
      path: this.newPath().trim() || undefined,
      createBranch: this.newCreateBranch(),
    });

    this.isAdding.set(false);

    if (result.success) {
      this.closeAddForm();
    } else {
      this.addError.set(result.error || 'Failed to create worktree');
    }
  }

  protected closeAddForm(): void {
    this.showAddForm.set(false);
    this.newBranch.set('');
    this.newPath.set('');
    this.newCreateBranch.set(false);
    this.addError.set('');
  }

  // Remove worktree
  protected onRemoveClick(event: MouseEvent, wt: GitWorktreeInfo): void {
    event.stopPropagation();
    this.removeTarget.set(wt);
    this.removeError.set('');
  }

  protected async onConfirmRemove(force: boolean): Promise<void> {
    const target = this.removeTarget();
    if (!target) return;

    this.isRemoving.set(true);
    this.removeError.set('');

    const result = await this.worktreeService.removeWorktree(
      target.path,
      force,
    );

    this.isRemoving.set(false);

    if (result.success) {
      this.removeTarget.set(null);
    } else {
      this.removeError.set(result.error || 'Failed to remove worktree');
    }
  }
}
