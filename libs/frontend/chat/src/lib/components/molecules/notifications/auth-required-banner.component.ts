import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, KeyRound, X } from 'lucide-angular';

/**
 * AuthRequiredBannerComponent - inline banner shown in the chat surface when a
 * send fails because the active provider needs (re-)authentication.
 *
 * Primary case: an expired OpenAI Codex OAuth token. The chat previously failed
 * with a cryptic "not initialized" error and the only hint was buried in
 * Settings; this banner surfaces the recovery action inline.
 *
 * Presentational only — receives message/provider via inputs and emits
 * `reauth` / `dismiss`. The container (chat-view) owns the RPC + state wiring.
 */
@Component({
  selector: 'ptah-auth-required-banner',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message()) {
      <div
        class="relative bg-base-300/30 rounded border border-warning/40"
        role="alert"
        aria-label="Authentication required"
      >
        <div class="py-1.5 px-2 flex items-center gap-1.5 text-[11px]">
          <lucide-angular
            [img]="KeyRoundIcon"
            class="w-3 h-3 text-warning flex-shrink-0"
            aria-hidden="true"
          />
          <span class="font-semibold text-base-content/80">
            Authentication required
          </span>
          <span class="flex-1"></span>
          <button
            type="button"
            class="btn btn-xs btn-primary gap-0.5 px-2"
            (click)="reauth.emit()"
            [attr.aria-label]="reauthLabel()"
          >
            {{ reauthLabel() }}
          </button>
          <button
            type="button"
            class="btn btn-xs btn-ghost px-1"
            (click)="dismiss.emit()"
            aria-label="Dismiss"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
        <p class="px-2 pb-1.5 text-[11px] text-base-content/60 leading-snug">
          {{ message() }}
        </p>
      </div>
    }
  `,
})
export class AuthRequiredBannerComponent {
  /** Recovery message to display (empty/undefined hides the banner). */
  readonly message = input<string | undefined>(undefined);
  /** Provider id, used to tailor the action label. */
  readonly providerId = input<string | null>(null);

  /** User asked to re-authenticate. */
  readonly reauth = output<void>();
  /** User dismissed the banner. */
  readonly dismiss = output<void>();

  protected readonly reauthLabel = computed(() =>
    this.providerId() === 'openai-codex'
      ? 'Re-authenticate in terminal'
      : 'Open Settings',
  );

  protected readonly KeyRoundIcon = KeyRound;
  protected readonly XIcon = X;
}
