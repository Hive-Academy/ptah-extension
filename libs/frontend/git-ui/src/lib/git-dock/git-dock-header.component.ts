import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  ArrowUpFromLine,
  GitBranch,
  Info,
  LucideAngularModule,
  PanelLeft,
  PanelLeftClose,
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

@Component({
  selector: 'ptah-git-dock-header',
  standalone: true,
  imports: [
    LucideAngularModule,
    BranchPickerDropdownComponent,
    BranchDetailsPopoverComponent,
    OpenInButtonComponent,
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
          @if (gitStatus.branch().ahead) {
            <span class="text-info">↑{{ gitStatus.branch().ahead }}</span>
          }
          @if (gitStatus.branch().behind) {
            <span class="text-warning">↓{{ gitStatus.branch().behind }}</span>
          }
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
      @if (gitBranches.stashCount()) {
        <span>stash {{ gitBranches.stashCount() }}</span>
      }
      <span class="ml-auto"></span>
      <ptah-open-in-button
        [targets]="launchers.targets()"
        [root]="gitStatus.activeWorkspacePath() ?? ''"
        (open)="openWorkspace($event)"
      />
      @if (gitStatus.branch().ahead > 0) {
        <button
          type="button"
          data-testid="git-push-button"
          class="btn btn-xs"
          [disabled]="pushing()"
          (click)="push()"
        >
          <lucide-angular [img]="PushIcon" class="h-3 w-3" />Push
        </button>
      }
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
  protected readonly PanelLeftIcon = PanelLeft;
  protected readonly PanelLeftCloseIcon = PanelLeftClose;
  protected readonly pickerOpen = signal(false);
  protected readonly detailsOpen = signal(false);
  protected readonly pushing = signal(false);
  private readonly branchTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('branchTrigger');
  private readonly detailsTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('detailsTrigger');
  protected readonly actionStatus = signal<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  protected async push(): Promise<void> {
    if (this.pushing()) return;
    this.pushing.set(true);
    try {
      const result = await this.gitBranches.push();
      this.actionStatus.set(
        result.success
          ? { kind: 'success', message: 'Push completed.' }
          : { kind: 'error', message: result.error ?? 'Push failed.' },
      );
    } finally {
      this.pushing.set(false);
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
}
