import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, KeyRound, X } from 'lucide-angular';

let nextId = 0;

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
 *
 * When the container binds a carry-over provider (stored-provider mismatch
 * with a ready active provider), a "Continue with <provider>" button comes
 * first and emits `carryOver`. Its accessible description discloses that this
 * conversation's text is sent to that provider (TASK_2026_865 AC 8.4).
 * Without a provider the banner renders exactly as before (AC 1.2, 1.3).
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
          <span class="font-semibold text-base-content-muted">
            Authentication required
          </span>
          <span class="flex-1"></span>
          @if (carryOverProvider(); as provider) {
            <button
              type="button"
              class="btn btn-xs btn-outline btn-primary gap-0.5 px-2"
              [disabled]="carryOverBusy()"
              [attr.aria-busy]="carryOverBusy()"
              [attr.aria-describedby]="disclosureId"
              (click)="carryOver.emit()"
            >
              @if (carryOverBusy()) {
                <span
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                ></span>
              }
              Continue with {{ provider }}
            </button>
            <span class="sr-only" [id]="disclosureId">
              Sends this conversation's text to {{ provider }} to start a new
              chat from a summary. Tool input, tool output and attachments are
              not sent, and known secrets are redacted.
            </span>
          }
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
        <p class="px-2 pb-1.5 text-[11px] text-base-content-muted leading-snug">
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

  /**
   * Display name of the active provider a carry-over can continue with, or
   * null for no carry-over button.
   */
  readonly carryOverProvider = input<string | null>(null);
  /** A carry-over for this banner's tab or session is starting. */
  readonly carryOverBusy = input<boolean>(false);

  /** User asked to re-authenticate. */
  readonly reauth = output<void>();
  /** User dismissed the banner. */
  readonly dismiss = output<void>();
  /** User asked to continue in a new chat on the active provider. */
  readonly carryOver = output<void>();

  /** Unique per instance: several chat views can show the banner at once. */
  protected readonly disclosureId =
    `auth-required-carry-over-disclosure-${nextId++}`;

  protected readonly reauthLabel = computed(() =>
    this.providerId() === 'openai-codex'
      ? 'Re-authenticate in terminal'
      : 'Open Settings',
  );

  protected readonly KeyRoundIcon = KeyRound;
  protected readonly XIcon = X;
}
