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
import {
  AlertTriangle,
  CircleAlert,
  LucideAngularModule,
} from 'lucide-angular';
import type {
  GitCheckoutParams,
  GitCheckoutResult,
} from '@ptah-extension/shared';
import { GitBranchesService } from '../services/git-branches.service';

/** A switch git refused because local changes would be overwritten. */
interface BlockedSwitch {
  branch: string;
  track: boolean;
  conflictingPaths: readonly string[];
  /**
   * Set when a confirmed discard was itself refused (untracked files git will
   * not delete): the backend's reason. Discarding again cannot help, so only
   * stashing is offered.
   */
  discardRefusal: string | null;
}

/** A successful "Stash & switch" whose stash entry the user should know about. */
interface StashNotice {
  /** The entry's stash name right after the switch: the newest entry. */
  label: string;
  /** Commit SHA of the entry, for the tooltip. */
  sha: string;
}

/** How to treat local changes when retrying a blocked switch. */
type SwitchMode = Pick<GitCheckoutParams, 'stash' | 'force'>;

@Component({
  selector: 'ptah-branch-picker-dropdown',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
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
        class="surface-3 absolute top-full left-0 z-50 mt-1 min-w-72 rounded"
      >
        <input
          class="input input-xs m-2 w-[calc(100%-1rem)] focus-visible:outline-[oklch(var(--s))]"
          aria-label="Search branches"
          placeholder="Search branches…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
        <!-- Copy here is text-base-content: text-warning / text-error on these
             tints, and error-content on a btn-error fill, fail AA in at least
             one anubis theme. The hue rides on tints, borders and icons. -->
        @if (blockedSwitch(); as blocked) {
          <div
            role="alert"
            data-testid="blocked-switch"
            class="flex flex-col gap-1 p-2 text-xs text-base-content bg-warning/10"
          >
            <p class="flex items-start gap-1">
              <lucide-angular
                [img]="WarningIcon"
                class="w-3 h-3 mt-0.5 flex-shrink-0 text-warning"
                aria-hidden="true"
              />
              <span>
                Local changes would be overwritten by switching to
                <span class="font-mono">{{ blocked.branch }}</span
                >.
              </span>
            </p>
            @if (blocked.discardRefusal) {
              <div
                class="flex items-start gap-1 rounded border border-error/60 bg-error/10 px-1.5 py-1"
              >
                <lucide-angular
                  [img]="ErrorIcon"
                  class="w-3 h-3 mt-0.5 flex-shrink-0 text-error"
                  aria-hidden="true"
                />
                <p
                  class="flex-1 min-w-0 break-words"
                  data-testid="discard-refusal"
                >
                  {{ blocked.discardRefusal }}
                </p>
              </div>
            }
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
              <div
                class="flex items-start gap-1 rounded border border-error/60 bg-error/10 px-1.5 py-1"
              >
                <lucide-angular
                  [img]="ErrorIcon"
                  class="w-3 h-3 mt-0.5 flex-shrink-0 text-error"
                  aria-hidden="true"
                />
                <p class="flex-1 min-w-0">
                  Discard all uncommitted changes? This cannot be undone.
                </p>
              </div>
              <div class="flex gap-1">
                <!-- focus: rather than focus-visible: — focus is moved here by
                     script after a pointer click, which Chromium does not
                     treat as :focus-visible. The ! beats styles.css's
                     button:focus:not(:focus-visible) { outline: none }. -->
                <button
                  #discardConfirmButton
                  type="button"
                  class="btn btn-outline btn-xs border-error bg-error/10 text-base-content
                         focus:!outline focus:!outline-2 focus:!outline-offset-2
                         focus:!outline-[oklch(var(--s))]"
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
                  class="btn btn-primary btn-xs
                         focus:!outline focus:!outline-2 focus:!outline-offset-2
                         focus:!outline-[oklch(var(--s))]"
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
                @if (!blocked.discardRefusal) {
                  <!-- Outline, not ghost: anubis-light forces .btn-ghost to
                       base-content ink, which erased text-error. The error
                       border is the destructive cue; the unfilled outline keeps
                       it secondary to the filled Stash & switch. -->
                  <button
                    type="button"
                    class="btn btn-outline btn-xs border-error text-base-content"
                    data-testid="discard-switch"
                    [disabled]="busy()"
                    (click)="confirmingDiscard.set(true)"
                  >
                    Discard &amp; switch…
                  </button>
                }
              </div>
            }
          </div>
        }
        @if (error(); as message) {
          <div
            class="m-2 flex items-start gap-1 rounded border border-error/60 bg-error/10 px-1.5 py-1 text-xs text-base-content"
          >
            <lucide-angular
              [img]="ErrorIcon"
              class="w-3 h-3 mt-0.5 flex-shrink-0 text-error"
              aria-hidden="true"
            />
            <p
              role="alert"
              data-testid="picker-error"
              class="flex-1 min-w-0 break-words"
            >
              {{ message }}
            </p>
          </div>
        }
        @if (stashNotice(); as notice) {
          <div
            role="status"
            data-testid="stash-notice"
            class="flex items-start gap-2 p-2 text-xs bg-info/10"
          >
            <p class="flex-1">
              Changes stashed as
              <span class="font-mono" [title]="notice.sha">{{
                notice.label
              }}</span>
              — find them in Stashes.
            </p>
            <button
              #stashNoticeDismiss
              type="button"
              class="btn btn-ghost btn-xs
                     focus:!outline focus:!outline-2 focus:!outline-offset-2
                     focus:!outline-[oklch(var(--s))]"
              data-testid="dismiss-stash-notice"
              (click)="close()"
            >
              Dismiss
            </button>
          </div>
        }
        <div class="max-h-72 overflow-auto p-1">
          @if (!query() && gitBranches.recentBranches().length) {
            <p class="px-2 text-[10px] uppercase opacity-50">Recent</p>
          }
          @for (name of recent(); track name) {
            <button
              class="btn btn-ghost btn-xs w-full justify-start"
              [disabled]="busy()"
              (click)="switchTo(name)"
            >
              {{ name }}
            </button>
          }
          <p class="px-2 text-[10px] uppercase opacity-50">Local</p>
          @for (branch of local(); track branch.name) {
            <button
              class="btn btn-ghost btn-xs w-full justify-start"
              [disabled]="branch.isCurrent || busy()"
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
              [disabled]="busy()"
              (click)="switchTo(branch.name, true)"
            >
              {{ branch.name }}
            </button>
          }
        </div>
        <div class="flex gap-1 border-t border-base-content/10 p-2">
          <input
            class="input input-xs flex-1 focus-visible:outline-[oklch(var(--s))]"
            aria-label="New branch name"
            placeholder="New branch"
            [ngModel]="newBranch()"
            (ngModelChange)="newBranch.set($event)"
            (keydown.enter)="create()"
          />
          <button
            class="btn btn-primary btn-xs"
            [disabled]="!newBranch().trim() || busy()"
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
  protected readonly WarningIcon = AlertTriangle;
  protected readonly ErrorIcon = CircleAlert;
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
  protected readonly stashNotice = signal<StashNotice | null>(null);
  private readonly stashNoticeDismiss =
    viewChild<ElementRef<HTMLButtonElement>>('stashNoticeDismiss');
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
    effect(() => this.stashNoticeDismiss()?.nativeElement.focus());
    // The stash notice belongs to the switch that produced it: however the
    // picker closes (Dismiss, Escape, outside click, trigger), it goes too.
    effect(() => {
      if (!this.isOpen()) this.stashNotice.set(null);
    });
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
    if (this.busy()) return;
    this.cancelBlocked();
    void this.runSwitch(branch, track, {});
  }

  protected retryBlocked(mode: SwitchMode): void {
    const blocked = this.blockedSwitch();
    if (blocked) void this.runSwitch(blocked.branch, blocked.track, mode);
  }

  /**
   * Run one checkout with `busy` held, so every entry point (rows, Create,
   * the blocked-switch actions) is disabled until it settles. Null when a
   * checkout is already running.
   */
  private async checkoutExclusively(
    params: GitCheckoutParams,
  ): Promise<GitCheckoutResult | null> {
    if (this.busy()) return null;
    this.busy.set(true);
    try {
      return await this.gitBranches.checkout(params);
    } finally {
      this.busy.set(false);
    }
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
    if (this.busy()) return;
    const params: GitCheckoutParams = { branch, ...mode };
    if (track) params.track = true;
    this.error.set(null);
    this.stashNotice.set(null);
    const result = await this.checkoutExclusively(params);
    if (!result) return;
    if (result.success) {
      this.cancelBlocked();
      const landedOn = track ? localNameOf(branch) : branch;
      if (result.stashRef) {
        // Keep the picker open on the notice so the user learns where their
        // changes went; Dismiss (or any other close) closes it.
        this.recordSwitch(landedOn);
        // The short SHA, not `stash@{0}`: the stash stack is shared by every
        // worktree, so an ordinal can name another entry a moment later.
        this.stashNotice.set({
          label: result.stashRef.slice(0, 7),
          sha: result.stashRef,
        });
      } else {
        this.completeSwitch(landedOn);
      }
    } else if (result.dirty && !mode.stash) {
      // A refused discard (untracked blockers) re-prompts with git's reason
      // and without the discard option, which cannot clear them.
      this.confirmingDiscard.set(false);
      this.blockedSwitch.set({
        branch,
        track,
        conflictingPaths: result.conflictingPaths ?? [],
        discardRefusal: mode.force
          ? (result.error ?? 'Git refused to discard these changes.')
          : null,
      });
    } else {
      this.cancelBlocked();
      this.error.set(result.error ?? `Could not switch to ${branch}.`);
    }
  }

  protected create(): void {
    const branch = this.newBranch().trim();
    if (branch && !this.busy()) void this.createBranch(branch);
  }

  private async createBranch(branch: string): Promise<void> {
    this.error.set(null);
    const result = await this.checkoutExclusively({ branch, createNew: true });
    if (!result) return;
    if (result.success) this.completeSwitch(branch);
    else
      this.error.set(
        `Could not create branch ${branch}: ${result.error ?? 'git gave no reason.'}`,
      );
  }

  private completeSwitch(branch: string): void {
    this.recordSwitch(branch);
    this.close();
  }

  private recordSwitch(branch: string): void {
    this.gitBranches.recordVisitedBranch(branch);
    this.branchCheckedOut.emit(branch);
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
