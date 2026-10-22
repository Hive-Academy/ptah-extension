import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';
import { SettingsSaveFeedbackService } from './settings-save-feedback.service';
import { SettingsBusyDisabledDirective } from './busy-disabled.directive';

/**
 * Renders the Settings save toast (prototype `.toast-msg`, bottom-right) from
 * `SettingsSaveFeedbackService`. Success is `role="status"` (polite); failure and refusal are
 * `role="alert"`. Undo is disabled while any save is in flight (D3); it stays focusable (aria-disabled).
 *
 * While a NativeDrawer is open the toast sits at `bottom-28` (112 px) instead of `bottom-6`, so it clears
 * the drawer's pinned footer (Close, Save, Back: 57 px, 105 px when the setup wizard's footer wraps) and
 * never takes a click meant for it (Batch 49b). The rule is pure CSS (`:has()`), so nothing is observed or
 * polled. A NativeModal needs no rule: its `<dialog>` is in the top layer, above any fixed element.
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
        [attr.role]="toast.tone"
        [attr.aria-live]="toast.tone === 'status' ? 'polite' : 'assertive'"
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

  constructor() {
    effect(() => {
      // Read the toast so every new message re-stacks the region above popovers opened since.
      this.feedback.toast();
      const region = this.region()?.nativeElement;
      if (!region) return;
      if (typeof region.showPopover !== 'function') {
        this.keepRegionInPlace(region);
        return;
      }
      try {
        if (region.matches(':popover-open')) region.hidePopover();
        region.showPopover();
        region.style.display = '';
      } catch {
        // Intentionally swallowed (not connected or Popover API refused): the toast stays in the page layer.
        this.keepRegionInPlace(region);
      }
    });
  }

  /** Undo a non-open popover's display:none when promotion did not happen, so the toast stays visible in-page. */
  private keepRegionInPlace(region: HTMLElement): void {
    region.style.display = 'block';
  }

  protected testId(base: string): string {
    return this.inline() ? base.replace('settings-toast', 'settings-toast-inline') : base;
  }
}
