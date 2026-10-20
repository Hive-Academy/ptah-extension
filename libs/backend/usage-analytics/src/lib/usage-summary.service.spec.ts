import 'reflect-metadata';
import { UsageAnalyticsService } from './usage-summary.service';
import { CodexSource } from './sources/codex.source';
import { OpenCodeSource } from './sources/opencode.source';
import { GrokSource } from './sources/grok.source';
import { CliSessionSource } from './cli-session.source';
import type { UsageSource, UsageContribution } from './usage-source.types';

describe('UsageAnalyticsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('deduplicates and groups day/provider/model, keeps unpriced null, and propagates partial status', async () => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const base: UsageContribution = { key: 'a', timestampMs: today, providerId: 'anthropic', modelId: 'm', inputUncachedTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 0, outputTokens: 3, sourceId: 'claude-ledger' };
    const claude: UsageSource = { read: async () => ({ contributions: [base, base, { ...base, key: 'b', inputUncachedTokens: 4 }], status: { sourceId: 'claude-ledger', status: 'partial', reason: 'One file unreadable' } }) };
    const empty = { contributions: [], status: { sourceId: 'cli', status: 'complete' as const } };
    jest.spyOn(CodexSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(OpenCodeSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(GrokSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(CliSessionSource.prototype, 'read').mockResolvedValue(empty);
    const service = new UsageAnalyticsService(claude, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() });
    const summary = await service.summarize({ range: 7 }, '');
    expect(summary.facts).toHaveLength(1);
    expect(summary.facts[0]).toMatchObject({ providerId: 'anthropic', modelId: 'm', inputUncachedTokens: 14, cacheReadTokens: 4, costUsd: null, costSource: 'unpriced' });
    expect(summary.sources[0]).toMatchObject({ status: 'partial', reason: 'One file unreadable' });
  });

  it('returns finished sources and a time-budget partial status on abort', async () => {
    const budget = new AbortController();
    const claude: UsageSource = { read: async () => ({ contributions: [], status: { sourceId: 'claude-ledger', status: 'complete' } }) };
    jest.spyOn(CodexSource.prototype, 'read').mockImplementation(async () => { budget.abort(); throw new DOMException('Aborted', 'AbortError'); });
    const service = new UsageAnalyticsService(claude, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() });
    const summary = await service.summarize({ range: 7 }, '', budget.signal);
    expect(summary.sources[0]).toMatchObject({ sourceId: 'claude-ledger', status: 'complete' });
    expect(summary.sources[1]).toMatchObject({ sourceId: 'codex', status: 'partial', reason: 'time-budget' });
    expect(summary.sources[2]).toMatchObject({ sourceId: 'opencode', status: 'unavailable', reason: 'time-budget' });
  });
});
