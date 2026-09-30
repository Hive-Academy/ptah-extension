import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { GitCheckoutParams } from '@ptah-extension/shared';
import { GitBranchesService } from '../services/git-branches.service';

/** A switch git refused because local changes would be overwritten. */
interface BlockedSwitch {
  branch: string;
  track: boolean;
  conflictingPaths: readonly string[];
}

/** How to treat local changes when retrying a blocked switch. */
type SwitchMode = Pick<GitCheckoutParams, 'stash' | 'force'>;

@Component({
  selector: 'ptah-branch-picker-dropdown',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
  template: `
    @if (isOpen()) {
      <div
        role="dialog"
        aria-label="Branch picker"
        data-testid="branch-picker"
        class="absolute top-full left-0 z-50 mt-1 min-w-72 rounded border border-base-content/10 bg-base-200 shadow-lg"
      >
        <input
          class="input input-xs m-2 w-[calc(100%-1rem)]"
          aria-label="Search branches"
          placeholder="Search branches…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
        @if (blockedSwitch(); as blocked) {
          <div
            role="alert"
            data-testid="blocked-switch"
            class="flex flex-col gap-1 p-2 text-xs bg-warning/10"
          >
            <p class="text-warning">
              Local changes would be overwritten by switching to
              <span class="font-mono">{{ blocked.branch }}</span>.
            </p>
            @if (blocked.conflictingPaths.length) {
              <ul
                aria-label="Files that would be overwritten"
                data-testid="conflicting-paths"
                class="max-h-24 overflow-auto font-mono text-[10px] opacity-80"
              >
                @for (path of blocked.conflictingPaths; track path) {
                  <li class="truncate" [title]="path">{{ path }}</li>
                }
              </ul>
            }
            @if (confirmingDiscard()) {
              <p class="text-error">
                Discard all uncommitted changes? This cannot be undone.
              </p>
              <div class="flex gap-1">
                <button
                  #discardConfirmButton
                  type="button"
                  class="btn btn-error btn-xs"
                  data-testid="confirm-discard"
                  [disabled]="busy()"
                  (click)="retryBlocked({ force: true })"
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  [disabled]="busy()"
                  (click)="confirmingDiscard.set(false)"
                >
                  Back
                </button>
              </div>
            } @else {
              <div class="flex flex-wrap gap-1">
                <button
                  #stashSwitchButton
                  type="button"
                  class="btn btn-primary btn-xs"
                  data-testid="stash-switch"
                  [disabled]="busy()"
                  (click)="retryBlocked({ stash: true })"
                >
                  Stash &amp; switch
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  [disabled]="busy()"
                  (click)="cancelBlocked()"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs text-error"
                  data-testid="discard-switch"
                  [disabled]="busy()"
                  (click)="confirmingDiscard.set(true)"
                >
                  Discard &amp; switch…
                </button>
              </div>
            }
          </div>
        }
        @if (error()) {
          <div role="alert" class="p-2 text-error text-xs">{{ error() }}</div>
        }
        <div class="max-h-72 overflow-auto p-1">
          @if (!query() && gitBranches.recentBranches().length) {
            <p class="px-2 text-[10px] uppercase opacity-50">Recent</p>
          }
          @for (name of recent(); track name) {
            <button
              class="btn btn-ghost btn-xs w-full justify-start"
              (click)="switchTo(name)"
            >
              {{ name }}
            </button>
          }
          <p class="px-2 text-[10px] uppercase opacity-50">Local</p>
          @for (branch of local(); track branch.name) {
            <button
              class="btn btn-ghost btn-xs w-full justify-start"
              [disabled]="branch.isCurrent"
              (click)="switchTo(branch.name)"
            >
              {{ branch.name }}
              @if (branch.ahead) {
                <span>↑{{ branch.ahead }}</span>
              }
              @if (branch.behind) {
                <span>↓{{ branch.behind }}</span>
              }
            </button>
          }
          <p class="px-2 text-[10px] uppercase opacity-50">Remote</p>
          @for (branch of remote(); track branch.name) {
            <button
              class="btn btn-ghost btn-xs w-full justify-start"
              (click)="switchTo(branch.name, true)"
            >
              {{ branch.name }}
            </button>
          }
        </div>
        <div class="flex gap-1 border-t border-base-content/10 p-2">
          <input
            class="input input-xs flex-1"
            aria-label="New branch name"
            placeholder="New branch"
            [ngModel]="newBranch()"
            (ngModelChange)="newBranch.set($event)"
            (keydown.enter)="create()"
          />
          <button
            class="btn btn-primary btn-xs"
            [disabled]="!newBranch().trim()"
            (click)="create()"
          >
            Create
          </button>
        </div>
      </div>
    }
  `,
})
export class BranchPickerDropdownComponent {
  protected readonly gitBranches = inject(GitBranchesService);
  private readonly element = inject(ElementRef<HTMLElement>);
  readonly isOpen = input.required<boolean>();
  readonly closed = output<void>();
  readonly branchCheckedOut = output<string>();
  protected readonly query = signal('');
  protected readonly newBranch = signal('');
  protected readonly blockedSwitch = signal<BlockedSwitch | null>(null);
  protected readonly confirmingDiscard = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly stashSwitchButton =
    viewChild<ElementRef<HTMLButtonElement>>('stashSwitchButton');
  private readonly discardConfirmButton = viewChild<
    ElementRef<HTMLButtonElement>
  >('discardConfirmButton');
  private readonly lowerQuery = computed(() =>
    this.query().trim().toLowerCase(),
  );
  protected readonly local = computed(() =>
    this.visibleBranches(this.gitBranches.localBranches()),
  );
  protected readonly remote = computed(() =>
    this.visibleBranches(this.gitBranches.remoteBranches()),
  );
  protected readonly recent = computed(() =>
    this.gitBranches
      .recentBranches()
      .filter((name) => name.toLowerCase().includes(this.lowerQuery())),
  );

  constructor() {
    // Move focus to the step's primary action when the blocked-switch prompt
    // appears and when it advances to the discard confirmation.
    effect(() => this.stashSwitchButton()?.nativeElement.focus());
    effect(() => this.discardConfirmButton()?.nativeElement.focus());
  }

  private visibleBranches<T extends { name: string; lastCommitTime?: number }>(
    branches: readonly T[],
  ): T[] {
    const query = this.lowerQuery();
    if (query) {
      return branches.filter((branch) =>
        branch.name.toLowerCase().includes(query),
      );
    }
    return [...branches]
      .sort(
        (left, right) =>
          (right.lastCommitTime ?? 0) - (left.lastCommitTime ?? 0) ||
          left.name.localeCompare(right.name),
      )
      .slice(0, 10);
  }

  /** `track` marks a remote-tracking ref: the backend creates or reuses the local branch. */
  protected switchTo(branch: string, track = false): void {
    this.cancelBlocked();
    void this.runSwitch(branch, track, {});
  }

  protected retryBlocked(mode: SwitchMode): void {
    const blocked = this.blockedSwitch();
    if (blocked) void this.runSwitch(blocked.branch, blocked.track, mode);
  }

  protected cancelBlocked(): void {
    this.blockedSwitch.set(null);
    this.confirmingDiscard.set(false);
  }

  private async runSwitch(
    branch: string,
    track: boolean,
    mode: SwitchMode,
  ): Promise<void> {
    const params: GitCheckoutParams = { branch, ...mode };
    if (track) params.track = true;
    this.error.set(null);
    this.busy.set(true);
    const result = await this.gitBranches.checkout(params);
    this.busy.set(false);
    if (result.success) {
      this.cancelBlocked();
      this.completeSwitch(track ? localNameOf(branch) : branch);
    } else if (result.dirty && !mode.force && !mode.stash) {
      this.confirmingDiscard.set(false);
      this.blockedSwitch.set({
        branch,
        track,
        conflictingPaths: result.conflictingPaths ?? [],
      });
    } else {
      this.cancelBlocked();
      this.error.set(result.error ?? `Could not switch to ${branch}.`);
    }
  }

  protected create(): void {
    const branch = this.newBranch().trim();
    if (branch) void this.createBranch(branch);
  }

  private async createBranch(branch: string): Promise<void> {
    this.error.set(null);
    const result = await this.gitBranches.checkout({ branch, createNew: true });
    if (result.success) this.completeSwitch(branch);
    else
      this.error.set(
        `Could not create branch ${branch}: ${result.error ?? 'git gave no reason.'}`,
      );
  }

  private completeSwitch(branch: string): void {
    this.gitBranches.recordVisitedBranch(branch);
    this.branchCheckedOut.emit(branch);
    this.close();
  }

  close(): void {
    if (this.isOpen()) this.closed.emit();
  }

  onDocumentClick(event: MouseEvent): void {
    if (
      this.isOpen() &&
      event.target instanceof Node &&
      !this.element.nativeElement.contains(event.target)
    )
      this.close();
  }
}

/** `origin/feature/x` → `feature/x`: the local branch a tracked switch lands on. */
function localNameOf(remoteRef: string): string {
  return remoteRef.slice(remoteRef.indexOf('/') + 1);
}
