import { pickPrimaryModel, type ModelUsageEntry } from './pick-primary-model';

describe('pickPrimaryModel', () => {
  it('returns null for an empty array', () => {
    expect(pickPrimaryModel([])).toBeNull();
  });

  it('returns the only model when array has one entry', () => {
    const usage: ModelUsageEntry[] = [
      { model: 'claude-sonnet-4', totalCost: 0.01 },
    ];
    expect(pickPrimaryModel(usage)).toBe('claude-sonnet-4');
  });

  it('picks the highest-cost model', () => {
    const usage: ModelUsageEntry[] = [
      { model: 'claude-haiku', totalCost: 0.001 },
      { model: 'claude-opus', totalCost: 0.05 },
      { model: 'claude-sonnet', totalCost: 0.02 },
    ];
    expect(pickPrimaryModel(usage)).toBe('claude-opus');
  });

  it('breaks cost ties by total tokens descending', () => {
    const usage: ModelUsageEntry[] = [
      {
        model: 'claude-sonnet',
        totalCost: 0.05,
        tokens: { input: 100, output: 100 },
      },
      {
        model: 'claude-opus',
        totalCost: 0.05,
        tokens: { input: 1000, output: 1000, cacheRead: 500 },
      },
    ];
    expect(pickPrimaryModel(usage)).toBe('claude-opus');
  });

  it('counts cacheRead and cacheCreation in the token tie-breaker', () => {
    const usage: ModelUsageEntry[] = [
      {
        model: 'a-model',
        totalCost: 1,
        tokens: { input: 10, output: 10 },
      },
      {
        model: 'b-model',
        totalCost: 1,
        tokens: { input: 0, output: 0, cacheRead: 50, cacheCreation: 50 },
      },
    ];
    expect(pickPrimaryModel(usage)).toBe('b-model');
  });

  it('breaks full ties by model name lexicographically ascending', () => {
    const usage: ModelUsageEntry[] = [
      {
        model: 'claude-sonnet',
        totalCost: 0.02,
        tokens: { input: 100, output: 100 },
      },
      {
        model: 'claude-opus',
        totalCost: 0.02,
        tokens: { input: 100, output: 100 },
      },
    ];
    // 'claude-opus' < 'claude-sonnet' lexicographically
    expect(pickPrimaryModel(usage)).toBe('claude-opus');
  });

  it('treats missing tokens field as zero tokens for tie-break', () => {
    const usage: ModelUsageEntry[] = [
      { model: 'claude-opus', totalCost: 0.02 }, // no tokens
      {
        model: 'claude-sonnet',
        totalCost: 0.02,
        tokens: { input: 1, output: 1 },
      },
    ];
    expect(pickPrimaryModel(usage)).toBe('claude-sonnet');
  });

  it('is deterministic across input ordering (live vs history paths)', () => {
    const a: ModelUsageEntry = {
      model: 'claude-opus',
      totalCost: 0.05,
      tokens: { input: 100, output: 200 },
    };
    const b: ModelUsageEntry = {
      model: 'claude-sonnet',
      totalCost: 0.05,
      tokens: { input: 100, output: 200 },
    };
    expect(pickPrimaryModel([a, b])).toBe(pickPrimaryModel([b, a]));
    expect(pickPrimaryModel([a, b])).toBe('claude-opus');
  });
});
