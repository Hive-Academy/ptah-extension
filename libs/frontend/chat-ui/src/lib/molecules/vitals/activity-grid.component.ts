import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/** One day of activity. `date` is a local calendar day, `YYYY-MM-DD`. */
export interface ActivityDay {
  readonly date: string;
  readonly value: number;
}

export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

const DAYS_PER_WEEK = 7;
const CELL = 20;
const GAP = 6;
const PITCH = CELL + GAP;
/** Room for the 2 px today outline at the edges. */
const PAD = 2;
const MAX_WEEKS = 53;
const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Day-one field: opacity falls off with distance from today (option-ab.mjs:53-62). */
const DAY_ONE_FALLOFF = 0.085;
const DAY_ONE_MIN_OPACITY = 0.12;
const DAY_ONE_ROW_STRETCH = 1.4;

interface ActivityCell {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly level: ActivityLevel;
  readonly today: boolean;
  /** Day-one opacity; `null` in history mode. */
  readonly opacity: number | null;
}

/** Epoch ms of a `YYYY-MM-DD` day at UTC midnight, or `null` when malformed. */
function parseDay(date: string): number | null {
  const match = ISO_DAY.exec(date);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Levels 1-4 by mid-rank quantile among the active (positive) days, so the
 * busiest quarter of days reads brightest whatever the absolute scale. Zero
 * and negative values are level 0.
 */
export function activityLevels(
  values: readonly number[],
): (value: number) => ActivityLevel {
  const active = values.filter((value) => value > 0).sort((a, b) => a - b);
  return (value: number): ActivityLevel => {
    if (!(value > 0) || active.length === 0) return 0;
    let below = 0;
    let equal = 0;
    for (const other of active) {
      if (other < value) below++;
      else if (other === value) equal++;
    }
    const rank = (below + equal / 2) / active.length;
    return (1 + Math.min(3, Math.floor(rank * 4))) as ActivityLevel;
  };
}

/**
 * ActivityGridComponent — the 13-week × 7-day activity field. Columns are
 * weeks (oldest left), rows are weekdays (Sunday top); the last column is the
 * week containing `today`, and days after today are not drawn. The today cell
 * is outlined and pulses once when motion is allowed. `mode='day-one'` draws
 * the calm first-run dot field that glows toward today instead of real data.
 *
 * Static SVG: no per-cell listener. One `role="img"` with the caller's
 * accessible name; the legend is decorative.
 */
@Component({
  selector: 'ptah-activity-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-mode]': 'mode()' },
  template: `
    @if (todayMs() !== null) {
      <svg
        class="ptah-activity-grid__svg"
        [class.ptah-activity-grid--day-one]="mode() === 'day-one'"
        [attr.width]="width()"
        [attr.height]="height"
        [attr.viewBox]="viewBox()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        focusable="false"
      >
        @for (cell of cells(); track cell.key) {
          <rect
            [attr.class]="
              'ptah-activity-grid__cell h' +
              cell.level +
              (cell.today ? ' ptah-activity-grid__today' : '')
            "
            [attr.x]="cell.x"
            [attr.y]="cell.y"
            [attr.width]="cellSize"
            [attr.height]="cellSize"
            [attr.rx]="cellRadius"
            [attr.opacity]="cell.opacity"
            [attr.stroke-width]="cell.today ? 2 : null"
            [attr.data-date]="cell.key"
          />
        }
      </svg>
      @if (caption() || mode() === 'history') {
        <div class="ptah-activity-grid__footer" [style.width.px]="width()">
          @if (caption()) {
            <span class="text-xs text-base-content-muted">{{ caption() }}</span>
          }
          @if (mode() === 'history') {
            <span
              class="ptah-activity-grid__legend text-xs text-base-content-muted"
              aria-hidden="true"
            >
              <svg width="68" height="12" viewBox="0 0 68 12">
                @for (level of legendLevels; track level) {
                  <rect
                    [attr.class]="'h' + level"
                    [attr.x]="level * 14"
                    width="12"
                    height="12"
                    rx="3"
                  />
                }
              </svg>
            </span>
          }
        </div>
      }
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex-direction: column;
        gap: 10px;
        max-width: 100%;
      }
      .ptah-activity-grid__svg {
        display: block;
        max-width: 100%;
        height: auto;
      }
      .ptah-activity-grid__footer {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        max-width: 100%;
      }
      .ptah-activity-grid__legend {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
      }
      .h0 {
        fill: oklch(var(--bc) / 0.08);
      }
      .h1 {
        fill: oklch(var(--p) / 0.28);
      }
      .h2 {
        fill: oklch(var(--p) / 0.5);
      }
      .h3 {
        fill: oklch(var(--p) / 0.75);
      }
      .h4 {
        fill: oklch(var(--p));
      }
      .ptah-activity-grid__today {
        stroke: oklch(var(--p));
      }
      .ptah-activity-grid--day-one .ptah-activity-grid__today {
        fill: oklch(var(--bc) / 0.08);
        filter: drop-shadow(0 0 6px oklch(var(--p) / 0.6));
      }
      @media (prefers-reduced-motion: no-preference) {
        .ptah-activity-grid__today {
          animation: ptah-activity-pulse 2s ease-in-out 1;
        }
      }
      @keyframes ptah-activity-pulse {
        50% {
          opacity: 0.45;
        }
      }
    `,
  ],
})
export class ActivityGridComponent {
  readonly days = input.required<readonly ActivityDay[]>();
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly today = input.required<string>();
  readonly weeks = input<number>(13);
  readonly mode = input<'history' | 'day-one'>('history');
  readonly caption = input<string | null>(null);
  readonly ariaLabel = input.required<string>();

  protected readonly cellSize = CELL;
  protected readonly cellRadius = 4;
  protected readonly height = DAYS_PER_WEEK * PITCH - GAP;
  protected readonly legendLevels: readonly ActivityLevel[] = [0, 1, 2, 3, 4];

  private readonly weekCount = computed(() => {
    const weeks = Math.floor(this.weeks());
    return Number.isFinite(weeks)
      ? Math.min(MAX_WEEKS, Math.max(1, weeks))
      : 13;
  });

  protected readonly width = computed(() => this.weekCount() * PITCH - GAP);
  protected readonly viewBox = computed(
    () => `${-PAD} ${-PAD} ${this.width() + PAD * 2} ${this.height + PAD * 2}`,
  );

  /** `today` at UTC midnight; `null` when malformed, and then nothing renders. */
  protected readonly todayMs = computed(() => parseDay(this.today()));

  protected readonly cells = computed<readonly ActivityCell[]>(() => {
    const todayMs = this.todayMs();
    if (todayMs === null) return [];
    const weeks = this.weekCount();
    const todayRow = new Date(todayMs).getUTCDay();
    const startMs = todayMs - ((weeks - 1) * DAYS_PER_WEEK + todayRow) * DAY_MS;
    const dayOne = this.mode() === 'day-one';

    const byDay = new Map<string, number>();
    if (!dayOne) {
      for (const day of this.days()) {
        if (!Number.isFinite(day.value)) continue;
        byDay.set(day.date, (byDay.get(day.date) ?? 0) + day.value);
      }
    }

    const slots: { key: string; week: number; row: number }[] = [];
    for (let week = 0; week < weeks; week++) {
      for (let row = 0; row < DAYS_PER_WEEK; row++) {
        const ms = startMs + (week * DAYS_PER_WEEK + row) * DAY_MS;
        if (ms > todayMs) break;
        slots.push({ key: formatDay(ms), week, row });
      }
    }

    const level = activityLevels(slots.map((slot) => byDay.get(slot.key) ?? 0));
    const todayWeek = weeks - 1;

    return slots.map(({ key, week, row }) => {
      const isToday = week === todayWeek && row === todayRow;
      let opacity: number | null = null;
      if (dayOne && !isToday) {
        const distance = Math.hypot(
          week - todayWeek,
          (row - todayRow) * DAY_ONE_ROW_STRETCH,
        );
        opacity =
          Math.round(
            Math.max(DAY_ONE_MIN_OPACITY, 1 - distance * DAY_ONE_FALLOFF) * 100,
          ) / 100;
      }
      return {
        key,
        x: week * PITCH,
        y: row * PITCH,
        level: dayOne ? 0 : level(byDay.get(key) ?? 0),
        today: isToday,
        opacity,
      };
    });
  });
}
