import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input, output, signal } from '@angular/core';

@Component({
  selector: 'ptah-review-confirm-dialog', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <section class="surface-1 w-full max-w-md rounded-xl border border-base-300 p-5 shadow-xl" role="dialog"
        aria-modal="true" [attr.aria-labelledby]="dialogId()" [attr.aria-describedby]="dialogId() + '-description'"
        (keydown)="onKeydown($event)">
        <h2 class="text-xl font-semibold" [id]="dialogId()" tabindex="-1">{{ title() }}</h2>
        <p class="mt-3 text-sm" [id]="dialogId() + '-description'">{{ description() }}</p>
        @if (requirePermissions()) { <label class="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" class="checkbox" [checked]="acknowledged()" (change)="acknowledged.set(!acknowledged())" />
          I confirm this bot token has Pull requests: Read and write, Contents: Read, and Metadata: Read for this repository.</label> }
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="btn btn-ghost" (click)="cancelled.emit()">Cancel</button>
          <button type="button" class="btn btn-primary" [disabled]="requirePermissions() && !acknowledged()" (click)="confirmed.emit()">{{ confirmLabel() }}</button>
        </div>
      </section>
    </div>
  `,
})
export class ReviewConfirmDialogComponent implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private returnFocus: HTMLElement | null = null;
  readonly dialogId = input.required<string>();
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly requirePermissions = input(false);
  readonly acknowledged = signal(false);
  readonly cancelled = output<void>();
  readonly confirmed = output<void>();

  ngAfterViewInit(): void {
    const document = this.element.nativeElement.ownerDocument;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.element.nativeElement.querySelector<HTMLElement>('h2')?.focus();
  }
  ngOnDestroy(): void { this.returnFocus?.focus(); }
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancelled.emit(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.element.nativeElement.querySelectorAll<HTMLElement>('h2, button:not([disabled])'));
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && this.element.nativeElement.ownerDocument.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && this.element.nativeElement.ownerDocument.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
