import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';
import { SettingsSaveFeedbackService } from './settings-save-feedback.service';
import { SettingsBusyDisabledDirective } from './busy-disabled.directive';

/** Delay between clearing the live regions and writing the new message, so a repeated message is re-announced. */
const ANNOUNCE_DELAY_MS = 50;

/**
 * Renders the Settings save toast (prototype `.toast-msg`, bottom-right) from
 * `SettingsSaveFeedbackService`. Undo is disabled while any save is in flight (D3); it stays focusable (aria-disabled).
 *
 * Announcements (P6-A1): two `sr-only` live regions are always rendered, outside the toast `@if`, so they exist
 * empty before the first toast. Success goes to the `role="status"` (polite) region, failure and refusal to the
 * `role="alert"` region. On every new toast both are cleared and the toned one is filled after
 * {@link ANNOUNCE_DELAY_MS}; dismissing clears them. The visual card carries no role of its own, so a message
 * is announced exactly once per toast instance.
 *
 * While a NativeDrawer is open the toast sits at `bottom-28` (112 px) instead of `bottom-6`, so it clears
 * the drawer's pinned footer (Close, Save, Back: 57 px, 105 px when the setup wizard's footer wraps) and
 * never takes a click meant for it (Batch 49b). The rule is pure CSS (`:has()`), so nothing is observed or
 * polled. The page toast also re-raises above newly opened modal dialogs without moving focus.
 *
 * `inline` (Batch 55b CS-1): the same toast in the flow of a panel instead of fixed to the page, for a surface
 * whose focus trap the page toast is outside of (the drawer's Models & Tiers tab), so a keyboard user can reach its
 * Undo. Its test ids carry `-inline`, so the page toast and an inline copy never share one.
 *
 * The page toast is a manual popover, so it sits in the browser top layer. A native popover or dropdown shell
 * (also top layer, with a full-viewport backdrop) opened earlier would otherwise cover the toast and take the
 * click meant for its Undo; a popover shown later is stacked above the earlier ones.
 */
@Component({
  selector: 'ptah-settings-toast',
  standalone: true,
  imports: [NgTemplateOutlet, LucideAngularModule, SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      [attr.data-testid]="testId('settings-toast-live-status')"
    >{{ liveStatus() }}</div>
    <div
      class="sr-only"
      role="alert"
      aria-atomic="true"
      [attr.data-testid]="testId('settings-toast-live-alert')"
    >{{ liveAlert() }}</div>

    @if (feedback.toast(); as toast) {
      @if (inline()) {
        <ng-container *ngTemplateOutlet="body; context: { $implicit: toast }" />
      } @else {
        <div
          #region
          popover="manual"
          class="fixed inset-auto bottom-6 right-6 z-50 m-0 h-auto w-auto max-w-sm overflow-visible border-0 bg-transparent p-0 text-inherit [body:has(ptah-native-drawer_[role=dialog])_&]:bottom-28"
          data-testid="settings-toast-region"
        >
          <ng-container *ngTemplateOutlet="body; context: { $implicit: toast }" />
        </div>
      }
    }

    <ng-template #body let-toast>
      <div
        class="flex items-center gap-3 rounded-lg border bg-base-300 px-4 py-2.5 text-[13px] text-base-content"
        [class.shadow-lg]="!inline()"
        [class.border-base-content/15]="toast.tone === 'status'"
        [class.border-error/40]="toast.tone === 'alert'"
        [attr.data-testid]="testId('settings-toast')"
      >
        <span class="min-w-0 flex-1" [attr.data-testid]="testId('settings-toast-message')">{{ toast.message }}</span>
        @if (toast.canUndo) {
          <button
            type="button"
            class="btn btn-xs btn-warning font-bold"
            [ptahBusyDisabled]="feedback.saving()"
            (click)="feedback.undo()"
            [attr.data-testid]="testId('settings-toast-undo')"
          >
            Undo
          </button>
        }
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square h-5 w-5 min-h-0"
          (click)="feedback.dismiss()"
          aria-label="Dismiss notification"
          [attr.data-testid]="testId('settings-toast-dismiss')"
        >
          <lucide-angular [img]="XIcon" class="w-3 h-3 opacity-60" aria-hidden="true" />
        </button>
      </div>
    </ng-template>
  `,
})
export class SettingsToastComponent {
  protected readonly feedback = inject(SettingsSaveFeedbackService);
  protected readonly XIcon = X;

  /** Render in the flow of the host panel instead of fixed to the page; off for the page toast. */
  readonly inline = input(false);

  private readonly region = viewChild<ElementRef<HTMLElement>>('region');

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private raisePending = false;

  /** Text of the persistent polite region; empty until {@link ANNOUNCE_DELAY_MS} after a status toast appears. */
  protected readonly liveStatus = signal('');
  /** Text of the persistent assertive region; empty until {@link ANNOUNCE_DELAY_MS} after an alert toast appears. */
  protected readonly liveAlert = signal('');
  private announceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      // Each new toast object (also a repeat of the same message) clears both regions, then fills the toned one
      // after a tick, so screen readers see a text change in an element that already existed (P6-A1).
      const toast = this.feedback.toast();
      this.clearAnnounceTimer();
      this.liveStatus.set('');
      this.liveAlert.set('');
      if (!toast) return;
      this.announceTimer = setTimeout(() => {
        this.announceTimer = null;
        (toast.tone === 'alert' ? this.liveAlert : this.liveStatus).set(toast.message);
      }, ANNOUNCE_DELAY_MS);
    });
    this.destroyRef.onDestroy(() => this.clearAnnounceTimer());
    effect(() => {
      // Every new message also re-stacks the region.
      this.feedback.toast();
      const region = this.region()?.nativeElement;
      if (region) this.raiseRegion(region);
    });
    // toggle does not bubble. Capture also observes modal dialog openings.
    this.document.addEventListener('toggle', this.onTopLayerToggle, true);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('toggle', this.onTopLayerToggle, true);
    });
  }

  private readonly onTopLayerToggle = (event: Event): void => {
    const region = this.region()?.nativeElement;
    const target = event.target;
    if (
      !('newState' in event) || event.newState !== 'open' ||
      !region || !this.feedback.toast() || this.inline() || target === region ||
      !(target instanceof HTMLElement) ||
      !(target.hasAttribute('popover') || target.tagName === 'DIALOG') ||
      // Another page toast re-raising itself must not re-raise this one (loop).
      target.matches('[data-testid="settings-toast-region"]') ||
      this.raisePending
    ) return;
    this.raisePending = true;
    queueMicrotask(() => {
      this.raisePending = false;
      if (
        !this.destroyRef.destroyed && this.feedback.toast() && !this.inline() &&
        this.region()?.nativeElement === region && region.isConnected
      ) this.raiseRegion(region);
    });
  };

  private raiseRegion(region: HTMLElement): void {
    if (typeof region.showPopover !== 'function') {
      this.keepRegionInPlace(region);
      return;
    }
    try {
      if (region.matches(':popover-open')) region.hidePopover();
      // No autofocus descendants: popover focusing steps leave the active control alone,
      // including when a modal dialog just opened. The inline variant remains reachable there.
      region.showPopover();
      region.style.display = '';
    } catch {
      // degradation-audit: optional-capability - promotion refused; keep the toast visible in-page.
      this.keepRegionInPlace(region);
    }
  }

  /** Undo a non-open popover's display:none when promotion did not happen, so the toast stays visible in-page. */
  private keepRegionInPlace(region: HTMLElement): void {
    region.style.display = 'block';
  }

  private clearAnnounceTimer(): void {
    if (this.announceTimer === null) return;
    clearTimeout(this.announceTimer);
    this.announceTimer = null;
  }

  protected testId(base: string): string {
    return this.inline() ? base.replace('settings-toast', 'settings-toast-inline') : base;
  }
}
