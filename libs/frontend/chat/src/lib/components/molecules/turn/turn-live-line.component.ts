import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  formatAgentDuration,
  StreamingQuotesComponent,
} from '@ptah-extension/chat-ui';

/**
 * The live line under a live turn (design-spec §3.7): a pulsing dot, the
 * orchestrator verb and the turn timer.
 *
 * The verb follows the session needs-you aggregate, the same source as the
 * header chip: `Waiting for you` while it is above 0. Otherwise the line
 * shows the rotating loading sentences, which stay for the whole turn.
 * Only the verb is announced (`role="status"`, polite, `Orchestrating`
 * while the sentences show); the sentences and the timer are
 * `aria-hidden` so screen readers hear no per-character updates.
 *
 * Presentational only: the host passes `now` from its one transcript clock;
 * this component starts no timer.
 */
@Component({
  selector: 'ptah-turn-live-line',
  standalone: true,
  imports: [StreamingQuotesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: [
    `
      .turn-live-dot {
        position: relative;
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        flex-shrink: 0;
      }
      /* 2 px ring 4 px outside the dot; transform and opacity only. */
      .turn-live-dot::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 9999px;
        border: 2px solid currentColor;
        animation: ptahTurnLivePulse 1.6s
          var(--ptah-ease-soft, cubic-bezier(0.22, 0.61, 0.36, 1)) infinite;
      }
      @keyframes ptahTurnLivePulse {
        from {
          transform: scale(0.6);
          opacity: 0.55;
        }
        to {
          transform: scale(1.25);
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .turn-live-dot::after {
          animation: none;
          opacity: 0;
        }
      }
    `,
  ],
  template: `
    <div
      class="mt-3.5 flex items-center gap-2 text-xs"
      role="status"
      aria-live="polite"
      data-test="turn-live-line"
    >
      <span
        class="turn-live-dot bg-state-run text-state-run"
        aria-hidden="true"
      ></span>
      @if (waitingForYou()) {
        <span class="text-base-content" data-test="turn-live-verb"
          >Waiting for you</span
        >
      } @else {
        <span class="sr-only" data-test="turn-live-verb">Orchestrating</span>
        <ptah-streaming-quotes aria-hidden="true" />
      }
      @if (timer(); as timerText) {
        <span class="text-base-content-muted" aria-hidden="true">·</span>
        <span
          class="tabular-nums text-base-content-muted"
          aria-hidden="true"
          data-test="turn-live-timer"
          >{{ timerText }}</span
        >
      }
    </div>
  `,
})
export class TurnLiveLineComponent {
  /** `S`: the turn start (epoch ms); `null` shows no timer. */
  readonly startTs = input<number | null>(null);

  /** The transcript clock (epoch ms). */
  readonly now = input(0);

  /** Session needs-you aggregate (the header chip's count). */
  readonly needsYouCount = input(0);

  protected readonly waitingForYou = computed(() => this.needsYouCount() > 0);

  /** `{m}m {ss}s`; `null` under one second or without a start. */
  protected readonly timer = computed(() => {
    const start = this.startTs();
    return start === null ? null : formatAgentDuration(this.now() - start);
  });
}
