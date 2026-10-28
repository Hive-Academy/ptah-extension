import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild, viewChildren } from '@angular/core';
import type { AttentionItem } from '../services/attention.types';

let permissionActionsInstance = 0;

/** Shared permission controls for the bell, snackbar, and canvas rail. */
@Component({
  selector: 'ptah-attention-permission-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!compact() && item().permissionPreview) {
      <p class="mt-2 break-words text-xs text-base-content-muted">{{ item().permissionPreview }}</p>
    }
    <div role="group" aria-label="Permission actions" class="flex min-w-0 items-center gap-1" [class.mt-2]="!compact()" (keydown.escape)="closeMenu($event)">
      @for (action of visibleActions(); track action.id) {
        <button #visibleButton type="button" class="btn btn-sm px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" [class.min-h-9]="!compact()" [class.min-h-7]="compact()" [class.h-7]="compact()"
          [class.btn-primary]="action.id === primaryAction()?.id" [class.btn-ghost]="action.id !== primaryAction()?.id"
          [disabled]="busy() || !!reasonFor(action.id)" [attr.title]="reasonFor(action.id) ?? null"
          [attr.aria-describedby]="reasonFor(action.id) ? 'permission-action-reason-' + instanceId + '-' + item().key + '-' + action.id : null"
          (click)="choose(action.id)">{{ action.label }}</button>
      }
      @if (overflowActions().length) {
        <button #moreButton type="button" class="btn btn-ghost btn-sm px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" [class.min-h-9]="!compact()" [class.min-h-7]="compact()" [class.h-7]="compact()"
          aria-label="More permission actions" [attr.aria-expanded]="menuOpen()" [attr.aria-controls]="'permission-more-' + instanceId" [disabled]="busy()" (click)="toggleMenu()">More</button>
      }
    </div>
    <div role="group" aria-label="Additional permission actions" [id]="'permission-more-' + instanceId" [hidden]="!menuOpen()" class="mt-1 flex-wrap gap-1" [class.flex]="menuOpen()" (keydown.escape)="closeMenu($event)">
      @if (menuOpen()) {
        @for (action of overflowActions(); track action.id) {
          <button #extraAction type="button" class="btn btn-ghost btn-sm min-h-7 px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            [disabled]="busy() || !!reasonFor(action.id)" [attr.title]="reasonFor(action.id) ?? null"
            [attr.aria-describedby]="reasonFor(action.id) ? 'permission-action-reason-' + instanceId + '-' + item().key + '-' + action.id : null"
            (click)="choose(action.id)">{{ action.label }}</button>
        }
      }
    </div>
    @for (action of item().actions; track action.id) {
      @if (reasonFor(action.id); as reason) {
        <span class="sr-only" [id]="'permission-action-reason-' + instanceId + '-' + item().key + '-' + action.id">{{ reason }}</span>
      }
    }
    @if (expanded()) {
      <form class="mt-2 space-y-2" novalidate (submit)="submit($event, reasonField.value)" (keydown.escape)="cancel($event)">
        <label class="block text-xs font-medium" [for]="'permission-reason-' + instanceId">Reason for denial</label>
        <input #reasonField [id]="'permission-reason-' + instanceId" type="text" maxlength="1000"
          class="input input-bordered input-sm w-full" autocomplete="off" [disabled]="busy()"
          [attr.aria-invalid]="reasonError() ? 'true' : null"
          [attr.aria-describedby]="reasonError() ? 'permission-reason-error-' + instanceId : null"
          (input)="reasonError.set(false)" />
        @if (reasonError()) {
          <p [id]="'permission-reason-error-' + instanceId" class="text-xs text-error" role="alert">Enter a reason for denial.</p>
        }
        <div class="flex gap-1">
          <button type="submit" class="btn btn-error btn-sm" [disabled]="busy() || !!reasonFor('deny_with_message')">Send denial</button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="toggleMessage()">Cancel</button>
        </div>
      </form>
    }
  `,
})
export class AttentionPermissionActionsComponent {
  readonly instanceId = ++permissionActionsInstance;
  readonly item = input.required<AttentionItem>();
  readonly busy = input(false);
  readonly compact = input(false);
  readonly unavailable = input<ReadonlyMap<string, string>>(new Map());
  readonly selected = output<{ actionId: string; reason?: string }>();
  readonly expanded = signal(false);
  readonly menuOpen = signal(false);
  readonly reasonError = signal(false);
  private readonly reasonField = viewChild<ElementRef<HTMLInputElement>>('reasonField');
  private readonly moreButton = viewChild<ElementRef<HTMLButtonElement>>('moreButton');
  private readonly visibleButtons = viewChildren<ElementRef<HTMLButtonElement>>('visibleButton');
  private readonly extraActions = viewChildren<ElementRef<HTMLButtonElement>>('extraAction');
  readonly primaryAction = computed(() => this.item().actions.find(action => action.id === 'allow' && !this.reasonFor(action.id))
    ?? this.item().actions.find(action => action.id === 'open' && !this.reasonFor(action.id))
    ?? this.item().actions.find(action => action.id !== 'deny_with_message' && !this.reasonFor(action.id)));
  readonly visibleActions = computed(() => this.item().actions.filter(action => action.id === 'allow' || action.id === 'deny' || action.id === this.primaryAction()?.id));
  readonly overflowActions = computed(() => this.item().actions.filter(action => !this.visibleActions().includes(action)));

  constructor() {
    effect(() => {
      if (this.expanded()) this.reasonField()?.nativeElement.focus();
    });
    effect(() => {
      if (this.menuOpen()) this.extraActions().find(action => !action.nativeElement.disabled)?.nativeElement.focus();
    });
  }

  toggleMenu(): void {
    if (this.menuOpen()) this.closeMenu();
    else this.menuOpen.set(true);
  }

  toggleMessage(): void {
    this.reasonError.set(false);
    if (this.expanded()) {
      this.expanded.set(false);
      this.returnFocus();
    } else {
      this.expanded.set(true);
    }
  }

  private returnFocus(): void {
    const more = this.moreButton()?.nativeElement;
    if (more && !more.disabled) {
      more.focus();
      return;
    }
    const denyIndex = this.visibleActions().findIndex(action => action.id === 'deny');
    this.visibleButtons()[denyIndex]?.nativeElement.focus();
  }

  reasonFor(actionId: string): string | undefined {
    return this.item().actions.find(action => action.id === actionId)?.disabledReason
      ?? this.unavailable().get(`${this.item().key}:${this.item().generation}:${actionId}`);
  }

  choose(actionId: string): void {
    if (this.menuOpen()) this.closeMenu();
    if (actionId === 'deny_with_message') this.toggleMessage();
    else this.selected.emit({ actionId });
  }

  closeMenu(event?: Event): void {
    if (this.menuOpen()) {
      event?.stopPropagation();
      event?.preventDefault();
      this.menuOpen.set(false);
      this.moreButton()?.nativeElement.focus();
    }
  }

  submit(event: Event, reason: string): void {
    event.preventDefault();
    if (this.busy() || this.reasonFor('deny_with_message')) return;
    if (!reason.trim()) {
      this.reasonError.set(true);
      return;
    }
    this.reasonError.set(false);
    this.selected.emit({ actionId: 'deny_with_message', reason: reason.trim() });
  }

  cancel(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.toggleMessage();
  }
}
