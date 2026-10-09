/**
 * MetricsCardsComponent — the total-cost tile (TASK_2026_575 R8): a lower
 * bound always carries its marker and a tooltip naming what it leaves out;
 * a fully priced total carries none; an unknown total is neutral, never $0.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AggregateTotals } from '../../services/session-analytics-state.service';
import { MetricsCardsComponent } from './metrics-cards.component';

function totals(over: Partial<AggregateTotals> = {}): AggregateTotals {
  return {
    totalCost: 5,
    totalCostIsLowerBound: false,
    totalTokens: 1_000,
    totalInput: 600,
    totalOutput: 400,
    totalCacheRead: 0,
    totalCacheCreation: 0,
    totalMessages: 10,
    sessionCount: 2,
    totalSubagents: 0,
    avgCostPerSession: 2.5,
    pendingSessionCount: 0,
    errorSessionCount: 0,
    partialSessionCount: 0,
    untimestampedCount: 0,
    unknownCostSessionCount: 0,
    partiallyPricedSessionCount: 0,
    cliAgentSessionCount: 0,
    ...over,
  };
}

describe('MetricsCardsComponent', () => {
  let fixture: ComponentFixture<MetricsCardsComponent>;

  function render(aggregates: AggregateTotals): HTMLElement {
    fixture = TestBed.createComponent(MetricsCardsComponent);
    fixture.componentRef.setInput('aggregates', aggregates);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byTestId = (root: HTMLElement, id: string) =>
    root.querySelector(`[data-testid="${id}"]`);
  const normalized = (node: Element | null) =>
    node?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows a fully priced total without a marker', () => {
    const root = render(totals());
    expect(normalized(byTestId(root, 'metrics-total-cost'))).toBe('$5.00');
    expect(
      byTestId(root, 'metrics-total-cost')?.parentElement?.className,
    ).toContain('border-success');
    expect(
      byTestId(root, 'metrics-total-cost')?.parentElement?.className,
    ).toContain('bg-surface-2');
    expect(byTestId(root, 'metrics-total-lower-bound')).toBeNull();
    expect(normalized(byTestId(root, 'metrics-avg-cost'))).toBe('$2.50');
  });

  it('labels a lower-bound total and names the partial and unpriced counts', () => {
    const root = render(
      totals({
        totalCostIsLowerBound: true,
        partiallyPricedSessionCount: 1,
        unknownCostSessionCount: 1,
      }),
    );
    const cost = byTestId(root, 'metrics-total-cost');
    expect(normalized(cost)).toMatch(/^≥\s*At least \$5\.00$/);
    expect(cost?.classList).toContain('text-success');
    expect(normalized(byTestId(root, 'metrics-avg-cost'))).toMatch(
      /^≥\s*At least \$2\.50$/,
    );
    expect(cost?.parentElement?.getAttribute('title')).toBe(
      'Estimated from recorded usage and current rate card. Lower bound: 1 session only partly priced (priced part included); 1 session with no price (left out).',
    );
  });

  it('marks the total but not the average when only unpriced sessions are left out', () => {
    // Unpriced sessions leave both the sum and the average's denominator, so
    // the average over the priced sessions is exact, not "at least".
    const root = render(
      totals({
        totalCost: 2,
        avgCostPerSession: 2,
        totalCostIsLowerBound: true,
        partiallyPricedSessionCount: 0,
        unknownCostSessionCount: 1,
      }),
    );
    expect(normalized(byTestId(root, 'metrics-total-cost'))).toMatch(
      /^≥\s*At least \$2\.00$/,
    );
    const avg = byTestId(root, 'metrics-avg-cost');
    expect(normalized(avg)).toBe('$2.00');
    expect(avg?.parentElement?.getAttribute('title')).toBe(
      'Estimated from recorded usage and current rate card',
    );
  });

  it('marks both the total and the average when a contributor is partly priced', () => {
    const root = render(
      totals({
        totalCostIsLowerBound: true,
        partiallyPricedSessionCount: 1,
        unknownCostSessionCount: 0,
      }),
    );
    expect(normalized(byTestId(root, 'metrics-total-cost'))).toMatch(
      /^≥\s*At least \$5\.00$/,
    );
    const avg = byTestId(root, 'metrics-avg-cost');
    expect(normalized(avg)).toMatch(/^≥\s*At least \$2\.50$/);
    expect(avg?.parentElement?.getAttribute('title')).toBe(
      'Estimated from recorded usage and current rate card. Lower bound: 1 session only partly priced (priced part included).',
    );
  });

  it('shows an unknown total as Unknown in a neutral colour, never $0', () => {
    const root = render(
      totals({
        totalCost: null,
        avgCostPerSession: null,
        unknownCostSessionCount: 2,
      }),
    );
    const cost = byTestId(root, 'metrics-total-cost');
    expect(normalized(cost)).toBe('Unknown');
    expect(cost?.classList).not.toContain('text-success');
    expect(cost?.classList).toContain('text-base-content-muted');
    expect(byTestId(root, 'metrics-total-lower-bound')).toBeNull();
    expect(root.textContent).not.toContain('$0.00');
  });
});
