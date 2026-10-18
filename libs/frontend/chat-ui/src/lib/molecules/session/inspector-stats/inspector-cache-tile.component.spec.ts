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

  beforeEach(() => { now.set(0); acquire.mockClear(); release.mockClear(); });

  it.each(['1h', '5m'] as const)('shows the %s estimate and expiration boundary', ttl => {
    const expiresAt = ttl === '1h' ? 3_600_000 : 300_000;
    const fixture = render({ ttl, lastRequestAt: 0, expiresAt });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(`Prompt cache · ${ttl}`);
    expect(root.textContent).toContain(`Cache expires in ${ttl === '1h' ? 60 : 5} min (estimated)`);
    now.set(expiresAt - 1);
    fixture.detectChanges();
    expect(root.textContent).toContain('Cache expires in 1 min (estimated)');
    now.set(expiresAt);
    fixture.detectChanges();
    expect(root.textContent).toContain('Cache expired');
    expect(root.querySelector('[data-testid="inspector-cache-tile"]')?.getAttribute('aria-label')).toContain('server can evict cached content early');
    fixture.destroy();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('shows armed idle time through fire time and hides it after lateness', () => {
    const fixture = render({ ttl: '1h', lastRequestAt: 0, expiresAt: 3_600_000, idleCompactAt: 120_000 });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Idle compaction in 2 min');
    now.set(120_000);
    fixture.detectChanges();
    expect(root.textContent).toContain('Idle compaction in 0 min');
    now.set(180_000);
    fixture.detectChanges();
    expect(root.textContent).not.toContain('Idle compaction');
    fixture.destroy();
  });
});
