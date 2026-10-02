import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { NativeTabGroupComponent, type NativeTab } from '@ptah-extension/ui';
import { CommitComposerComponent } from '../commit/commit-composer.component';
import { ConflictBannerComponent } from '../conflict/conflict-banner.component';
import { GitDockHeaderComponent } from '../git-dock/git-dock-header.component';
import { HistoryTimelineComponent } from '../history/history-timeline.component';
import { ReviewCanvasComponent } from '../review-canvas/review-canvas.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { FileContentChangesService } from '../services/file-content-changes.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStashService } from '../services/git-stash.service';
import { GitStatusService } from '../services/git-status.service';
import {
  ReviewNavigationService,
  type ReviewTab,
} from '../services/review-navigation.service';
import { statusUnavailableLabel } from '../source-control/source-control-panel.component';
import { SpotEditorComponent } from '../spot-editor/spot-editor.component';
import { TaskWorktreeViewComponent } from '../task/task-worktree-view.component';

/** Below this shell width the file tree stacks above the diff (design-spec §6.1a). */
const STACK_BELOW_PX = 520;

/** The tabs this shell shows (design-spec §3). */
const SHELL_TABS: readonly ReviewTab[] = [
  'changes',
  'commit',
  'task',
  'history',
];

function fileCountLabel(count: number): string {
  return count === 1 ? 'file' : 'files';
}

/**
 * What the spot editor exposes to the shell. Structural, so this file never
 * names `SpotEditorComponent` outside `imports` and the `@defer` block — any
 * other reference would pull the editor out of its lazy chunk.
 */
interface SpotEditorPort {
  notifyDiskChange(filePaths: readonly string[], truncated: boolean): void;
  confirmLeave(): boolean | Promise<boolean>;
}

type BodyNotice = 'loading' | 'unavailable' | 'not-a-repo';

/**
 * ReviewShellComponent — the Electron dock body (implementation-plan
 * Component 23, design-spec §3): the git header, the conflict-banner slot and
 * the review tabs. It replaces `GitDockComponent` at cutover (Batch 58), which
 * keeps the lazy-mount contract of `electron-shell.component.ts`.
 *
 * - **Arming.** The constructor arms `GitStatusService` and
 *   `GitBranchesService` (with a branch read) and detects editor targets;
 *   destroy disarms both. Re-arming after a dock close is idempotent because
 *   `startListening()` fetches eagerly.
 * - **Stash routing.** While mounted it registers with
 *   `GitStashService.registerReviewCanvas()`, so a stash file opens here as a
 *   historical comparison; destroy releases the registration.
 * - **Conflict banner.** Above the tabs, `ConflictBannerComponent` shows
 *   while a merge, rebase or cherry-pick is in progress (design-spec §11).
 * - **States (RC3).** "Loading repository…" only before anything was read; a
 *   failed read with no earlier good one says the status is unavailable,
 *   never "not a Git repository"; a failed re-read after a good one keeps the
 *   last known changes and marks them stale. A re-read never unmounts the tab
 *   body, so nothing in it loses state.
 * - **Changes tab.** The review canvas, or the spot editor when navigation
 *   targets a file (design-spec §3.3, "Back to review" returns). Both bodies
 *   are `@defer` blocks, so the canvas (and Pierre behind it) and CodeMirror
 *   stay in lazy chunks. The spot editor also opens outside a repository.
 * - **Commit tab.** The commit composer, in a `@defer` block that loads the
 *   first time the tab shows.
 * - **Task tab.** The task/worktree view (branch, PR/CI, worktrees), in a
 *   `@defer` block that loads the first time the tab shows. It is told
 *   whether it shows, so its PR refresh timer runs only then.
 * - **History tab.** The history timeline (stashes and the branch's own
 *   commits), in a `@defer` block that loads the first time the tab shows. It
 *   is told whether it shows, so it reads `git:log` only then.
 * - Every body stays mounted once rendered and is hidden while another tab
 *   shows.
 * - **Width.** One `ResizeObserver` on the host decides `stacked` (< 520 px)
 *   for the canvas; it is disconnected on destroy.
 * - **Disk changes.** `file:content-changed` batches reach the open spot
 *   editor through {@link FileContentChangesService}.
 * - **Unsaved edits.** While mounted it registers the spot editor's
 *   `confirmLeave` as the navigation leave guard, so a change set, commit,
 *   stash file or comparison that would replace a dirty editor asks Discard
 *   or Keep editing first; Keep editing cancels the navigation.
 */
@Component({
  selector: 'ptah-review-shell',
  standalone: true,
  imports: [
    CommitComposerComponent,
    ConflictBannerComponent,
    GitDockHeaderComponent,
    HistoryTimelineComponent,
    NativeTabGroupComponent,
    ReviewCanvasComponent,
    SpotEditorComponent,
    TaskWorktreeViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full w-full' },
  template: `
    <div class="flex h-full min-h-0 flex-col" data-testid="review-shell">
      <ptah-git-dock-header />

      <!-- Cross-cutting notices sit above the tabs (design-spec §3.2). -->
      @if (staleLabel(); as label) {
        <div
          role="status"
          class="flex flex-shrink-0 items-start gap-1 border-b border-l-2 border-base-content/10 border-l-warning bg-base-200 px-2 py-1.5 text-xs text-base-content"
          data-testid="review-shell-stale"
        >
          Git status is unavailable ({{ label }}) — showing the last known
          changes.
        </div>
      }

      <!-- The merge/rebase/cherry-pick banner (design-spec §11). Always
           mounted: it renders its card only while an operation is in
           progress, and keeps the screen-reader line announcing how one
           ended after the card goes. -->
      <ptah-conflict-banner />

      @if (bodyNotice(); as notice) {
        <div class="flex-1 p-4 text-sm text-base-content">
          @switch (notice) {
            @case ('loading') {
              <span role="status" data-testid="review-shell-loading"
                >Loading repository…</span
              >
            }
            @case ('unavailable') {
              <!-- A failed read proves nothing about the repository: only a
                   readable result saying isGitRepo:false earns the "not a Git
                   repository" line (TASK_2026_576 RC3). -->
              <span role="status" data-testid="review-shell-status-unavailable"
                >Git status is unavailable ({{ unavailableLabel() }}).</span
              >
            }
            @default {
              <span data-testid="review-shell-not-a-repo"
                >The active workspace is not a Git repository.</span
              >
            }
          }
        </div>
      } @else {
        <ptah-native-tab-group
          class="!flex min-h-0 flex-1 flex-col [&>div:first-child>button:focus-visible]:outline [&>div:first-child>button:focus-visible]:outline-2 [&>div:first-child>button:focus-visible]:outline-offset-[-2px] [&>div:first-child>button:focus-visible]:outline-[oklch(var(--s))] [&>div:first-child]:flex-shrink-0 [&>div:first-child]:bg-base-100 [&>div:first-child]:px-2 [&>div:last-child:focus-visible]:outline [&>div:last-child:focus-visible]:outline-2 [&>div:last-child:focus-visible]:outline-offset-[-2px] [&>div:last-child:focus-visible]:outline-[oklch(var(--s))] [&>div:last-child]:flex [&>div:last-child]:min-h-0 [&>div:last-child]:flex-1 [&>div:last-child]:flex-col"
          ariaLabel="Review"
          [tabs]="tabs()"
          [activeId]="shownTab()"
          (tabSelected)="onTabSelected($event)"
        >
          <!-- The header's collapse control names this id in aria-controls;
               the changed-file tree it collapses is inside. The Changes body
               stays mounted (hidden) while another tab shows, so the canvas
               and an open spot editor keep their state. -->
          <div
            id="git-source-control-rail"
            class="min-h-0 flex-1 flex-col"
            data-testid="review-shell-changes-body"
            [class.flex]="shownTab() === 'changes'"
            [class.hidden]="shownTab() !== 'changes'"
          >
            @if (fileTarget(); as target) {
              @defer (on immediate) {
                <ptah-spot-editor
                  #spotEditor
                  class="min-h-0 flex-1"
                  [request]="target.request"
                  [startEditable]="target.editable === true"
                  [editorTargets]="launchers.targets()"
                  (backToReview)="onBackToReview()"
                  (openExternal)="launchers.openLinkedFile($event)"
                />
              } @placeholder {
                <p
                  class="p-4 text-xs text-base-content-muted"
                  role="status"
                  data-testid="review-shell-body-loading"
                >
                  Loading the editor…
                </p>
              } @error {
                <p
                  class="p-4 text-xs text-base-content"
                  role="alert"
                  data-testid="review-shell-body-error"
                >
                  The editor could not be loaded. Reload the window to try
                  again.
                </p>
              }
            } @else {
              @defer (on immediate) {
                <ptah-review-canvas class="flex-1" [stacked]="stacked()" />
              } @placeholder {
                <p
                  class="p-4 text-xs text-base-content-muted"
                  role="status"
                  data-testid="review-shell-body-loading"
                >
                  Loading the review…
                </p>
              } @error {
                <p
                  class="p-4 text-xs text-base-content"
                  role="alert"
                  data-testid="review-shell-body-error"
                >
                  The review could not be loaded. Reload the window to try
                  again.
                </p>
              }
            }
          </div>

          <!-- Loaded the first time the Commit tab shows, then kept mounted
               (hidden) so a running commit and its output survive a tab
               switch. -->
          <div
            class="min-h-0 flex-1 flex-col overflow-y-auto"
            data-testid="review-shell-commit-body"
            [class.flex]="shownTab() === 'commit'"
            [class.hidden]="shownTab() !== 'commit'"
          >
            @defer (when shownTab() === 'commit') {
              <ptah-commit-composer />
            } @placeholder {
              <p
                class="p-4 text-xs text-base-content-muted"
                role="status"
                data-testid="review-shell-commit-loading"
              >
                Loading the commit composer…
              </p>
            } @error {
              <p
                class="p-4 text-xs text-base-content"
                role="alert"
                data-testid="review-shell-commit-error"
              >
                The commit composer could not be loaded. Reload the window to
                try again.
              </p>
            }
          </div>

          <!-- Loaded the first time the Task tab shows, then kept mounted
               (hidden); [shown] stops its PR refresh timer while hidden. -->
          <div
            class="min-h-0 flex-1 flex-col overflow-y-auto"
            data-testid="review-shell-task-body"
            [class.flex]="shownTab() === 'task'"
            [class.hidden]="shownTab() !== 'task'"
          >
            @defer (when shownTab() === 'task') {
              <ptah-task-worktree-view [shown]="shownTab() === 'task'" />
            } @placeholder {
              <p
                class="p-4 text-xs text-base-content-muted"
                role="status"
                data-testid="review-shell-task-loading"
              >
                Loading the task view…
              </p>
            } @error {
              <p
                class="p-4 text-xs text-base-content"
                role="alert"
                data-testid="review-shell-task-error"
              >
                The task view could not be loaded. Reload the window to try
                again.
              </p>
            }
          </div>

          <!-- Loaded the first time the History tab shows, then kept mounted
               (hidden); [shown] keeps its git:log reads to while it shows. -->
          <div
            class="min-h-0 flex-1 flex-col overflow-y-auto"
            data-testid="review-shell-history-body"
            [class.flex]="shownTab() === 'history'"
            [class.hidden]="shownTab() !== 'history'"
          >
            @defer (when shownTab() === 'history') {
              <ptah-history-timeline [shown]="shownTab() === 'history'" />
            } @placeholder {
              <p
                class="p-4 text-xs text-base-content-muted"
                role="status"
                data-testid="review-shell-history-loading"
              >
                Loading the history…
              </p>
            } @error {
              <p
                class="p-4 text-xs text-base-content"
                role="alert"
                data-testid="review-shell-history-error"
              >
                The history could not be loaded. Reload the window to try again.
              </p>
            }
          </div>
        </ptah-native-tab-group>
      }
    </div>
  `,
})
export class ReviewShellComponent {
  protected readonly gitStatus = inject(GitStatusService);
  private readonly gitBranches = inject(GitBranchesService);
  private readonly navigation = inject(ReviewNavigationService);
  protected readonly launchers = inject(EditorLauncherService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  private readonly spotEditor = viewChild<SpotEditorPort>('spotEditor');

  /** The shell is narrower than {@link STACK_BELOW_PX}. */
  protected readonly stacked = signal(false);
  private resizeObserver: ResizeObserver | null = null;

  /** The spot editor target, or `null` while the canvas shows. */
  protected readonly fileTarget = computed(() => {
    const target = this.navigation.current().target;
    return target.kind === 'file' ? target : null;
  });

  /** The tab whose body shows. */
  protected readonly shownTab = computed<ReviewTab>(
    () => this.navigation.current().tab,
  );

  protected readonly tabs = computed<readonly NativeTab[]>(() => {
    const isRepo = this.gitStatus.isGitRepo();
    const changed = isRepo ? this.gitStatus.changedFileCount() : null;
    const staged = isRepo ? this.gitStatus.stagedCount() : null;
    return [
      {
        id: 'changes',
        label: 'Changes',
        count: changed,
        ...(changed === null
          ? {}
          : {
              ariaLabel: `Changes, ${changed} changed ${fileCountLabel(changed)}`,
            }),
      },
      {
        id: 'commit',
        label: 'Commit',
        count: staged,
        ...(staged === null
          ? {}
          : {
              ariaLabel: `Commit, ${staged} staged ${fileCountLabel(staged)}`,
            }),
      },
      { id: 'task', label: 'Task' },
      { id: 'history', label: 'History' },
    ];
  });

  /**
   * What replaces the tabs when there is no repository to review. A spot
   * editor target still opens: a linked file needs no repository.
   */
  protected readonly bodyNotice = computed<BodyNotice | null>(() => {
    if (this.gitStatus.isGitRepo() || this.fileTarget()) return null;
    if (this.gitStatus.isLoading()) return 'loading';
    return this.gitStatus.statusUnavailable() ? 'unavailable' : 'not-a-repo';
  });

  protected readonly unavailableLabel = computed(() => {
    const reason = this.gitStatus.statusUnavailable();
    return reason ? statusUnavailableLabel(reason) : '';
  });

  /** The latest read failed after a good one: the changes shown are stale. */
  protected readonly staleLabel = computed(() => {
    const reason = this.gitStatus.staleReason();
    return reason && this.gitStatus.isGitRepo()
      ? statusUnavailableLabel(reason)
      : null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    this.gitStatus.startListening();
    this.gitBranches.startListening();
    void this.gitBranches.refreshBranches();
    void this.launchers.detect();

    const releaseStash = inject(GitStashService).registerReviewCanvas();
    const releaseDiskChanges = inject(FileContentChangesService).listen(
      (change) =>
        this.spotEditor()?.notifyDiskChange(change.filePaths, change.truncated),
    );
    // A navigation that would replace the spot editor asks it first, so
    // unsaved edits are never unmounted silently. No editor (or one still
    // loading) has nothing to lose.
    const releaseLeaveGuard = this.navigation.registerLeaveGuard(
      () => this.spotEditor()?.confirmLeave() ?? true,
    );

    afterNextRender(() => this.observeWidth());

    destroyRef.onDestroy(() => {
      this.gitStatus.stopListening();
      this.gitBranches.stopListening();
      releaseStash();
      releaseDiskChanges();
      releaseLeaveGuard();
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  protected onTabSelected(id: string): void {
    const tab = SHELL_TABS.find((candidate) => candidate === id);
    if (tab) this.navigation.selectTab(tab);
  }

  /**
   * Leave the spot editor. Its Back button goes away with it, so focus moves
   * to the tab panel instead of falling to the page.
   */
  protected onBackToReview(): void {
    this.navigation.backToReview();
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        this.host.nativeElement
          .querySelector<HTMLElement>('[role="tabpanel"]')
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  private observeWidth(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries.at(-1)?.contentRect.width ?? 0;
      // A hidden dock measures 0: keep the last real layout.
      if (width > 0) this.stacked.set(width < STACK_BELOW_PX);
    });
    this.resizeObserver.observe(this.host.nativeElement);
  }
}
