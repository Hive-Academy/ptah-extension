import { TestBed } from '@angular/core/testing';
import { InspectorLimitsLanesComponent } from './inspector-limits-lanes.component';
import { buildStatsLimitViewModel } from '../plan-limits/stats-limit-view-model';
import type { StatsLimitLaneRun } from '../plan-limits/stats-limit-view-model.types';

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
    expect(root.querySelector('[data-testid="lanes-count"]')?.textContent?.trim()).toBe('1 provider');
    expect(root.querySelectorAll('ptah-provider-lane-limit-tile')).toHaveLength(1);
    expect(root.textContent).toContain('Limits not tracked');
    expect(root.querySelector('ptah-lane-usage-tile')).toBeNull();
  });
});
