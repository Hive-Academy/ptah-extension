import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { QuotaOwnerRef } from '@ptah-extension/shared';
import { InspectorLimitsLanesComponent } from './inspector-limits-lanes.component';
import { buildStatsLimitViewModel } from '../plan-limits/stats-limit-view-model';
import type { StatsLimitLaneRun } from '../plan-limits/stats-limit-view-model.types';

const NOW = Date.UTC(2026, 9, 26, 23, 30);
const CLAUDE: QuotaOwnerRef = {
  key: 'claude-cli#account:721c000000000000',
  providerId: 'claude-cli',
  identityKind: 'account',
  label: 'Claude account',
};

function run(overrides: Partial<StatsLimitLaneRun> = {}): StatsLimitLaneRun {
  return {
    runId: 'run-1',
    cli: 'ptah-cli',
    cliLabel: 'Claude',
    role: null,
    model: null,
    modelScope: null,
    status: 'completed',
    restored: true,
    startedAt: NOW - 16 * 60_000,
    quotaOwner: CLAUDE,
    usageTotals: { totalTokens: 2600, costUsd: 0.02, partial: true },
    ...overrides,
  };
}

let fixture: ComponentFixture<InspectorLimitsLanesComponent>;

function render(runs: StatsLimitLaneRun[]): HTMLElement {
  TestBed.configureTestingModule({ imports: [InspectorLimitsLanesComponent] });
  fixture = TestBed.createComponent(InspectorLimitsLanesComponent);
  fixture.componentRef.setInput(
    'limits',
    buildStatsLimitViewModel({
      sessionId: 'session-1',
      sessionOwnerKey: null,
      sessionModelScope: null,
      owners: [],
      laneRuns: runs,
      now: NOW,
      time: { timeZone: 'UTC', zoneNameLocale: 'en-GB' },
    }),
  );
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const by = (root: HTMLElement, testId: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

describe('InspectorLimitsLanesComponent LANES section', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a compact count with its full reading as label and tooltip', () => {
    const root = render([run()]);
    const count = by(root, 'lanes-count');

    expect(count?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 · 1 run');
    expect(count?.getAttribute('aria-label')).toBe('1 lane, 1 lane run, not in session totals');
    expect(count?.getAttribute('title')).toBe(count?.getAttribute('aria-label'));

    TestBed.resetTestingModule();
    const two = by(render([run(), run({ runId: 'run-2' })]), 'lanes-count');
    expect(two?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 · 2 runs');
  });

  it('turns the "not in totals" caption into an ⓘ toggle: tooltip, visible line, Escape closes', () => {
    const root = render([run()]);
    const toggle = by(root, 'lanes-caption') as HTMLButtonElement;

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-label')).toBe('Lanes note');
    expect(toggle.getAttribute('title')).toBe('lane · not in totals');
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.querySelector('lucide-angular')?.getAttribute('aria-hidden')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(by(root, 'lanes-caption-detail')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    const detail = by(root, 'lanes-caption-detail');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(detail?.id);
    expect(detail?.textContent?.trim()).toBe('lane · not in totals');
    expect(detail?.className).toContain('text-[10.5px]');

    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(by(root, 'lanes-caption-detail')).toBeNull();
  });

  it('leaves Enter and Space on every LANES toggle uncancelled, so the browser activates the button', () => {
    const root = render([run({ quotaOwner: undefined })]);
    by(root, 'lane-usage-tile')?.click();
    fixture.detectChanges();
    const toggles = ['lanes-caption', 'lane-subtotal-toggle', 'lane-footnote-toggle'].map((id) => by(root, id));

    expect(toggles.every(Boolean)).toBe(true);
    for (const toggle of toggles) {
      for (const key of ['Enter', ' ']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        toggle?.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    }
  });

  it('renders the lane and the subtotal in their compact inspector form', () => {
    const root = render([run()]);

    expect(by(root, 'lane-cost')).not.toBeNull();
    expect(by(root, 'lane-usage-tile')?.getAttribute('aria-label')).toContain('at least 2.6k tokens');
    expect(by(root, 'lane-subtotal-toggle')).not.toBeNull();
    expect(by(root, 'lane-caption')).toBeNull();
    expect(by(root, 'lane-subtotal-cost')).not.toBeNull();
    expect(by(root, 'lane-subtotal-grid')).toBeNull();
  });
});
