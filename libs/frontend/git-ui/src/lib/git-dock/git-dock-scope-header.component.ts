import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Pin, PinOff } from 'lucide-angular';
import type { SessionWorkingRootSource } from '@ptah-extension/shared';
import { UNRESOLVED_SCOPE_MESSAGE } from '../services/git-dock-mutation-gate';
import type { GitDockScope } from '../services/git-dock-scope.store';
import { worktreeFolderName } from '../review-shell/worktree-scope-bar.component';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

const SOURCE_HINTS: Record<SessionWorkingRootSource, string> = {
  'organization-worktree': 'session worktree',
  'agent-origin-worktree': 'agent worktree',
  'session-cwd': 'workspace',
  'workspace-root': 'workspace',
};

/**
 * GitDockScopeHeaderComponent — the line at the top of the git dock that says
 * what the dock is scoped to (TASK_2026_855): the session, its worktree
 * folder, the branch, where the root came from, and a toggle between
 * following the active session and pinning the current one.
 *
 * Presentational: the shell binds the scope store and runs pin/unpin.
 */
@Component({
  selector: 'ptah-git-dock-scope-header',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block flex-shrink-0' },
  template: `
    <div
      class="flex min-w-0 items-center gap-2 border-b border-base-content/10 px-2 py-1 text-xs text-base-content"
      [class.border-l-2]="scope().isWorktree"
      [class.border-l-primary]="scope().isWorktree"
      data-testid="git-dock-scope-header"
    >
      <span
        class="flex min-w-0 flex-1 items-center gap-1.5 truncate"
        role="status"
        [title]="title()"
        data-testid="git-dock-scope-label"
      >
        <span
          class="truncate font-semibold"
          data-testid="git-dock-scope-name"
          >{{ name() }}</span
        >
        @if (folder(); as folderName) {
          <span
            class="truncate text-base-content/70"
            data-testid="git-dock-scope-folder"
            >{{ folderName }}</span
          >
        }
        @if (branch(); as branchName) {
          <span
            class="truncate font-mono text-base-content/70"
            data-testid="git-dock-scope-branch"
            >{{ branchName }}</span
          >
        }
        @if (scope().unresolved) {
          <span
            class="shrink-0 text-warning"
            data-testid="git-dock-scope-unresolved"
            >{{
              compact() ? 'read-only' : 'worktree not loaded · read-only'
            }}</span
          >
        }
        @if (!compact() && hint(); as hintText) {
          <span
            class="shrink-0 text-base-content/50"
            data-testid="git-dock-scope-hint"
            >{{ hintText }}</span
          >
        }
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs shrink-0 gap-1 {{ focusRing }}"
        [attr.aria-pressed]="pinned()"
        [attr.aria-label]="toggleLabel()"
        [title]="toggleLabel()"
        [disabled]="!pinned() && scope().session === null"
        data-testid="git-dock-scope-pin"
        (click)="pinToggled.emit(!pinned())"
      >
        <lucide-angular
          [img]="pinned() ? PinOffIcon : PinIcon"
          class="h-3 w-3"
          aria-hidden="true"
        />
        @if (!compact()) {
          <span>{{ toggleLabel() }}</span>
        }
      </button>
    </div>
  `,
})
export class GitDockScopeHeaderComponent {
  readonly scope = input.required<GitDockScope>();
  /** The scoped root's checked-out branch, when known. */
  readonly branch = input<string | null>(null);
  /** Narrow dock: hide the hint and the toggle's text (icon + aria-label stay). */
  readonly compact = input(false);

  /** true = pin the current scope, false = follow the active session again. */
  readonly pinToggled = output<boolean>();

  protected readonly focusRing = FOCUS_RING;
  protected readonly PinIcon = Pin;
  protected readonly PinOffIcon = PinOff;

  protected readonly pinned = computed(() => this.scope().mode === 'pinned');

  protected readonly name = computed(() => {
    const scope = this.scope();
    if (scope.root === null && !scope.unresolved) return 'No folder open';
    if (scope.session === null) return 'Workspace';
    return scope.session.closed
      ? `${scope.session.name} (closed)`
      : scope.session.name;
  });

  protected readonly folder = computed(() => {
    const root = this.scope().root;
    return root === null ? null : worktreeFolderName(root);
  });

  protected readonly hint = computed(() => {
    const source = this.scope().source;
    return source === null ? null : SOURCE_HINTS[source];
  });

  protected readonly title = computed(() => {
    const scope = this.scope();
    return scope.unresolved ? UNRESOLVED_SCOPE_MESSAGE : (scope.root ?? '');
  });

  protected readonly toggleLabel = computed(() =>
    this.pinned() ? 'Follow active session' : 'Pin scope',
  );
}
