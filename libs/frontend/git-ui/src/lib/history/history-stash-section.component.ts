import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  LucideAngularModule,
  X,
} from 'lucide-angular';
import type { GitStashFileEntry, StashEntry } from '@ptah-extension/shared';
import { GitBranchesService } from '../services/git-branches.service';
import {
  GitStashService,
  type GitStashMutation,
} from '../services/git-stash.service';
import { GitStatusService } from '../services/git-status.service';
import { GitConfirmDialogComponent } from '../shared/git-confirm-dialog.component';
import { stashAge } from '../stash/stash-popover.component';

const STATUS_LABELS: Record<GitStashFileEntry['status'], string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
};

/** The stash a pending drop question is about, pinned to its workspace. */
interface DropTarget {
  workspaceRoot: string;
  entry: StashEntry;
}

let instanceCount = 0;

/**
 * The History tab's Stashes section (design-spec §12, parity §5 rows 105-113):
 * a collapsible list of `stash@{N}` entries with message, branch and age.
 * Selecting an entry lists its files; a file opens the parent-vs-stash diff
 * through {@link GitStashService.openFileDiff} (the review canvas while one is
 * mounted). Apply and Pop run directly; Drop asks through the git-ui confirm
 * dialog first.
 */
@Component({
  selector: 'ptah-history-stash-section',
  standalone: true,
  imports: [LucideAngularModule, GitConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex flex-col gap-1 text-xs"
      [attr.aria-labelledby]="headingId"
      data-testid="history-stashes"
    >
      <h3 [id]="headingId" class="m-0 text-sm font-medium">
        <button
          type="button"
          class="flex items-center gap-1 rounded px-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          data-testid="history-stashes-toggle"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="listId"
          (click)="expanded.set(!expanded())"
        >
          <lucide-angular
            [img]="expanded() ? ChevronDownIcon : ChevronRightIcon"
            class="h-3 w-3 flex-shrink-0"
            aria-hidden="true"
          />
          <span>Stashes ({{ stash.entries().length }})</span>
        </button>
      </h3>

      <div [id]="listId" [hidden]="!expanded()">
        @if (stash.error(); as error) {
          <!-- text-base-content with the error icon: text-error on base
               fails AA (design-spec §0). -->
          <p
            role="alert"
            class="m-0 flex items-start gap-1 px-2 py-1 text-base-content"
            data-testid="history-stash-error"
          >
            <lucide-angular
              [img]="ErrorIcon"
              class="mt-0.5 h-3 w-3 flex-shrink-0 text-error"
              aria-hidden="true"
            />
            <span>{{ error }}</span>
          </p>
        }
        <!-- Always in the DOM so a changed text is announced. -->
        <div role="status" data-testid="history-stash-status">
          @if (dropNotice(); as notice) {
            <p
              class="m-0 px-2 py-1 text-base-content"
              data-testid="history-stash-drop-notice"
            >
              {{ notice }}
            </p>
          }
        </div>
        @if (stash.listLoading() && stash.entries().length === 0) {
          <p
            class="m-0 px-2 py-1 text-base-content-muted"
            role="status"
            data-testid="history-stash-loading"
          >
            Loading stashes…
          </p>
        } @else if (stash.entries().length === 0) {
          <p
            class="m-0 px-2 py-1 text-base-content-muted"
            data-testid="history-stash-empty"
          >
            No stashes.
          </p>
        } @else {
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            @for (entry of stash.entries(); track entry.hash) {
              <li class="rounded" [class.bg-base-300]="isSelected(entry)">
                <div class="flex items-center gap-1 px-1 py-0.5">
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed"
                    data-testid="history-stash-entry"
                    [attr.aria-expanded]="isSelected(entry)"
                    [disabled]="stash.busy()"
                    (click)="stash.select(entry)"
                  >
                    <span class="font-mono">{{ stashRef(entry) }}</span>
                    <span
                      class="min-w-0 flex-1 truncate"
                      [title]="entry.message"
                      >{{ entry.message }}</span
                    >
                    @if (entry.branch) {
                      <span class="text-base-content-muted"
                        >on {{ entry.branch }}</span
                      >
                    }
                    <span class="text-base-content-muted">{{
                      age(entry)
                    }}</span>
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    data-testid="history-stash-apply"
                    [disabled]="stash.busy()"
                    [attr.aria-label]="'Apply ' + stashRef(entry)"
                    (click)="run('apply', entry)"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    data-testid="history-stash-pop"
                    [disabled]="stash.busy()"
                    [attr.aria-label]="'Pop ' + stashRef(entry)"
                    (click)="run('pop', entry)"
                  >
                    Pop
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs px-1"
                    data-testid="history-stash-drop"
                    [disabled]="stash.busy()"
                    [attr.aria-label]="'Drop ' + stashRef(entry)"
                    [title]="'Drop ' + stashRef(entry)"
                    (click)="askDrop(entry, $event)"
                  >
                    <lucide-angular
                      [img]="DropIcon"
                      class="h-3 w-3"
                      aria-hidden="true"
                    />
                  </button>
                </div>
                @if (isSelected(entry)) {
                  @if (stash.filesLoading()) {
                    <p
                      class="m-0 px-3 pb-1 text-base-content-muted"
                      role="status"
                    >
                      Loading files…
                    </p>
                  } @else {
                    <ul
                      class="m-0 list-none px-2 pb-1"
                      [attr.aria-label]="'Files in ' + stashRef(entry)"
                    >
                      @for (file of stash.files(); track file.path) {
                        <li>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs w-full justify-start gap-2 font-normal"
                            data-testid="history-stash-file"
                            [title]="'Open diff for ' + file.path"
                            [disabled]="stash.busy()"
                            (click)="stash.openFileDiff(file)"
                          >
                            <span
                              class="w-3 font-mono"
                              [attr.aria-label]="statusLabel(file)"
                              >{{ file.status }}</span
                            >
                            <span class="truncate">{{ file.path }}</span>
                          </button>
                        </li>
                      } @empty {
                        <li class="px-1 text-base-content-muted">
                          No file changes.
                        </li>
                      }
                    </ul>
                  }
                }
              </li>
            }
          </ul>
        }
      </div>

      <ptah-git-confirm-dialog
        #dropDialog
        [title]="dropTitle()"
        description="This permanently discards the stashed changes."
        confirmLabel="Drop"
        (confirmed)="onConfirmDrop()"
        (cancelled)="dropTarget.set(null)"
      />
    </section>
  `,
})
export class HistoryStashSectionComponent {
  /** Whether the History tab is showing; the list is read only then. */
  readonly shown = input(false);

  protected readonly stash = inject(GitStashService);
  private readonly gitStatus = inject(GitStatusService);
  private readonly gitBranches = inject(GitBranchesService);

  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly DropIcon = X;
  protected readonly ErrorIcon = CircleAlert;

  private readonly idBase = `history-stashes-${instanceCount++}`;
  protected readonly headingId = `${this.idBase}-heading`;
  protected readonly listId = `${this.idBase}-list`;

  private readonly dropDialog =
    viewChild.required<GitConfirmDialogComponent>('dropDialog');

  protected readonly expanded = signal(true);
  protected readonly dropTarget = signal<DropTarget | null>(null);

  /** Why a confirmed drop did not run, pinned to the workspace now shown. */
  private readonly dropSkipped = signal<{
    workspaceRoot: string | null;
    text: string;
  } | null>(null);
  protected readonly dropNotice = computed(() => {
    const skipped = this.dropSkipped();
    return skipped?.workspaceRoot === this.gitStatus.activeWorkspacePath()
      ? skipped.text
      : null;
  });

  protected readonly dropTitle = computed(() => {
    const target = this.dropTarget();
    return target ? `Drop ${this.stashRef(target.entry)}?` : '';
  });

  constructor() {
    // Read on show, on a workspace switch while showing, and when the stash
    // count badge moves (a stash made elsewhere).
    effect(() => {
      const shown = this.shown();
      const root = this.gitStatus.activeWorkspacePath();
      this.gitBranches.stashCount();
      untracked(() => {
        if (shown && root) void this.stash.loadList();
      });
    });
  }

  protected isSelected(entry: StashEntry): boolean {
    return this.stash.selectedIndex() === entry.index;
  }

  protected stashRef(entry: StashEntry): string {
    return `stash@{${entry.index}}`;
  }

  protected age(entry: StashEntry): string {
    return stashAge(entry.time);
  }

  protected statusLabel(file: GitStashFileEntry): string {
    return STATUS_LABELS[file.status];
  }

  protected async run(
    kind: Exclude<GitStashMutation, 'drop'>,
    entry: StashEntry,
  ): Promise<void> {
    this.dropSkipped.set(null);
    await this.stash.mutate(kind, entry);
  }

  protected askDrop(entry: StashEntry, event: Event): void {
    const root = this.gitStatus.activeWorkspacePath();
    if (!root || !(event.currentTarget instanceof HTMLElement)) return;
    this.dropSkipped.set(null);
    this.dropTarget.set({ workspaceRoot: root, entry });
    this.dropDialog().open(event.currentTarget);
  }

  /**
   * Drop only the stash the question named: the same workspace, and an entry
   * whose hash is still listed (indices shift after a pop or drop elsewhere).
   * When neither holds, the confirmed drop does not run and the user is told
   * why (MOD-4).
   */
  protected async onConfirmDrop(): Promise<void> {
    const target = this.dropTarget();
    this.dropTarget.set(null);
    if (!target) return;
    const ref = this.stashRef(target.entry);
    const root = this.gitStatus.activeWorkspacePath();
    if (root !== target.workspaceRoot) {
      this.dropSkipped.set({
        workspaceRoot: root,
        text: `${ref} was not dropped: the workspace changed before the drop could run.`,
      });
      return;
    }
    const entry = this.stash
      .entries()
      .find(({ hash }) => hash === target.entry.hash);
    if (entry) {
      await this.stash.mutate('drop', entry);
      return;
    }
    this.dropSkipped.set({
      workspaceRoot: root,
      text: `${ref} is no longer there, so nothing was dropped. The list was refreshed.`,
    });
    await this.stash.loadList();
  }
}
