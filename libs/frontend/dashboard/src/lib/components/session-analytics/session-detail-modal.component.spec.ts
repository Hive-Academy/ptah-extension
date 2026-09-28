/**
 * SessionDetailModalComponent — cost tile (TASK_2026_575 scope 6c): the
 * partial session's priced subtotal carries the "at least" marker, and an
 * unknown cost is neutral, never the success colour.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { DashboardSessionEntry } from '../../services/session-analytics-state.service';
import { SessionDetailModalComponent } from './session-detail-modal.component';

function entry(over: Partial<DashboardSessionEntry> = {}): DashboardSessionEntry {
  return {
    sessionId: 's-1',
    name: 'Session',
    createdAt: 1_000,
    lastActivityAt: 2_000,
    model: 'claude-opus-5-5',
    modelDisplayName: 'Opus 5.5',
    totalCost: 2,
    knownCost: 2,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
    messageCount: 4,
    agentSessionCount: 0,
    cliAgents: [],
    modelUsageList: [],
    status: 'ok',
    coverage: 'complete',
    untimestampedCount: 0,
    pricingCoverage: 'full',
    ...over,
  };
}

describe('SessionDetailModalComponent', () => {
  let fixture: ComponentFixture<SessionDetailModalComponent>;

  function render(session: DashboardSessionEntry): HTMLElement {
    fixture = TestBed.createComponent(SessionDetailModalComponent);
    fixture.componentRef.setInput('session', session);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byTestId = (root: HTMLElement, id: string) =>
    root.querySelector(`[data-testid="${id}"]`);
  const normalized = (node: Element | null) =>
    node?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows a partial session as its priced subtotal with the marker and a note', () => {
    const root = render(
      entry({ totalCost: null, knownCost: 3, pricingCoverage: 'partial' }),
    );
    expect(normalized(byTestId(root, 'session-detail-cost'))).toMatch(
      /^≥\s*At least \$3\.00$/,
    );
    expect(byTestId(root, 'session-detail-lower-bound')).not.toBeNull();
    expect(normalized(byTestId(root, 'session-detail-coverage'))).toContain(
      'a lower bound',
    );
  });

  it('shows a fully priced session without the marker', () => {
    const root = render(entry());
    expect(normalized(byTestId(root, 'session-detail-cost'))).toBe('$2.00');
    expect(byTestId(root, 'session-detail-lower-bound')).toBeNull();
  });

  it('shows Unknown in a neutral colour and names unrecorded CLI-lane spend', () => {
    const root = render(
      entry({
        totalCost: null,
        knownCost: null,
        pricingCoverage: 'none',
        cliAgents: ['codex'],
      }),
    );
    const cost = byTestId(root, 'session-detail-cost');
    expect(normalized(cost)).toBe('Unknown');
    expect(cost?.classList).not.toContain('text-success');
    expect(root.textContent).not.toContain('$0.00');
    expect(normalized(byTestId(root, 'session-detail-coverage'))).toContain(
      'CLI agent runs (codex) record no cost',
    );
  });
});
