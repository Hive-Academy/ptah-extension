import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  afterNextRender,
  computed,
  input,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@ptah-extension/i18n';

/**
 * CountdownTimerComponent — presentational days/hours/minutes/seconds countdown
 * to a fixed target instant, themed with the live amber + ink tokens.
 *
 * Prerender-safe: `ngSkipHydration` opts the subtree out of hydration (the SSG
 * build renders a build-time snapshot that the client re-renders and ticks
 * live), so the ticking clock never trips a hydration mismatch. The 1s interval
 * is started in `afterNextRender` (browser only) and cleared on destroy. The
 * seconds cell pulses to read as "live", gated behind
 * `prefers-reduced-motion: no-preference`.
 */
@Component({
  selector: 'ptah-countdown-timer',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { ngSkipHydration: 'true', 'data-prerender-volatile': '' },
  template: `
    @if (expired()) {
      <div
        class="text-center font-mono text-sm uppercase tracking-[0.2em] text-amber-500"
        role="timer"
      >
        {{ 'ui.countdown.closing' | transloco }}
      </div>
    } @else {
      <!-- A clock reads days to seconds left to right in both languages -->
      <div
        class="flex items-start justify-center gap-2 sm:gap-3"
        dir="ltr"
        role="timer"
        [attr.aria-label]="'ui.countdown.ariaLabel' | transloco: ariaParams()"
      >
        <!-- i18n-keys: ui.countdown.days ui.countdown.hours ui.countdown.minutes ui.countdown.seconds -->
        @for (cell of cells(); track cell.unit; let last = $last) {
          <div class="flex flex-col items-center">
            <span
              class="inline-flex min-w-[2.75rem] items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 font-mono text-2xl sm:text-3xl font-bold leading-none tabular-nums text-white"
              [class.sec-pulse]="cell.unit === 'seconds'"
              >{{ cell.value }}</span
            >
            <span
              class="mt-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-500"
              >{{ cell.labelKey | transloco }}</span
            >
          </div>
          @if (!last) {
            <span
              class="mt-2 font-mono text-2xl font-bold text-amber-500/50"
              aria-hidden="true"
              >:</span
            >
          }
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      @media (prefers-reduced-motion: no-preference) {
        .sec-pulse {
          animation: sec-pulse 1s ease-in-out infinite;
        }
        @keyframes sec-pulse {
          0%,
          100% {
            border-color: rgba(245, 165, 36, 0.25);
            box-shadow: none;
          }
          50% {
            border-color: rgba(245, 165, 36, 0.6);
            box-shadow: 0 0 14px rgba(245, 165, 36, 0.3);
          }
        }
      }
    `,
  ],
})
export class CountdownTimerComponent implements OnDestroy {
  /** Target instant as an epoch-ms timestamp (e.g. `Date.UTC(2026, 7, 15)`). */
  public readonly target = input.required<number>();

  private readonly now = signal(Date.now());
  private intervalId: ReturnType<typeof setInterval> | null = null;

  protected readonly remaining = computed(() =>
    Math.max(0, this.target() - this.now()),
  );
  protected readonly expired = computed(() => this.remaining() === 0);

  protected readonly cells = computed(() => {
    const totalSeconds = Math.floor(this.remaining() / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [
      { unit: 'days', labelKey: 'ui.countdown.days', value: this.pad(days) },
      { unit: 'hours', labelKey: 'ui.countdown.hours', value: this.pad(hours) },
      {
        unit: 'minutes',
        labelKey: 'ui.countdown.minutes',
        value: this.pad(minutes),
      },
      {
        unit: 'seconds',
        labelKey: 'ui.countdown.seconds',
        value: this.pad(seconds),
      },
    ];
  });

  /** Parameters of `ui.countdown.ariaLabel`, one per cell. */
  protected readonly ariaParams = computed(() => {
    const [d, h, m, s] = this.cells();
    return {
      days: d.value,
      hours: h.value,
      minutes: m.value,
      seconds: s.value,
    };
  });

  constructor() {
    afterNextRender(() => {
      this.now.set(Date.now());
      this.intervalId = setInterval(() => this.now.set(Date.now()), 1000);
    });
  }

  public ngOnDestroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private pad(n: number): string {
    return n.toString().padStart(2, '0');
  }
}
