import { TestBed } from '@angular/core/testing';
import { InspectorLimitsLanesComponent } from './inspector-limits-lanes.component';
import { buildStatsLimitViewModel } from '../plan-limits/stats-limit-view-model';
import type { PlanLimitTileModel, StatsLimitLaneRun } from '../plan-limits/stats-limit-view-model.types';

const now = Date.UTC(2026, 9, 26, 23, 30);
const run = (runId: string, role: string): StatsLimitLaneRun => ({
  runId, cli: 'codex', cliLabel: 'Codex', role, status: 'completed',
  restored: false, startedAt: now - 1000, usageTotals: null,
});

describe('InspectorLimitsLanesComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows one provider for three runs across roles, with unknown usage', () => {
    TestBed.configureTestingModule({ imports: [InspectorLimitsLanesComponent] });
    const fixture = TestBed.createComponent(InspectorLimitsLanesComponent);
    fixture.componentRef.setInput('limits', buildStatsLimitViewModel({
      sessionId: 's', sessionOwnerKey: null, sessionModelScope: null,
      owners: [], laneRuns: [run('a', 'frontend'), run('b', 'backend'), run('c', 'frontend')],
      now, time: { timeZone: 'UTC', zoneNameLocale: 'en-GB' },
    }));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="providers-count"]')?.textContent?.trim()).toBe('2 providers');
    expect(root.querySelectorAll('ptah-provider-lane-limit-tile')).toHaveLength(2);
    expect(root.querySelectorAll('section')).toHaveLength(1);
    expect(root.querySelector('select, button')).toBeNull();
    expect(root.textContent).toContain('Limits not tracked');
    expect(root.querySelector('ptah-lane-usage-tile')).toBeNull();
  });

  it('keeps Claude first in one section and aligns provider source lines', () => {
    const tile = (id: string, caption: string): PlanLimitTileModel => ({
      id, kind: 'window', label: 'Weekly', captionLead: caption, caption,
      value: '63% used', resetLine: 'resets in 1d', tone: 'neutral',
      sourceChips: ['Provider API'], detailLines: [], window: {
        windowKey: 'weekly', label: 'Weekly', state: 'ok', usedText: '63% used',
        percent: 63, resetFacts: [], sourceChips: ['Provider API'],
      },
    });
    const base = buildStatsLimitViewModel({
      sessionId: 's', sessionOwnerKey: null, sessionModelScope: null,
      owners: [], laneRuns: [], now, time: { timeZone: 'UTC', zoneNameLocale: 'en-GB' },
    });
    TestBed.configureTestingModule({ imports: [InspectorLimitsLanesComponent] });
    const fixture = TestBed.createComponent(InspectorLimitsLanesComponent);
    fixture.componentRef.setInput('limits', { ...base,
      planTiles: [tile('claude', 'Claude account · 227d')],
      providerLimits: [{ id: 'provider:codex', label: 'Codex CLI', ownerState: 'single',
        windows: [tile('codex', 'Codex account · 58b5')], message: '', ownerDetails: [] }],
    });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('section')).toHaveLength(1);
    expect(root.querySelector('[data-testid="providers-count"]')?.textContent).toContain('2 providers');
    const providers = [...root.querySelectorAll('ptah-provider-lane-limit-tile')];
    expect(providers).toHaveLength(2);
    expect(providers[0].textContent).toContain('Claude');
    expect(providers[1].textContent).toContain('Codex');
    expect(providers.map(row => row.querySelector('.badge-ghost')?.textContent?.trim()))
      .toEqual(['Provider API', 'Provider API']);
  });
});
