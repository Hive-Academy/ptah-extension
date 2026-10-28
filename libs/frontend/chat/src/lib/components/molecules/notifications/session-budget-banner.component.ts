import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  SessionBudgetStage,
  SessionBudgetState,
} from '@ptah-extension/shared';
import { budgetAmount, formatPercent } from './session-budget-format';

/** Stages that show a banner. */
type BannerStage = 'handoff' | 'limit';

interface BudgetMeter {
  /** Bar value, clamped to 0–100. */
  readonly value: number;
  readonly label: string;
}

const BODY =
  'Ask the agent to finish its running work, write a handoff document and give you a prompt for a new session.';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * SessionBudgetBannerComponent - the session budget notice.
 *
 * Dumb component: shown at the `handoff` and `limit` display stages unless the
 * user dismissed that stage. A dismissed `handoff` comes back at `limit`. "Wrap up & hand off" asks the
 * parent to send the wrap-up message; the agent does the rest. While an automatic hand-off is queued the
 * notice stays up (even if dismissed) with "Auto hand-off queued" and a Cancel button.
 */
@Component({
  selector: 'ptah-session-budget-banner',
  standalone: true,
  template: `
    @if (stage(); as current) {
      <div
        class="surface-2 mx-2 my-1 rounded-lg border text-xs"
        [class.border-warning]="current === 'handoff'"
        [class.border-error]="current === 'limit'"
        [attr.role]="current === 'limit' ? 'alert' : 'status'"
        [attr.aria-live]="current === 'limit' ? 'assertive' : 'polite'"
        data-testid="session-budget-banner"
      >
        <div class="px-2.5 pt-2">
          <div
            class="font-semibold leading-5"
            data-testid="session-budget-title"
          >
            {{ title() }}
          </div>
          @if (meter(); as meter) {
            <progress
              class="progress mt-1.5 h-1.5 w-full"
              [class.progress-warning]="current === 'handoff'"
              [class.progress-error]="current === 'limit'"
              [value]="meter.value"
              max="100"
              [attr.aria-label]="meter.label"
              data-testid="session-budget-meter"
            ></progress>
          }
        </div>

        <p
          class="mt-1.5 px-2.5 leading-relaxed text-base-content-muted"
          data-testid="session-budget-body"
        >
          {{ body }}
        </p>

        @if (autoHandoffQueued()) {
          <div
            class="mt-1.5 flex flex-wrap items-center gap-2 px-2.5"
            data-testid="session-budget-auto-queued"
          >
            <span class="font-semibold">Auto hand-off queued</span>
            <span class="text-base-content-muted">
              It runs after the current turn.
            </span>
            <button
              type="button"
              class="btn btn-xs btn-outline {{ focus }}"
              aria-label="Cancel the automatic hand-off"
              (click)="cancelAutoHandoff.emit()"
              data-testid="session-budget-auto-cancel"
            >
              Cancel
            </button>
          </div>
        }

        <div class="flex flex-wrap items-center gap-1 px-2.5 pb-2 pt-1.5">
          <button
            type="button"
            class="btn btn-xs btn-primary {{ focus }}"
            [disabled]="wrapUpSent()"
            (click)="wrapUp.emit()"
            data-testid="session-budget-wrap-up"
          >
            {{ wrapUpSent() ? 'Wrap-up requested' : 'Wrap up & hand off' }}
          </button>
          <button
            type="button"
            class="btn btn-xs btn-ghost {{ focus }}"
            (click)="dismiss.emit()"
            data-testid="session-budget-dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionBudgetBannerComponent {
  /** The tab's budget state, for the figures. */
  readonly budget = input<SessionBudgetState | null>(null);

  /** The stage to display (authoritative or live, whichever is higher). */
  readonly displayStage = input<SessionBudgetStage | null>(null);

  /** The stage the user dismissed in this session, or `null`. */
  readonly dismissedStage = input<SessionBudgetStage | null>(null);

  /** True once the wrap-up message was sent for this session. */
  readonly wrapUpSent = input(false);

  /** True while the automatic hand-off is queued and can still be cancelled. */
  readonly autoHandoffQueued = input(false);

  /** "Wrap up & hand off". */
  readonly wrapUp = output<void>();
  /** "Dismiss": hide the notice until the stage rises. */
  readonly dismiss = output<void>();
  /** "Cancel" on a queued automatic hand-off. */
  readonly cancelAutoHandoff = output<void>();

  protected readonly body = BODY;
  protected readonly focus = FOCUS;

  /** The stage to show, or `null` for none. */
  protected readonly stage = computed<BannerStage | null>(() => {
    const display = this.displayStage();
    if (!this.budget() || (display !== 'handoff' && display !== 'limit')) {
      return null;
    }
    return this.dismissedStage() === display && !this.autoHandoffQueued()
      ? null
      : display;
  });

  /** "Session used 41.2M of 50.0M tokens". */
  protected readonly title = computed(() => {
    const budget = this.budget();
    return budget ? `Session used ${budgetAmount(budget)}` : '';
  });

  /** Linear meter of `percent`, clamped for the bar. Hidden with no figure. */
  protected readonly meter = computed<BudgetMeter | null>(() => {
    const budget = this.budget();
    if (!budget || !this.stage() || budget.percent === null) return null;
    const shown = formatPercent(budget.percent);
    return {
      value: Math.max(0, Math.min(100, budget.percent)),
      label:
        budget.percent > 100
          ? `${shown} of session budget, over the limit`
          : `${shown} of session budget`,
    };
  });
}
