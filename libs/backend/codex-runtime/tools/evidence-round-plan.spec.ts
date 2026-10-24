import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { roundPlan, parseRoundArgs, ROUND_ORDER } from './evidence-round-plan';
import type { EvidenceCase } from './evidence-harness';
const entry = (id: string, turnCost: number): EvidenceCase => ({
  id,
  turnCost,
  kind: 'round',
  observations: [],
  purpose: 'test',
});
describe('shared approved round budget', () => {
  it('subtracts actual prior turns and reserves a steer slot', () => {
    expect(
      roundPlan([entry('profile-inputs', 1), entry('profile-inputs', 1)], 6),
    ).toEqual({
      plannedTurns: 2,
      cap: 3,
      remaining: 7,
      priorTurnsUsed: 6,
      estimatedTokens: 32000,
    });
  });
  it.each([-1, 14, 0.5, NaN])('rejects invalid prior count %s', (count) => {
    expect(() => roundPlan([], count)).toThrow('Prior turns');
  });
  it('rejects a cap beyond the shared remaining budget', () => {
    expect(() => roundPlan([entry('profile-inputs', 1)], 13)).toThrow(
      'Cap exceeds',
    );
  });
  it('rejects the old grouping under the corrected token estimates', () => {
    expect(() =>
      roundPlan(
        [
          entry('different-home-isolation', 1),
          entry('always-allow-scope', 2),
          entry('same-home-isolation', 2),
          entry('resume-history', 2),
        ],
        0,
      ),
    ).toThrow('Estimated tokens exceed');
  });
  it('refuses combined caps above the thirteen remaining turns', () => {
    expect(roundPlan([entry('profile-inputs', 12)], 0).cap).toBe(13);
    expect(() => roundPlan([entry('profile-inputs', 13)], 0)).toThrow(
      'Cap exceeds',
    );
    expect(() => roundPlan([entry('profile-inputs', 4)], 12)).toThrow(
      'Cap exceeds',
    );
  });
  it('rejects unknown token estimates', () => {
    expect(() => roundPlan([entry('unknown', 1)], 0)).toThrow(
      'estimate missing',
    );
  });
});

describe('round selection and recorded usage', () => {
  it('requires the sum of actual earlier usage for later rounds', () => {
    expect(() => parseRoundArgs(['--round', '7d', '--dry-run'])).toThrow(
      'Later rounds require',
    );
    expect(
      parseRoundArgs(['--round', '7e', '--prior-turns-used', '7', '--dry-run']),
    ).toEqual({ round: '7e', priorTurnsUsed: 7, args: ['--dry-run'] });
    expect(
      parseRoundArgs(['--round', '7c', '--prior-turns-used', '4'])
        .priorTurnsUsed,
    ).toBe(4);
  });
  it.each([
    ['--round', '7a'],
    ['--round'],
    ['--round', '7c', '--round', '7d'],
    ['--round', '7d', '--prior-turns-used', '-1'],
    ['--round', '7e', '--prior-turns-used', '14'],
    ['--turn-cap=17'],
    ['--turn-cap', '17'],
  ])('rejects unsafe CLI %j', (...args) => {
    expect(() => parseRoundArgs(args)).toThrow();
  });
  it('fits all caps within thirteen turns and prioritizes unproved scope/isolation', () => {
    const catalog = JSON.parse(
      readFileSync(join(__dirname, 'evidence-cases.json'), 'utf8'),
    ) as EvidenceCase[];
    let prior = 0;
    for (const [round, turns, tokens] of [
      ['7c', 3, 64000],
      ['7d', 2, 48000],
      ['7e', 3, 48000],
    ] as const) {
      const cases = ROUND_ORDER[round].map((id) => {
        const item = catalog.find((candidate) => candidate.id === id);
        if (!item) throw new Error(`Missing case ${id}`);
        return item;
      });
      const plan = roundPlan(cases, prior);
      expect(plan).toMatchObject({
        plannedTurns: turns,
        cap: turns + 1,
        remaining: 13 - prior,
        estimatedTokens: tokens,
      });
      expect(plan.estimatedTokens).toBeLessThanOrEqual(85000);
      expect(
        cases.some(
          (item) =>
            item.id === 'usage-semantics' ||
            item.id === 'different-home-isolation',
        ),
      ).toBe(false);
      prior += plan.cap;
    }
    expect(prior).toBe(11);
    expect(() => roundPlan([entry('always-allow-scope', 3)], prior)).toThrow(
      'Cap exceeds',
    );
  });
});
