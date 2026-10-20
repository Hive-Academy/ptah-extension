import 'reflect-metadata';
import { UsageAnalyticsService } from './usage-summary.service';
import { CodexSource } from './sources/codex.source';
import { OpenCodeSource } from './sources/opencode.source';
import { GrokSource } from './sources/grok.source';
import { CliSessionSource } from './cli-session.source';
import type { UsageSource, UsageContribution } from './usage-source.types';

describe('UsageAnalyticsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('ranks session-linked usage by priced cost and counts deduplicated activity', async () => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const base: UsageContribution = { key: 'a', sessionId: 'session-a', sessionTitle: 'First session', timestampMs: today, providerId: 'anthropic', modelId: 'm', inputUncachedTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2, sourceId: 'claude-ledger', subagentId: 'agent-1' };
    const claude: UsageSource = { read: async () => ({ contributions: [base, base, { ...base, key: 'b', sessionId: 'session-b', sessionTitle: 'Second session', subagentId: undefined, inputUncachedTokens: 20 }, { ...base, key: 'c', sessionId: 'session-c', sessionTitle: 'Unpriced session', subagentId: undefined, inputUncachedTokens: 30 }], status: { sourceId: 'claude-ledger', status: 'complete' } }) };
    const empty = { contributions: [], status: { sourceId: 'cli', status: 'complete' as const } };
    jest.spyOn(CodexSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(OpenCodeSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(GrokSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(CliSessionSource.prototype, 'read').mockResolvedValue(empty);
    const service = new UsageAnalyticsService(claude, { price: async (row) => ({ costUsd: row.sessionId === 'session-c' ? null : row.sessionId === 'session-b' ? 2 : 1, cacheSavingsUsd: null, costSource: row.sessionId === 'session-c' ? 'unpriced' as const : 'model-priced' as const, priceSource: 'bundled' as const }) }, { warn: jest.fn() });
    const summary = await service.summarize({ range: 7 }, '');
    expect(summary.topSessions?.map((row) => row.sessionId)).toEqual(['session-b', 'session-a', 'session-c']);
    expect(summary.sessionCount).toBe(3);
    expect(summary.messageCount).toBe(3);
    expect(summary.subagentCount).toBe(1);
    expect(summary.topSessions?.[2]).toMatchObject({ costUsd: null, unpriced: true });
  });

  it('shows the model with the greatest session cost, breaking ties by tokens', async () => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const base: UsageContribution = { key: 'a', sessionId: 'session-a', timestampMs: today, providerId: 'anthropic', modelId: 'costly', inputUncachedTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, sourceId: 'claude-ledger' };
    const claude: UsageSource = { read: async () => ({ contributions: [base, { ...base, key: 'b' }, { ...base, key: 'c', modelId: 'cheap', inputUncachedTokens: 100 }, { ...base, key: 'd', sessionId: 'session-b', modelId: 'tie-small' }, { ...base, key: 'e', sessionId: 'session-b', modelId: 'tie-large', inputUncachedTokens: 10 }], status: { sourceId: 'claude-ledger', status: 'complete' } }) };
    const empty = { contributions: [], status: { sourceId: 'cli', status: 'complete' as const } };
    jest.spyOn(CodexSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(OpenCodeSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(GrokSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(CliSessionSource.prototype, 'read').mockResolvedValue(empty);
    const service = new UsageAnalyticsService(claude, { price: async (row) => ({ costUsd: row.sessionId === 'session-b' ? null : row.modelId === 'costly' ? 3 : 5, cacheSavingsUsd: null, costSource: row.sessionId === 'session-b' ? 'unpriced' as const : 'model-priced' as const, priceSource: 'bundled' as const }) }, { warn: jest.fn() });
    const summary = await service.summarize({ range: 7 }, '');
    expect(summary.topSessions?.find((row) => row.sessionId === 'session-a')?.modelId).toBe('costly');
    expect(summary.topSessions?.find((row) => row.sessionId === 'session-b')?.modelId).toBe('tie-large');
  });

  it('keeps facts when a session id cannot be represented in the RPC response', async () => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const row: UsageContribution = { key: 'a', sessionId: 'invalid session id', timestampMs: today, providerId: 'anthropic', modelId: 'm', inputUncachedTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, sourceId: 'claude-ledger' };
    const claude: UsageSource = { read: async () => ({ contributions: [row, { ...row, key: 'b', sessionId: 'x'.repeat(161) }], status: { sourceId: 'claude-ledger', status: 'complete' } }) };
    const empty = { contributions: [], status: { sourceId: 'cli', status: 'complete' as const } };
    jest.spyOn(CodexSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(OpenCodeSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(GrokSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(CliSessionSource.prototype, 'read').mockResolvedValue(empty);
    const warn = jest.fn();
    const service = new UsageAnalyticsService(claude, { price: async () => ({ costUsd: 1, cacheSavingsUsd: null, costSource: 'model-priced', priceSource: 'bundled' }) }, { warn });
    const summary = await service.summarize({ range: 7 }, '');
    expect(summary.facts[0].inputUncachedTokens).toBe(20);
    expect(summary.topSessions).toEqual([]);
    expect(summary.sessionCount).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[UsageAnalytics] Invalid session id omitted', { sourceId: 'claude-ledger' });
  });

  it('does not count the contribution beyond the fact limit in sessions', async () => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const base: UsageContribution = { key: 'a', timestampMs: today, providerId: 'anthropic', modelId: 'm', inputUncachedTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, sourceId: 'claude-ledger' };
    const contributions = Array.from({ length: 100_000 }, (_, i): UsageContribution => ({ ...base, key: String(i), modelId: `m${i}` }));
    contributions.push({ ...base, key: 'overflow', modelId: 'overflow', sessionId: 'session-overflow' });
    const claude: UsageSource = { read: async () => ({ contributions, status: { sourceId: 'claude-ledger', status: 'complete' } }) };
    const service = new UsageAnalyticsService(claude, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() });
    const summary = await service.summarize({ range: 7 }, '');
    expect(summary.facts).toHaveLength(100_000);
    expect(summary.sources[0]).toMatchObject({ status: 'partial', reason: 'fact-limit' });
    expect(summary.sessionCount).toBe(0);
    expect(summary.messageCount).toBe(0);
    expect(summary.topSessions).toEqual([]);
  });

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
