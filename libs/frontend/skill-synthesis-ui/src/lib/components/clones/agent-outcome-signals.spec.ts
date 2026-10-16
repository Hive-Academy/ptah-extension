import type { AgentOutcomeSignals } from '@ptah-extension/shared';

import { formatAgentOutcomeSignals } from './agent-outcome-signals';

function signals(
  overrides: Partial<AgentOutcomeSignals> = {},
): AgentOutcomeSignals {
  return {
    slug: 'planner',
    windowDays: 30,
    runCount: 5,
    delivered: { numerator: 4, denominator: 5 },
    reviewPass: { numerator: 3, denominator: 4 },
    avgReviseRounds: 1.5,
    topFailureClass: 'timeout',
    ...overrides,
  };
}

function byId(
  metrics: ReturnType<typeof formatAgentOutcomeSignals>,
  testId: string,
): { label: string; value: string } | undefined {
  const metric = metrics.find((entry) => entry.testId === testId);
  if (metric === undefined) return undefined;
  return { label: metric.label, value: metric.value };
}

describe('formatAgentOutcomeSignals', () => {
  it('says no data yet when signals are absent', () => {
    for (const missing of [undefined, null]) {
      const metrics = formatAgentOutcomeSignals(missing, null);
      expect(metrics).toEqual([
        {
          label: 'Outcomes (30d)',
          value: 'no data yet',
          testId: 'clone-metric-outcome-empty',
        },
      ]);
    }
  });

  it('says no data yet when the window has zero runs, never 0% or 100%', () => {
    const metrics = formatAgentOutcomeSignals(
      signals({
        runCount: 0,
        delivered: { numerator: 0, denominator: 0 },
        reviewPass: { numerator: 0, denominator: 0 },
        avgReviseRounds: null,
        topFailureClass: null,
      }),
      30,
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.value).toBe('no data yet');
    expect(metrics.map((metric) => metric.value).join(' ')).not.toMatch(/\d+%/);
  });

  it('labels the empty state with the echoed window', () => {
    const metrics = formatAgentOutcomeSignals(signals({ runCount: 0 }), 14);
    expect(metrics[0]?.label).toBe('Outcomes (14d)');
  });

  it('uses the record window when the caller has not been told one', () => {
    const metrics = formatAgentOutcomeSignals(
      signals({ runCount: 0, windowDays: 14 }),
      null,
    );
    expect(metrics[0]?.label).toBe('Outcomes (14d)');
  });

  it('falls back to 30 days for a non-positive window', () => {
    const metrics = formatAgentOutcomeSignals(undefined, 0);
    expect(metrics[0]?.label).toBe('Outcomes (30d)');
  });

  it('formats delivered, review, revise rounds and the top failure', () => {
    const metrics = formatAgentOutcomeSignals(signals(), 30);
    expect(byId(metrics, 'clone-metric-outcome-window')).toEqual({
      label: 'Window',
      value: '(last 30 days)',
    });
    expect(byId(metrics, 'clone-metric-outcome-delivered')).toEqual({
      label: 'Delivered',
      value: '80% (4/5)',
    });
    expect(byId(metrics, 'clone-metric-outcome-review')).toEqual({
      label: 'Review pass',
      value: '75% (3/4)',
    });
    expect(byId(metrics, 'clone-metric-outcome-revise')).toEqual({
      label: 'Avg revise rounds',
      value: '1.5',
    });
    expect(byId(metrics, 'clone-metric-outcome-failure')).toEqual({
      label: 'Top failure',
      value: 'timeout',
    });
    expect(byId(metrics, 'clone-metric-outcome-empty')).toBeUndefined();
  });

  it('prefers the caller window over the record window', () => {
    const metrics = formatAgentOutcomeSignals(signals({ windowDays: 14 }), 30);
    expect(byId(metrics, 'clone-metric-outcome-window')?.value).toBe(
      '(last 30 days)',
    );
  });

  it('says no verified runs when nothing has a verified verdict', () => {
    const metrics = formatAgentOutcomeSignals(
      signals({ delivered: { numerator: 0, denominator: 0 } }),
      30,
    );
    expect(byId(metrics, 'clone-metric-outcome-delivered')?.value).toBe(
      'no verified runs',
    );
  });

  it('hides average revise rounds while nothing has been reviewed', () => {
    const metrics = formatAgentOutcomeSignals(
      signals({
        reviewPass: { numerator: 0, denominator: 0 },
        avgReviseRounds: null,
      }),
      30,
    );
    expect(byId(metrics, 'clone-metric-outcome-review')?.value).toBe(
      'not reviewed yet',
    );
    expect(byId(metrics, 'clone-metric-outcome-revise')).toBeUndefined();
  });

  it('hides a null revise average even when a review denominator slipped through', () => {
    const metrics = formatAgentOutcomeSignals(
      signals({
        reviewPass: { numerator: 1, denominator: 1 },
        avgReviseRounds: null,
      }),
      30,
    );
    expect(byId(metrics, 'clone-metric-outcome-revise')).toBeUndefined();
  });

  it('shows 0.0 revise rounds when reviewed runs really had none', () => {
    const metrics = formatAgentOutcomeSignals(
      signals({ avgReviseRounds: 0 }),
      30,
    );
    expect(byId(metrics, 'clone-metric-outcome-revise')?.value).toBe('0.0');
  });

  it('says no failures recorded when every class is null', () => {
    const metrics = formatAgentOutcomeSignals(
      signals({ topFailureClass: null }),
      30,
    );
    expect(byId(metrics, 'clone-metric-outcome-failure')?.value).toBe(
      'no failures recorded',
    );
  });

  it('rounds rates to whole numbers', () => {
    const oneThird = formatAgentOutcomeSignals(
      signals({ delivered: { numerator: 1, denominator: 3 } }),
      30,
    );
    const twoThirds = formatAgentOutcomeSignals(
      signals({ delivered: { numerator: 2, denominator: 3 } }),
      30,
    );
    expect(byId(oneThird, 'clone-metric-outcome-delivered')?.value).toBe(
      '33% (1/3)',
    );
    expect(byId(twoThirds, 'clone-metric-outcome-delivered')?.value).toBe(
      '67% (2/3)',
    );
  });
});
