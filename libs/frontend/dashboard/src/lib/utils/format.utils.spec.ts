/**
 * Cost formatting rules for the analytics surfaces (TASK_2026_575 scope 6c):
 * a partially priced session shows its priced subtotal as a labeled lower
 * bound, an unpriced one reads "Unknown", and nothing unknown is ever $0 or
 * coloured like an amount.
 */
import type { DashboardSessionEntry } from '../services/session-analytics-state.service';
import {
  costValueClass,
  formatSessionCost,
  sessionCostPerMessage,
  sessionCoverageNotes,
  sessionHasKnownCost,
  sessionShowsLowerBound,
} from './format.utils';

type CostSession = Pick<
  DashboardSessionEntry,
  | 'status'
  | 'totalCost'
  | 'knownCost'
  | 'pricingCoverage'
  | 'cliAgents'
  | 'coverage'
  | 'untimestampedCount'
  | 'messageCount'
>;

function session(over: Partial<CostSession> = {}): CostSession {
  return {
    status: 'ok',
    totalCost: 2,
    knownCost: 2,
    pricingCoverage: 'full',
    cliAgents: [],
    coverage: 'complete',
    untimestampedCount: 0,
    messageCount: 4,
    ...over,
  };
}

const full = session();
const partial = session({
  totalCost: null,
  knownCost: 3,
  pricingCoverage: 'partial',
});
const none = session({
  totalCost: null,
  knownCost: null,
  pricingCoverage: 'none',
});
const cliOnly = session({
  status: 'empty',
  totalCost: null,
  knownCost: null,
  pricingCoverage: 'none',
  cliAgents: ['codex'],
  messageCount: 0,
});

describe('format.utils — session cost', () => {
  it('shows the full total, the partial subtotal, or Unknown', () => {
    expect(formatSessionCost(full)).toBe('$2.00');
    expect(formatSessionCost(partial)).toBe('$3.00');
    expect(formatSessionCost(none)).toBe('Unknown');
  });

  it('marks only the partial subtotal as a lower bound', () => {
    expect(sessionShowsLowerBound(full)).toBe(false);
    expect(sessionShowsLowerBound(partial)).toBe(true);
    expect(sessionShowsLowerBound(none)).toBe(false);
    // A total that the host still labels partial is a lower bound too.
    expect(
      sessionShowsLowerBound(session({ pricingCoverage: 'partial' })),
    ).toBe(true);
  });

  it('prices cost per message from the same figure, unknown stays null', () => {
    expect(sessionCostPerMessage(full)).toBeCloseTo(0.5);
    expect(sessionCostPerMessage(partial)).toBeCloseTo(0.75);
    expect(sessionCostPerMessage(none)).toBeNull();
    expect(sessionCostPerMessage(session({ messageCount: 0 }))).toBeNull();
  });

  it('reads a CLI-lane-only session as Unknown, never No usage or $0 (A6)', () => {
    expect(formatSessionCost(cliOnly)).toBe('Unknown');
    expect(sessionHasKnownCost(cliOnly)).toBe(false);
    expect(sessionShowsLowerBound(cliOnly)).toBe(false);
    expect(sessionCoverageNotes(cliOnly)).toContain(
      'CLI agent runs (codex) record no cost; they are not included in this estimate.',
    );
    // A session with no usage and no CLI lanes really has none.
    expect(
      formatSessionCost(session({ ...cliOnly, cliAgents: [] })),
    ).toBe('No usage');
  });

  it('keeps state words out of the success colour', () => {
    expect(costValueClass(sessionHasKnownCost(full))).toBe('text-success');
    expect(costValueClass(sessionHasKnownCost(partial))).toBe('text-success');
    expect(costValueClass(sessionHasKnownCost(none))).toBe(
      'text-base-content-muted',
    );
    expect(
      costValueClass(sessionHasKnownCost(session({ status: 'error' }))),
    ).toBe('text-base-content-muted');
    expect(
      costValueClass(sessionHasKnownCost(session({ status: 'pending' }))),
    ).toBe('text-base-content-muted');
  });

  it('explains an unknown cost and a lower-bound cost', () => {
    expect(sessionCoverageNotes(full)).toEqual([]);
    expect(sessionCoverageNotes(none)).toEqual([
      'No current rate-card price for this usage; cost is unknown.',
    ]);
    expect(sessionCoverageNotes(partial)).toEqual([
      'Part of this usage has no rate-card price; the cost shown is the priced part only, a lower bound.',
    ]);
  });
});
