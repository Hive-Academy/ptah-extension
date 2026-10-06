import type { SessionBudgetState } from '@ptah-extension/shared';
import {
  budgetTooltip,
  costBudgetSuffix,
  costBudgetText,
  costTooltip,
  formatBudgetUsd,
  tokensBudgetSuffix,
  tokensTooltip,
} from './session-budget-format';

const TOKENS_BUDGET: SessionBudgetState = {
  sessionId: 'session-1',
  stage: 'normal',
  unit: 'tokens',
  measure: 'tokens',
  used: 14_900_000,
  limit: 50_000_000,
  percent: 29.8,
  lowerBound: false,
  revision: 4,
  compactions: 0,
  extensions: 0,
  blocked: false,
};

const COST_BUDGET: SessionBudgetState = {
  ...TOKENS_BUDGET,
  unit: 'cost',
  measure: 'cost',
  used: 1,
  limit: 30,
};

const LOWER_BOUND_BUDGET: SessionBudgetState = {
  ...COST_BUDGET,
  measure: 'cost-lower-bound',
  used: 8.96,
  lowerBound: true,
};

const WEIGHTED_BUDGET: SessionBudgetState = {
  ...COST_BUDGET,
  measure: 'weighted-fallback',
  used: 6_200_000,
  limit: 9_000_000,
};

const FIGURES = { tokensLabel: '14.9M', totalCost: 38.18 };

const THRESHOLDS =
  'At 50% Ptah lowers auto-compact; at 80% it prepares a handoff; at 100% new messages pause.';

describe('session-budget-format', () => {
  describe('formatBudgetUsd', () => {
    it('drops cents from a whole-dollar limit', () => {
      expect(formatBudgetUsd(30)).toBe('$30');
    });

    it('keeps two decimals when the limit has cents', () => {
      expect(formatBudgetUsd(12.5)).toBe('$12.50');
    });
  });

  describe('tokensBudgetSuffix', () => {
    it('shows the token limit for a tokens budget', () => {
      expect(tokensBudgetSuffix(TOKENS_BUDGET)).toBe('/ 50.0M');
    });

    it.each([null, COST_BUDGET, LOWER_BOUND_BUDGET, WEIGHTED_BUDGET])(
      'is null for any other budget: %#',
      (budget) => {
        expect(tokensBudgetSuffix(budget)).toBeNull();
      },
    );
  });

  describe('costBudgetSuffix', () => {
    it('shows the dollar limit for a cost budget', () => {
      expect(costBudgetSuffix(COST_BUDGET)).toBe('/ $30');
    });

    it.each([null, TOKENS_BUDGET, LOWER_BOUND_BUDGET, WEIGHTED_BUDGET])(
      'is null for any other budget: %#',
      (budget) => {
        expect(costBudgetSuffix(budget)).toBeNull();
      },
    );
  });

  describe('costBudgetText', () => {
    it('shows the lower bound against the limit', () => {
      expect(costBudgetText(LOWER_BOUND_BUDGET)).toBe(
        '≥ $8.96 / $30 (some models have no price)',
      );
    });

    it('shows the weighted estimate against its own limit', () => {
      expect(costBudgetText(WEIGHTED_BUDGET)).toBe(
        'est. 6.2M / 9.0M weighted tokens (no price for this model)',
      );
    });

    it.each([null, TOKENS_BUDGET, COST_BUDGET])(
      'keeps the badge for a budget the snapshot can show: %#',
      (budget) => {
        expect(costBudgetText(budget)).toBeNull();
      },
    );

    it('keeps the badge when the fallback has no used figure', () => {
      expect(costBudgetText({ ...LOWER_BOUND_BUDGET, used: null })).toBeNull();
    });
  });

  describe('budgetTooltip', () => {
    it('is null without a budget or a percent', () => {
      expect(budgetTooltip(null, FIGURES)).toBeNull();
      expect(
        budgetTooltip({ ...TOKENS_BUDGET, percent: null }, FIGURES),
      ).toBeNull();
    });

    it('tokens: uses the chip label, not the budget used figure', () => {
      expect(budgetTooltip({ ...TOKENS_BUDGET, used: 1 }, FIGURES)).toBe(
        `Session budget: 29% used (14.9M of 50.0M). ${THRESHOLDS}`,
      );
    });

    it('cost: uses the snapshot total against the dollar limit', () => {
      expect(budgetTooltip(COST_BUDGET, FIGURES)).toBe(
        `Session budget: 29% used ($38.18 of $30). ${THRESHOLDS}`,
      );
    });

    it('cost-lower-bound: marks the budget used figure as a lower bound', () => {
      expect(budgetTooltip(LOWER_BOUND_BUDGET, FIGURES)).toBe(
        `Session budget: 29% used (≥ $8.96 of $30). ${THRESHOLDS}`,
      );
    });

    it('weighted-fallback: uses the weighted estimate and its limit', () => {
      expect(budgetTooltip(WEIGHTED_BUDGET, FIGURES)).toBe(
        `Session budget: 29% used (6.2M of 9.0M). ${THRESHOLDS}`,
      );
    });

    it('weighted-fallback with no used figure shows an em dash', () => {
      expect(budgetTooltip({ ...WEIGHTED_BUDGET, used: null }, FIGURES)).toBe(
        `Session budget: 29% used (— of 9.0M). ${THRESHOLDS}`,
      );
    });
  });

  describe('chip tooltips', () => {
    const LINE = 'Session budget: line';

    it('puts the budget line on COST unless the budget is in tokens', () => {
      expect(costTooltip(COST_BUDGET, LINE)).toBe(LINE);
      expect(costTooltip(WEIGHTED_BUDGET, LINE)).toBe(LINE);
      expect(costTooltip(TOKENS_BUDGET, LINE)).toBeNull();
      expect(costTooltip(null, null)).toBeNull();
    });

    it('appends the budget line to the TOKENS breakdown only for a tokens budget', () => {
      expect(tokensTooltip(TOKENS_BUDGET, LINE, 'Breakdown')).toBe(
        `Breakdown\n\n${LINE}`,
      );
      expect(tokensTooltip(COST_BUDGET, LINE, 'Breakdown')).toBe('Breakdown');
      expect(tokensTooltip(TOKENS_BUDGET, null, 'Breakdown')).toBe('Breakdown');
    });
  });
});
