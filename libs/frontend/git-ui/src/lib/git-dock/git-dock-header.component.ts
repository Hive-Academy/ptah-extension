import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
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
} from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';
import { BranchPickerDropdownComponent } from '../branch-picker/branch-picker-dropdown.component';
import { BranchDetailsPopoverComponent } from '../branch-picker/branch-details-popover.component';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
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
    <div
      class="relative flex h-8 flex-shrink-0 items-center gap-1 border-b border-base-content/10 bg-base-200 px-2 text-xs"
      data-testid="git-dock-header"
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
      <div class="relative flex items-center">
        <button
          #branchTrigger
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          data-testid="current-branch-button"
          aria-haspopup="dialog"
          [attr.aria-expanded]="pickerOpen()"
          (click)="pickerOpen.set(!pickerOpen())"
        >
          <lucide-angular [img]="BranchIcon" class="h-3 w-3" />{{
            gitBranches.currentBranch() || gitStatus.branchName()
          }}
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
      <span class="ml-auto"></span>
      <ptah-open-in-button
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
          <span class="text-warning">↓{{ gitStatus.branch().behind }}</span>
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
          <span class="text-info">↑{{ gitStatus.branch().ahead }}</span>
        } @else {
          Push
        }
      </button>
    </div>
    @if (actionStatus(); as message) {
      <div
        role="status"
        class="border-b border-base-content/10 px-3 py-1 text-xs"
        [class.text-error]="message.kind === 'error'"
      >
        {{ message.message }}
      </div>
    } @else if (launchers.launchStatus(); as message) {
      <div
        role="status"
        class="border-b border-base-content/10 px-3 py-1 text-xs"
        [class.text-error]="message.kind === 'error'"
      >
        {{ message.message }}
      </div>
    }
  }`,
})
export class GitDockHeaderComponent {
  protected readonly gitStatus = inject(GitStatusService);
  protected readonly gitBranches = inject(GitBranchesService);
  protected readonly launchers = inject(EditorLauncherService);
  protected readonly review = inject(GitReviewService);
  protected readonly layout = inject(ElectronLayoutService);
  protected readonly BranchIcon = GitBranch;
  protected readonly InfoIcon = Info;
  protected readonly PushIcon = ArrowUpFromLine;
  protected readonly PullIcon = ArrowDownToLine;
  protected readonly FetchIcon = RefreshCw;
  protected readonly StashIcon = Archive;
  protected readonly PanelLeftIcon = PanelLeft;
  protected readonly PanelLeftCloseIcon = PanelLeftClose;
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
  protected readonly actionStatus = signal<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  protected async sync(action: SyncAction): Promise<void> {
    if (this.syncing()) return;
    const workspace = this.gitStatus.activeWorkspacePath();
    if (!workspace) return;
    this.syncing.set(action);
    this.actionStatus.set(null);
    const copy = SYNC_COPY[action];
    try {
      const result = await this.gitBranches[action]();
      if (this.gitStatus.activeWorkspacePath() !== workspace) return;
      this.actionStatus.set(
        result.success
          ? { kind: 'success', message: copy.done }
          : { kind: 'error', message: result.error ?? copy.failed },
      );
      if (result.success) await this.gitStatus.refresh();
    } finally {
      this.syncing.set(null);
    }
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
