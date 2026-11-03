import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input, output } from '@angular/core';
import type { OperatorSettings, RepositorySettings, Severity } from '@ptah-extension/review-contracts';

@Component({
  selector: 'ptah-review-settings-drawer', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 bg-black/60">
      <aside class="surface-1 absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-base-300 p-5 shadow-xl"
        role="dialog" aria-modal="true" aria-labelledby="review-settings-title" (keydown)="onKeydown($event)">
        <header class="flex items-start justify-between gap-3"><div><h2 id="review-settings-title" class="text-xl font-semibold" tabindex="-1">Review settings</h2>
          <p class="text-sm text-base-content-muted">Settings apply to the next run. This is a dry-run review preview.</p></div>
          <button type="button" class="btn btn-ghost btn-sm" aria-label="Close review settings" (click)="closed.emit()">Close</button>
        </header>
        @if (loadState() === 'loading') { <p class="mt-5" role="status">Loading review settings…</p> }
        @else if (loadState() === 'error') { <div class="alert alert-error mt-5" role="alert">Review settings are unavailable. <button type="button" class="btn btn-ghost btn-sm" (click)="retry.emit()">Retry</button></div> }
        @else { <div class="mt-6 space-y-5">
          <section><h3 class="font-semibold">Repository</h3>
            @if (repository(); as repo) { <p class="text-sm">{{ repo.owner }}/{{ repo.name }}</p><span class="badge badge-outline">{{ repo.dryRun ? 'Dry-run' : 'Configured' }}</span> }
            @else { <p class="text-sm text-base-content-muted">Repository unavailable.</p> }
          </section>
          <section><h3 class="font-semibold">Maintainer allowlist</h3>
            @if (settings()?.maintainerLogins?.length) { <ul class="flex flex-wrap gap-2">@for (login of settings()!.maintainerLogins; track login) { <li class="badge badge-outline">{{ login }}</li> }</ul> }
            @else { <p class="text-sm text-base-content-muted">Allowlist unavailable.</p> }
            <p class="text-xs text-base-content-muted">Maintainers shown for review; changes require operator settings.</p>
          </section>
          <section class="grid gap-3 sm:grid-cols-2"><div><h3 class="font-semibold">Minimum severity</h3><p class="text-sm">{{ minimumSeverity() }}</p></div>
            <div><h3 class="font-semibold">Max inline comments</h3><p class="text-sm">{{ settings()?.maxNewInline ?? 'Unavailable' }}</p></div>
            <div><h3 class="font-semibold">Confidence floor</h3><p class="text-sm">{{ settings()?.confidenceFloor ?? 'Unavailable' }}</p></div>
            <div><h3 class="font-semibold">Lane cap per PR</h3><p class="text-sm">{{ settings()?.laneCapPerPr ?? 'Unavailable' }}</p></div>
          </section>
          <section><h3 class="font-semibold">Bot credential</h3><p class="text-sm text-base-content-muted">Credential status unavailable. Tokens are never displayed.</p></section>
          <section><h3 class="font-semibold">Effective repository configuration</h3><p class="text-sm text-base-content-muted">Configuration details and validation state unavailable.</p></section>
        </div> }
      </aside>
    </div>
  `,
})
export class ReviewSettingsDrawerComponent implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private returnFocus: HTMLElement | null = null;
  readonly repository = input<RepositorySettings | null>(null);
  readonly settings = input<OperatorSettings | null>(null);
  readonly minimumSeverity = input<Severity>('Minor');
  readonly loadState = input<'loading' | 'ready' | 'error'>('ready');
  readonly closed = output<void>();
  readonly retry = output<void>();
  ngAfterViewInit(): void { const doc = this.element.nativeElement.ownerDocument; this.returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null; this.element.nativeElement.querySelector<HTMLElement>('#review-settings-title')?.focus(); }
  ngOnDestroy(): void { this.returnFocus?.focus(); }
  onKeydown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.element.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="-1"]'));
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && this.element.nativeElement.ownerDocument.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && this.element.nativeElement.ownerDocument.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
