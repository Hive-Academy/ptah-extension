import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ReviewStateSchema } from '@ptah-extension/review-contracts';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';
import { ReviewRunsStore } from '../review-runs.store';
import { ReviewRepositoriesComponent } from './review-repositories.component';
import { ReviewRunsListComponent } from './review-runs-list.component';
import { ReviewRunDetailComponent } from './review-run-detail.component';
import { ReviewSettingsDrawerComponent } from './review-settings-drawer.component';
import { ReviewConfirmDialogComponent } from './review-confirm-dialog.component';

@Component({
  selector: 'ptah-review-runs-page',
  standalone: true,
  imports: [LucideAngularModule, ReviewRepositoriesComponent, ReviewRunsListComponent, ReviewRunDetailComponent, ReviewSettingsDrawerComponent, ReviewConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="p-4 md:p-6">
      <header class="surface-1 flex flex-wrap items-start justify-between gap-4 rounded-xl p-5">
        <label class="order-3 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-sm" [checked]="store.settings()?.globalPublicationPaused ?? false" [disabled]="!store.settings() || store.pauseSaving()" (change)="setPause($event)" />Pause all publication</label>
        <div class="flex items-start gap-3"><div class="flex h-10 w-10 items-center justify-center rounded-xl bg-base-200" aria-hidden="true"><lucide-angular [img]="icons.refresh" class="size-5" aria-hidden="true" /></div>
          <div><h1 class="text-xl font-semibold">Review runs</h1><p class="text-sm text-base-content-muted">Repository review attempts and coverage</p>
            @if (store.lastRefreshedAt(); as refreshed) { <p class="mt-1 text-xs text-base-content-muted">Last refreshed {{ refreshed.toLocaleString() }}</p> }
          </div>
        </div>
        <div class="flex gap-2"><button type="button" class="btn btn-ghost btn-sm" (click)="openSettings()">Review settings</button><button type="button" class="btn btn-ghost btn-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Refresh review runs" [disabled]="store.isRefreshing()" (click)="store.refresh()">Refresh</button></div>
      </header>
      @if (store.pauseError()) { <div class="alert alert-error mt-3" role="alert">Publication pause could not be updated.</div> }
      @if (store.poll()?.status === 'failed' || store.refreshError()) { <div class="alert alert-warning mt-3" role="alert"><span>The last review poll failed. Review runs may be out of date.</span><button type="button" class="btn btn-ghost btn-sm" aria-label="Retry with Refresh" (click)="store.refresh()">Retry with Refresh</button></div> }
      @if (store.state() === 'offline') {
        <div class="alert alert-warning mt-4" role="alert"><span>Review service is unavailable. Showing cached runs from {{ store.lastRefreshedAt()?.toLocaleString() }}. Live publication status is unavailable.</span><button class="btn btn-ghost btn-sm" (click)="store.load()">Retry connection</button></div>
      } @else if (store.state() === 'error') {
        <div class="alert alert-error mt-4" role="alert"><span>Review history could not be loaded.</span><button class="btn btn-ghost btn-sm" (click)="store.load()">Retry</button></div>
      } @else if (store.state() === 'no-lanes') {
        <div class="alert alert-warning mt-4" role="alert">No lanes available. Review has not produced a clean result.</div>
      }
      <div class="mt-5 grid gap-5 min-[900px]:grid-cols-[280px_minmax(0,1fr)]">
        <ptah-review-repositories [repositories]="store.repositories()" [selected]="store.repoFilter()" (choose)="store.setRepoFilter($event)" />
        <section class="surface-1 min-w-0 overflow-hidden rounded-xl" aria-label="Review runs list" [attr.aria-busy]="store.isRefreshing()">
          <div class="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 class="font-semibold">Runs</h2><p class="text-xs text-base-content-muted">{{ store.queuedCount() }} queued</p></div>
            <div class="flex flex-wrap gap-2"><label class="sr-only" for="review-repo-filter">Repository</label>
              <select id="review-repo-filter" class="select select-bordered select-sm" [value]="store.repoFilter()" (change)="setRepo($event)"><option value="all">All repositories</option>
                @for (repo of store.repositories(); track repo.owner + '/' + repo.name) { <option [value]="repo.owner + '/' + repo.name">{{ repo.owner }}/{{ repo.name }}</option> }
              </select>
              <label class="sr-only" for="review-state-filter">State</label><select id="review-state-filter" class="select select-bordered select-sm" [value]="store.stateFilter()" (change)="setState($event)"><option value="all">All states</option>
                @for (status of statuses; track status) { <option [value]="status">{{ status }}</option> }
              </select>
            </div>
          </div>
          @if (store.state() === 'loading' && !store.hasCache()) {
            <div class="space-y-3 p-4" role="status" aria-label="Loading review runs"><div class="skeleton h-12 w-full"></div><div class="skeleton h-12 w-full"></div><div class="skeleton h-12 w-full"></div></div>
          } @else if (store.state() === 'no-lanes') {
            <div class="p-8 text-center text-sm text-base-content-muted">Check lane availability in settings.</div>
          } @else if (store.filteredRuns().length) {
            <ptah-review-runs-list [runs]="store.filteredRuns()" (open)="store.selectRun($event)" />
          } @else if (store.runs().length) {
            <div class="p-8 text-center"><p class="font-semibold">No matching runs</p><p class="text-sm text-base-content-muted">Try another repository or state.</p><button class="btn btn-ghost btn-sm mt-3" (click)="store.clearFilters()">Clear filters</button></div>
          } @else if (store.state() !== 'error') {
            <div class="p-8 text-center"><p class="font-semibold">No review runs yet</p><p class="text-sm text-base-content-muted">Runs will appear after the next poll.</p><button class="btn btn-ghost btn-sm mt-3" (click)="store.load()">Refresh</button></div>
          }
        </section>
      </div>
      @if (store.selectedRun(); as run) { <ptah-review-run-detail [run]="run" [loadState]="store.detailState()" (retry)="store.loadRun(run.attemptId)" (closed)="store.closeRun()" /> }
      @if (settingsOpen()) { <ptah-review-settings-drawer [repository]="store.repositories()[0] ?? null" [settings]="store.settings()" [draft]="store.draftSettings()" [hasToken]="store.hasToken()" [saving]="store.settingsSaving()" [saveError]="store.settingsSaveError()" [loadState]="store.settingsState()" (changed)="store.updateDraft($event)" (repositoryEnabled)="store.setRepositoryEnabled($event)" (save)="store.saveSettings()" (retry)="store.loadSettings()" (closed)="settingsOpen.set(false)" /> }
      @if (pauseOffConfirmation()) { <ptah-review-confirm-dialog dialogId="review-page-resume-confirm" title="Resume live publication?" description="Turning pause off can allow eligible pull requests to receive comments. CodeRabbit remains enabled." confirmLabel="Resume publication" (cancelled)="pauseOffConfirmation.set(false)" (confirmed)="confirmPauseOff()" /> }
    </main>
  `,
})
export class ReviewRunsPageComponent implements OnInit {
  readonly store = inject(ReviewRunsStore);
  readonly settingsOpen = signal(false);
  readonly pauseOffConfirmation = signal(false);
  readonly statuses = ReviewStateSchema.options;
  protected readonly icons = { refresh: RefreshCw } as const;
  openSettings(): void { this.settingsOpen.set(true); void this.store.loadSettings(); }
  ngOnInit(): void { void this.store.load(); void this.store.loadSettings(); }
  setPause(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.checked) {
      target.checked = true;
      this.pauseOffConfirmation.set(true);
      return;
    }
    void this.store.setPublicationPause(true);
  }
  confirmPauseOff(): void { this.pauseOffConfirmation.set(false); void this.store.setPublicationPause(false, true); }
  setRepo(event: Event): void { const target = event.target; if (target instanceof HTMLSelectElement) this.store.setRepoFilter(target.value); }
  setState(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.value === 'all') this.store.setStateFilter('all');
    else { const state = ReviewStateSchema.safeParse(target.value); if (state.success) this.store.setStateFilter(state.data); }
  }
}

