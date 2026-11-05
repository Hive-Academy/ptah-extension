import { ChangeDetectionStrategy, Component, ElementRef, AfterViewInit, OnDestroy, input, output, inject, signal } from '@angular/core';
import type { ReviewRun, StageRecord } from '@ptah-extension/review-contracts';
import { ReviewRunsStore } from '../review-runs.store';
import { ReviewConfirmDialogComponent } from './review-confirm-dialog.component';
import { ReviewFindingsTableComponent, type ReviewFindingRow } from './review-findings-table.component';

@Component({
  selector: 'ptah-review-run-detail', standalone: true, imports: [ReviewFindingsTableComponent, ReviewConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 bg-black/60">
      <aside class="surface-1 absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l border-base-300 p-5 shadow-xl"
        role="dialog" aria-modal="true" aria-labelledby="review-detail-title" (keydown)="onKeydown($event)">
        <header class="flex items-start justify-between gap-4"><div>
          <h2 id="review-detail-title" class="text-xl font-semibold" tabindex="-1">PR #{{ run().prNumber }} review</h2>
          <p class="text-sm text-base-content-muted">{{ run().repo.owner }}/{{ run().repo.name }} · {{ run().headSha.slice(0, 10) }}</p>
          <p class="text-xs text-base-content-muted">Attempt {{ run().attemptId }}</p>
        </div><button type="button" class="btn btn-ghost btn-sm" aria-label="Close run details" (click)="closed.emit()">Close</button></header>
        <div class="mt-4 flex flex-wrap gap-2"><span class="badge badge-outline" [class.badge-warning]="run().status === 'partial'" [class.badge-error]="run().status === 'failed'">{{ run().status }}</span>
          @if (run().status === 'partial') { <span class="badge badge-warning">Partial coverage</span> }
        </div>
        @if (run().failure; as failure) {
          <p class="alert alert-error mt-4 text-sm" role="alert">Failed in {{ failure.stage }}: {{ failure.message }} ({{ failure.code }})</p>
        }
        @if (run().headRetry?.automaticRetriesStopped) { <p class="mt-2 text-sm text-warning">Automatic retries stopped</p> }
        @else if (run().headRetry?.nextEligibleAt; as retryAt) { <p class="mt-2 text-sm text-warning">Retry after {{ retryTime(retryAt) }}</p> }
        @if (loadState() === 'loading') { <p class="mt-5" role="status">Loading run details…</p> }
        @else if (loadState() === 'error') { <div class="alert alert-error mt-5" role="alert">Run details are unavailable. <button type="button" class="btn btn-ghost btn-sm" (click)="retry.emit()">Retry</button></div> }
        @else {
          <section class="mt-6"><h3 class="font-semibold">Stage timeline</h3>
            @if (run().stages.length === 0) { <p class="text-sm text-base-content-muted">Stage history unavailable.</p> }
            @else { <ol class="mt-2 space-y-2 border-l border-base-300 pl-4">
              @for (stage of run().stages; track stage.name + ':' + (stage.scope ?? '')) { <li class="rounded-lg bg-base-200 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2"><strong>{{ stageLabel(stage) }}</strong><span class="badge badge-outline" [class.badge-warning]="stage.status === 'partial'" [class.badge-error]="stage.status === 'failed'">{{ stage.status }}</span></div>
                <p class="text-xs text-base-content-muted">{{ stage.durationMs === null ? 'Duration unavailable' : (stage.durationMs / 1000).toFixed(1) + ' s' }}</p>
                @if (stage.family) { <p class="text-sm">{{ stage.family }} family</p> }
                @if (stage.scope) { <p class="text-sm">{{ stage.scope }}</p> }
                @if (stage.error) { <p class="text-sm" role="status">{{ stage.error }}</p> }
              </li> }
            </ol> }
          </section>
          <section class="mt-6 space-y-2"><h3 class="font-semibold">Coverage and lanes</h3>
            @if (run().status === 'partial') { <div class="alert alert-warning">Coverage limited. Unchecked paths are not claimed clean.</div> }
            @if (run().coverage.length) { <ul class="list-disc pl-5 text-sm">@for (item of run().coverage; track item) { <li>{{ item }}</li> }</ul> }
            @else { <p class="text-sm text-base-content-muted">Lane coverage unavailable.</p> }
            <p class="text-sm">Lens family: {{ family('lenses') ?? 'Unavailable' }}</p>
            <p class="text-sm">Verifier family: {{ family('verification') ?? 'Unavailable' }}</p>
            @if (family('lenses') && family('lenses') === family('verification')) { <span class="badge badge-warning">Weaker evidence · same-family verification</span> }
          </section>
          <section class="mt-6 space-y-2"><h3 class="font-semibold">Rerun this PR</h3>
            <p class="text-sm text-base-content-muted">CodeRabbit remains enabled. A dry-run creates a local preview; a live rerun may publish comments.</p>
            <div class="flex gap-2"><button type="button" class="btn btn-ghost btn-sm" [disabled]="store.rerunState() === 'running'" (click)="store.rerun(run().attemptId, true)">Rerun as dry-run</button>
              <button type="button" class="btn btn-primary btn-sm" [disabled]="store.rerunState() === 'running' || !store.hasToken() || store.settings()?.globalPublicationPaused" (click)="confirmLive.set(true)">Rerun live</button></div>
            @if (store.rerunState() === 'error') { <p role="alert" class="text-sm text-error">Rerun could not be started.</p> }
          </section>
          <section class="mt-6"><h3 class="font-semibold">Findings</h3><ptah-review-findings-table [rows]="findings()" /></section>
          <section class="mt-6"><h3 class="font-semibold">Walkthrough preview</h3><p class="text-sm text-base-content-muted">Walkthrough preview unavailable.</p></section>
          <section class="mt-6"><h3 class="font-semibold">Artifacts</h3><p class="text-sm text-base-content-muted">Artifact list unavailable.</p></section>
        }
      </aside>
      @if (confirmLive()) { <ptah-review-confirm-dialog dialogId="review-live-rerun-confirm" title="Start live rerun?" description="This rerun can publish a new COMMENT review and verified inline comments on the current PR head. CodeRabbit remains enabled." confirmLabel="Start live rerun" [requirePermissions]="true" (cancelled)="confirmLive.set(false)" (confirmed)="startLiveRerun()" /> }
    </div>
  `,
})
export class ReviewRunDetailComponent implements AfterViewInit, OnDestroy {
  retryTime(value: string): string { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private returnFocus: HTMLElement | null = null;
  readonly store = inject(ReviewRunsStore);
  readonly confirmLive = signal(false);
  readonly run = input.required<ReviewRun>();
  readonly findings = input<readonly ReviewFindingRow[]>([]);
  readonly loadState = input<'loading' | 'ready' | 'error'>('ready');
  readonly closed = output<void>();
  readonly retry = output<void>();
  ngAfterViewInit(): void { const doc = this.element.nativeElement.ownerDocument; this.returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null; this.element.nativeElement.querySelector<HTMLElement>('#review-detail-title')?.focus(); }
  ngOnDestroy(): void { this.returnFocus?.focus(); }
  startLiveRerun(): void { this.confirmLive.set(false); void this.store.rerun(this.run().attemptId, false); }
  stageLabel(stage: StageRecord): string { return stage.name === 'lenses' && stage.scope ? stage.scope : ({ discovery: 'Discovery', context: 'Context', checks: 'Checks', triage: 'Triage', lenses: 'Lenses', verification: 'Verification', identity: 'Identity', publication: 'Publication' })[stage.name]; }
  family(name: StageRecord['name']): string | null { return this.run().stages.find(stage => stage.name === name)?.family ?? null; }
  onKeydown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.element.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), [tabindex="-1"]'));
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && this.element.nativeElement.ownerDocument.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && this.element.nativeElement.ownerDocument.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
