import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  ElementRef,
} from '@angular/core';
import {
  LucideAngularModule,
  GitBranch,
  ArrowUp,
  ArrowDown,
  FileEdit,
  GitFork,
  Plus,
  FolderOpen,
} from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';
import { GitStatusService } from '../services/git-status.service';
import { EditorService } from '../services/editor.service';
import { WorktreeService } from '../services/worktree.service';
import { AddWorktreeDialogComponent } from '../worktree/add-worktree-dialog.component';
import { GitChangedFilesComponent } from './git-changed-files.component';
import type { GitWorktreeInfo } from '@ptah-extension/shared';

/**
 * GitStatusBarComponent - Horizontal bar showing git branch info, ahead/behind counts,
 * changed file count, worktree indicator with dropdown, and add-worktree action.
 *
 * Complexity Level: 2 (Medium - delegates to two services, toggles dialog/dropdown visibility)
 * Patterns: Standalone component, OnPush, signal-based delegation, composition
 *
 * Renders only when the active workspace is a git repository (isGitRepo guard).
 * Placed between the editor toolbar and the content area in EditorPanelComponent.
 *
 * Worktree integration (TASK_2025_227 Batch 6):
 * - Loads worktrees on init via WorktreeService
 * - Shows worktree count with GitFork icon when > 1 (clickable dropdown)
 * - Clicking a worktree in the dropdown switches the file explorer to show its files
 * - Provides "Add Worktree" button that toggles the AddWorktreeDialogComponent
 */
@Component({
  selector: 'ptah-git-status-bar',
  standalone: true,
  imports: [
    LucideAngularModule,
    AddWorktreeDialogComponent,
    GitChangedFilesComponent,
  ],
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

        <!-- Worktree count indicator (clickable when > 1 to show dropdown) -->
        @if (worktreeCount() > 1) {
          <div class="relative">
            <button
              type="button"
              class="flex items-center gap-0.5 opacity-60 hover:opacity-100
                     cursor-pointer transition-opacity"
              [title]="worktreeCount() + ' active worktrees — click to browse'"
              aria-label="Show worktree list"
              [attr.aria-expanded]="showWorktreeList()"
              (click)="toggleWorktreeList()"
            >
              <lucide-angular
                [img]="GitForkIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              <span>{{ worktreeCount() }}</span>
            </button>

            <!-- Worktree dropdown list -->
            @if (showWorktreeList()) {
              <div
                class="absolute left-0 top-full mt-1 z-50 min-w-[280px] max-w-[400px]
                       bg-base-300 border border-base-content/10 rounded-lg shadow-lg
                       py-1 text-xs"
                role="listbox"
                aria-label="Worktree list"
              >
                <div
                  class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider
                         opacity-50 border-b border-base-content/5"
                >
                  Git Worktrees
                </div>
                @for (wt of worktreeService.worktrees(); track wt.path) {
                  <button
                    type="button"
                    class="flex items-center gap-2 w-full px-3 py-1.5 text-left
                           hover:bg-base-content/10 transition-colors"
                    [class.bg-primary]="wt.isMain"
                    [class.bg-opacity-10]="wt.isMain"
                    role="option"
                    [attr.aria-selected]="wt.isMain"
                    [title]="'Open ' + wt.path + ' in file explorer'"
                    (click)="onWorktreeSelect(wt)"
                  >
                    <lucide-angular
                      [img]="wt.isMain ? GitBranchIcon : FolderOpenIcon"
                      class="w-3.5 h-3.5 flex-shrink-0 opacity-60"
                      aria-hidden="true"
                    />
                    <div class="flex flex-col min-w-0 gap-0.5">
                      <span class="font-medium truncate">
                        {{ extractBranchName(wt.branch) }}
                        @if (wt.isMain) {
                          <span class="text-primary opacity-70 ml-1"
                            >(main)</span
                          >
                        }
                      </span>
                      <span class="opacity-40 truncate text-[10px]">{{
                        wt.path
                      }}</span>
                    </div>
                  </button>
                }
              </div>
            }
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

        <!-- Changed files count (clickable to toggle changed files panel) -->
        @if (gitStatus.hasChanges()) {
          <button
            type="button"
            class="flex items-center gap-1 ml-auto opacity-80 hover:opacity-100
                   cursor-pointer transition-opacity"
            [class.text-primary]="showChangedFiles()"
            [title]="
              gitStatus.changedFileCount() +
              ' changed file(s) — click to browse'
            "
            aria-label="Toggle changed files panel"
            [attr.aria-expanded]="showChangedFiles()"
            (click)="toggleChangedFiles()"
          >
            <lucide-angular
              [img]="FileEditIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            <span>{{ gitStatus.changedFileCount() }}</span>
          </button>
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

      <!-- Changed files panel (below status bar) -->
      @if (showChangedFiles()) {
        <ptah-git-changed-files
          [files]="gitStatus.files()"
          (fileClicked)="onChangedFileClick($event)"
        />
      }

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
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class GitStatusBarComponent {
  protected readonly gitStatus = inject(GitStatusService);
  protected readonly worktreeService = inject(WorktreeService);
  private readonly editorService = inject(EditorService);
  private readonly layoutService = inject(ElectronLayoutService);
  private readonly elementRef = inject(ElementRef);

  /** Close dropdowns/panels when clicking outside the component. */
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (
      target instanceof Node &&
      !this.elementRef.nativeElement.contains(target)
    ) {
      if (this.showWorktreeList()) this.showWorktreeList.set(false);
      if (this.showChangedFiles()) this.showChangedFiles.set(false);
    }
  }

  // ============================================================================
  // ICONS
  // ============================================================================

  protected readonly GitBranchIcon = GitBranch;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly ArrowDownIcon = ArrowDown;
  protected readonly FileEditIcon = FileEdit;
  protected readonly GitForkIcon = GitFork;
  protected readonly PlusIcon = Plus;
  protected readonly FolderOpenIcon = FolderOpen;

  // ============================================================================
  // WORKTREE STATE
  // ============================================================================

  /** Whether the changed files panel is visible. */
  protected readonly showChangedFiles = signal(false);

  /** Whether the add-worktree dialog is visible. */
  protected readonly showAddWorktreeDialog = signal(false);

  /** Whether the worktree list dropdown is visible. */
  protected readonly showWorktreeList = signal(false);

  /** Number of active worktrees, derived from WorktreeService. */
  protected readonly worktreeCount = computed(
    () => this.worktreeService.worktrees().length,
  );

  constructor() {
    // Load worktrees on init so the count indicator is populated
    this.worktreeService.loadWorktrees();

    // Auto-close changed files panel when all changes are resolved
    effect(
      () => {
        if (!this.gitStatus.hasChanges()) {
          this.showChangedFiles.set(false);
        }
      },
      { allowSignalWrites: true },
    );
  }

  // ============================================================================
  // WORKTREE LIST ACTIONS
  // ============================================================================

  /** Toggle the worktree list dropdown. */
  protected toggleWorktreeList(): void {
    this.showWorktreeList.update((v) => !v);
  }

  /**
   * Handle worktree selection from the dropdown.
   * Adds the worktree as a workspace folder and switches to it,
   * which triggers the file tree to reload with the worktree's files.
   */
  protected onWorktreeSelect(worktree: GitWorktreeInfo): void {
    this.showWorktreeList.set(false);
    if (worktree.path) {
      void this.layoutService.addFolderByPath(worktree.path);
    }
  }

  /**
   * Display-friendly branch name with fallback for detached HEAD.
   * parseWorktreeList() already strips refs/heads/ prefix, so this
   * is purely a null/detached-state fallback.
   */
  protected extractBranchName(branch: string | undefined): string {
    if (!branch) return '(detached)';
    return branch;
  }

  // ============================================================================
  // CHANGED FILES PANEL ACTIONS
  // ============================================================================

  /** Toggle the changed files panel visibility. */
  protected toggleChangedFiles(): void {
    this.showChangedFiles.update((v) => !v);
  }

  /**
   * Handle file click from the changed files panel.
   * Converts relative git path to absolute path and opens in the editor.
   */
  protected onChangedFileClick(relativePath: string): void {
    const workspaceRoot = this.gitStatus.activeWorkspacePath;
    if (!workspaceRoot) return;

    // Guard against path traversal — validate each segment individually.
    // Git status paths are always relative with forward slashes, never absolute.
    const normalized = relativePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    const isAbsolute =
      normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized);
    const hasTraversal = segments.some((s) => s === '..' || s === '.');
    if (isAbsolute || hasTraversal || segments.length === 0) return;

    // Build absolute path from workspace root + relative path
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
    const root = normalizedRoot.endsWith('/')
      ? normalizedRoot
      : normalizedRoot + '/';
    const absolutePath = root + normalized;

    void this.editorService.openFile(absolutePath);
  }

  // ============================================================================
  // DIALOG ACTIONS
  // ============================================================================

  /** Toggle the add-worktree dialog visibility. */
  protected toggleAddWorktreeDialog(): void {
    this.showAddWorktreeDialog.update((v) => !v);
  }

  /** Handle successful worktree creation: close dialog and refresh list. */
  protected onWorktreeCreated(): void {
    this.showAddWorktreeDialog.set(false);
    // WorktreeService already refreshed the list in addWorktree()
  }

  /** Handle dialog cancellation: close dialog. */
  protected onWorktreeDialogCancelled(): void {
    this.showAddWorktreeDialog.set(false);
  }
}
