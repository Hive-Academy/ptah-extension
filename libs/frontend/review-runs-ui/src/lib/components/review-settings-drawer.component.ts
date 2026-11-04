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
            <p class="text-sm">Hive-Academy/PtahCode · Dry-run</p>
            <label class="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox checkbox-sm" [checked]="draft().repositories[0]?.enabled ?? false" (change)="setRepositoryEnabled($event)" />Enable review polling</label>
          </section>
          <section><h3 class="font-semibold">Maintainer allowlist</h3>
            <label class="text-xs text-base-content-muted" for="review-maintainers">GitHub logins, comma separated</label>
            <input id="review-maintainers" class="input input-bordered w-full" [value]="draft().maintainerLogins.join(', ')" (input)="setLogins($event)" autocomplete="off" />
          </section>
          <section class="grid gap-3 sm:grid-cols-2"><div><h3 class="font-semibold">Minimum severity</h3><p class="text-sm">{{ minimumSeverity() }}</p></div>
            <label class="text-sm">Poll interval (minutes)<input type="number" min="1" max="1440" class="input input-bordered w-full" [value]="draft().pollMinutes" (input)="setNumber('pollMinutes', $event)" /></label>
            <label class="text-sm">Max inline comments<input type="number" min="0" max="100" class="input input-bordered w-full" [value]="draft().maxNewInline" (input)="setNumber('maxNewInline', $event)" /></label>
            <label class="text-sm">Confidence floor<input type="number" min="0" max="1" step="0.01" class="input input-bordered w-full" [value]="draft().confidenceFloor" (input)="setNumber('confidenceFloor', $event)" /></label>
            <label class="text-sm">Lane cap per PR<input type="number" min="1" max="6" class="input input-bordered w-full" [value]="draft().laneCapPerPr" (input)="setNumber('laneCapPerPr', $event)" /></label>
          </section>
          <section><h3 class="font-semibold">Bot credential</h3><p class="text-sm text-base-content-muted">{{ hasToken() ? 'Credential stored' : 'Credential missing' }}. Tokens are never displayed.</p></section>
          <section><h3 class="font-semibold">Effective repository configuration</h3><p class="text-sm text-base-content-muted">Configuration details and validation state unavailable.</p></section>
          @if (saveError()) { <p class="text-sm text-error" role="alert">{{ saveError() }}</p> }
          <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save.emit()">{{ saving() ? 'Saving…' : 'Save review settings' }}</button>
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
  readonly draft = input.required<OperatorSettings>();
  readonly hasToken = input(false);
  readonly saving = input(false);
  readonly saveError = input<string | null>(null);
  readonly minimumSeverity = input<Severity>('Minor');
  readonly loadState = input<'loading' | 'ready' | 'error'>('ready');
  readonly closed = output<void>();
  readonly retry = output<void>();
  readonly changed = output<Partial<OperatorSettings>>();
  readonly repositoryEnabled = output<boolean>();
  readonly save = output<void>();
  setRepositoryEnabled(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.repositoryEnabled.emit(event.target.checked);
  }
  setLogins(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.changed.emit({ maintainerLogins: event.target.value.split(',').map((login) => login.trim()).filter(Boolean) });
  }
  setNumber(field: 'pollMinutes' | 'maxNewInline' | 'confidenceFloor' | 'laneCapPerPr', event: Event): void {
    if (event.target instanceof HTMLInputElement) this.changed.emit({ [field]: Number(event.target.value) });
  }
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
