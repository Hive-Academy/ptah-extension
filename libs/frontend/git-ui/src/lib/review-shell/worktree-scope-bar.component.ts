import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

/** The last path segment of a folder, for a label with no branch to show. */
export function worktreeFolderName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) ?? path
  );
}

/**
 * WorktreeScopeBarComponent — the strip at the top of the Changes tab while
 * it views another worktree read-only: what is shown, a way back to the
 * active workspace's working tree, and a way to open the worktree as a
 * workspace (where it can be edited). Presentational: the shell runs both
 * actions.
 */
@Component({
  selector: 'ptah-worktree-scope-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block flex-shrink-0' },
  template: `
    <div
      class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-l-2 border-base-content/10 border-l-info bg-base-200 px-2 py-1 text-xs text-base-content"
      data-testid="worktree-scope-bar"
    >
      <span
        class="min-w-0 flex-1 truncate"
        role="status"
        [title]="root()"
        data-testid="worktree-scope-label"
        >Viewing <span class="font-semibold">{{ worktreeLabel() }}</span>
        worktree (read-only)</span
      >
      <button
        type="button"
        class="btn btn-ghost btn-xs {{ focusRing }}"
        data-testid="worktree-scope-back"
        (click)="back.emit()"
      >
        Back to {{ activeLabel() }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs {{ focusRing }}"
        data-testid="worktree-scope-open"
        [title]="'Open ' + root() + ' as a workspace folder'"
        (click)="openAsWorkspace.emit()"
      >
        Open as workspace
      </button>
    </div>
  `,
})
export class WorktreeScopeBarComponent {
  /** The viewed worktree's root. */
  readonly root = input.required<string>();
  /** Its checked-out branch, once read; the folder name stands in until then. */
  readonly branch = input<string | null>(null);
  /** The active workspace's branch, or its folder name. */
  readonly activeLabel = input.required<string>();

  /** Back to the active workspace's working tree. */
  readonly back = output<void>();
  /** Open the worktree as a workspace folder. */
  readonly openAsWorkspace = output<void>();

  protected readonly focusRing = FOCUS_RING;

  protected readonly worktreeLabel = computed(
    () => this.branch() || worktreeFolderName(this.root()),
  );
}
