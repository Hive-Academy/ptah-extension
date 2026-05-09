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
    minTrajectoryFidelityRatio: 0.4,
    dedupClusterThreshold: 0.78,
    minAbstractionEditDistance: 0.3,
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'inherit',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 24,
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
