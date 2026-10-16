import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import {
  GitBranch,
  LoaderCircle,
  LucideAngularModule,
  TriangleAlert,
} from 'lucide-angular';
import { ChangeSetActionsService } from '../../../services/change-set/change-set-actions.service';
import {
  SessionGitStatsStore,
  sessionBranch,
  sessionWorkingRoot,
} from '../../../services/session-git-stats/session-git-stats.store';

let nextGitId = 0;

/**
 * The inspector GIT section (design 4.4): branch and the uncommitted
 * `+add −del` counts of the session's working root, shared through
 * `SessionGitStatsStore` (tracked while the section renders). The
 * ahead / behind pair is never rendered (G3: no per-session source).
 * `Retry` re-tracks the root; `Review changes` opens the host's existing
 * review surface.
 */
@Component({
  selector: 'ptah-inspector-git-section',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let git = state();
    <section class="border-t border-surface-border p-4" [attr.aria-labelledby]="headingId">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h3 [id]="headingId" class="sec-label text-[10.5px] font-semibold uppercase">GIT</h3>
        @if (git.kind === 'known') {
          <button
            type="button"
            class="inline-flex h-6 items-center text-xs font-medium text-[var(--ptah-link)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            (click)="reviewChanges()"
          >
            Review changes
          </button>
        }
      </div>
      @switch (git.kind) {
        @case ('known') {
          <div class="flex items-center gap-2 text-xs">
            <lucide-angular [img]="GitBranchIcon" class="size-3.5 shrink-0 text-base-content-muted" aria-hidden="true" />
            <span class="min-w-0 truncate font-mono text-xs font-medium" [attr.title]="branch()">{{ branch() ?? 'Detached HEAD' }}</span>
            <span
              class="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs font-medium"
              [attr.title]="git.partial ? 'Some files could not be counted' : 'Uncommitted changes'"
            >
              <span class="diff-add-text">+{{ git.additions }}{{ git.partial ? '+' : '' }}</span>
              <span class="diff-del-text">&#8722;{{ git.deletions }}{{ git.partial ? '+' : '' }}</span>
            </span>
          </div>
        }
        @case ('unknown') {
          @if (git.reason === 'failed') {
            <div role="alert" class="flex items-center gap-1.5 text-xs text-state-err">
              <lucide-angular [img]="TriangleAlertIcon" class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="min-w-0 flex-1">Could not read git status</span>
              <button
                type="button"
                class="inline-flex h-6 min-w-6 items-center gap-1 px-1.5 text-xs font-medium text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label="Retry reading git status"
                [attr.aria-busy]="retrying() ? 'true' : null"
                (click)="retry()"
              >
                @if (retrying()) {
                  <lucide-angular [img]="LoaderIcon" class="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                }
                Retry
              </button>
            </div>
          } @else {
            <p class="text-xs text-base-content-muted">Git changes unavailable</p>
          }
        }
        @default {
          <p class="flex items-center gap-2 text-xs text-base-content-muted">
            <lucide-angular [img]="GitBranchIcon" class="size-3.5 shrink-0" aria-hidden="true" />
            Not a git repository
          </p>
        }
      }
    </section>
  `,
})
export class InspectorGitSectionComponent {
  private readonly tabs = inject(TabManagerService);
  private readonly gitStore = inject(SessionGitStatsStore);
  private readonly vscode = inject(VSCodeService);
  private readonly changeSetActions = inject(ChangeSetActionsService);

  readonly tabId = input.required<string>();

  protected readonly GitBranchIcon = GitBranch;
  protected readonly TriangleAlertIcon = TriangleAlert;
  protected readonly LoaderIcon = LoaderCircle;
  protected readonly headingId = `ptah-git-h-${++nextGitId}`;

  /** Bumped by `Retry` so the tracking effect untracks and tracks again. */
  private readonly retryNonce = signal(0);
  protected readonly retrying = signal(false);

  private readonly lookup = computed(() =>
    this.tabs.findTabByIdAcrossWorkspaces(this.tabId()),
  );

  private readonly gitRoot = computed(() => {
    const found = this.lookup();
    return found
      ? sessionWorkingRoot(
          found.tab,
          found.workspacePath ?? null,
          this.vscode.config().workspaceRoot,
        )
      : null;
  });

  // Default equality: the store publishes a new object only on a real
  // change, including a branch-only checkout.
  protected readonly state = computed(() =>
    this.gitStore.stateFor(this.gitRoot()),
  );

  protected readonly branch = computed(() =>
    sessionBranch(this.lookup()?.tab, this.state()),
  );

  constructor() {
    effect((onCleanup) => {
      const root = this.gitRoot();
      const tabId = this.tabId();
      this.retryNonce();
      if (root) onCleanup(this.gitStore.track(root, tabId));
    });
    // A retry ends when the state leaves the failed read.
    effect(() => {
      const git = this.state();
      if (git.kind !== 'unknown' || git.reason !== 'failed')
        this.retrying.set(false);
    });
  }

  protected retry(): void {
    if (this.retrying()) return;
    this.retrying.set(true);
    this.retryNonce.update((n) => n + 1);
  }

  protected reviewChanges(): void {
    this.changeSetActions.openScm().catch((error: unknown) => {
      // openScm already logs and restores the dock; nothing else to undo.
      console.error('[SessionInspector] Could not open the review', error);
    });
  }
}
