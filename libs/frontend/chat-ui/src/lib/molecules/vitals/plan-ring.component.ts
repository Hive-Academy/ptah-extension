import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { ProgressRingComponent } from './progress-ring.component';

/** The plan-window reading a plan ring draws. `percent` is 0-100. */
export interface PlanRingData {
  readonly percent: number;
  readonly label: string;
  readonly resetsInMs: number | null;
}

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

/** "2h 14m", "3d 4h", "14m"; under one minute reads "<1m". */
function formatResetDelay(ms: number): string {
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 1) return '<1m';
  if (minutes < HOUR_MINUTES) return `${minutes}m`;
  if (minutes < DAY_MINUTES) {
    const hours = Math.floor(minutes / HOUR_MINUTES);
    const rest = minutes % HOUR_MINUTES;
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(minutes / DAY_MINUTES);
  const hours = Math.floor((minutes % DAY_MINUTES) / HOUR_MINUTES);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * The caption a stat cell shows under a plan ring: `"<label> · resets in 2h 14m"`,
 * or just `"<label>"` when the reset time is unknown. The ring itself renders
 * no caption (options.md:279), so consumers pass this to the cell's `caption`.
 */
export function planRingCaption(ring: PlanRingData): string {
  const { label, resetsInMs } = ring;
  if (resetsInMs === null || !Number.isFinite(resetsInMs)) return label;
  if (resetsInMs <= 0) return `${label} · resets now`;
  return `${label} · resets in ${formatResetDelay(resetsInMs)}`;
}

/**
 * PlanRingComponent — the teal plan-usage ring of the vitals rows. A thin
 * wrapper over `ptah-progress-ring` (`size='value'`, percent as centre text).
 * Renders nothing when `ring` is null or its percent is not a finite number.
 */
@Component({
  selector: 'ptah-plan-ring',
  standalone: true,
  imports: [ProgressRingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (percent() !== null) {
      <ptah-progress-ring
        [value]="fraction()"
        [centerText]="centerText()"
        tone="teal"
        size="value"
        [ariaLabel]="ariaLabel()"
      />
    }
  `,
})
export class PlanRingComponent {
  readonly ring = input.required<PlanRingData | null>();

  /** Percent clamped to 0-100 and rounded; `null` = nothing to draw. */
  protected readonly percent = computed(() => {
    const ring = this.ring();
    if (!ring || !Number.isFinite(ring.percent)) return null;
    return Math.round(Math.min(100, Math.max(0, ring.percent)));
  });

  protected readonly fraction = computed(() => (this.percent() ?? 0) / 100);
  protected readonly centerText = computed(() => `${this.percent() ?? 0}%`);
  protected readonly ariaLabel = computed(() => {
    const ring = this.ring();
    const percent = this.percent();
    if (!ring || percent === null) return '';
    return `${percent}% used. ${planRingCaption(ring)}`;
  });
}
