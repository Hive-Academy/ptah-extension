import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  CircleAlert,
  GitMerge,
  LucideAngularModule,
  RotateCw,
} from 'lucide-angular';
import type {
  GitHistoryCommit,
  GitLogResult,
  GitLogUnavailableReason,
} from '@ptah-extension/shared';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitHistoryService } from '../services/git-history.service';
import { GitStatusService } from '../services/git-status.service';
import { ReviewNavigationService } from '../services/review-navigation.service';
import { stashAge } from '../stash/stash-popover.component';
import { HistoryStashSectionComponent } from './history-stash-section.component';

/** One `git:log` answer, with the workspace and HEAD state it was read for. */
interface LogRead {
  workspaceRoot: string;
  key: string;
  result: GitLogResult;
}

/** A commit row as the template shows it. */
interface CommitRow {
  commit: GitHistoryCommit;
  relative: string;
  absolute: string;
  isMerge: boolean;
  title: string;
}

const UNAVAILABLE_MESSAGES: Record<GitLogUnavailableReason, string> = {
  'not-a-repository': 'This folder is not a git repository.',
  'git-failed': 'Could not read the commit history.',
};

let instanceCount = 0;

function toRow(commit: GitHistoryCommit, now: number): CommitRow {
  const time = Date.parse(commit.authorDate);
  const valid = Number.isFinite(time);
  const isMerge = commit.parentCount >= 2;
  const parent = isMerge ? 'its first parent' : 'its parent';
  return {
    commit,
    relative: valid ? stashAge(time, now) : '',
    absolute: valid ? new Date(time).toLocaleString() : commit.authorDate,
    isMerge,
    title: `Open ${commit.shortSha} read-only, compared with ${parent}`,
  };
}

/**
 * HistoryTimelineComponent — body of the review shell's History tab
 * (TASK_2026_576 Requirement 12, design-spec §12).
 *
 * - Stashes ({@link HistoryStashSectionComponent}).
 * - The branch's own commits from `git:log`, newest first: "Commits since
 *   <base>", or "Recent commits" on the base branch itself. Selecting a commit
 *   opens it read-only against its parent through
 *   {@link ReviewNavigationService.openHistorical}. A root commit has no parent
 *   to compare with, so its row offers "Initial commit — open in editor".
 *
 * The log is read when the tab shows, and again when it shows after HEAD,
 * the branch or a push moved (or a read failed). No timer: nothing here runs
 * while the tab is hidden.
 */
@Component({
  selector: 'ptah-history-timeline',
  standalone: true,
  imports: [
    LucideAngularModule,
    OpenInButtonComponent,
    HistoryStashSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Truncation priority (V-8): below 400 px the author steps aside so the
  // subject keeps the row. Visually hidden, not removed, so a screen reader
  // still reads it. A CSS container query, no observer.
  styles: [
    `
      .history-timeline {
        container-type: inline-size;
      }
      @container (max-width: 400px) {
        .history-author {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
        }
      }
    `,
  ],
  template: `
    <div
      class="history-timeline flex flex-col gap-3 p-3 text-xs"
      data-testid="history-timeline"
    >
      <ptah-history-stash-section [shown]="shown()" />

      <section
        class="flex flex-col gap-1 border-t border-base-content/10 pt-2"
        [attr.aria-labelledby]="headingId"
        data-testid="history-commits"
      >
        <div class="flex items-center justify-between gap-2">
          <h3
            [id]="headingId"
            class="m-0 text-sm font-medium"
            data-testid="history-heading"
          >
            {{ heading() }}
          </h3>
          <button
            type="button"
            class="btn btn-ghost btn-xs px-1"
            aria-label="Refresh history"
            title="Refresh history"
            data-testid="history-refresh"
            [disabled]="loading() || !gitStatus.activeWorkspacePath()"
            (click)="reload()"
          >
            <lucide-angular
              [img]="RefreshIcon"
              class="h-3 w-3"
              [class.animate-spin]="loading()"
              aria-hidden="true"
            />
          </button>
        </div>

        @if (ok(); as log) {
          @if (log.branch === null) {
            <p
              class="m-0 text-base-content-muted"
              data-testid="history-detached"
            >
              HEAD is detached. Showing the commits it points to.
            </p>
          }
        }

        @if (openError(); as error) {
          <!-- text-base-content with the error icon: text-error on base
               fails AA (design-spec §0). -->
          <p
            role="alert"
            class="m-0 flex items-start gap-1 text-base-content"
            data-testid="history-open-error"
          >
            <lucide-angular
              [img]="ErrorIcon"
              class="mt-0.5 h-3 w-3 flex-shrink-0 text-error"
              aria-hidden="true"
            />
            <span>{{ error }}</span>
          </p>
        }

        @if (unavailableMessage(); as message) {
          <div
            role="alert"
            class="flex items-center gap-2 rounded border border-base-content/10 px-2 py-1.5"
            data-testid="history-unavailable"
          >
            <lucide-angular
              [img]="ErrorIcon"
              class="h-3 w-3 flex-shrink-0 text-error"
              aria-hidden="true"
            />
            <span class="flex-1">{{ message }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              data-testid="history-retry"
              [disabled]="loading()"
              (click)="reload()"
            >
              Retry
            </button>
          </div>
        } @else if (ok(); as log) {
          @if (rows().length === 0) {
            <p
              class="m-0 py-6 text-center text-base-content-muted"
              data-testid="history-empty"
            >
              {{ emptyMessage() }}
            </p>
          } @else {
            <ul
              class="m-0 flex list-none flex-col gap-0.5 p-0"
              [attr.aria-labelledby]="headingId"
            >
              @for (row of rows(); track row.commit.sha) {
                <li>
                  @if (row.commit.isRoot) {
                    <div
                      class="flex items-center gap-2 rounded px-2 py-1"
                      data-testid="history-root-commit"
                    >
                      <span class="font-mono text-base-content-muted">{{
                        row.commit.shortSha
                      }}</span>
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span
                          class="truncate text-sm"
                          [title]="row.commit.subject"
                          >{{ row.commit.subject }}</span
                        >
                        <span class="text-base-content-muted"
                          >Initial commit — open in editor</span
                        >
                      </span>
                      <span
                        class="history-author flex-shrink-0 whitespace-nowrap text-base-content-muted"
                        >{{ row.commit.authorName }}</span
                      >
                      <time
                        class="flex-shrink-0 whitespace-nowrap text-[11px] text-base-content-muted"
                        [attr.datetime]="row.commit.authorDate"
                        [title]="row.absolute"
                        >{{ row.relative
                        }}<span class="sr-only"
                          >, {{ row.absolute }}</span
                        ></time
                      >
                      <ptah-open-in-button
                        mode="icon-only"
                        [targets]="launchers.targets()"
                        [root]="gitStatus.activeWorkspacePath() ?? ''"
                        (open)="openInEditor($event)"
                      />
                    </div>
                  } @else {
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                      data-testid="history-commit"
                      [title]="row.title"
                      [attr.aria-busy]="openingSha() === row.commit.sha"
                      (click)="select(row.commit)"
                    >
                      <span
                        class="flex-shrink-0 font-mono text-base-content-muted"
                        >{{ row.commit.shortSha }}</span
                      >
                      @if (row.isMerge) {
                        <span
                          class="flex items-center gap-0.5 text-base-content-muted"
                          data-testid="history-merge"
                        >
                          <lucide-angular
                            [img]="MergeIcon"
                            class="h-3 w-3"
                            aria-hidden="true"
                          />
                          <span>Merge</span>
                          <span class="sr-only"
                            >commit, compared with its first parent</span
                          >
                        </span>
                      }
                      <span
                        class="min-w-0 flex-1 truncate text-sm"
                        data-testid="history-commit-subject"
                        [title]="row.commit.subject"
                        >{{ row.commit.subject }}</span
                      >
                      <span
                        class="history-author flex-shrink-0 whitespace-nowrap text-base-content-muted"
                        data-testid="history-commit-author"
                        >{{ row.commit.authorName }}</span
                      >
                      <time
                        class="flex-shrink-0 whitespace-nowrap text-[11px] text-base-content-muted"
                        [attr.datetime]="row.commit.authorDate"
                        [title]="row.absolute"
                        >{{ row.relative
                        }}<span class="sr-only"
                          >, {{ row.absolute }}</span
                        ></time
                      >
                    </button>
                  }
                </li>
              }
            </ul>
            @if (log.truncated) {
              <p
                class="m-0 text-base-content-muted"
                data-testid="history-truncated"
              >
                Older commits are not shown.
              </p>
            }
          }
        } @else if (loading()) {
          <div
            class="flex items-center justify-center py-3"
            role="status"
            aria-label="Loading history"
            data-testid="history-loading"
          >
            <span class="loading loading-spinner loading-sm"></span>
          </div>
        } @else if (!gitStatus.activeWorkspacePath()) {
          <p
            class="m-0 py-6 text-center text-base-content-muted"
            data-testid="history-no-workspace"
          >
            Open a workspace folder to see its history.
          </p>
        }
      </section>
    </div>
  `,
})
export class HistoryTimelineComponent {
  /** Whether the History tab is the one showing; reads happen only then. */
  readonly shown = input(false);

  protected readonly gitStatus = inject(GitStatusService);
  protected readonly launchers = inject(EditorLauncherService);
  private readonly gitBranches = inject(GitBranchesService);
  private readonly history = inject(GitHistoryService);
  private readonly navigation = inject(ReviewNavigationService);

  protected readonly RefreshIcon = RotateCw;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly MergeIcon = GitMerge;

  protected readonly headingId = `history-commits-heading-${instanceCount++}`;

  private readonly read = signal<LogRead | null>(null);
  protected readonly loading = signal(false);
  protected readonly openingSha = signal<string | null>(null);
  /** The last open failure, pinned to the workspace it happened in. */
  private readonly openFailure = signal<{
    workspaceRoot: string | null;
    text: string;
  } | null>(null);
  protected readonly openError = computed(() => {
    const failure = this.openFailure();
    return failure?.workspaceRoot === this.gitStatus.activeWorkspacePath()
      ? failure.text
      : null;
  });

  /** Bumped by every read; a reply for an older request is dropped. */
  private request = 0;
  private inFlightKey: string | null = null;
  private destroyed = false;

  /**
   * What the list depends on besides the workspace: the branch, HEAD (the
   * last commit's hash) and pushes (a push can move `origin/HEAD`).
   */
  private readonly freshnessKey = computed(() =>
    [
      this.gitStatus.activeWorkspacePath() ?? '',
      this.gitStatus.branchName(),
      this.gitBranches.lastCommit()?.hash ?? '',
      String(this.gitBranches.pushCompletions()),
    ].join('\n'),
  );

  /** The latest answer, only for the workspace now active. */
  private readonly result = computed<GitLogResult | null>(() => {
    const read = this.read();
    return read?.workspaceRoot === this.gitStatus.activeWorkspacePath()
      ? read.result
      : null;
  });

  protected readonly ok = computed(() => {
    const result = this.result();
    return result?.status === 'ok' ? result : null;
  });

  protected readonly unavailableMessage = computed(() => {
    const result = this.result();
    return result?.status === 'unavailable'
      ? UNAVAILABLE_MESSAGES[result.reason]
      : null;
  });

  protected readonly heading = computed(() => {
    const log = this.ok();
    if (log?.mode === 'since-base' && log.base) {
      return `Commits since ${log.base}`;
    }
    if (log?.mode === 'recent') return 'Recent commits';
    return 'Commits';
  });

  protected readonly emptyMessage = computed(() =>
    this.ok()?.mode === 'recent'
      ? 'No commits yet.'
      : 'No commits yet on this branch.',
  );

  protected readonly rows = computed<CommitRow[]>(() => {
    const now = Date.now();
    return (this.ok()?.commits ?? []).map((commit) => toRow(commit, now));
  });

  constructor() {
    effect(() => {
      const shown = this.shown();
      const root = this.gitStatus.activeWorkspacePath();
      const key = this.freshnessKey();
      untracked(() => {
        if (shown && root && this.isStale(root, key)) {
          void this.load(root, key);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
  }

  /** Read again now: Retry and the refresh button. */
  protected reload(): void {
    const root = this.gitStatus.activeWorkspacePath();
    if (root) void this.load(root, this.freshnessKey());
  }

  protected async select(commit: GitHistoryCommit): Promise<void> {
    const workspaceRoot = this.gitStatus.activeWorkspacePath();
    this.openFailure.set(null);
    this.openingSha.set(commit.sha);
    const outcome = await this.navigation.openHistorical(commit.sha);
    if (this.destroyed) return;
    if (this.openingSha() === commit.sha) this.openingSha.set(null);
    if (!outcome.opened && outcome.error) {
      this.openFailure.set({ workspaceRoot, text: outcome.error });
    }
  }

  protected openInEditor(request: OpenInRequest): void {
    const root = this.gitStatus.activeWorkspacePath();
    if (root) void this.launchers.openWorkspace(request.target, root);
  }

  /** True unless the shown answer is a good read of this exact state. */
  private isStale(root: string, key: string): boolean {
    if (this.inFlightKey === key) return false;
    const read = this.read();
    return !(
      read?.workspaceRoot === root &&
      read.key === key &&
      read.result.status === 'ok'
    );
  }

  private async load(root: string, key: string): Promise<void> {
    const request = ++this.request;
    this.inFlightKey = key;
    // A reload or a moved HEAD replaces the list the error was about (MIN-3).
    this.openFailure.set(null);
    this.loading.set(true);
    const result = await this.history.readLog(root);
    if (this.destroyed || request !== this.request) return;
    this.inFlightKey = null;
    this.loading.set(false);
    this.read.set({ workspaceRoot: root, key, result });
  }
}
