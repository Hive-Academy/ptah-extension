import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { OperatorSettings, RepositorySettings } from '@ptah-extension/review-contracts';

@Component({
  selector: 'ptah-review-repositories-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
            <section class="space-y-3">
              <h3 class="font-semibold">Repositories</h3>
              @for (
                repo of draft().repositories;
                track repo.owner + '/' + repo.name
              ) {
                <div class="rounded-xl border border-base-300 p-3">
                  <div class="flex items-center justify-between gap-2">
                    <p class="font-medium break-all">
                      {{ repo.owner }}/{{ repo.name }}
                    </p>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      [attr.aria-label]="
                        'Remove ' + repo.owner + '/' + repo.name
                      "
                      (click)="removed.emit(repo)"
                    >
                      Remove
                    </button>
                  </div>
                  <label class="mt-2 flex items-center gap-2 text-sm"
                    ><input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      [checked]="repo.enabled"
                      (change)="enabledChanged.emit({ repo, event: $event })"
                    />Enable review polling</label
                  >
                  <label class="mt-2 flex items-center gap-2 text-sm"
                    ><input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      [checked]="repo.dryRun"
                      [disabled]="
                        !hasToken() || !botConnected()
                      "
                      (change)="dryRunChanged.emit({ repo, event: $event })"
                    />Keep this repository in dry-run</label
                  >
                  <label class="mt-2 flex items-center gap-2 text-sm"><input type="checkbox"
                    class="checkbox checkbox-sm" [checked]="repo.publicationPaused"
                    (change)="pauseChanged.emit({ repo, event: $event })" />Pause publication for this repository</label>
                  @if (!hasToken() || !botConnected()) {
                    <p class="text-xs text-base-content-muted">
                      Connect a bot token to enable live publication.
                    </p>
                  }
                </div>
              } @empty {
                <p class="text-sm text-base-content-muted">
                  No repositories added.
                </p>
              }
              <label class="block text-sm" for="review-add-repository"
                >Add repository (owner/name)</label
              >
              <div class="flex gap-2">
                <input
                  #repositoryInput
                  id="review-add-repository"
                  class="input input-bordered w-full"
                  [value]="newRepository()"
                  (input)="newRepositoryChanged.emit($event)"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  (click)="added.emit()"
                >
                  Add repository
                </button>
              </div>
              @if (repositoryError()) {
                <p role="alert" class="text-sm text-error">
                  {{ repositoryError() }}
                </p>
              }
              <p class="text-xs text-base-content-muted">
                Fork PRs are always excluded. CodeRabbit remains enabled
                alongside Ptah review.
              </p>
            </section>
  `,
})
export class ReviewRepositoriesEditorComponent {
  readonly draft = input.required<OperatorSettings>();
  readonly hasToken = input(false);
  readonly botConnected = input(false);
  readonly newRepository = input('');
  readonly repositoryError = input<string | null>(null);
  readonly removed = output<RepositorySettings>();
  readonly enabledChanged = output<{ repo: RepositorySettings; event: Event }>();
  readonly dryRunChanged = output<{ repo: RepositorySettings; event: Event }>();
  readonly pauseChanged = output<{ repo: RepositorySettings; event: Event }>();
  readonly newRepositoryChanged = output<Event>();
  readonly added = output<void>();
}
