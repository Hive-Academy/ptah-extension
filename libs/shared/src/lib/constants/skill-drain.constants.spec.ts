import {
  SKILL_DRAIN_HANDLER_NAMES,
  SKILL_DRAIN_JOB_IDS,
  SKILL_DRAIN_TIERS,
  skillDrainTierForJobId,
} from './skill-drain.constants';

describe('skill drain job identity', () => {
  it('declares exactly the three tiers, cheapest cadence first', () => {
    expect(SKILL_DRAIN_TIERS).toEqual(['frequent', 'nightly', 'weekly']);
  });

  it.each(SKILL_DRAIN_TIERS)('assigns %s a fixed job id', (tier) => {
    expect(SKILL_DRAIN_JOB_IDS[tier]).toBe(`@ptah/skills-drain-${tier}`);
  });

  it.each(SKILL_DRAIN_TIERS)('assigns %s a fixed handler name', (tier) => {
    expect(SKILL_DRAIN_HANDLER_NAMES[tier]).toBe(`skills:drain:${tier}`);
  });

  // The ids are the upsert key. Two tiers sharing one would make the second
  // registration overwrite the first, leaving a host with two of the three
  // cadences and no error anywhere.
  it('gives every tier a distinct job id', () => {
    const ids = SKILL_DRAIN_TIERS.map((tier) => SKILL_DRAIN_JOB_IDS[tier]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves a job id back to its tier', () => {
    for (const tier of SKILL_DRAIN_TIERS) {
      expect(skillDrainTierForJobId(SKILL_DRAIN_JOB_IDS[tier])).toBe(tier);
    }
  });

  it('returns null for a job id that is not a drain job', () => {
    expect(skillDrainTierForJobId('@ptah/daily-backup')).toBeNull();
    expect(skillDrainTierForJobId('')).toBeNull();
  });

  // `cron:create` rejects any RPC-supplied prompt starting with `handler:`, so
  // a drain handler name that did not carry the prefix at its call site would
  // be creatable — and therefore triggerable — from the renderer.
  it('keeps handler names free of the reserved prefix itself', () => {
    for (const tier of SKILL_DRAIN_TIERS) {
      expect(SKILL_DRAIN_HANDLER_NAMES[tier].startsWith('handler:')).toBe(
        false,
      );
    }
  });
});
