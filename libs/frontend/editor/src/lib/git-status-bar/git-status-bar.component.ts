import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import {
  GitBranch,
  LucideAngularModule,
  Terminal as TermIcon,
} from 'lucide-angular';
import { GitStatusService } from '../services/git-status.service';
import { EditorService } from '../services/editor.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitChangedFilesComponent } from './git-changed-files.component';
import { BranchPickerDropdownComponent } from '../branch-picker/branch-picker-dropdown.component';
import { BranchDetailsPopoverComponent } from '../branch-picker/branch-details-popover.component';

/**
 * GitStatusBarComponent — VS Code-style status bar showing branch info,
 * stash indicator, changed-file count, and a terminal toggle.
 *
 * Layout (left → right):
 *   [GitBranch icon] [branchName ↑N ↓N] [stash N]   …   [Δ changedCount] [Terminal]
 *
 * Interactions:
 *   - Click on branch segment → opens {@link BranchPickerDropdownComponent}.
 *   - Right-click on branch segment → opens
 *     {@link BranchDetailsPopoverComponent}.
 *   - Click Δ count → toggles inline changed-files panel.
 *   - Click terminal icon → toggles `EditorService.terminalVisible`.
 *
 * Worktree count and the dropdown were removed in TASK_2026_111 Batch 4 —
 * worktrees are now managed inside the Source Control panel.
 *
 * Wave: TASK_2026_111 Batch 4.
 */
@Component({
  selector: 'ptah-git-status-bar',
  standalone: true,
  imports: [
    LucideAngularModule,
    GitChangedFilesComponent,
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

        <!-- Changed files indicator -->
        @if (gitStatus.hasChanges()) {
          <button
            type="button"
            class="flex items-center gap-1.5 px-2 py-0.5 rounded
                   text-base-content/60 hover:text-base-content hover:bg-base-content/5
                   transition-colors"
            [class.text-primary]="showChangedFiles()"
            [title]="gitStatus.changedFileCount() + ' changed file(s)'"
            (click)="toggleChangedFiles()"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
            <span class="text-[11px]">{{ gitStatus.changedFileCount() }}</span>
          </button>
        }

        <!-- Terminal toggle -->
        <button
          type="button"
          class="btn btn-ghost btn-xs px-1.5 ml-1
                 text-base-content/60 hover:text-base-content"
          [class.text-primary]="editorService.terminalVisible()"
          [title]="
            editorService.terminalVisible() ? 'Hide terminal' : 'Show terminal'
          "
          aria-label="Toggle terminal"
          (click)="onTerminalToggle()"
        >
          <lucide-angular [img]="TerminalIcon" class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Changed files panel (below status bar) -->
      @if (showChangedFiles()) {
        <ptah-git-changed-files
          [files]="gitStatus.files()"
          (fileClicked)="onChangedFileClick($event)"
        />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class GitStatusBarComponent {
  protected readonly gitStatus = inject(GitStatusService);
  protected readonly gitBranches = inject(GitBranchesService);
  protected readonly editorService = inject(EditorService);
  private readonly elementRef = inject(ElementRef);

  // ============================================================================
  // ICONS
  // ============================================================================

  protected readonly GitBranchIcon = GitBranch;
  protected readonly TerminalIcon = TermIcon;

  // ============================================================================
  // STATE
  // ============================================================================

  /** Whether the changed files panel is visible. */
  protected readonly showChangedFiles = signal(false);

  /** Whether the branch picker dropdown is open. */
  protected readonly branchPickerOpen = signal(false);

  /** Whether the branch details popover is open. */
  protected readonly detailsPopoverOpen = signal(false);

  constructor() {
    // Start the branches service listening for git:status-update push events
    // and pull an initial snapshot so the status bar populates without waiting
    // for the first event.
    this.gitBranches.startListening();
    void this.gitBranches.refreshBranches();

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
  // OUTSIDE-CLICK
  // ============================================================================

  /** Close inline panels when clicking outside the component. */
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (
      target instanceof Node &&
      !this.elementRef.nativeElement.contains(target)
    ) {
      if (this.showChangedFiles()) this.showChangedFiles.set(false);
    }
  }

  // ============================================================================
  // ACTIONS
  // ============================================================================

  protected toggleChangedFiles(): void {
    this.showChangedFiles.update((v) => !v);
  }

  protected onTerminalToggle(): void {
    this.editorService.toggleTerminal();
  }

  /**
   * Open the branch picker dropdown. Stops propagation so the document-level
   * outside-click listener on the dropdown itself doesn't immediately close
   * it before it has a chance to render.
   */
  protected onBranchClick(event: MouseEvent): void {
    event.stopPropagation();
    // Mutual exclusion with the details popover.
    if (this.detailsPopoverOpen()) this.detailsPopoverOpen.set(false);
    this.branchPickerOpen.update((v) => !v);
  }

  protected onBranchContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.branchPickerOpen()) this.branchPickerOpen.set(false);
    this.detailsPopoverOpen.update((v) => !v);
  }

  protected onBranchCheckedOut(_branchName: string): void {
    // The git watcher will push a `git:status-update` event after the checkout
    // succeeds, which already triggers a refresh via GitBranchesService. The
    // dropdown closes itself on success, so nothing else is needed here.
  }

  /**
   * Handle file click from the changed files panel.
   * Converts relative git path to absolute path and opens in the editor.
   */
  protected onChangedFileClick(relativePath: string): void {
    const workspaceRoot = this.gitStatus.activeWorkspacePath();
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
}
