import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { GitBranchesService } from '../services/git-branches.service';

@Component({
  selector: 'ptah-branch-details-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative', '(document:keydown.escape)': 'close()' },
  template: `@if (isOpen()) {
    <div
      role="dialog"
      aria-label="Branch details"
      data-testid="branch-details"
      class="absolute top-full left-0 z-50 mt-1 min-w-64 rounded border border-base-content/10 bg-base-200 p-3 text-xs shadow-lg"
    >
      <strong>{{ gitBranches.currentBranch() || '(no branch)' }}</strong>
      <p>Stashes: {{ gitBranches.stashCount() }}</p>
      @if (gitBranches.lastCommit(); as commit) {
        <p title="{{ commit.hash }}">
          {{ commit.shortHash }} · {{ commit.subject }}
        </p>
        <p class="opacity-60">{{ commit.author }}</p>
      }
      @if (firstRemote(); as remote) {
        <p class="truncate" title="{{ remote.fetchUrl }}">
          {{ remote.name }} · {{ remote.fetchUrl }}
        </p>
      }
    </div>
  }`,
})
export class BranchDetailsPopoverComponent {
  protected readonly gitBranches = inject(GitBranchesService);
  readonly isOpen = input.required<boolean>();
  readonly closed = output<void>();
  protected readonly firstRemote = computed(
    () => this.gitBranches.remotes()[0] ?? null,
  );
  constructor() {
    effect(() => {
      if (this.isOpen()) void this.gitBranches.refreshRemotes();
    });
  }
  protected close(): void {
    if (this.isOpen()) this.closed.emit();
  }
}
