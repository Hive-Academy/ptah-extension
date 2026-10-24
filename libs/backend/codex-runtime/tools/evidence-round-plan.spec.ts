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
      roundPlan([entry('profile-inputs', 1), entry('usage-semantics', 1)], 6),
    ).toEqual({
      plannedTurns: 2,
      cap: 3,
      remaining: 10,
      priorTurnsUsed: 6,
      estimatedTokens: 40000,
    });
  });
  it.each([-1, 17, 0.5, NaN])('rejects invalid prior count %s', (count) => {
    expect(() => roundPlan([], count)).toThrow('Prior turns');
  });
  it('rejects a cap beyond the shared remaining budget', () => {
    expect(() => roundPlan([entry('profile-inputs', 1)], 16)).toThrow(
      'Cap exceeds',
    );
  });
  it('rejects the original requested 7a grouping at 96k', () => {
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
  it('refuses combined caps above the sixteen remaining turns', () => {
    expect(roundPlan([entry('profile-inputs', 15)], 0).cap).toBe(16);
    expect(() => roundPlan([entry('profile-inputs', 16)], 0)).toThrow(
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
  it('requires an explicit actual 7a usage count for 7b', () => {
    expect(() => parseRoundArgs(['--round', '7b', '--dry-run'])).toThrow(
      '7b requires',
    );
    expect(
      parseRoundArgs(['--round', '7b', '--7a-turns-used', '6', '--dry-run']),
    ).toEqual({ round: '7b', priorTurnsUsed: 6, args: ['--dry-run'] });
  });
  it.each([
    ['--round', '7c'],
    ['--round'],
    ['--round', '7a', '--round', '7b'],
    ['--7a-turns-used', '1'],
    ['--round', '7b', '--7a-turns-used', '-1'],
    ['--round', '7b', '--7a-turns-used', '18'],
    ['--turn-cap=17'],
    ['--turn-cap', '17'],
  ])('rejects unsafe CLI %j', (...args) => {
    expect(() => parseRoundArgs(args)).toThrow();
  });
  it.each([
    ['7a', 6, 72000],
    ['7b', 4, 64000],
  ] as const)(
    'keeps proposed %s within bounds with one reserve',
    (round, turns, tokens) => {
      const catalog = JSON.parse(
        readFileSync(join(__dirname, 'evidence-cases.json'), 'utf8'),
      ) as EvidenceCase[];
      const cases = ROUND_ORDER[round].map((id) => {
        const item = catalog.find((candidate) => candidate.id === id);
        if (!item) throw new Error(`Missing case ${id}`);
        return item;
      });
      expect(roundPlan(cases, round === '7a' ? 0 : 7)).toMatchObject({
        plannedTurns: turns,
        cap: turns + 1,
        remaining: round === '7a' ? 16 : 9,
        estimatedTokens: tokens,
      });
      expect(tokens + 12000).toBeLessThanOrEqual(85000);
      if (round === '7b') expect(cases.at(-1)?.id).toBe('usage-semantics');
    },
  );
});
