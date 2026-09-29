import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { SettingsSaveFeedbackService } from './settings-save-feedback.service';

/**
 * Renders the Settings save toast (prototype `.toast-msg`, bottom-right) from
 * `SettingsSaveFeedbackService`. Success is `role="status"` (polite); failure and refusal are
 * `role="alert"`. Undo is disabled while any save is in flight (D3).
 */
@Component({
  selector: 'ptah-settings-toast',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (feedback.toast(); as toast) {
      <div class="fixed bottom-6 right-6 z-50 max-w-sm">
        <div
          class="flex items-center gap-3 rounded-lg border bg-base-300 px-4 py-2.5 text-[13px] text-base-content shadow-lg"
          [class.border-base-content/15]="toast.tone === 'status'"
          [class.border-error/40]="toast.tone === 'alert'"
          [attr.role]="toast.tone"
          [attr.aria-live]="toast.tone === 'status' ? 'polite' : 'assertive'"
          data-testid="settings-toast"
        >
          <span class="min-w-0 flex-1" data-testid="settings-toast-message">{{ toast.message }}</span>
          @if (toast.canUndo) {
            <button
              type="button"
              class="btn btn-xs btn-warning font-bold"
              [disabled]="feedback.saving()"
              (click)="feedback.undo()"
              data-testid="settings-toast-undo"
            >
              Undo
            </button>
          }
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square h-5 w-5 min-h-0"
            (click)="feedback.dismiss()"
            aria-label="Dismiss notification"
            data-testid="settings-toast-dismiss"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3 opacity-60" aria-hidden="true" />
          </button>
        </div>
      </div>
    }
  `,
})
export class SettingsToastComponent {
  protected readonly feedback = inject(SettingsSaveFeedbackService);
  protected readonly XIcon = X;
}
