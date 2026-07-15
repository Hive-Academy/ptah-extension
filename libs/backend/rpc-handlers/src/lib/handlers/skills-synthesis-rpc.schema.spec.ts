/**
 * Skill Synthesis RPC schema specs — Zod validation rules.
 *
 * Tests: successesToPromote=0 rejected, out-of-range thresholds, empty id for pin/unpin,
 * partial update params accepted, z.coerce.number accepts numeric strings.
 */
import {
  SkillSynthesisSettingsSchema,
  UpdateSkillSynthesisSettingsParamsSchema,
  PinSkillParamsSchema,
  UnpinSkillParamsSchema,
  SkillGetCloneParamsSchema,
  SkillEnhanceNowParamsSchema,
  SkillRevertEnhancementParamsSchema,
  SkillRebaseCloneParamsSchema,
  SkillKeepCloneParamsSchema,
  SkillInvocationStatsParamsSchema,
  getScorecardsParamsSchema,
  getScorecardDetailParamsSchema,
} from './skills-synthesis-rpc.schema';

describe('SkillSynthesisSettingsSchema', () => {
  const validFull = {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinChars: 800,
    prefilterMinToolUses: 2,
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'inherit',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
  };

  it('accepts a fully valid settings object', () => {
    expect(() => SkillSynthesisSettingsSchema.parse(validFull)).not.toThrow();
  });

  it('rejects successesToPromote=0 (min is 1)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        successesToPromote: 0,
      }),
    ).toThrow();
  });

  it('rejects dedupCosineThreshold > 1', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        dedupCosineThreshold: 1.1,
      }),
    ).toThrow();
  });

  it('rejects dedupCosineThreshold < 0', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        dedupCosineThreshold: -0.1,
      }),
    ).toThrow();
  });

  it('rejects minJudgeScore > 10', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({ ...validFull, minJudgeScore: 11 }),
    ).toThrow();
  });

  it('rejects curatorIntervalHours < 1', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        curatorIntervalHours: 0,
      }),
    ).toThrow();
  });

  it('z.coerce.number() accepts numeric strings for number fields', () => {
    const result = SkillSynthesisSettingsSchema.parse({
      ...validFull,
      successesToPromote: '5',
      maxActiveSkills: '100',
      minJudgeScore: '7.5',
    });
    expect(result.successesToPromote).toBe(5);
    expect(result.maxActiveSkills).toBe(100);
    expect(result.minJudgeScore).toBe(7.5);
  });
});

describe('UpdateSkillSynthesisSettingsParamsSchema', () => {
  it('accepts a partial settings object (only one field)', () => {
    const result = UpdateSkillSynthesisSettingsParamsSchema.parse({
      settings: { successesToPromote: 5 },
    });
    expect(result.settings.successesToPromote).toBe(5);
    // Other fields absent
    expect(result.settings.enabled).toBeUndefined();
  });

  it('accepts an empty settings object', () => {
    expect(() =>
      UpdateSkillSynthesisSettingsParamsSchema.parse({ settings: {} }),
    ).not.toThrow();
  });

  it('rejects an invalid value in a partial update', () => {
    expect(() =>
      UpdateSkillSynthesisSettingsParamsSchema.parse({
        settings: { successesToPromote: 0 },
      }),
    ).toThrow();
  });
});

describe('PinSkillParamsSchema', () => {
  it('accepts a non-empty id', () => {
    const result = PinSkillParamsSchema.parse({ id: 'cand-abc' });
    expect(result.id).toBe('cand-abc');
  });

  it('rejects an empty id', () => {
    expect(() => PinSkillParamsSchema.parse({ id: '' })).toThrow();
  });

  it('rejects a missing id', () => {
    expect(() => PinSkillParamsSchema.parse({})).toThrow();
  });
});

describe('UnpinSkillParamsSchema', () => {
  it('accepts a non-empty id', () => {
    const result = UnpinSkillParamsSchema.parse({ id: 'cand-xyz' });
    expect(result.id).toBe('cand-xyz');
  });

  it('rejects an empty id', () => {
    expect(() => UnpinSkillParamsSchema.parse({ id: '' })).toThrow();
  });
});

describe('SkillGetCloneParamsSchema', () => {
  it('accepts a valid slug + kind', () => {
    const result = SkillGetCloneParamsSchema.parse({
      slug: 'deep-research',
      kind: 'skill',
    });
    expect(result.slug).toBe('deep-research');
    expect(result.kind).toBe('skill');
  });

  it('accepts agent and command kinds', () => {
    expect(() =>
      SkillGetCloneParamsSchema.parse({ slug: 'a', kind: 'agent' }),
    ).not.toThrow();
    expect(() =>
      SkillGetCloneParamsSchema.parse({ slug: 'c', kind: 'command' }),
    ).not.toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      SkillGetCloneParamsSchema.parse({ slug: 'x', kind: 'plugin' }),
    ).toThrow();
  });

  it('rejects an empty slug', () => {
    expect(() =>
      SkillGetCloneParamsSchema.parse({ slug: '', kind: 'skill' }),
    ).toThrow();
  });
});

describe('SkillEnhanceNowParamsSchema', () => {
  it('accepts a non-empty slug + kind', () => {
    const result = SkillEnhanceNowParamsSchema.parse({
      kind: 'skill',
      slug: 'my-skill',
    });
    expect(result.slug).toBe('my-skill');
    expect(result.kind).toBe('skill');
  });

  it('accepts agent and command kinds', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'agent', slug: 'my-agent' }),
    ).not.toThrow();
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'command', slug: 'my-cmd' }),
    ).not.toThrow();
  });

  it('rejects an empty slug', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'skill', slug: '' }),
    ).toThrow();
  });

  it('rejects a missing slug', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'skill' }),
    ).toThrow();
  });

  it('rejects a missing kind', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ slug: 'my-skill' }),
    ).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      SkillEnhanceNowParamsSchema.parse({ kind: 'plugin', slug: 'my-skill' }),
    ).toThrow();
  });
});

describe('SkillRevertEnhancementParamsSchema', () => {
  it('accepts kind + slug + historyTs (epoch-millis snapshot format)', () => {
    const result = SkillRevertEnhancementParamsSchema.parse({
      kind: 'skill',
      slug: 'my-skill',
      historyTs: '1717848000000',
    });
    expect(result.historyTs).toBe('1717848000000');
    expect(result.kind).toBe('skill');
  });

  it('accepts agent and command kinds', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'agent',
        slug: 'my-agent',
        historyTs: '1717848000000',
      }),
    ).not.toThrow();
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'command',
        slug: 'my-cmd',
        historyTs: '1717848000000',
      }),
    ).not.toThrow();
  });

  it('rejects a missing kind', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        slug: 'my-skill',
        historyTs: '1717848000000',
      }),
    ).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'plugin',
        slug: 'my-skill',
        historyTs: '1717848000000',
      }),
    ).toThrow();
  });

  it('accepts a collision-suffixed historyTs (ts-counter)', () => {
    const result = SkillRevertEnhancementParamsSchema.parse({
      kind: 'skill',
      slug: 'my-skill',
      historyTs: '1717848000000-1',
    });
    expect(result.historyTs).toBe('1717848000000-1');
  });

  it('rejects a missing historyTs', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
      }),
    ).toThrow();
  });

  it('rejects an empty historyTs', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
        historyTs: '',
      }),
    ).toThrow();
  });

  it('rejects a traversal historyTs (../../etc)', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
        historyTs: '../../etc',
      }),
    ).toThrow();
  });

  it('rejects a single-level traversal historyTs (../)', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
        historyTs: '../',
      }),
    ).toThrow();
  });

  it('rejects a non-numeric (legacy ISO-ish) historyTs', () => {
    expect(() =>
      SkillRevertEnhancementParamsSchema.parse({
        kind: 'skill',
        slug: 'my-skill',
        historyTs: '20260608T120000',
      }),
    ).toThrow();
  });
});

describe('Slug traversal hardening (all clone schemas)', () => {
  const malicious = ['../../etc', 'a/b', 'a\\b', '..', '../foo', 'foo/..'];
  const valid = ['deep-research', 'My_Skill.v2', 'a', 'agent-007'];

  describe('SkillGetCloneParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillGetCloneParamsSchema.parse({ slug, kind: 'skill' }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillGetCloneParamsSchema.parse({ slug, kind: 'skill' }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillEnhanceNowParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillEnhanceNowParamsSchema.parse({ kind: 'skill', slug }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillEnhanceNowParamsSchema.parse({ kind: 'skill', slug }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillRevertEnhancementParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillRevertEnhancementParamsSchema.parse({
            kind: 'skill',
            slug,
            historyTs: '1717848000000',
          }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillRevertEnhancementParamsSchema.parse({
            kind: 'skill',
            slug,
            historyTs: '1717848000000',
          }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillRebaseCloneParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillRebaseCloneParamsSchema.parse({ kind: 'skill', slug }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillRebaseCloneParamsSchema.parse({ kind: 'skill', slug }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillKeepCloneParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillKeepCloneParamsSchema.parse({ kind: 'skill', slug }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillKeepCloneParamsSchema.parse({ kind: 'skill', slug }),
        ).not.toThrow();
      });
    }
  });

  describe('SkillInvocationStatsParamsSchema.slug', () => {
    for (const slug of malicious) {
      it(`rejects ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillInvocationStatsParamsSchema.parse({ slug }),
        ).toThrow();
      });
    }
    for (const slug of valid) {
      it(`accepts ${JSON.stringify(slug)}`, () => {
        expect(() =>
          SkillInvocationStatsParamsSchema.parse({ slug }),
        ).not.toThrow();
      });
    }
  });
});

describe('SkillRebaseCloneParamsSchema', () => {
  it('accepts kind + slug', () => {
    const result = SkillRebaseCloneParamsSchema.parse({
      kind: 'skill',
      slug: 'my-skill',
    });
    expect(result.kind).toBe('skill');
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      SkillRebaseCloneParamsSchema.parse({ kind: 'x', slug: 'my-skill' }),
    ).toThrow();
  });
});

describe('SkillKeepCloneParamsSchema', () => {
  it('accepts kind + slug', () => {
    const result = SkillKeepCloneParamsSchema.parse({
      kind: 'agent',
      slug: 'my-agent',
    });
    expect(result.slug).toBe('my-agent');
  });

  it('rejects an empty slug', () => {
    expect(() =>
      SkillKeepCloneParamsSchema.parse({ kind: 'skill', slug: '' }),
    ).toThrow();
  });
});

describe('SkillInvocationStatsParamsSchema', () => {
  it('accepts a non-empty slug', () => {
    const result = SkillInvocationStatsParamsSchema.parse({ slug: 'my-skill' });
    expect(result.slug).toBe('my-skill');
  });

  it('rejects an empty slug', () => {
    expect(() =>
      SkillInvocationStatsParamsSchema.parse({ slug: '' }),
    ).toThrow();
  });
});

describe('getScorecardsParamsSchema', () => {
  it('accepts a valid slugs array', () => {
    const result = getScorecardsParamsSchema.parse({
      slugs: ['backend-developer', 'frontend-developer'],
    });
    expect(result.slugs).toHaveLength(2);
  });

  it('accepts an empty slugs array', () => {
    expect(() => getScorecardsParamsSchema.parse({ slugs: [] })).not.toThrow();
  });

  it('accepts exactly 500 slugs (upper bound)', () => {
    const slugs = Array.from({ length: 500 }, (_, i) => `agent-${i}`);
    expect(() => getScorecardsParamsSchema.parse({ slugs })).not.toThrow();
  });

  it('rejects more than 500 slugs', () => {
    const slugs = Array.from({ length: 501 }, (_, i) => `agent-${i}`);
    expect(() => getScorecardsParamsSchema.parse({ slugs })).toThrow();
  });

  it('rejects an empty-string slug entry', () => {
    expect(() => getScorecardsParamsSchema.parse({ slugs: [''] })).toThrow();
  });

  it('rejects a slug entry longer than 200 chars', () => {
    expect(() =>
      getScorecardsParamsSchema.parse({ slugs: ['x'.repeat(201)] }),
    ).toThrow();
  });

  it('rejects a non-array slugs value', () => {
    expect(() =>
      getScorecardsParamsSchema.parse({ slugs: 'backend-developer' }),
    ).toThrow();
  });

  it('rejects a missing slugs field', () => {
    expect(() => getScorecardsParamsSchema.parse({})).toThrow();
  });
});

describe('getScorecardDetailParamsSchema', () => {
  it('accepts slug alone (limit optional)', () => {
    const result = getScorecardDetailParamsSchema.parse({ slug: 'agent' });
    expect(result.slug).toBe('agent');
    expect(result.limit).toBeUndefined();
  });

  it('accepts slug + valid limit', () => {
    const result = getScorecardDetailParamsSchema.parse({
      slug: 'agent',
      limit: 25,
    });
    expect(result.limit).toBe(25);
  });

  it('accepts limit=1 and limit=100 (bounds)', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 1 }),
    ).not.toThrow();
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 100 }),
    ).not.toThrow();
  });

  it('rejects an empty slug', () => {
    expect(() => getScorecardDetailParamsSchema.parse({ slug: '' })).toThrow();
  });

  it('rejects a slug longer than 200 chars', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('rejects a non-integer limit', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 2.5 }),
    ).toThrow();
  });

  it('rejects limit=0 (below min)', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 0 }),
    ).toThrow();
  });

  it('rejects limit=101 (above max)', () => {
    expect(() =>
      getScorecardDetailParamsSchema.parse({ slug: 'a', limit: 101 }),
    ).toThrow();
  });
});

describe('SkillSynthesisSettingsSchema — suggestionMinClusterSize boundary', () => {
  const validFull = {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinChars: 800,
    prefilterMinToolUses: 2,
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'inherit',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
  };

  it('accepts suggestionMinClusterSize=2 (minimum)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMinClusterSize: 2,
      }),
    ).not.toThrow();
  });

  it('accepts suggestionMinClusterSize=100 (maximum)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMinClusterSize: 100,
      }),
    ).not.toThrow();
  });

  it('rejects suggestionMinClusterSize=1 (below min of 2)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMinClusterSize: 1,
      }),
    ).toThrow();
  });

  it('rejects suggestionMinClusterSize=101 (above max of 100)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMinClusterSize: 101,
      }),
    ).toThrow();
  });

  it('rejects missing suggestionMinClusterSize (required field)', () => {
    const { suggestionMinClusterSize: _omit, ...rest } = validFull;
    expect(() => SkillSynthesisSettingsSchema.parse(rest)).toThrow();
  });
});

describe('SkillSynthesisSettingsSchema — suggestionMaxCandidates boundary', () => {
  const validFull = {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinChars: 800,
    prefilterMinToolUses: 2,
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'inherit',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
  };

  it('accepts suggestionMaxCandidates=1 (minimum)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMaxCandidates: 1,
      }),
    ).not.toThrow();
  });

  it('accepts suggestionMaxCandidates=5000 (maximum)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMaxCandidates: 5000,
      }),
    ).not.toThrow();
  });

  it('rejects suggestionMaxCandidates=0 (below min of 1)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMaxCandidates: 0,
      }),
    ).toThrow();
  });

  it('rejects suggestionMaxCandidates=5001 (above max of 5000)', () => {
    expect(() =>
      SkillSynthesisSettingsSchema.parse({
        ...validFull,
        suggestionMaxCandidates: 5001,
      }),
    ).toThrow();
  });

  it('rejects missing suggestionMaxCandidates (required field)', () => {
    const { suggestionMaxCandidates: _omit, ...rest } = validFull;
    expect(() => SkillSynthesisSettingsSchema.parse(rest)).toThrow();
  });
});
