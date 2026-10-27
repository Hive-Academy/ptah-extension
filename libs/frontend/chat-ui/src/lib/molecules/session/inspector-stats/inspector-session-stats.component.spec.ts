import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelStateService } from '@ptah-extension/core';
import type { SessionStatsInputs } from '../session-stats-view';
import { CacheCountdownClockService } from './cache-countdown-clock.service';
import { InspectorSessionStatsComponent } from './inspector-session-stats.component';

describe(InspectorSessionStatsComponent.name, () => {
  const clockNow = signal(0);
  const release = jest.fn();
  const clock = { now: clockNow, acquire: jest.fn(() => release) };

  it('mounts only a present cache, releases it on removal, and updates on session switch', () => {
    TestBed.configureTestingModule({
      imports: [InspectorSessionStatsComponent],
      providers: [
        { provide: ModelStateService, useValue: { availableModels: signal([]) } },
        { provide: CacheCountdownClockService, useValue: clock },
      ],
    });
    const fixture = TestBed.createComponent(InspectorSessionStatsComponent);
    const stats: SessionStatsInputs = {
      sessionId: 'one', snapshot: null, cache: null, liveModelStats: null,
      compactionCount: 0, limits: null, budget: null,
      context: { hasLive: false, known: false, percent: null, label: '—', usedTokens: null },
      limitSummary: { state: 'none', text: null, extra: 0, source: null, fullText: null },
    };
    fixture.componentRef.setInput('stats', stats);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="inspector-cache-tile"]')).toBeNull();
    const grid = root.querySelector('[data-testid="inspector-stats-grid"]');
    expect(grid?.classList.contains('grid-cols-3')).toBe(true);
    expect(grid?.querySelectorAll('[data-glass-surface="tile"]').length).toBe(0);
    for (const field of ['Context', 'Tokens', 'Cost']) {
      const missing = root.querySelector(`[aria-label="${field} unavailable"]`);
      expect(missing?.textContent?.trim()).toBe('—');
      expect(missing?.classList.contains('text-base-content-muted')).toBe(true);
      expect(missing?.getAttribute('title')).toBe('not reported');
    }
    expect(grid?.textContent).toContain('all agents');
    expect(grid?.textContent).toContain('this session');
    expect(root.textContent).not.toMatch(/No data yet|Window unknown|Agents/);

    const cache ={ ttl: '1h' as const, lastRequestAt: 0, expiresAt: 3_600_000 };
    fixture.componentRef.setInput('stats', { ...stats, cache });
    fixture.detectChanges();
    const tile = root.querySelector('[data-testid="inspector-cache-tile"]');
    expect(root.querySelector('ptah-inspector-cache-tile')?.classList.contains('col-span-2')).toBe(false);
    expect(tile?.textContent).toContain('1:00:00');
    fixture.componentRef.setInput('stats', { ...stats, sessionId: 'two', cache: { ttl: '5m', lastRequestAt: 0, expiresAt: 300_000 } });
    fixture.detectChanges();
    expect(root.textContent).toContain('05:00');
    fixture.componentRef.setInput('stats', stats);
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="inspector-cache-tile"]')).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('preserves the Model label and display name below the metric grid', () => {
    TestBed.configureTestingModule({
      imports: [InspectorSessionStatsComponent],
      providers: [{
        provide: ModelStateService,
        useValue: { availableModels: signal([{ id: 'claude-opus-4-7', name: 'Opus 4.7' }]) },
      }],
    });
    const fixture = TestBed.createComponent(InspectorSessionStatsComponent);
    const stats: SessionStatsInputs = {
      sessionId: 'session-1',
      snapshot: null,
      liveModelStats: {
        model: 'claude-opus-4-7',
        contextUsed: 0,
        contextPercent: 0,
        contextWindow: 0,
      },
      compactionCount: 0,
      limits: null,
      budget: null,
      context: { hasLive: false, known: false, percent: null, label: '—', usedTokens: null },
      limitSummary: { state: 'none', text: null, extra: 0, source: null, fullText: null },
    };
    fixture.componentRef.setInput('stats', stats);
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('[data-testid="inspector-session-stats"]') as HTMLElement;
    const label = [...root.querySelectorAll('div')].find(element => element.textContent?.trim() === 'Model');
    expect(label).toBeTruthy();
    expect(label?.classList.contains('text-base-content-muted')).toBe(true);
    const value = label?.nextElementSibling as HTMLElement;
    expect(value.textContent?.trim()).toBe('Opus 4.7');
    expect(value.classList.contains('font-semibold')).toBe(true);
  });

  it('opens the Context details from its dotted label, under the totals row', () => {
    TestBed.configureTestingModule({
      imports: [InspectorSessionStatsComponent],
      providers: [{ provide: ModelStateService, useValue: { availableModels: signal([]) } }],
    });
    const fixture = TestBed.createComponent(InspectorSessionStatsComponent);
    const stats: SessionStatsInputs = {
      sessionId: 'session-ctx', snapshot: null, cache: null,
      liveModelStats: { model: 'm', contextUsed: 1000, contextPercent: 10, contextWindow: 10_000 },
      compactionCount: 0, limits: null, budget: null,
      context: { hasLive: true, known: true, percent: 10, label: '10%', usedTokens: 1000 },
      limitSummary: { state: 'none', text: null, extra: 0, source: null, fullText: null },
    };
    fixture.componentRef.setInput('stats', stats);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const toggle = root.querySelector<HTMLButtonElement>('button[aria-label="Context details"]');
    expect(toggle?.textContent?.trim()).toBe('Context');
    expect(toggle?.classList.contains('decoration-dotted')).toBe(true);
    const tooltip = toggle?.getAttribute('title') ?? '';
    expect(tooltip.length).toBeGreaterThan(0);
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('10');
    expect(root.querySelector('[role="region"]')).toBeNull();
    toggle!.click();
    fixture.detectChanges();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    const region = root.querySelector('[role="region"][aria-label="Context details"]');
    expect(region?.textContent).toBe(tooltip);
    expect(root.querySelector('[data-testid="inspector-stats-grid"]')?.contains(region)).toBe(false);
    toggle!.click();
    fixture.detectChanges();
    expect(root.querySelector('[role="region"]')).toBeNull();
  });

  it('formats known totals and keeps the plan-limit line under the row', () => {
    TestBed.configureTestingModule({
      imports: [InspectorSessionStatsComponent],
      providers: [{ provide: ModelStateService, useValue: { availableModels: signal([]) } }],
    });
    const fixture = TestBed.createComponent(InspectorSessionStatsComponent);
    const snapshot = {
      tokenCount: 2_284_653, totalCost: 1.2,
      tokens: { input: 2_000_000, output: 19_323, cacheRead: 265_330, cacheCreation: 0 },
    } as unknown as NonNullable<SessionStatsInputs['snapshot']>;
    fixture.componentRef.setInput('stats', {
      sessionId: 's', snapshot, cache: null, liveModelStats: null,
      compactionCount: 0, limits: null, budget: null,
      context: { hasLive: false, known: false, percent: null, label: '—', usedTokens: null },
      limitSummary: { state: 'near', text: '5-hour 94%', extra: 0, source: 'session', fullText: '5-hour 94%' },
    } satisfies SessionStatsInputs);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const grid = root.querySelector('[data-testid="inspector-stats-grid"]') as HTMLElement;
    expect(grid.textContent).toContain('2.3M');
    expect(grid.textContent).toContain('$1.20');
    expect(grid.textContent).not.toContain('2284653');
    expect(grid.textContent).not.toContain('5-hour');
    expect(root.textContent).toContain('5-hour 94%');
  });
});
