import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { DiffViewComponent } from '../diff-view/diff-view.component';
import { SourceControlPanelComponent } from '../source-control/source-control-panel.component';
import { DiffTabsService } from '../services/diff-tabs.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';
import { GitDockHeaderComponent } from './git-dock-header.component';
import { GitReviewToolbarComponent } from '../review/git-review-toolbar.component';
import { GitReviewPanelComponent } from '../review/git-review-panel.component';
import { GitReviewService } from '../services/git-review.service';
import { EditorLauncherService } from '../services/editor-launcher.service';
import type { OpenInRequest } from '../open-in/open-in-button.component';
import { ElectronLayoutService } from '@ptah-extension/core';
import { RailResizeHandleComponent } from './rail-resize-handle.component';
import { FileViewComponent } from '../file-view/file-view.component';

/**
 * GitDockComponent — live host for the git surface in the Electron shell's
 * right dock (TASK_2026_385 Batch 3.1, Component 9).
 *
 * **Arming.** The constructor arms both `GitStatusService.startListening()`
 * and `GitBranchesService.startListening()` + `refreshBranches()`, and
 * `destroyRef.onDestroy` disarms both. This replaces the arming that used to
 * live in `editor-panel.component.ts` (`ngOnInit`/`ngOnDestroy`) and
 * `git-status-bar.component.ts`'s constructor — until this component mounts,
 * `git-status.service.ts`'s push gate has no armer in the Electron shell.
 * `startListening()` performs an eager fetch, which is what makes re-arming
 * after a dock close idempotent (closing and reopening the dock reconciles
 * instead of dropping every push that arrived while it was shut).
 *
 * **Body.** Hosts the header, the source-control panel (file list, stage /
 * unstage / commit) and the diff view, shown only when a diff tab is active.
 * A file-name click routes to the `file:open` RPC (TASK_2026_386's external
 * editor launch), matching the source-control panel's `fileClicked` output.
 *
 * The header hosts the branch picker and details popover; this component owns
 * their lifecycle through the header while keeping rendering isolated.
 */
@Component({
  selector: 'ptah-git-dock',
  standalone: true,
  host: { class: 'block h-full w-full' },
  imports: [
    GitDockHeaderComponent,
    SourceControlPanelComponent,
    DiffViewComponent,
    GitReviewToolbarComponent,
    GitReviewPanelComponent,
    RailResizeHandleComponent,
    FileViewComponent,
  ],
  template: `
    <div class="flex flex-col h-full" data-testid="git-dock">
      <ptah-git-dock-header />
      <ptah-git-review-toolbar />

      @if (
        !gitStatus.isLoading() &&
        gitStatus.isGitRepo() &&
        review.mode() === 'branch-review'
      ) {
        <ptah-git-review-panel
          [workspaceRoot]="gitStatus.activeWorkspacePath() ?? ''"
        />
      } @else {
        <div class="flex-1 min-h-0 flex overflow-hidden">
          @if (
            !gitStatus.isLoading() &&
            gitStatus.isGitRepo() &&
            !layout.gitRailCollapsed()
          ) {
            <div
              id="git-source-control-rail"
              class="flex-shrink-0 border-r border-base-content/10 overflow-hidden"
              [style.width.px]="layout.gitRailWidth()"
              style="max-width: calc(100% - 12rem)"
            >
              <ptah-source-control-panel
                [files]="gitStatus.files()"
                [editorTargets]="launchers.targets()"
                [workspaceRoot]="gitStatus.activeWorkspacePath() ?? ''"
                (diffRequested)="diffTabs.openDiff($event)"
                (fileClicked)="onFileClicked($event)"
              />
            </div>
            <ptah-git-rail-resize-handle
              [width]="layout.gitRailWidth()"
              [min]="160"
              [max]="480"
              (widthChange)="layout.setGitRailWidth($event)"
              (widthCommit)="layout.commitGitRailWidth()"
            />
          } @else if (!diffTabs.activeDiffTab()) {
            <div
              class="flex-1 p-4 text-sm"
              [class.opacity-60]="!gitStatus.isLoading()"
            >
              @if (gitStatus.isLoading()) {
                Loading repository…
              } @else if (!gitStatus.isGitRepo()) {
                The active workspace is not a Git repository.
              }
            </div>
          }

          @if (diffTabs.activeDiffTab(); as activeDiffTab) {
            <div
              class="flex-1 min-w-0 flex flex-col overflow-hidden"
              data-testid="git-dock-content"
            >
              <div
                class="flex flex-shrink-0 overflow-x-auto border-b border-base-content/10 bg-base-200"
                role="tablist"
                aria-label="Open diffs"
                aria-orientation="horizontal"
              >
                @for (
                  tab of diffTabs.diffTabs();
                  track tab.filePath;
                  let index = $index
                ) {
                  <div
                    class="flex items-center flex-shrink-0 border-r border-base-content/10"
                  >
                    <button
                      type="button"
                      role="tab"
                      class="px-2 py-1 text-xs max-w-48 truncate cursor-pointer
                           focus-visible:outline focus-visible:outline-2
                           focus-visible:outline-offset-[-2px]
                           focus-visible:outline-[oklch(var(--s))]"
                      [class.bg-base-100]="
                        tab.filePath === diffTabs.activeDiffKey()
                      "
                      [class.font-semibold]="
                        tab.filePath === diffTabs.activeDiffKey()
                      "
                      [id]="diffTabId(index)"
                      [attr.aria-selected]="
                        tab.filePath === diffTabs.activeDiffKey()
                      "
                      [attr.aria-controls]="diffPanelId"
                      [attr.tabindex]="
                        tab.filePath === diffTabs.activeDiffKey() ? 0 : -1
                      "
                      [title]="tab.fileName"
                      (click)="diffTabs.activateDiff(tab.filePath)"
                      (keydown)="onDiffTabKeydown($event, tab.filePath)"
                    >
                      {{ tab.fileName }}
                    </button>
                    <button
                      type="button"
                      class="px-1.5 py-1 text-xs opacity-60 hover:opacity-100 cursor-pointer
                           focus-visible:outline focus-visible:outline-2
                           focus-visible:outline-offset-[-2px]
                           focus-visible:outline-[oklch(var(--s))]"
                      [attr.aria-label]="
                        tab.view
                          ? 'Close file ' + tab.fileName
                          : 'Close diff for ' + tab.fileName
                      "
                      (click)="diffTabs.closeDiff(tab.filePath)"
                    >
                      <span aria-hidden="true">&times;</span>
                    </button>
                  </div>
                }
              </div>

              <div
                class="flex-1 min-h-0 overflow-hidden"
                role="tabpanel"
                [id]="diffPanelId"
                [attr.aria-labelledby]="activeDiffTabId()"
              >
                @if (activeDiffTab.view) {
                  <ptah-file-view
                    [tab]="activeDiffTab"
                    [editorTargets]="launchers.targets()"
                    (retryRequested)="diffTabs.refreshFileView($event)"
                    (openExternal)="launchers.openLinkedFile($event)"
                  />
                } @else {
                  <ptah-diff-view
                    [diffTab]="activeDiffTab"
                    [openDiffKeys]="diffTabs.openDiffKeys()"
                    [applyHunks]="diffTabs.applyHunksFn"
                    (retryRequested)="diffTabs.refreshDiffTab($event)"
                  />
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitDockComponent {
  private static instanceCount = 0;
  private readonly instanceId = GitDockComponent.instanceCount++;
  protected readonly diffPanelId = `git-diff-panel-${this.instanceId}`;

  protected readonly gitStatus = inject(GitStatusService);
  private readonly gitBranches = inject(GitBranchesService);
  protected readonly diffTabs = inject(DiffTabsService);
  protected readonly review = inject(GitReviewService);
  protected readonly launchers = inject(EditorLauncherService);
  protected readonly layout = inject(ElectronLayoutService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.gitStatus.startListening();
    this.gitBranches.startListening();
    void this.gitBranches.refreshBranches();
    void this.launchers.detect();

    this.destroyRef.onDestroy(() => {
      this.gitStatus.stopListening();
      this.gitBranches.stopListening();
    });
  }

  /** Route a working-tree row click to the external editor. */
  protected onFileClicked(request: OpenInRequest): void {
    const root = this.gitStatus.activeWorkspacePath();
    if (root && request.path)
      void this.launchers.openFile(
        request.target,
        root,
        request.path,
        request.line,
      );
  }

  protected diffTabId(index: number): string {
    return `git-diff-tab-${this.instanceId}-${index}`;
  }

  protected activeDiffTabId(): string | null {
    const activeKey = this.diffTabs.activeDiffKey();
    const index = this.diffTabs
      .diffTabs()
      .findIndex((tab) => tab.filePath === activeKey);
    return index >= 0 ? this.diffTabId(index) : null;
  }

  /** Automatic tab activation for the horizontal arrow-key navigation model. */
  protected onDiffTabKeydown(event: KeyboardEvent, key: string): void {
    if (event.key === 'Delete') {
      event.preventDefault();
      this.diffTabs.closeDiff(key);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    const tabs = this.diffTabs.diffTabs();
    const currentIndex = tabs.findIndex((tab) => tab.filePath === key);
    if (currentIndex < 0 || tabs.length < 2) return;

    event.preventDefault();
    const offset = event.key === 'ArrowLeft' ? -1 : 1;
    const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
    this.diffTabs.activateDiff(tabs[nextIndex].filePath);

    const currentControl = event.currentTarget as HTMLElement | null;
    const tablist = currentControl?.closest('[role="tablist"]');
    const controls = tablist?.querySelectorAll<HTMLElement>('[role="tab"]');
    controls?.item(nextIndex).focus();
  }
}
