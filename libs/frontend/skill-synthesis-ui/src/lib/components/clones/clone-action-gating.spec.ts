import type { CloneSummary } from '@ptah-extension/shared';

import {
  cloneActionModel,
  cloneStatusLabel,
  formatHistoryTimestamp,
  formatSuccessRate,
  hasUpstreamSource,
  KEEP_MINE_EXPLANATION,
} from './clone-action-gating';

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function clone(overrides: Partial<CloneSummary> = {}): CloneSummary {
  return {
    slug: 'deep-research',
    kind: 'skill',
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 10,
    successRate: 0.8,
    lastEnhancedAt: null,
    historyCount: 2,
    pendingSourceHash: null,
    enhanceMinInvocations: 5,
    enhanceCooldownUntil: null,
    ...overrides,
  };
}

describe('cloneActionModel — Enhance gating', () => {
  it('enables Enhance once the invocation threshold is met and no cooldown is active', () => {
    const model = cloneActionModel(clone(), NOW);
    expect(model.enhance).toEqual({ enabled: true, reason: null });
    expect(model.eligibility).toBe('ready');
    expect(model.eligibilityLabel).toBe('ready');
  });

  it('disables Enhance below the invocation threshold and states the threshold', () => {
    // The figma-designer case: zero invocations, five required.
    const model = cloneActionModel(
      clone({ invocationCount: 0, enhanceMinInvocations: 5 }),
      NOW,
    );
    expect(model.enhance.enabled).toBe(false);
    expect(model.enhance.reason).toContain('5 recorded runs');
    expect(model.enhance.reason).toContain('has 0');
    expect(model.eligibility).toBe('below-threshold');
    expect(model.eligibilityLabel).toBe('0/5 runs');
  });

  it('disables Enhance during the cooldown window and states the remaining time', () => {
    const model = cloneActionModel(
      clone({ enhanceCooldownUntil: NOW + 2 * 60 * 60 * 1000 }),
      NOW,
    );
    expect(model.enhance.enabled).toBe(false);
    expect(model.enhance.reason).toContain('available again in 2h');
    expect(model.eligibility).toBe('cooldown');
    expect(model.eligibilityLabel).toBe('cooldown 2h');
  });

  it('treats an expired cooldown as ready', () => {
    const model = cloneActionModel(
      clone({ enhanceCooldownUntil: NOW - 1000 }),
      NOW,
    );
    expect(model.enhance.enabled).toBe(true);
    expect(model.eligibility).toBe('ready');
  });

  it('reports the threshold before the cooldown when both would block', () => {
    const model = cloneActionModel(
      clone({
        invocationCount: 1,
        enhanceMinInvocations: 5,
        enhanceCooldownUntil: NOW + 60_000,
      }),
      NOW,
    );
    expect(model.eligibility).toBe('below-threshold');
    expect(model.eligibilityLabel).toBe('1/5 runs');
  });

  it('formats cooldown remainders in minutes, hours and days', () => {
    const label = (ms: number) =>
      cloneActionModel(clone({ enhanceCooldownUntil: NOW + ms }), NOW)
        .eligibilityLabel;
    expect(label(5 * 60_000)).toBe('cooldown 5m');
    expect(label(3 * 60 * 60_000)).toBe('cooldown 3h');
    expect(label(50 * 60 * 60_000)).toBe('cooldown 2d');
  });
});

describe('cloneActionModel — Revert gating', () => {
  it('enables Revert when snapshots exist', () => {
    expect(cloneActionModel(clone({ historyCount: 3 }), NOW).revert).toEqual({
      enabled: true,
      reason: null,
    });
  });

  it('disables Revert with an explanation when there are no snapshots', () => {
    const revert = cloneActionModel(clone({ historyCount: 0 }), NOW).revert;
    expect(revert.enabled).toBe(false);
    expect(revert.reason).toContain('No history snapshots');
  });
});

describe('cloneActionModel — divergence resolution', () => {
  it('offers neither Rebase nor Keep for a non-diverged entry', () => {
    const model = cloneActionModel(clone({ diverged: false }), NOW);
    expect(model.rebase).toBeNull();
    expect(model.keep).toBeNull();
    expect(model.upstreamNote).toBeNull();
  });

  it('offers both Rebase and Keep for a diverged plugin clone', () => {
    const model = cloneActionModel(
      clone({ diverged: true, cloneStatus: 'diverged' }),
      NOW,
    );
    expect(model.rebase).toEqual({ enabled: true, reason: null });
    expect(model.keep).toEqual({ enabled: true, reason: null });
    expect(model.upstreamNote).toBeNull();
  });

  it('NEVER offers Rebase for an authored entry, and says why', () => {
    // `skillSynthesis:rebaseClone` throws `Cannot resolve upstream source`
    // for these, so rendering the button at all is the bug being fixed.
    const model = cloneActionModel(
      clone({ diverged: true, cloneStatus: 'authored' }),
      NOW,
    );
    expect(model.rebase).toBeNull();
    expect(model.keep).toEqual({ enabled: true, reason: null });
    expect(model.upstreamNote).toContain('no upstream source');
    expect(model.upstreamNote).toContain('Authored here');
  });

  it('NEVER offers Rebase for a synth entry either', () => {
    const model = cloneActionModel(
      clone({ diverged: true, cloneStatus: 'synth' }),
      NOW,
    );
    expect(model.rebase).toBeNull();
    expect(model.upstreamNote).toContain('accepted recommendation');
  });
});

describe('hasUpstreamSource', () => {
  it.each([
    ['clone', true],
    ['diverged', true],
    ['authored', false],
    ['synth', false],
  ] as const)('%s -> %s', (cloneStatus, expected) => {
    expect(hasUpstreamSource(clone({ cloneStatus }))).toBe(expected);
  });
});

describe('KEEP_MINE_EXPLANATION', () => {
  it('states that no file content changes and the warning will not recur', () => {
    expect(KEEP_MINE_EXPLANATION).toContain('changes no file content');
    expect(KEEP_MINE_EXPLANATION).toContain('not be notified');
  });
});

describe('formatters', () => {
  it('lets divergence outrank the stored status label', () => {
    expect(
      cloneStatusLabel(clone({ cloneStatus: 'clone', diverged: true })),
    ).toBe('diverged');
    expect(
      cloneStatusLabel(clone({ cloneStatus: 'authored', diverged: false })),
    ).toBe('authored');
  });

  it('returns null for success rate when nothing has been recorded', () => {
    expect(formatSuccessRate(clone({ invocationCount: 0 }))).toBeNull();
    expect(
      formatSuccessRate(clone({ invocationCount: 4, successRate: 0.5 })),
    ).toBe('50%');
  });

  it('renders a history stamp readably and passes unknown shapes through', () => {
    expect(formatHistoryTimestamp('20260101T093000')).toBe('2026-01-01 09:30');
    expect(formatHistoryTimestamp('not-a-stamp')).toBe('not-a-stamp');
  });
});
