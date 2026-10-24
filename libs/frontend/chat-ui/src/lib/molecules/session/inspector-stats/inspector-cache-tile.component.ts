import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input } from '@angular/core';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { CacheCountdownClockService } from './cache-countdown-clock.service';

type Cache = NonNullable<SessionStatsEntry['cache']>;
const IDLE_FIRE_LATENESS_MS = 60_000;
const ESTIMATE_TITLE = 'Estimated from the last request. The server can evict cached content early.';
const CIRCUMFERENCE = 2 * Math.PI * 18;

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
    <div class="relative rounded-md border border-surface-border bg-surface-1 p-1.5" role="group"
      data-testid="inspector-cache-tile" [title]="estimateTitle" [attr.aria-label]="accessibleText()">
      <div class="flex flex-wrap items-center gap-1">
        <svg width="24" height="24" viewBox="0 0 44 44" class="block -rotate-90 shrink-0"
          [style.color]="ringInk()" aria-hidden="true">
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface-border-strong)" stroke-width="4" />
          <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" stroke-width="4"
            stroke-linecap="round" [attr.stroke-dasharray]="circumference"
            [attr.stroke-dashoffset]="circumference * (1 - remainingPercent() / 100)" class="arc" />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="text-[10px] text-base-content-muted">Prompt cache · {{ cache().ttl }}</div>
          <div class="text-sm font-semibold tabular-nums">{{ countdownText() }}</div>
          <div class="text-[10px] text-base-content-muted tabular-nums">
            Estimated@if (idleCountdown(); as idle) { · idle compaction in {{ idle }} }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .arc { transition: stroke-dashoffset 400ms var(--ptah-ease-soft); }
    @media (prefers-reduced-motion: reduce) { .arc { transition: none; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorCacheTileComponent {
  readonly cache = input.required<Cache>();
  private readonly clock = inject(CacheCountdownClockService);
  protected readonly estimateTitle = ESTIMATE_TITLE;
  protected readonly circumference = CIRCUMFERENCE;
  protected readonly remainingMs = computed(() => this.cache().expiresAt - this.clock.now());
  protected readonly remainingPercent = computed(() => {
    const ttlMs = this.cache().ttl === '1h' ? 3_600_000 : 300_000;
    return Math.max(0, Math.min(100, this.remainingMs() / ttlMs * 100));
  });
  protected readonly ringInk = computed(() => this.remainingMs() <= 0 ? 'var(--state-ink-err)'
    : this.remainingPercent() <= 20 ? 'var(--state-ink-need)'
    : 'var(--ptah-gold, var(--ptah-accent-ink))');
  protected readonly countdownText = computed(() => this.remainingMs() <= 0
    ? 'Expired' : countdown(this.remainingMs()));
  protected readonly idleCountdown = computed(() => {
    const fireAt = this.cache().idleCompactAt;
    const now = this.clock.now();
    return fireAt === undefined || now >= fireAt + IDLE_FIRE_LATENESS_MS
      ? null : countdown(fireAt - now, false);
  });
  protected readonly accessibleText = computed(() => {
    const remaining = this.remainingMs();
    const fireAt = this.cache().idleCompactAt;
    const now = this.clock.now();
    const idle = fireAt === undefined || now >= fireAt + IDLE_FIRE_LATENESS_MS
      ? null : `Idle compaction in ${wholeMinutes(fireAt - now)}.`;
    return [
      `Prompt cache ${this.cache().ttl}.`,
      remaining > 0 ? `Cache expires in ${wholeMinutes(remaining)} (estimated).` : 'Cache expired.',
      ...(idle ? [idle] : []),
      ESTIMATE_TITLE,
    ].join(' ');
  });

  constructor() {
    inject(DestroyRef).onDestroy(this.clock.acquire());
  }
}

