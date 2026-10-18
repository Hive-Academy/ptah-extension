import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input } from '@angular/core';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { CacheCountdownClockService } from './cache-countdown-clock.service';

type Cache = NonNullable<SessionStatsEntry['cache']>;
const IDLE_FIRE_LATENESS_MS = 60_000;
const ESTIMATE_TITLE = 'Estimated from the last request. The server can evict cached content early.';

@Component({
  selector: 'ptah-inspector-cache-tile',
  standalone: true,
  template: `
    <div class="col-span-2 min-w-0 rounded-md border border-surface-border bg-surface-1 p-2.5" role="group"
      data-testid="inspector-cache-tile" [title]="estimateTitle" [attr.aria-label]="accessibleText()">
      <div class="text-[11px] text-base-content-muted">Prompt cache · {{ cache().ttl }}</div>
      <div class="text-[15px] font-semibold tabular-nums">{{ expiryText() }}</div>
      @if (idleText(); as idle) {
        <p class="text-[11px] text-base-content-muted tabular-nums">{{ idle }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorCacheTileComponent {
  readonly cache = input.required<Cache>();
  private readonly clock = inject(CacheCountdownClockService);
  protected readonly estimateTitle = ESTIMATE_TITLE;
  protected readonly expiryText = computed(() => {
    const remaining = this.cache().expiresAt - this.clock.now();
    return remaining > 0
      ? `Cache expires in ${Math.max(1, Math.ceil(remaining / 60_000))} min (estimated)`
      : 'Cache expired';
  });
  protected readonly idleText = computed(() => {
    const fireAt = this.cache().idleCompactAt;
    const now = this.clock.now();
    return fireAt === undefined || now >= fireAt + IDLE_FIRE_LATENESS_MS
      ? null
      : `Idle compaction in ${Math.max(0, Math.ceil((fireAt - now) / 60_000))} min`;
  });
  protected readonly accessibleText = computed(() =>
    `Prompt cache ${this.cache().ttl}. ${this.expiryText()}. ${this.idleText() ?? ''} ${ESTIMATE_TITLE}`.trim(),
  );

  constructor() {
    inject(DestroyRef).onDestroy(this.clock.acquire());
  }
}
