import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
} from '@angular/core';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { CacheCountdownClockService } from './cache-countdown-clock.service';

type Cache = NonNullable<SessionStatsEntry['cache']>;
const IDLE_FIRE_LATENESS_MS = 60_000;
const ESTIMATE_TITLE =
  'Estimated from the last request. The server can evict cached content early.';

function wholeMinutes(ms: number): string {
  const count = Math.max(1, Math.ceil(ms / 60_000));
  return `${count} ${count === 1 ? 'minute' : 'minutes'}`;
}

function countdown(ms: number, showHours = true): string {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return showHours && minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
    : `${String(minutes).padStart(2, '0')}:${remainder}`;
}

@Component({
  selector: 'ptah-inspector-cache-tile',
  standalone: true,
  host: { class: 'block min-w-0' },
  template: `
    <!-- Same metric cell as Context / Tokens / Cost: label, value, subline, bar. -->
    <div
      class="min-w-0"
      role="group"
      data-testid="inspector-cache-tile"
      [title]="estimateTitle"
      [attr.aria-label]="accessibleText()"
    >
      <div class="text-[10.5px] text-base-content-muted">
        Cache · {{ cache().ttl }}
      </div>
      <div
        class="text-base font-semibold leading-tight tabular-nums"
        [style.color]="expired() ? ink() : null"
      >
        {{ countdownText() }}
      </div>
      <p
        class="truncate text-[10.5px] text-base-content-muted tabular-nums"
        [textContent]="subline()"
      ></p>
      <div
        class="mt-1 h-1 rounded-full bg-[var(--surface-border-strong)]"
        aria-hidden="true"
      >
        <span
          class="bar block h-full rounded-full"
          data-testid="cache-bar"
          [style.width.%]="remainingPercent()"
          [style.background-color]="ink()"
        ></span>
      </div>
    </div>
  `,
  styles: [
    `
      .bar {
        transition: width 400ms var(--ptah-ease-soft);
      }
      @media (prefers-reduced-motion: reduce) {
        .bar {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorCacheTileComponent {
  readonly cache = input.required<Cache>();
  private readonly clock = inject(CacheCountdownClockService);
  protected readonly estimateTitle = ESTIMATE_TITLE;
  protected readonly remainingMs = computed(
    () => this.cache().expiresAt - this.clock.now(),
  );
  protected readonly expired = computed(() => this.remainingMs() <= 0);
  protected readonly remainingPercent = computed(() => {
    const ttlMs = this.cache().ttl === '1h' ? 3_600_000 : 300_000;
    return Math.max(0, Math.min(100, (this.remainingMs() / ttlMs) * 100));
  });
  protected readonly ink = computed(() =>
    this.remainingMs() <= 0
      ? 'var(--state-ink-err)'
      : this.remainingPercent() <= 20
        ? 'var(--state-ink-need)'
        : 'var(--ptah-gold, var(--ptah-accent-ink))',
  );
  protected readonly countdownText = computed(() =>
    this.remainingMs() <= 0 ? 'Expired' : countdown(this.remainingMs()),
  );
  protected readonly idleCountdown = computed(() => {
    const fireAt = this.cache().idleCompactAt;
    const now = this.clock.now();
    return fireAt === undefined || now >= fireAt + IDLE_FIRE_LATENESS_MS
      ? null
      : countdown(fireAt - now, false);
  });
  protected readonly subline = computed(() => {
    const idle = this.idleCountdown();
    return idle ? `idle in ${idle}` : 'estimated';
  });
  protected readonly accessibleText = computed(() => {
    const remaining = this.remainingMs();
    const fireAt = this.cache().idleCompactAt;
    const now = this.clock.now();
    const idle =
      fireAt === undefined || now >= fireAt + IDLE_FIRE_LATENESS_MS
        ? null
        : `Idle compaction in ${wholeMinutes(fireAt - now)}.`;
    return [
      `Prompt cache ${this.cache().ttl}.`,
      remaining > 0
        ? `Cache expires in ${wholeMinutes(remaining)} (estimated).`
        : 'Cache expired.',
      ...(idle ? [idle] : []),
      ESTIMATE_TITLE,
    ].join(' ');
  });

  constructor() {
    inject(DestroyRef).onDestroy(this.clock.acquire());
  }
}
