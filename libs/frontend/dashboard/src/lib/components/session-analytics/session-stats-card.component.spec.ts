/**
 * SessionStatsCardComponent — cost tile states (TASK_2026_575 scope 6c): the
 * partial session's priced subtotal with its "at least" marker, Unknown in a
 * neutral colour, and never $0 for a CLI-lane-only session.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { DashboardSessionEntry } from '../../services/session-analytics-state.service';
import { SessionStatsCardComponent } from './session-stats-card.component';

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

describe('SessionStatsCardComponent', () => {
  let fixture: ComponentFixture<SessionStatsCardComponent>;

  function render(session: DashboardSessionEntry): HTMLElement {
    fixture = TestBed.createComponent(SessionStatsCardComponent);
    fixture.componentRef.setInput('session', session);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byTestId = (root: HTMLElement, id: string) =>
    root.querySelector(`[data-testid="${id}"]`);
  const normalized = (node: Element | null) =>
    node?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows a fully priced session without a marker', () => {
    const root = render(entry());
    expect(normalized(byTestId(root, 'session-card-cost'))).toBe('$2.00');
    expect(byTestId(root, 'session-card-lower-bound')).toBeNull();
    expect(normalized(byTestId(root, 'session-card-cost-per-message'))).toBe(
      '$0.50',
    );
  });

  it('shows a partial session as "≥ $3.00" with the per-message figure marked too', () => {
    const root = render(
      entry({ totalCost: null, knownCost: 3, pricingCoverage: 'partial' }),
    );
    const cost = byTestId(root, 'session-card-cost');
    expect(normalized(cost)).toMatch(/^≥\s*At least \$3\.00$/);
    expect(byTestId(root, 'session-card-lower-bound')?.getAttribute('title'))
      .toMatch(/Lower bound/);
    expect(cost?.classList).toContain('text-success');
    expect(normalized(byTestId(root, 'session-card-cost-per-message'))).toMatch(
      /^≥\s*At least \$0\.75$/,
    );
    expect(byTestId(root, 'session-card-partial')).not.toBeNull();
  });

  it('shows an unpriced session as Unknown in a neutral colour', () => {
    const root = render(
      entry({ totalCost: null, knownCost: null, pricingCoverage: 'none' }),
    );
    const cost = byTestId(root, 'session-card-cost');
    expect(normalized(cost)).toBe('Unknown');
    expect(cost?.classList).not.toContain('text-success');
    expect(cost?.classList).toContain('text-base-content-muted');
    expect(byTestId(root, 'session-card-lower-bound')).toBeNull();
    expect(normalized(byTestId(root, 'session-card-cost-per-message'))).toBe(
      '$--',
    );
  });

  it('keeps an unpriced per-model row out of the success colour', () => {
    const root = render(
      entry({
        totalCost: null,
        knownCost: 1.15,
        pricingCoverage: 'partial',
        modelUsageList: [
          {
            model: 'claude-opus-5-5',
            modelDisplayName: 'Opus 5.5',
            inputTokens: 40_000,
            outputTokens: 3_000,
            costUSD: 1.15,
          },
          {
            model: 'opencode-go/glm-5.3',
            modelDisplayName: 'opencode-go/glm-5.3',
            inputTokens: 60_000,
            outputTokens: 5_000,
            costUSD: null,
          },
        ],
      }),
    );
    const rowCosts = Array.from(root.querySelectorAll('span.font-medium'));
    const unknown = rowCosts.find((n) => n.textContent?.trim() === 'Unknown');
    const priced = rowCosts.find((n) => n.textContent?.trim() === '$1.15');
    expect(unknown?.classList).not.toContain('text-success');
    expect(unknown?.classList).toContain('text-base-content-muted');
    expect(priced?.classList).toContain('text-success');
  });

  it('never renders $0.00 for a CLI-lane-only session (A6)', () => {
    const root = render(
      entry({
        status: 'empty',
        totalCost: null,
        knownCost: null,
        pricingCoverage: 'none',
        cliAgents: ['codex'],
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        messageCount: 0,
      }),
    );
    expect(normalized(byTestId(root, 'session-card-cost'))).toBe('Unknown');
    expect(root.textContent).not.toContain('$0.00');
    expect(root.textContent).toContain('codex');
  });
});
