import 'reflect-metadata';
import { UsageAnalyticsService, mergeKnownCost } from './usage-summary.service';

describe('mergeKnownCost', () => {
  it('keeps the known cost absent when no ledger slice had one', () => {
    expect(mergeKnownCost(undefined, undefined)).toEqual({});
  });

  it('sums known costs across slices', () => {
    expect(mergeKnownCost(1.5, undefined)).toEqual({ knownCostUsd: 1.5 });
    expect(mergeKnownCost(undefined, 2)).toEqual({ knownCostUsd: 2 });
    expect(mergeKnownCost(1.5, 2)).toEqual({ knownCostUsd: 3.5 });
  });
});
import { CodexSource } from './sources/codex.source';
import { OpenCodeSource } from './sources/opencode.source';
import { GrokSource } from './sources/grok.source';
import { CliSessionSource } from './cli-session.source';
import type { UsageSource, UsageContribution } from './usage-source.types';
import { SessionStatsRepository } from '@ptah-extension/persistence-sqlite';

describe('UsageAnalyticsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not start ledger SQL when the budget has expired', async () => {
    const repository = new SessionStatsRepository({ ready: async () => { throw new Error('unused'); } });
    const groups = jest.spyOn(repository, 'getWorkspaceUsageGroups');
    const budget = new AbortController();
    budget.abort();
    const empty = { contributions: [], status: { sourceId: 'external', status: 'complete' as const } };
    const service = new UsageAnalyticsService({ read: async () => empty }, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() }, repository);
    const summary = await service.summarize({ range: 7 }, 'C:/workspace', budget.signal);
    expect(groups).not.toHaveBeenCalled();
    expect(summary.sources[0]).toMatchObject({ sourceId: 'claude-ledger', status: 'partial', reason: 'time-budget' });
  });

  it('stops ledger slices after abort without running count or ranking queries', async () => {
    const repository = new SessionStatsRepository({ ready: async () => { throw new Error('unused'); } });
    const budget = new AbortController();
    jest.spyOn(repository, 'getWorkspaceCoverage').mockResolvedValue(null);
    const groups = jest.spyOn(repository, 'getWorkspaceUsageGroups').mockImplementation(async () => { budget.abort(); return []; });
    const count = jest.spyOn(repository, 'getWorkspaceSessionCount');
    const empty = { contributions: [], status: { sourceId: 'external', status: 'complete' as const } };
    const service = new UsageAnalyticsService({ read: async () => empty }, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() }, repository);
    const summary = await service.summarize({ range: 7 }, 'C:/workspace', budget.signal);
    expect(groups).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
    expect(summary.sources[0]).toMatchObject({ status: 'partial', reason: 'time-budget' });
  });

  it('keeps ledger counts on a completed RPC budget', async () => {
    const repository = new SessionStatsRepository({ ready: async () => { throw new Error('unused'); } });
    jest.spyOn(repository, 'getWorkspaceCoverage').mockResolvedValue(null);
    jest.spyOn(repository, 'getWorkspaceUsageGroups').mockResolvedValue([]);
    const sessions = jest.spyOn(repository, 'getWorkspaceSessionCount').mockResolvedValue(4);
    const messages = jest.spyOn(repository, 'getWorkspaceMessageCount').mockResolvedValue(9);
    jest.spyOn(repository, 'getWorkspaceTopSessions').mockResolvedValue([]);
    const empty = { contributions: [], status: { sourceId: 'external', status: 'complete' as const } };
    for (const source of [CodexSource, OpenCodeSource, GrokSource, CliSessionSource]) {
      jest.spyOn(source.prototype, 'read').mockResolvedValue(empty);
    }
    const service = new UsageAnalyticsService({ read: async () => empty }, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() }, repository);
    const summary = await service.summarize({ range: 7 }, 'C:/workspace', new AbortController().signal);
    expect(sessions).toHaveBeenCalledTimes(1);
    expect(messages).toHaveBeenCalledTimes(1);
    expect(summary.sessionCount).toBe(4);
    expect(summary.messageCount).toBe(9);
  });

  it('marks an empty ledger partial because historical sessions were not backfilled', async () => {
    const repository = new SessionStatsRepository({ ready: async () => { throw new Error('unused'); } });
    jest.spyOn(repository, 'getWorkspaceCoverage').mockResolvedValue(null);
    jest.spyOn(repository, 'getWorkspaceUsageGroups').mockResolvedValue([]);
    jest.spyOn(repository, 'getWorkspaceSessionCount').mockResolvedValue(0);
    jest.spyOn(repository, 'getWorkspaceMessageCount').mockResolvedValue(0);
    jest.spyOn(repository, 'getWorkspaceTopSessions').mockResolvedValue([]);
    const empty = { contributions: [], status: { sourceId: 'external', status: 'complete' as const } };
    jest.spyOn(CodexSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(OpenCodeSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(GrokSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(CliSessionSource.prototype, 'read').mockResolvedValue(empty);
    const service = new UsageAnalyticsService({ read: async () => empty }, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() }, repository);
    const summary = await service.summarize({ range: 7 }, 'C:/workspace');
    expect(summary.sources[0]).toMatchObject({ sourceId: 'claude-ledger', status: 'partial' });
    expect(summary.sources[0].reason).toContain('not backfilled');
  });

  it('keeps SQL facts within the response cap and reports partial coverage', async () => {
    const repository = new SessionStatsRepository({ ready: async () => { throw new Error('unused'); } });
    jest.spyOn(repository, 'getWorkspaceCoverage').mockResolvedValue(null);
    const day = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString().slice(0, 10);
    const row = { day, provider_id: 'openai', model_id: 'm', source: 'live', cost_authority: 'unpriced', input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, known_cost_micro_usd: null, has_unpriced: 1, session_count: 1 };
    jest.spyOn(repository, 'getWorkspaceUsageGroups')
      .mockResolvedValueOnce(Array.from({ length: 100_001 }, (_, i) => ({ ...row, model_id: `m${i}` })))
      .mockResolvedValueOnce([{ ...row, model_id: 'm0' }])
      .mockResolvedValue([]);
    jest.spyOn(repository, 'getWorkspaceSessionCount').mockResolvedValue(1);
    jest.spyOn(repository, 'getWorkspaceMessageCount').mockResolvedValue(1);
    jest.spyOn(repository, 'getWorkspaceTopSessions').mockResolvedValue([]);
    const empty = { contributions: [], status: { sourceId: 'external', status: 'complete' as const } };
    jest.spyOn(CodexSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(OpenCodeSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(GrokSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(CliSessionSource.prototype, 'read').mockResolvedValue(empty);
    const service = new UsageAnalyticsService({ read: async () => empty }, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() }, repository);
    const summary = await service.summarize({ range: 7 }, 'C:/workspace', new AbortController().signal);
    expect(summary.facts).toHaveLength(100_000);
    expect(summary.facts.find((fact) => fact.modelId === 'm0')?.inputUncachedTokens).toBe(2);
    expect(summary.sources[0]).toMatchObject({ status: 'partial', reason: 'fact-limit' });
  });

  it('suppresses native Codex overlap only in the authorized workspace', async () => {
    const repository = new SessionStatsRepository({ ready: async () => { throw new Error('unused'); } });
    jest.spyOn(repository, 'getWorkspaceCoverage').mockResolvedValue(null);
    jest.spyOn(repository, 'getWorkspaceUsageGroups').mockResolvedValue([]);
    jest.spyOn(repository, 'getWorkspaceSessionCount').mockResolvedValue(0);
    jest.spyOn(repository, 'getWorkspaceMessageCount').mockResolvedValue(0);
    jest.spyOn(repository, 'getWorkspaceTopSessions').mockResolvedValue([]);
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const base: UsageContribution = { key: 'a', sessionId: 'native-thread', timestampMs: today, providerId: 'codex', modelId: 'gpt', inputUncachedTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, sourceId: 'codex' };
    jest.spyOn(CodexSource.prototype, 'read').mockResolvedValue({ contributions: [base, { ...base, key: 'b' }], status: { sourceId: 'codex', status: 'complete' } });
    const empty = { contributions: [], status: { sourceId: 'external', status: 'complete' as const } };
    jest.spyOn(OpenCodeSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(GrokSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(CliSessionSource.prototype, 'read').mockResolvedValue(empty);
    const matches = jest.spyOn(repository, 'hasWorkspaceCodexRun').mockResolvedValue(true);
    const service = new UsageAnalyticsService({ read: async () => empty }, { price: async () => ({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' }) }, { warn: jest.fn() }, repository);
    const summary = await service.summarize({ range: 7 }, 'C:/workspace');
    expect(summary.facts).toEqual([]);
    expect(matches).toHaveBeenCalledTimes(1);
    expect(matches.mock.calls[0][0]).toBeTruthy();
    expect(matches.mock.calls[0][1]).toBe('native-thread');
    matches.mockResolvedValue(false);
    const other = await service.summarize({ range: 7 }, 'C:/other');
    expect(other.facts).toHaveLength(1);
    expect(other.facts[0].inputUncachedTokens).toBe(10);
  });

  it('projects SQL ledger days, provider pricing, null cost, and session rankings', async () => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const yesterday = new Date(today - 1).toISOString().slice(0, 10);
    const current = new Date(today).toISOString().slice(0, 10);
    const repository = new SessionStatsRepository({ ready: async () => { throw new Error('unused'); } });
    jest.spyOn(repository, 'getWorkspaceCoverage').mockResolvedValue({ first_captured_at_ms: today, last_captured_at_ms: today });
    jest.spyOn(repository, 'getWorkspaceUsageGroups').mockResolvedValue([
      { day: yesterday, provider_id: 'anthropic', model_id: 'claude', source: 'live', cost_authority: 'provider-reported', input_tokens: 3, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, known_cost_micro_usd: 2_000_000, has_unpriced: 0, session_count: 1 },
      { day: current, provider_id: 'openai', model_id: 'codex', source: 'live', cost_authority: 'unpriced', input_tokens: 4, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, known_cost_micro_usd: null, has_unpriced: 1, session_count: 1 },
    ]);
    jest.spyOn(repository, 'getWorkspaceSessionCount').mockResolvedValue(2);
    jest.spyOn(repository, 'getWorkspaceMessageCount').mockResolvedValue(3);
    jest.spyOn(repository, 'getWorkspaceTopSessions').mockResolvedValue([
      { session_id: 'session-a', title: 'Priced', provider_id: 'anthropic', model_id: 'claude', last_active_ms: today - 1, message_count: 2, known_cost_micro_usd: 2_000_000, has_unpriced: 0, input_tokens: 3, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 },
      { session_id: 'session-b', title: 'Unpriced', provider_id: 'openai', model_id: 'codex', last_active_ms: today, message_count: 1, known_cost_micro_usd: null, has_unpriced: 1, input_tokens: 4, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 },
    ]);
    const empty = { contributions: [], status: { sourceId: 'external', status: 'complete' as const } };
    jest.spyOn(CodexSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(OpenCodeSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(GrokSource.prototype, 'read').mockResolvedValue(empty);
    jest.spyOn(CliSessionSource.prototype, 'read').mockResolvedValue(empty);
    const service = new UsageAnalyticsService({ read: async () => { throw new Error('JSONL should not run'); } }, { price: async () => { throw new Error('not used'); } }, { warn: jest.fn() }, repository);
    const summary = await service.summarize({ range: 7 }, 'C:/workspace');
    expect(summary.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: yesterday, providerId: 'anthropic', costUsd: 2 }),
      expect.objectContaining({ day: current, providerId: 'openai', costUsd: null }),
    ]));
    expect(summary.sessionCount).toBe(2);
    expect(summary.messageCount).toBe(3);
    expect(summary.topSessions?.map((row) => row.sessionId)).toEqual(['session-a', 'session-b']);
    expect(summary.sources[0]).toMatchObject({ sourceId: 'claude-ledger', status: 'partial' });
    expect(summary.sources[0].reason).toContain(new Date(today).toISOString());
  });

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

