import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { RepositorySettings } from '@ptah-extension/review-contracts';

@Component({
  selector: 'ptah-review-repositories',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="surface-1 rounded-xl p-4" aria-label="Repositories">
      <div class="flex items-center justify-between gap-2"><h2 class="font-semibold">Repositories</h2><span class="badge badge-outline">{{ repositories().length }}</span></div>
      @for (repo of repositories(); track repo.owner + '/' + repo.name) {
        <button type="button" class="mt-3 w-full rounded-xl border border-base-300 bg-base-100 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          [attr.aria-pressed]="selected() === repo.owner + '/' + repo.name" (click)="choose.emit(repo.owner + '/' + repo.name)">
          <span class="block font-semibold break-all">{{ repo.owner }}/{{ repo.name }}</span>
          <span class="mt-2 badge badge-outline" [class.badge-warning]="repo.publicationPaused || repo.dryRun" [class.badge-success]="repo.enabled && !repo.dryRun && !repo.publicationPaused">
            {{ !repo.enabled ? 'Disabled' : repo.publicationPaused ? 'Paused' : repo.dryRun ? 'Dry-run' : 'Live' }}
          </span>
          <span class="mt-2 block text-xs text-base-content-muted">{{ repo.enabled ? 'Review enabled' : 'Review disabled' }}</span>
        </button>
      } @empty {
        <div class="py-8 text-center"><p class="font-medium">No repositories</p><p class="mt-1 text-sm text-base-content-muted">Add an allowed repository in review settings.</p></div>
      }
    </aside>
  `,
})
export class ReviewRepositoriesComponent {
  readonly repositories = input.required<readonly RepositorySettings[]>();
  readonly selected = input.required<string>();
  readonly choose = output<string>();
}
