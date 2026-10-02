import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  Injector,
  input,
  NgZone,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  CircleAlert,
  FolderOpen,
  GitBranch,
  LucideAngularModule,
  Plus,
  RotateCw,
  X,
} from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';
import type {
  GitPrStatusResult,
  GitWorktreeInfo,
} from '@ptah-extension/shared';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';
import { WorktreeService } from '../services/worktree.service';
import { GitConfirmDialogComponent } from '../shared/git-confirm-dialog.component';
import { TaskPrPanelComponent } from './task-pr-panel.component';

/**
 * While the Task tab shows, PR status is re-read at most this often by the
 * view's own timer (Requirement 10.5). The backend caches for the same span.
 */
export const PR_REFRESH_INTERVAL_MS = 60_000;

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/$/, '');
}

function branchLabel(wt: GitWorktreeInfo): string {
  return wt.branch || '(detached)';
}

/** The latest PR read, pinned to the workspace it was asked for. */
interface PrRead {
  readonly workspaceRoot: string;
  readonly result: GitPrStatusResult;
}

let instanceCount = 0;

/**
 * TaskWorktreeViewComponent — the body of the review shell's Task tab
 * (implementation-plan §31, design-spec §10, Requirement 10).
 *
 * - **Branch.** Branch, upstream and ↑ahead/↓behind, plus the branch-details
 *   content (stash count, last commit, first remote) shown inline. Remotes are
 *   re-read whenever the tab opens.
 * - **Pull request.** The latest `git:prStatus` result for the shown
 *   workspace, rendered by {@link TaskPrPanelComponent}.
 * - **Refresh.** On tab open, after a push, on a branch or workspace change
 *   and on the refresh button. While the tab shows, one component-owned timer
 *   re-reads at most every {@link PR_REFRESH_INTERVAL_MS}; hiding the tab and
 *   destroying the view clear it, and a reply that lands after either (or
 *   after a newer read started) is dropped.
 * - **Worktrees.** Each row is a switch button; Remove is a sibling button
 *   (never nested) and asks through {@link GitConfirmDialogComponent} with
 *   Remove and Force remove. An inline form adds a worktree.
 */
@Component({
  selector: 'ptah-task-worktree-view',
  standalone: true,
  imports: [
    GitConfirmDialogComponent,
    LucideAngularModule,
    OpenInButtonComponent,
    TaskPrPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="flex flex-col gap-3 p-3 text-xs text-base-content"
      aria-label="Task"
      data-testid="task-worktree-view"
    >
      <!-- Branch -->
      <div class="flex flex-col gap-1" data-testid="task-branch-panel">
        <div class="flex items-center justify-between gap-2">
          <h3 class="m-0 text-xs font-semibold">Branch</h3>
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            data-testid="task-refresh"
            aria-label="Refresh task view"
            title="Refresh"
            (click)="onRefresh()"
          >
            <lucide-angular
              [img]="RefreshIcon"
              class="h-3 w-3"
              [class.animate-spin]="refreshing()"
              aria-hidden="true"
            />
          </button>
        </div>
        <div class="flex min-w-0 items-center justify-between gap-2 text-sm">
          <span class="flex min-w-0 items-center gap-1">
            <lucide-angular
              [img]="BranchIcon"
              class="h-3.5 w-3.5 flex-shrink-0"
              aria-hidden="true"
            />
            <span class="truncate font-medium" data-testid="task-branch-name">{{
              branchName()
            }}</span>
            @if (upstream(); as up) {
              <span
                class="truncate text-base-content-muted"
                data-testid="task-branch-upstream"
                >→ {{ up }}</span
              >
            }
          </span>
          @if (upstream()) {
            <span
              class="flex flex-shrink-0 gap-1"
              data-testid="task-ahead-behind"
            >
              <span class="text-info"
                >↑{{ gitStatus.branch().ahead
                }}<span class="sr-only"> ahead,</span></span
              >
              <span class="text-warning"
                >↓{{ gitStatus.branch().behind
                }}<span class="sr-only"> behind</span></span
              >
            </span>
          } @else {
            <span class="flex-shrink-0 text-xs text-base-content-muted"
              >No upstream</span
            >
          }
        </div>
        <dl
          class="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"
          data-testid="task-branch-details"
        >
          <dt class="text-base-content-muted">Stashes</dt>
          <dd class="m-0">{{ gitBranches.stashCount() }}</dd>
          @if (gitBranches.lastCommit(); as commit) {
            <dt class="text-base-content-muted">Last commit</dt>
            <dd class="m-0 min-w-0 truncate" [title]="commit.hash">
              <span class="font-mono">{{ commit.shortHash }}</span>
              {{ commit.subject }}
              <span class="text-base-content-muted">· {{ commit.author }}</span>
            </dd>
          }
          @if (firstRemote(); as remote) {
            <dt class="text-base-content-muted">Remote</dt>
            <dd class="m-0 min-w-0 truncate" [title]="remote.fetchUrl">
              {{ remote.name }} · {{ remote.fetchUrl }}
            </dd>
          }
        </dl>
        <div>
          <ptah-open-in-button
            [targets]="launchers.targets()"
            [root]="gitStatus.activeWorkspacePath() ?? ''"
            (open)="openWorkspace($event)"
          />
        </div>
      </div>

      <ptah-task-pr-panel
        class="border-t border-base-content/10 pt-2"
        data-testid="task-pr-panel"
        [result]="prResult()"
      />

      <!-- Worktrees -->
      <div
        class="flex flex-col gap-1 border-t border-base-content/10 pt-2"
        data-testid="task-worktrees-panel"
      >
        <div class="flex items-center justify-between gap-2">
          <h3
            class="m-0 text-xs font-semibold"
            data-testid="task-worktrees-heading"
          >
            Worktrees ({{ worktrees.worktrees().length }})
          </h3>
          <button
            #addToggle
            type="button"
            class="btn btn-outline btn-xs gap-1"
            data-testid="task-worktree-add-toggle"
            [attr.aria-expanded]="showAddForm()"
            [attr.aria-controls]="addFormId"
            (click)="toggleAddForm()"
          >
            <lucide-angular
              [img]="PlusIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
            Add
          </button>
        </div>

        @if (showAddForm()) {
          <div
            class="flex flex-col gap-1.5 rounded border border-base-content/10 bg-base-200 p-2"
            data-testid="task-worktree-add-form"
            [id]="addFormId"
          >
            <input
              #branchInput
              type="text"
              class="input input-bordered input-xs w-full"
              aria-label="Branch name"
              placeholder="Branch name"
              data-testid="task-worktree-branch"
              [value]="newBranch()"
              (input)="newBranch.set(inputValue($event))"
              (keydown.enter)="onAddWorktree()"
              (keydown.escape)="closeAddForm()"
            />
            <input
              type="text"
              class="input input-bordered input-xs w-full"
              aria-label="Custom path (optional)"
              placeholder="Custom path (optional)"
              data-testid="task-worktree-path"
              [value]="newPath()"
              (input)="newPath.set(inputValue($event))"
              (keydown.enter)="onAddWorktree()"
              (keydown.escape)="closeAddForm()"
            />
            <label class="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                data-testid="task-worktree-create-branch"
                [checked]="newCreateBranch()"
                (change)="newCreateBranch.set(checkedValue($event))"
              />
              Create new branch
            </label>
            @if (addError()) {
              <p
                role="alert"
                class="m-0 flex items-start gap-1"
                data-testid="task-worktree-add-error"
              >
                <lucide-angular
                  [img]="ErrorIcon"
                  class="mt-0.5 h-3 w-3 flex-shrink-0 text-error"
                  aria-hidden="true"
                />
                <span>{{ addError() }}</span>
              </p>
            }
            <div class="flex gap-1">
              <button
                type="button"
                class="btn btn-primary btn-xs flex-1"
                data-testid="task-worktree-create"
                [disabled]="!newBranch().trim() || isAdding()"
                (click)="onAddWorktree()"
              >
                @if (isAdding()) {
                  <span
                    class="loading loading-spinner loading-xs"
                    aria-hidden="true"
                  ></span>
                  Creating…
                } @else {
                  Create
                }
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                (click)="closeAddForm()"
              >
                Cancel
              </button>
            </div>
          </div>
        }

        @if (worktrees.loadError(); as loadError) {
          <div
            role="alert"
            class="flex items-center gap-2 rounded border border-base-content/10 px-2 py-1.5"
            data-testid="task-worktrees-error"
          >
            <lucide-angular
              [img]="ErrorIcon"
              class="h-3 w-3 flex-shrink-0 text-error"
              aria-hidden="true"
            />
            <span class="flex-1">{{ loadError }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              data-testid="task-worktrees-retry"
              [disabled]="worktrees.isLoading()"
              (click)="retryWorktrees()"
            >
              Retry
            </button>
          </div>
        }
        @if (worktrees.isLoading() && worktrees.worktrees().length === 0) {
          <div
            class="flex items-center justify-center py-3"
            role="status"
            aria-label="Loading worktrees"
            data-testid="task-worktrees-loading"
          >
            <span class="loading loading-spinner loading-sm"></span>
          </div>
        } @else if (worktrees.worktrees().length === 0) {
          <!-- A failed read is not an empty list: the error above says so. -->
          @if (!worktrees.loadError()) {
            <p
              class="m-0 py-2 text-base-content-muted"
              data-testid="task-worktrees-empty"
            >
              No worktrees found.
            </p>
          }
        } @else {
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            @for (wt of worktrees.worktrees(); track wt.path) {
              <li
                class="flex items-center gap-1 rounded"
                data-testid="task-worktree-row"
                [class.bg-base-300]="isActiveWorktree(wt)"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left hover:bg-base-300"
                  data-testid="task-worktree-switch"
                  [attr.aria-current]="isActiveWorktree(wt) ? 'true' : null"
                  [attr.aria-label]="rowLabel(wt)"
                  [title]="'Switch to ' + wt.path"
                  (click)="onWorktreeSelect(wt)"
                >
                  <lucide-angular
                    [img]="wt.isMain ? BranchIcon : FolderIcon"
                    class="h-3.5 w-3.5 flex-shrink-0"
                    [class.text-primary]="isActiveWorktree(wt)"
                    aria-hidden="true"
                  />
                  <span class="truncate font-medium">{{
                    branchLabel(wt)
                  }}</span>
                  @if (wt.isMain) {
                    <span class="badge badge-xs badge-ghost flex-shrink-0"
                      >main</span
                    >
                  }
                  @if (isActiveWorktree(wt)) {
                    <span class="badge badge-xs badge-ghost flex-shrink-0"
                      >active</span
                    >
                  }
                  @if (wt.locked) {
                    <span
                      class="badge badge-xs badge-warning flex-shrink-0"
                      [title]="wt.lockReason ?? 'Locked'"
                      >locked</span
                    >
                  }
                  @if (wt.prunable) {
                    <span
                      class="badge badge-xs badge-ghost flex-shrink-0"
                      [title]="wt.prunableReason ?? 'Prunable'"
                      >prunable</span
                    >
                  }
                  <span
                    class="ml-auto min-w-0 truncate font-mono text-base-content-muted"
                    >{{ wt.path }}</span
                  >
                </button>
                @if (!wt.isMain) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs flex-shrink-0 px-1"
                    data-testid="task-worktree-remove"
                    [attr.aria-label]="'Remove worktree ' + branchLabel(wt)"
                    title="Remove worktree"
                    [disabled]="isRemoving()"
                    (click)="onRemoveClick($event, wt)"
                  >
                    <lucide-angular
                      [img]="RemoveIcon"
                      class="h-3 w-3"
                      aria-hidden="true"
                    />
                  </button>
                }
              </li>
            }
          </ul>
        }

        @if (removeError()) {
          <p
            role="alert"
            class="m-0 flex items-start gap-1"
            data-testid="task-worktree-remove-error"
          >
            <lucide-angular
              [img]="ErrorIcon"
              class="mt-0.5 h-3 w-3 flex-shrink-0 text-error"
              aria-hidden="true"
            />
            <span>{{ removeError() }}</span>
          </p>
        }
      </div>

      <ptah-git-confirm-dialog
        #removeDialog
        [title]="removeTitle()"
        [description]="removeDescription()"
        confirmLabel="Force remove"
        secondaryLabel="Remove"
        (confirmed)="onConfirmRemove(true)"
        (secondaryConfirmed)="onConfirmRemove(false)"
        (cancelled)="removeTarget.set(null)"
      />
    </section>
  `,
})
export class TaskWorktreeViewComponent {
  /** Whether the Task tab is the one showing; the PR timer runs only then. */
  readonly shown = input(false);

  protected readonly gitStatus = inject(GitStatusService);
  protected readonly gitBranches = inject(GitBranchesService);
  protected readonly worktrees = inject(WorktreeService);
  protected readonly launchers = inject(EditorLauncherService);
  private readonly layout = inject(ElectronLayoutService);
  private readonly injector = inject(Injector);
  private readonly zone = inject(NgZone);

  protected readonly BranchIcon = GitBranch;
  protected readonly FolderIcon = FolderOpen;
  protected readonly PlusIcon = Plus;
  protected readonly RemoveIcon = X;
  protected readonly RefreshIcon = RotateCw;
  protected readonly ErrorIcon = CircleAlert;

  protected readonly addFormId = `task-worktree-add-${instanceCount++}`;

  private readonly removeDialog =
    viewChild.required<GitConfirmDialogComponent>('removeDialog');
  private readonly addToggle =
    viewChild<ElementRef<HTMLButtonElement>>('addToggle');
  private readonly branchInput =
    viewChild<ElementRef<HTMLInputElement>>('branchInput');

  protected readonly showAddForm = signal(false);
  protected readonly newBranch = signal('');
  protected readonly newPath = signal('');
  protected readonly newCreateBranch = signal(false);
  protected readonly isAdding = signal(false);
  protected readonly addError = signal('');
  protected readonly removeTarget = signal<GitWorktreeInfo | null>(null);
  protected readonly isRemoving = signal(false);
  protected readonly removeError = signal('');

  private readonly prRead = signal<PrRead | null>(null);
  private readonly prLoading = signal(false);
  private prTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every read and every cancel; a stale reply is dropped. */
  private prRequest = 0;
  private destroyed = false;

  protected readonly branchName = computed(
    () =>
      this.gitStatus.branch().branch ||
      this.gitBranches.currentBranch() ||
      '(detached HEAD)',
  );

  protected readonly upstream = computed(
    () => this.gitStatus.branch().upstream,
  );

  protected readonly firstRemote = computed(
    () => this.gitBranches.remotes()[0] ?? null,
  );

  protected readonly refreshing = computed(
    () => this.prLoading() || this.worktrees.isLoading(),
  );

  /** The latest PR result, only for the workspace it was read for. */
  protected readonly prResult = computed<GitPrStatusResult | null>(() => {
    const read = this.prRead();
    return read?.workspaceRoot === this.gitStatus.activeWorkspacePath()
      ? read.result
      : null;
  });

  protected readonly removeTitle = computed(() => {
    const target = this.removeTarget();
    return target ? `Remove worktree "${branchLabel(target)}"?` : '';
  });

  protected readonly removeDescription = computed(() => {
    const target = this.removeTarget();
    if (target?.locked) {
      return 'This worktree is locked. Removing it requires Force remove.';
    }
    if (target?.prunable) {
      return 'Its directory is already gone. Remove clears the leftover entry.';
    }
    return 'Remove deletes the worktree directory. Force remove also discards uncommitted changes in it.';
  });

  constructor() {
    // Worktrees and remotes: read whenever the tab opens or, while it shows,
    // the workspace changes.
    effect(() => {
      if (!this.shown()) return;
      if (!this.gitStatus.activeWorkspacePath()) return;
      untracked(() => {
        void this.worktrees.loadWorktrees();
        void this.gitBranches.refreshRemotes();
      });
    });

    // PR status: read on open, branch or workspace change and after a push;
    // hiding the tab cancels the timer and any read in flight.
    effect(() => {
      const shown = this.shown();
      const root = this.gitStatus.activeWorkspacePath();
      this.gitStatus.branchName();
      this.gitBranches.pushCompletions();
      untracked(() => {
        if (shown && root) void this.refreshPr(root);
        else this.cancelPrRefresh();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.cancelPrRefresh();
    });
  }

  protected branchLabel(wt: GitWorktreeInfo): string {
    return branchLabel(wt);
  }

  protected rowLabel(wt: GitWorktreeInfo): string {
    const marks = [
      wt.isMain ? 'main' : '',
      this.isActiveWorktree(wt) ? 'active' : '',
      wt.locked ? 'locked' : '',
      wt.prunable ? 'prunable' : '',
    ].filter(Boolean);
    const suffix = marks.length > 0 ? ` (${marks.join(', ')})` : '';
    return `Switch to ${branchLabel(wt)}${suffix}, ${wt.path}`;
  }

  /**
   * The row that reads as active follows the shell's focused folder
   * (`ElectronLayoutService.activeWorkspace()`); with none, the main worktree.
   */
  protected isActiveWorktree(wt: GitWorktreeInfo): boolean {
    const activeRoot = this.layout.activeWorkspace()?.path ?? null;
    if (!activeRoot) return wt.isMain;
    return normalizePath(activeRoot) === normalizePath(wt.path);
  }

  protected onWorktreeSelect(wt: GitWorktreeInfo): void {
    void this.layout.addFolderByPath(wt.path);
  }

  /** Manual refresh: worktrees, remotes and PR status, past the timer. */
  protected onRefresh(): void {
    const root = this.gitStatus.activeWorkspacePath();
    if (!root) return;
    void this.worktrees.loadWorktrees();
    void this.gitBranches.refreshRemotes();
    void this.refreshPr(root);
  }

  protected retryWorktrees(): void {
    void this.worktrees.loadWorktrees();
  }

  protected openWorkspace(request: OpenInRequest): void {
    const root = this.gitStatus.activeWorkspacePath();
    if (root) void this.launchers.openWorkspace(request.target, root);
  }

  protected toggleAddForm(): void {
    if (this.showAddForm()) {
      this.closeAddForm();
      return;
    }
    this.showAddForm.set(true);
    afterNextRender(() => this.branchInput()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checkedValue(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected async onAddWorktree(): Promise<void> {
    const branch = this.newBranch().trim();
    if (!branch || this.isAdding()) return;

    this.isAdding.set(true);
    this.addError.set('');
    const result = await this.worktrees.addWorktree(branch, {
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
    const hadFocus = this.formHasFocus();
    this.showAddForm.set(false);
    this.newBranch.set('');
    this.newPath.set('');
    this.newCreateBranch.set(false);
    this.addError.set('');
    if (hadFocus) this.addToggle()?.nativeElement.focus();
  }

  protected onRemoveClick(event: MouseEvent, wt: GitWorktreeInfo): void {
    this.removeTarget.set(wt);
    this.removeError.set('');
    this.removeDialog().open(event.currentTarget as HTMLElement);
  }

  protected async onConfirmRemove(force: boolean): Promise<void> {
    const target = this.removeTarget();
    if (!target) return;

    this.isRemoving.set(true);
    this.removeError.set('');
    const result = await this.worktrees.removeWorktree(target.path, force);
    this.isRemoving.set(false);
    this.removeTarget.set(null);

    if (!result.success) {
      this.removeError.set(result.error || 'Failed to remove worktree');
      return;
    }
    // The row and its Remove button go away: keep focus in the panel.
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (!active || active === document.body || !active.isConnected) {
          this.addToggle()?.nativeElement.focus();
        }
      },
      { injector: this.injector },
    );
  }

  private formHasFocus(): boolean {
    const active = document.activeElement;
    const form = this.branchInput()?.nativeElement.parentElement;
    return !!active && !!form && form.contains(active);
  }

  private async refreshPr(root: string): Promise<void> {
    this.clearPrTimer();
    const request = ++this.prRequest;
    this.prLoading.set(true);
    const result = await this.gitBranches.readPrStatus(root);
    if (request !== this.prRequest) return;
    this.prLoading.set(false);
    this.prRead.set({ workspaceRoot: root, result });
    this.schedulePrRefresh();
  }

  /**
   * Armed outside the Angular zone: a pending minute-long timer inside it
   * would keep the app from ever reading as stable. The read itself re-enters
   * the zone.
   */
  private schedulePrRefresh(): void {
    if (this.destroyed || !this.shown()) return;
    this.prTimer = this.zone.runOutsideAngular(() =>
      setTimeout(() => {
        this.prTimer = null;
        this.zone.run(() => {
          const root = this.gitStatus.activeWorkspacePath();
          if (root) void this.refreshPr(root);
        });
      }, PR_REFRESH_INTERVAL_MS),
    );
  }

  private cancelPrRefresh(): void {
    this.clearPrTimer();
    this.prRequest++;
    this.prLoading.set(false);
  }

  private clearPrTimer(): void {
    if (this.prTimer === null) return;
    clearTimeout(this.prTimer);
    this.prTimer = null;
  }
}
