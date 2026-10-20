import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';
import type { AttentionItem } from '../services/attention.types';

/** Shared permission controls for the bell, snackbar, and canvas rail. */
@Component({
  selector: 'ptah-attention-permission-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (item().permissionPreview) {
      <p class="mt-2 break-words text-xs text-base-content-muted">{{ item().permissionPreview }}</p>
    }
    <div class="mt-2 flex flex-wrap gap-1">
      @for (action of item().actions; track action.id) {
        @if (action.id !== 'deny_with_message') {
          <button type="button" class="btn btn-ghost btn-sm min-h-11"
            [disabled]="busy() || !!action.disabledReason"
            [attr.title]="action.disabledReason ?? null"
            (click)="selected.emit({ actionId: action.id })">{{ action.label }}</button>
        }
      }
      @if (messageAction(); as action) {
        <button type="button" class="btn btn-ghost btn-sm min-h-11"
          [disabled]="busy() || !!action.disabledReason"
          [attr.aria-expanded]="expanded()"
          (click)="toggleMessage()">{{ action.label }}</button>
      }
    </div>
    @if (expanded()) {
      <form class="mt-2 space-y-2" novalidate (submit)="submit($event, reasonField.value)" (keydown.escape)="cancel($event)">
        <label class="block text-xs font-medium" [for]="'permission-reason-' + item().key">Reason for denial</label>
        <input #reasonField [id]="'permission-reason-' + item().key" type="text" required maxlength="1000"
          class="input input-bordered input-sm w-full" autocomplete="off" [disabled]="busy()"
          [attr.aria-invalid]="reasonError() ? 'true' : null"
          [attr.aria-describedby]="reasonError() ? 'permission-reason-error-' + item().key : null"
          (input)="reasonError.set(false)" />
        @if (reasonError()) {
          <p [id]="'permission-reason-error-' + item().key" class="text-xs text-error" role="alert">Enter a reason for denial.</p>
        }
        <div class="flex gap-1">
          <button type="submit" class="btn btn-error btn-sm" [disabled]="busy()">Send denial</button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="toggleMessage()">Cancel</button>
        </div>
      </form>
    }
  `,
})
export class AttentionPermissionActionsComponent {
  readonly item = input.required<AttentionItem>();
  readonly busy = input(false);
  readonly selected = output<{ actionId: string; reason?: string }>();
  readonly expanded = signal(false);
  readonly reasonError = signal(false);
  private readonly reasonField = viewChild<ElementRef<HTMLInputElement>>('reasonField');

  constructor() {
    effect(() => {
      if (this.expanded()) this.reasonField()?.nativeElement.focus();
    });
  }

  toggleMessage(): void {
    this.reasonError.set(false);
    this.expanded.update(open => !open);
  }

  messageAction() {
    return this.item().actions.find(action => action.id === 'deny_with_message');
  }

  submit(event: Event, reason: string): void {
    event.preventDefault();
    if (this.busy()) return;
    if (!reason.trim()) {
      this.reasonError.set(true);
      return;
    }
    this.reasonError.set(false);
    this.selected.emit({ actionId: 'deny_with_message', reason: reason.trim() });
  }

  cancel(event: Event): void {
    event.stopPropagation();
    this.expanded.set(false);
    this.reasonError.set(false);
  }
}
