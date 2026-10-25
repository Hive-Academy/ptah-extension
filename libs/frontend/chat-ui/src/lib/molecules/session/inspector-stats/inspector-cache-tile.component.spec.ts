import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { CacheCountdownClockService } from './cache-countdown-clock.service';
import { InspectorCacheTileComponent } from './inspector-cache-tile.component';

type Cache = NonNullable<SessionStatsEntry['cache']>;

describe(InspectorCacheTileComponent.name, () => {
  const now = signal(0);
  const release = jest.fn();
  const acquire = jest.fn(() => release);

  function render(cache: Cache) {
    TestBed.configureTestingModule({
      imports: [InspectorCacheTileComponent],
      providers: [{ provide: CacheCountdownClockService, useValue: { now, acquire } }],
    });
    const fixture = TestBed.createComponent(InspectorCacheTileComponent);
    fixture.componentRef.setInput('cache', cache);
    fixture.detectChanges();
    return fixture;
  }

  function ring(root: HTMLElement) {
    const svg = root.querySelector('svg');
    const arc = svg?.querySelectorAll('circle')[1];
    return { svg, arc };
  }

  beforeEach(() => { now.set(0); acquire.mockClear(); release.mockClear(); });

  it.each([
    { ttl: '1h' as const, expiresAt: 3_600_000, start: '1:00:00' },
    { ttl: '5m' as const, expiresAt: 300_000, start: '05:00' },
  ])('shows the $ttl countdown, ring, and expiration boundary', ({ ttl, expiresAt, start }) => {
    const fixture = render({ ttl, lastRequestAt: 0, expiresAt });
    const root = fixture.nativeElement as HTMLElement;
    const tile = root.querySelector('[data-testid="inspector-cache-tile"]');
    const { svg, arc } = ring(root);
    expect(root.classList.contains('col-span-2')).toBe(false);
    expect(root.classList.contains('min-w-0')).toBe(true);
    expect(tile?.classList.contains('relative')).toBe(true);
    expect(root.textContent).toContain(`Prompt cache · ${ttl}`);
    expect(root.textContent).toContain(start);
    expect(root.textContent).toContain('Estimated');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.style.color).toBe('var(--ptah-gold, var(--ptah-accent-ink))');
    expect(Number(arc?.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
    expect(tile?.getAttribute('role')).toBe('group');
    expect(tile?.getAttribute('title')).toContain('server can evict cached content early');
    expect(tile?.getAttribute('aria-label')).toContain(`Cache expires in ${ttl === '1h' ? 60 : 5} minutes (estimated)`);
    expect(tile?.hasAttribute('aria-live')).toBe(false);

    now.set(expiresAt * 0.8);
    fixture.detectChanges();
    expect(svg?.style.color).toBe('var(--state-ink-need)');
    expect(Number(arc?.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 18 * 0.8);

    now.set(expiresAt - 1);
    fixture.detectChanges();
    expect(root.textContent).toContain('00:01');
    expect(tile?.getAttribute('aria-label')).toContain('Cache expires in 1 minute (estimated)');
    now.set(expiresAt);
    fixture.detectChanges();
    expect(root.textContent).toContain('Expired');
    expect(svg?.style.color).toBe('var(--state-ink-err)');
    expect(Number(arc?.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 18);
    expect(tile?.getAttribute('aria-label')).toBe(
      `Prompt cache ${ttl}. Cache expired. Estimated from the last request. The server can evict cached content early.`,
    );
    fixture.destroy();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('updates seconds and keeps aria time at whole minutes', () => {
    const fixture = render({ ttl: '1h', lastRequestAt: 0, expiresAt: 3_600_000 });
    const root = fixture.nativeElement as HTMLElement;
    const tile = root.querySelector('[data-testid="inspector-cache-tile"]');
    now.set(60_000);
    fixture.detectChanges();
    expect(root.textContent).toContain('59:00');
    const aria = tile?.getAttribute('aria-label');
    now.set(61_000);
    fixture.detectChanges();
    expect(root.textContent).toContain('58:59');
    expect(tile?.getAttribute('aria-label')).toBe(aria);
    fixture.destroy();
  });

  it('shows idle time through fire time and hides it at the lateness cutoff', () => {
    const fixture = render({ ttl: '1h', lastRequestAt: 0, expiresAt: 3_600_000, idleCompactAt: 120_000 });
    const root = fixture.nativeElement as HTMLElement;
    const tile = root.querySelector('[data-testid="inspector-cache-tile"]');
    expect(root.textContent).toContain('Estimated · idle compaction in 02:00');
    expect(tile?.getAttribute('aria-label')).toContain('Idle compaction in 2 minutes.');
    now.set(120_000);
    fixture.detectChanges();
    expect(root.textContent).toContain('idle compaction in 00:00');
    expect(tile?.getAttribute('aria-label')).toContain('Idle compaction in 1 minute.');
    now.set(179_999);
    fixture.detectChanges();
    expect(root.textContent).toContain('idle compaction in 00:00');
    now.set(180_000);
    fixture.detectChanges();
    expect(root.textContent).not.toContain('idle compaction');
    expect(tile?.getAttribute('aria-label')).not.toContain('Idle compaction');
    fixture.destroy();
  });
});
