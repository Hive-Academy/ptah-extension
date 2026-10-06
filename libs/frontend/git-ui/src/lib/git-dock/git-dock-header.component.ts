import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  NgZone,
  signal,
  viewChild,
} from '@angular/core';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranch,
  Info,
  LucideAngularModule,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  X,
} from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';
import { BranchPickerDropdownComponent } from '../branch-picker/branch-picker-dropdown.component';
import { BranchDetailsPopoverComponent } from '../branch-picker/branch-details-popover.component';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import {
  EditorLauncherService,
  STATUS_AUTO_CLEAR_MS,
  type LaunchStatus,
} from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';
import { GitReviewService } from '../services/git-review.service';
import { StashPopoverComponent } from '../stash/stash-popover.component';

type SyncAction = 'fetch' | 'pull' | 'push';

const SYNC_COPY: Record<SyncAction, { done: string; failed: string }> = {
  fetch: { done: 'Fetch completed.', failed: 'Fetch failed.' },
  pull: { done: 'Pull completed.', failed: 'Pull failed.' },
  push: { done: 'Push completed.', failed: 'Push failed.' },
};

@Component({
  selector: 'ptah-git-dock-header',
  standalone: true,
  imports: [
    LucideAngularModule,
    BranchPickerDropdownComponent,
    BranchDetailsPopoverComponent,
    OpenInButtonComponent,
    StashPopoverComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (gitStatus.isGitRepo()) {
    <!-- Two groups that wrap rather than clip (TASK_2026_576 V-1): the
         branch group shrinks first (its label truncates, V-2); once it is
         down to its 10rem basis the sync group moves to a second row, so
         Fetch, Pull and Push stay whole at the 300 px dock minimum. -->
    <div
      class="relative flex min-h-8 flex-shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-base-content/10 bg-base-200 px-2 py-1 text-xs"
      data-testid="git-dock-header"
    >
      <div
        class="flex min-w-0 flex-[1_1_10rem] items-center gap-1"
        data-testid="git-dock-header-branch-group"
      >
        @if (review.mode() === 'working-tree') {
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            data-testid="git-rail-toggle"
            aria-controls="git-source-control-rail"
            [attr.aria-expanded]="!layout.gitRailCollapsed()"
            [attr.aria-label]="
              layout.gitRailCollapsed()
                ? 'Show source control'
                : 'Hide source control'
            "
            [title]="
              layout.gitRailCollapsed()
                ? 'Show source control'
                : 'Hide source control'
            "
            (click)="layout.toggleGitRail()"
          >
            <lucide-angular
              [img]="
                layout.gitRailCollapsed() ? PanelLeftIcon : PanelLeftCloseIcon
              "
              class="h-3 w-3"
            />
          </button>
        }
        <div class="relative flex min-w-0 items-center">
          <button
            #branchTrigger
            type="button"
            class="btn btn-ghost btn-xs min-w-0 max-w-[14rem] shrink flex-nowrap gap-1"
            data-testid="current-branch-button"
            aria-haspopup="dialog"
            [attr.aria-expanded]="pickerOpen()"
            [title]="branchLabel()"
            (click)="pickerOpen.set(!pickerOpen())"
          >
            <lucide-angular [img]="BranchIcon" class="h-3 w-3 shrink-0" /><span
              class="min-w-0 truncate"
              data-testid="current-branch-label"
              >{{ branchLabel() }}</span
            >
          </button>
          <button
            #detailsTrigger
            type="button"
            class="btn btn-ghost btn-xs px-1"
            aria-label="Branch details"
            (click)="detailsOpen.set(!detailsOpen())"
          >
            <lucide-angular [img]="InfoIcon" class="h-3 w-3" />
          </button>
          <ptah-branch-picker-dropdown
            [isOpen]="pickerOpen()"
            (closed)="closePicker()"
          />
          <ptah-branch-details-popover
            [isOpen]="detailsOpen()"
            (closed)="closeDetails()"
          />
        </div>
        <span role="status" aria-label="Git status" class="sr-only">{{
          gitStatus.branchName()
        }}</span>
        <div class="relative flex items-center">
          <button
            #stashTrigger
            type="button"
            class="btn btn-ghost btn-xs gap-1 px-1"
            data-testid="git-stash-button"
            aria-haspopup="dialog"
            [attr.aria-expanded]="stashOpen()"
            [attr.aria-label]="'Stashes (' + gitBranches.stashCount() + ')'"
            title="Stashes"
            (click)="stashOpen.set(!stashOpen())"
          >
            <lucide-angular
              [img]="StashIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />{{ gitBranches.stashCount() }}
          </button>
          <ptah-stash-popover [isOpen]="stashOpen()" (closed)="closeStash()" />
        </div>
      </div>
      <div
        class="ml-auto flex flex-shrink-0 items-center gap-1"
        data-testid="git-dock-header-sync-group"
      >
        <ptah-open-in-button
          [mode]="compact() ? 'icon-only' : 'full'"
          [targets]="launchers.targets()"
          [root]="gitStatus.activeWorkspacePath() ?? ''"
          (open)="openWorkspace($event)"
        />
        <button
          type="button"
          data-testid="git-fetch-button"
          class="btn btn-ghost btn-xs px-1"
          aria-label="Fetch"
          title="Fetch"
          [disabled]="syncing() !== null"
          (click)="sync('fetch')"
        >
          <lucide-angular
            [img]="FetchIcon"
            class="h-3 w-3"
            [class.animate-spin]="syncing() === 'fetch'"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          data-testid="git-pull-button"
          class="btn btn-ghost btn-xs gap-1"
          [attr.aria-label]="
            gitStatus.branch().behind
              ? 'Pull (' + gitStatus.branch().behind + ' behind)'
              : 'Pull'
          "
          title="Pull (fast-forward only)"
          [disabled]="syncing() !== null"
          (click)="sync('pull')"
        >
          <lucide-angular [img]="PullIcon" class="h-3 w-3" aria-hidden="true" />
          @if (gitStatus.branch().behind) {
            <!-- Button ink, not text-warning: stock warning ink fails AA on the
               light theme, and the arrow plus aria-label carry the meaning. -->
            <span class="tabular-nums" data-testid="git-behind-count"
              >↓{{ gitStatus.branch().behind }}</span
            >
          } @else {
            Pull
          }
        </button>
        <button
          type="button"
          data-testid="git-push-button"
          class="btn btn-ghost btn-xs gap-1"
          [attr.aria-label]="
            gitStatus.branch().ahead
              ? 'Push (' + gitStatus.branch().ahead + ' ahead)'
              : 'Push'
          "
          title="Push"
          [disabled]="syncing() !== null"
          (click)="sync('push')"
        >
          <lucide-angular [img]="PushIcon" class="h-3 w-3" aria-hidden="true" />
          @if (gitStatus.branch().ahead) {
            <span class="tabular-nums" data-testid="git-ahead-count"
              >↑{{ gitStatus.branch().ahead }}</span
            >
          } @else {
            Push
          }
        </button>
      </div>
    </div>
    @if (statusLine(); as line) {
      <!-- A success clears itself after a few seconds; an error stays until
           dismissed or replaced. -->
      <div
        class="flex items-center gap-1 border-b border-base-content/10 py-0.5 pl-3 pr-1 text-xs"
        data-testid="git-dock-status-line"
      >
        <span
          role="status"
          class="min-w-0 flex-1 break-words py-0.5"
          [class.text-error]="line.status.kind === 'error'"
          >{{ line.status.message }}</span
        >
        @if (line.status.kind === 'error') {
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square h-6 min-h-6 w-6 shrink-0 p-0"
            aria-label="Dismiss message"
            title="Dismiss"
            data-testid="git-dock-status-dismiss"
            (click)="dismissStatus(line.source)"
          >
            <lucide-angular
              [img]="DismissIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
          </button>
        }
      </div>
    }
  }`,
})
export class GitDockHeaderComponent {
  /**
   * The dock is narrow (review shell, below 400 px): Open in shows its icon
   * only, its accessible name unchanged.
   */
  readonly compact = input(false);

  protected readonly gitStatus = inject(GitStatusService);
  protected readonly gitBranches = inject(GitBranchesService);
  protected readonly launchers = inject(EditorLauncherService);
  protected readonly review = inject(GitReviewService);
  protected readonly layout = inject(ElectronLayoutService);
  private readonly zone = inject(NgZone);
  protected readonly BranchIcon = GitBranch;
  protected readonly InfoIcon = Info;
  protected readonly PushIcon = ArrowUpFromLine;
  protected readonly PullIcon = ArrowDownToLine;
  protected readonly FetchIcon = RefreshCw;
  protected readonly StashIcon = Archive;
  protected readonly PanelLeftIcon = PanelLeft;
  protected readonly PanelLeftCloseIcon = PanelLeftClose;
  protected readonly DismissIcon = X;
  /** The full branch name; the trigger truncates it and keeps it in `title`. */
  protected readonly branchLabel = computed(
    () => this.gitBranches.currentBranch() || this.gitStatus.branchName(),
  );
  protected readonly pickerOpen = signal(false);
  protected readonly detailsOpen = signal(false);
  protected readonly stashOpen = signal(false);
  /** The remote action in flight; disables Fetch, Pull and Push together. */
  protected readonly syncing = signal<SyncAction | null>(null);
  private readonly branchTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('branchTrigger');
  private readonly detailsTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('detailsTrigger');
  private readonly stashTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('stashTrigger');
  /** The last Fetch / Pull / Push outcome; shown before the launcher's. */
  private readonly actionStatus = signal<LaunchStatus | null>(null);
  /** Clears a success `actionStatus`; cancelled by a newer one and on destroy. */
  private actionClearTimer: ReturnType<typeof setTimeout> | null = null;

  /** The one status line under the header: sync outcome first, then launcher. */
  protected readonly statusLine = computed<{
    source: 'action' | 'launcher';
    status: LaunchStatus;
  } | null>(() => {
    const action = this.actionStatus();
    if (action) return { source: 'action', status: action };
    const launch = this.launchers.launchStatus();
    return launch ? { source: 'launcher', status: launch } : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelActionClear());
  }

  protected async sync(action: SyncAction): Promise<void> {
    if (this.syncing()) return;
    const workspace = this.gitStatus.activeWorkspacePath();
    if (!workspace) return;
    this.syncing.set(action);
    this.setActionStatus(null);
    const copy = SYNC_COPY[action];
    try {
      const result = await this.gitBranches[action]();
      if (this.gitStatus.activeWorkspacePath() !== workspace) return;
      this.setActionStatus(
        result.success
          ? { kind: 'success', message: copy.done }
          : { kind: 'error', message: result.error ?? copy.failed },
      );
      if (result.success) await this.gitStatus.refresh();
    } finally {
      this.syncing.set(null);
    }
  }
  protected dismissStatus(source: 'action' | 'launcher'): void {
    if (source === 'action') this.setActionStatus(null);
    else this.launchers.clearStatus();
  }
  /** A success clears itself after {@link STATUS_AUTO_CLEAR_MS}; an error stays. */
  private setActionStatus(status: LaunchStatus | null): void {
    this.cancelActionClear();
    this.actionStatus.set(status);
    if (status?.kind !== 'success') return;
    // Outside the zone, like the Task view's PR timer: a pending timer inside
    // it keeps the app from reading as stable. The signal write still
    // schedules change detection.
    this.actionClearTimer = this.zone.runOutsideAngular(() =>
      setTimeout(() => {
        this.actionClearTimer = null;
        this.actionStatus.set(null);
      }, STATUS_AUTO_CLEAR_MS),
    );
  }
  private cancelActionClear(): void {
    if (this.actionClearTimer === null) return;
    clearTimeout(this.actionClearTimer);
    this.actionClearTimer = null;
  }
  protected openWorkspace(request: OpenInRequest): void {
    const root = this.gitStatus.activeWorkspacePath();
    if (root) void this.launchers.openWorkspace(request.target, root);
  }
  protected closePicker(): void {
    this.pickerOpen.set(false);
    this.branchTrigger()?.nativeElement.focus();
  }
  protected closeDetails(): void {
    this.detailsOpen.set(false);
    this.detailsTrigger()?.nativeElement.focus();
  }
  protected closeStash(): void {
    this.stashOpen.set(false);
    this.stashTrigger()?.nativeElement.focus();
  }
}
