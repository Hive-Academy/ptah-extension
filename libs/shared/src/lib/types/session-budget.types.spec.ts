/**
 * The `sessionBudget.*` bounds table. The backend reader and the settings
 * card both fall back to these defaults, so a default outside its own bounds,
 * or a default pair breaking tighten < handoff, would make every fallback an
 * invalid configuration.
 */
import {
  SESSION_BUDGET_SETTINGS,
  isSessionBudgetPercentOrderValid,
  type SessionBudgetConfig,
  type SessionBudgetHandoff,
  type SessionBudgetHandoffReadStatus,
  type SessionBudgetRotation,
  type SessionBudgetState,
  type SessionBudgetWindow,
} from './session-budget.types';

const entries = Object.entries(SESSION_BUDGET_SETTINGS) as Array<
  [
    keyof SessionBudgetConfig,
    (typeof SESSION_BUDGET_SETTINGS)[keyof SessionBudgetConfig],
  ]
>;

describe('SESSION_BUDGET_SETTINGS', () => {
  it('has one entry per config field, keyed `sessionBudget.<field>`', () => {
    const fields: Array<keyof SessionBudgetConfig> = [
      'enabled',
      'unit',
      'tokens',
      'usd',
      'fallbackWeightedTokens',
      'tightenPercent',
      'handoffPercent',
      'handoffAfterCompactions',
      'tightenWindowTokens',
      'blockAtLimit',
    ];
    expect(Object.keys(SESSION_BUDGET_SETTINGS).sort()).toEqual(
      [...fields].sort(),
    );
    for (const [field, setting] of entries) {
      expect(setting.key).toBe(`sessionBudget.${field}`);
    }
  });

  it('ships the decision 13 defaults', () => {
    expect(SESSION_BUDGET_SETTINGS.tokens.default).toBe(50_000_000);
    expect(SESSION_BUDGET_SETTINGS.usd.default).toBe(30);
    expect(SESSION_BUDGET_SETTINGS.fallbackWeightedTokens.default).toBe(
      9_000_000,
    );
    expect(SESSION_BUDGET_SETTINGS.tightenPercent.default).toBe(50);
    expect(SESSION_BUDGET_SETTINGS.handoffPercent.default).toBe(80);
    expect(SESSION_BUDGET_SETTINGS.handoffAfterCompactions.default).toBe(3);
    expect(SESSION_BUDGET_SETTINGS.tightenWindowTokens.default).toBeNull();
    expect(SESSION_BUDGET_SETTINGS.blockAtLimit.default).toBe(true);
    expect(SESSION_BUDGET_SETTINGS.unit.default).toBe('tokens');
    expect(SESSION_BUDGET_SETTINGS.enabled.default).toBe(true);
  });

  it.each(entries)('%s: the default lies inside its own bounds', (_, s) => {
    switch (s.kind) {
      case 'boolean':
        expect(typeof s.default).toBe('boolean');
        break;
      case 'enum':
        expect(s.values).toContain(s.default);
        break;
      case 'number':
        expect(s.min).toBeLessThan(s.max);
        if (s.default === null) {
          expect(s.nullable).toBe(true);
        } else {
          expect(s.default).toBeGreaterThanOrEqual(s.min);
          expect(s.default).toBeLessThanOrEqual(s.max);
          if (s.integer) expect(Number.isInteger(s.default)).toBe(true);
        }
        break;
    }
  });

  it('the default percents keep tighten below handoff', () => {
    expect(
      isSessionBudgetPercentOrderValid(
        SESSION_BUDGET_SETTINGS.tightenPercent.default,
        SESSION_BUDGET_SETTINGS.handoffPercent.default,
      ),
    ).toBe(true);
  });
});

describe('SessionBudgetState.rotation', () => {
  const base: SessionBudgetState = {
    sessionId: 's1',
    stage: 'unknown',
    unit: 'tokens',
    measure: 'tokens',
    used: null,
    limit: 50_000_000,
    percent: null,
    lowerBound: false,
    revision: null,
    compactions: 0,
    extensions: 0,
    blocked: false,
  };

  it('is optional: a state without the advisory is complete', () => {
    expect(base.rotation).toBeUndefined();
  });

  it('carries the crossed context figure and threshold, and survives JSON', () => {
    const rotation: SessionBudgetRotation = {
      contextTokens: 312_000,
      threshold: 300_000,
    };
    const state: SessionBudgetState = { ...base, rotation };
    // The state rides the result-stats broadcast as JSON.
    const roundTripped = JSON.parse(
      JSON.stringify(state),
    ) as SessionBudgetState;
    expect(roundTripped.rotation).toEqual({
      contextTokens: 312_000,
      threshold: 300_000,
    });
    expect(Object.keys(roundTripped.rotation ?? {}).sort()).toEqual([
      'contextTokens',
      'threshold',
    ]);
  });
});

describe('SessionBudgetWindow restore failure (F-A)', () => {
  it('carries `restore-failed` with `applied: true` and survives JSON', () => {
    const window: SessionBudgetWindow = {
      target: 200_000,
      applied: true,
      reason: 'restore-failed',
    };
    const roundTripped = JSON.parse(
      JSON.stringify(window),
    ) as SessionBudgetWindow;
    expect(roundTripped).toEqual({
      target: 200_000,
      applied: true,
      reason: 'restore-failed',
    });
  });
});

describe('SessionBudgetHandoff.readStatus', () => {
  const base: SessionBudgetHandoff = {
    path: '/home/u/.ptah/handoffs/s1.md',
    chars: 1_200,
    truncated: false,
    writtenAt: 1_700_000_000_000,
  };

  it('is optional: a handoff built from a read transcript omits it', () => {
    expect(base.readStatus).toBeUndefined();
  });

  it.each<SessionBudgetHandoffReadStatus>(['workspace-unknown', 'read-failed'])(
    'carries `%s` through JSON',
    (readStatus) => {
      const roundTripped = JSON.parse(
        JSON.stringify({ ...base, readStatus }),
      ) as SessionBudgetHandoff;
      expect(roundTripped.readStatus).toBe(readStatus);
    },
  );
});

describe('isSessionBudgetPercentOrderValid', () => {
  it('rejects equal and inverted pairs', () => {
    expect(isSessionBudgetPercentOrderValid(79, 80)).toBe(true);
    expect(isSessionBudgetPercentOrderValid(80, 80)).toBe(false);
    expect(isSessionBudgetPercentOrderValid(90, 80)).toBe(false);
  });
});
