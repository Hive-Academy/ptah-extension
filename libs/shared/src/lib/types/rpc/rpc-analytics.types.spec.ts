import { UsageFactSchema, UsageSummaryParamsSchema, UsageTopSessionSchema } from './rpc-analytics.types';

describe('usage analytics contract', () => {
  it('validates bounded session rows and nullable unpriced cost', () => {
    const row = { sessionId: 'abc', title: 'Session', providerId: 'anthropic', modelId: 'm', costUsd: null, unpriced: true, tokens: 20, messageCount: 1, subagentCount: 0, lastActive: '2026-10-20T00:00:00.000Z' };
    expect(UsageTopSessionSchema.safeParse(row).success).toBe(true);
    expect(UsageTopSessionSchema.safeParse({ ...row, title: '' }).success).toBe(false);
    expect(UsageTopSessionSchema.safeParse({ ...row, tokens: -1 }).success).toBe(false);
  });
  it('accepts only dashboard ranges', () => {
    expect(UsageSummaryParamsSchema.safeParse({ range: 90 }).success).toBe(true);
    expect(UsageSummaryParamsSchema.safeParse({ range: 200 }).success).toBe(false);
  });

  it('rejects inconsistent unknown costs and unsafe counters', () => {
    const fact = {
      day: '2026-10-20', providerId: 'anthropic', modelId: 'claude',
      inputUncachedTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 1, costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', sourceId: 'claude-ledger',
    };
    expect(UsageFactSchema.safeParse(fact).success).toBe(true);
    expect(UsageFactSchema.safeParse({ ...fact, costUsd: 0 }).success).toBe(false);
    expect(UsageFactSchema.safeParse({ ...fact, cacheSavingsUsd: -1 }).success).toBe(false);
    expect(UsageFactSchema.safeParse({ ...fact, cacheSavingsUsd: Number.NaN }).success).toBe(false);
    expect(UsageFactSchema.safeParse({ ...fact, cacheSavingsUsd: 0.02 }).success).toBe(true);
    expect(UsageFactSchema.safeParse({ ...fact, inputUncachedTokens: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(UsageFactSchema.safeParse({ ...fact, day: '2026-02-30' }).success).toBe(false);
  });
});
