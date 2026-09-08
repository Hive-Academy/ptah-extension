import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import { DiffViewComponent } from '../diff-view/diff-view.component';
import { SourceControlPanelComponent } from '../source-control/source-control-panel.component';
import { DiffTabsService } from '../services/diff-tabs.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';
import { GitDockHeaderComponent } from './git-dock-header.component';

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
 * The branch-picker dropdown and details popover are intentionally NOT
 * hosted here — those 7 RPCs and their UI stay in the contract for
 * TASK_2026_386.
 */
@Component({
  selector: 'ptah-git-dock',
  standalone: true,
  imports: [
    GitDockHeaderComponent,
    SourceControlPanelComponent,
    DiffViewComponent,
  ],
  template: `
    <div class="flex flex-col h-full" data-testid="git-dock">
      <ptah-git-dock-header />

      <div class="flex-1 min-h-0 flex overflow-hidden">
        <div
          class="w-64 flex-shrink-0 border-r border-base-content/10 overflow-hidden"
        >
          <ptah-source-control-panel
            [files]="gitStatus.files()"
            (diffRequested)="diffTabs.openDiff($event)"
            (fileClicked)="onFileClicked($event)"
          />
        </div>

        @if (diffTabs.activeDiffTab()) {
          <div class="flex-1 min-w-0 overflow-hidden">
            <ptah-diff-view
              [diffTab]="diffTabs.activeDiffTab()"
              [openDiffKeys]="diffTabs.openDiffKeys()"
              [applyHunks]="diffTabs.applyHunksFn"
              (retryRequested)="diffTabs.refreshDiffTab($event)"
            />
          </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitDockComponent {
  protected readonly gitStatus = inject(GitStatusService);
  private readonly gitBranches = inject(GitBranchesService);
  protected readonly diffTabs = inject(DiffTabsService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.gitStatus.startListening();
    this.gitBranches.startListening();
    void this.gitBranches.refreshBranches();

    this.destroyRef.onDestroy(() => {
      this.gitStatus.stopListening();
      this.gitBranches.stopListening();
    });
  }

  /** Route a file-name click from the source-control panel to the external editor. */
  protected onFileClicked(path: string): void {
    void rpcCall(this.vscodeService, 'file:open', { path });
  }
}
