import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import {
  AgentDeliveryStore,
  type DeliveryAction,
  type ParentDeliveryItem,
} from '@ptah-extension/chat-streaming';
import type { AgentDeliveryReceipt } from '@ptah-extension/shared';

/**
 * Delivery status of one lane message or one parent delivery, with the
 * actions its state offers. A retry that may run the work twice asks for an
 * explicit confirmation first; without it nothing is sent.
 */
@Component({
  selector: 'ptah-delivery-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    @if (status(); as current) {
      <div class="flex min-w-0 flex-wrap items-center gap-1 text-xs" data-testid="delivery-status">
        <span class="min-w-0" [class.text-warning]="current.attention" [class.text-base-content-muted]="!current.attention">
          {{ current.label }}@if (current.resetAt !== undefined) { · <time [attr.datetime]="iso(current.resetAt)" [title]="absolute(current.resetAt)">{{ current.resetTime }}</time>} @else if (current.since !== undefined) { · <time [attr.datetime]="iso(current.since)" [title]="absolute(current.since)">{{ current.age }}</time>}
        </span>
        @for (action of current.actions; track action.kind) {
          <button type="button" class="btn btn-ghost btn-xs" [disabled]="busy()"
            [attr.aria-label]="actionName(action)" (click)="request(action)">{{ action.label }}</button>
        }
      </div>
      @if (confirming(); as action) {
        <div role="alertdialog" aria-modal="false" [attr.aria-label]="'Confirm ' + actionName(action)"
          class="mt-1 rounded-box border border-warning p-2 text-xs" (keydown.escape)="confirming.set(null)">
          <p class="text-warning">This may already have reached {{ receipt() ? 'the lane' : 'the parent chat' }}. Retrying can run it twice.</p>
          <div class="mt-1 flex gap-2">
            <button type="button" class="btn btn-warning btn-xs" (click)="confirm()">Retry anyway</button>
            <button type="button" class="btn btn-ghost btn-xs" (click)="confirming.set(null)">Keep waiting</button>
          </div>
        </div>
      }
      @if (error(); as message) { <p class="mt-1 text-xs text-error" role="alert">{{ message }}</p> }
    }
  `,
})
export class DeliveryStatusComponent {
  readonly receipt = input<AgentDeliveryReceipt | null>(null);
  readonly parentDelivery = input<ParentDeliveryItem | null>(null);
  /** Who the action is about, for accessible names, e.g. "message to Docs". */
  readonly subject = input.required<string>();
  private readonly store = inject(AgentDeliveryStore, { optional: true });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirming = signal<DeliveryAction | null>(null);
  protected readonly status = computed(() => {
    const store = this.store;
    if (!store) return null;
    const receipt = this.receipt();
    if (receipt) return store.receiptStatus(receipt);
    const parent = this.parentDelivery();
    return parent ? store.parentStatus(parent) : null;
  });

  protected actionName(action: DeliveryAction): string {
    return `${action.label} ${this.subject()}`;
  }

  protected request(action: DeliveryAction): void {
    this.error.set(null);
    if (action.confirmDuplicateRisk) this.confirming.set(action);
    else void this.run(action, false);
  }

  protected confirm(): void {
    const action = this.confirming();
    this.confirming.set(null);
    if (action) void this.run(action, true);
  }

  protected iso(at: number): string { return new Date(at).toISOString(); }
  protected absolute(at: number): string { return new Date(at).toLocaleString(); }

  private async run(action: DeliveryAction, confirmed: boolean): Promise<void> {
    const store = this.store;
    if (!store) return;
    this.busy.set(true);
    try {
      const receipt = this.receipt();
      const parent = this.parentDelivery();
      if (receipt) await store.runReceiptAction(receipt, action.kind, confirmed);
      else if (parent) await store.runParentAction(parent, action.kind, confirmed);
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : `${action.label} failed. Try again.`);
    } finally {
      this.busy.set(false);
    }
  }
}
