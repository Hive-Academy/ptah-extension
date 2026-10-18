/**
 * Specs for the `session:stats-live` wire parser (TASK_2026_626).
 *
 * Accept/reject table for the envelope the webview trusts before it hands the
 * snapshot to deep validation in chat-state.
 */
import { MESSAGE_TYPES, parseSessionStatsCache, parseSessionStatsLivePayload } from '../../../index';

describe('session:stats-live contract', () => {
  const sessionId = 'ffb0b9b0-0000-4000-8000-000000000001';

  function stats(overrides: Record<string, unknown> = {}) {
    return {
      sessionId,
      model: 'claude-sonnet-4-5',
      totalCost: 0.12,
      tokens: { input: 10, output: 20, cacheRead: 30, cacheCreation: 0 },
      messageCount: 2,
      status: 'ok',
      revision: 7,
      provisional: true,
      ...overrides,
    };
  }

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      sessionId,
      sessionStats: stats(),
      context: { model: 'claude-sonnet-4-5', contextTokens: 4200 },
      ...overrides,
    };
  }

  it('registers the message type right after session:stats', () => {
    expect(MESSAGE_TYPES.SESSION_STATS_LIVE).toBe('session:stats-live');
  });

  describe('accepts', () => {
    it.each(['1h', '5m'] as const)('keeps valid %s cache metadata', (ttl) => {
      const cache = { ttl, lastRequestAt: 100, expiresAt: ttl === '1h' ? 3_600_100 : 300_100, idleCompactAt: 200 };
      expect(parseSessionStatsCache(cache)).toEqual(cache);
      expect(parseSessionStatsLivePayload(payload({ sessionStats: stats({ cache }) }))?.sessionStats.cache).toEqual(cache);
    });

    it('keeps old snapshots without cache', () => {
      expect(parseSessionStatsLivePayload(payload())?.sessionStats.cache).toBeUndefined();
    });
    it('a provisional snapshot with a valid context', () => {
      const input = payload();
      const parsed = parseSessionStatsLivePayload(input);
      expect(parsed).toEqual({
        sessionId,
        sessionStats: input.sessionStats,
        context: { model: 'claude-sonnet-4-5', contextTokens: 4200 },
      });
    });

    it('a snapshot with no provisional field (authoritative)', () => {
      const sessionStats = stats();
      delete (sessionStats as Record<string, unknown>)['provisional'];
      const parsed = parseSessionStatsLivePayload(
        payload({ sessionStats, context: undefined }),
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.sessionStats.provisional).toBeUndefined();
    });

    it('a provisional snapshot without context, with no context key', () => {
      const input = payload();
      delete (input as Record<string, unknown>)['context'];
      const parsed = parseSessionStatsLivePayload(input);
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty('context');
    });

    it('a zero contextTokens context', () => {
      const parsed = parseSessionStatsLivePayload(
        payload({ context: { model: 'm', contextTokens: 0 } }),
      );
      expect(parsed?.context).toEqual({ model: 'm', contextTokens: 0 });
    });
  });

  describe('rejects', () => {
    it.each([
      null, [], 'cache', {},
      { ttl: '2h', lastRequestAt: 0, expiresAt: 1 },
      { ttl: '1h', lastRequestAt: Number.NaN, expiresAt: 1 },
      { ttl: '1h', lastRequestAt: -1, expiresAt: 1 },
      { ttl: '1h', lastRequestAt: 0, expiresAt: Number.POSITIVE_INFINITY },
      { ttl: '1h', lastRequestAt: 2, expiresAt: 1 },
      { ttl: '1h', lastRequestAt: 100, expiresAt: 300_100 },
      { ttl: '5m', lastRequestAt: 100, expiresAt: 300_101 },
      { ttl: '5m', lastRequestAt: 100, expiresAt: 300_100, idleCompactAt: 99 },
      { ttl: '1h', lastRequestAt: 0, expiresAt: 1, idleCompactAt: 'soon' },
    ])('drops only malformed cache %p', (cache) => {
      const parsed = parseSessionStatsLivePayload(payload({ sessionStats: stats({ cache }) }));
      expect(parsed?.sessionStats).not.toHaveProperty('cache');
      expect(parsed?.sessionStats.tokens.input).toBe(10);
    });
    it.each([
      ['provisional: false', { provisional: false }],
      ["provisional: 'yes'", { provisional: 'yes' }],
      ['provisional: null', { provisional: null }],
      ['missing revision', { revision: undefined }],
      ['NaN revision', { revision: Number.NaN }],
      ['Infinity revision', { revision: Number.POSITIVE_INFINITY }],
      ['string revision', { revision: '7' }],
    ])('%s', (_label, override) => {
      expect(
        parseSessionStatsLivePayload(payload({ sessionStats: stats(override) })),
      ).toBeNull();
    });

    it.each([
      ['empty sessionId', { sessionId: '' }],
      ['non-string sessionId', { sessionId: 42 }],
      ['missing sessionId', { sessionId: undefined }],
      ['null sessionStats', { sessionStats: null }],
      ['array sessionStats', { sessionStats: [] }],
      ['string sessionStats', { sessionStats: 'stats' }],
    ])('%s', (_label, override) => {
      expect(parseSessionStatsLivePayload(payload(override))).toBeNull();
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['string', 'session:stats-live'],
      ['number', 1],
      ['array', []],
    ])('non-object payload: %s', (_label, input) => {
      expect(parseSessionStatsLivePayload(input)).toBeNull();
    });
  });

  describe('drops only the context', () => {
    it.each([
      ['non-object context', 'ctx'],
      ['empty model', { model: '', contextTokens: 10 }],
      ['non-string model', { model: 3, contextTokens: 10 }],
      ['negative contextTokens', { model: 'm', contextTokens: -1 }],
      ['NaN contextTokens', { model: 'm', contextTokens: Number.NaN }],
      [
        'Infinity contextTokens',
        { model: 'm', contextTokens: Number.POSITIVE_INFINITY },
      ],
      ['missing contextTokens', { model: 'm' }],
    ])('bad context (%s) on a provisional snapshot', (_label, context) => {
      const parsed = parseSessionStatsLivePayload(payload({ context }));
      expect(parsed).not.toBeNull();
      expect(parsed?.sessionId).toBe(sessionId);
      expect(parsed).not.toHaveProperty('context');
    });

    it('a valid context on a non-provisional snapshot', () => {
      const sessionStats = stats();
      delete (sessionStats as Record<string, unknown>)['provisional'];
      const parsed = parseSessionStatsLivePayload(
        payload({
          sessionStats,
          context: { model: 'claude-sonnet-4-5', contextTokens: 4200 },
        }),
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.sessionStats).toBe(sessionStats);
      expect(parsed).not.toHaveProperty('context');
    });
  });

  // S14 (TASK_2026_627): absent = no change, null = clear, a value = set.
  describe('liveBudgetStage', () => {
    it.each([
      ['handoff', 'handoff'],
      ['limit', 'limit'],
      ['null (clear)', null],
    ])('keeps %s on a provisional snapshot', (_label, liveBudgetStage) => {
      const input = payload({ liveBudgetStage });
      const parsed = parseSessionStatsLivePayload(input);
      expect(parsed).toEqual({
        sessionId,
        sessionStats: input.sessionStats,
        context: { model: 'claude-sonnet-4-5', contextTokens: 4200 },
        liveBudgetStage,
      });
    });

    it('keeps the stage when the context is dropped', () => {
      const parsed = parseSessionStatsLivePayload(
        payload({ context: 'ctx', liveBudgetStage: 'limit' }),
      );
      expect(parsed).not.toHaveProperty('context');
      expect(parsed?.liveBudgetStage).toBe('limit');
    });

    it('has no key when the field is absent (no change)', () => {
      const parsed = parseSessionStatsLivePayload(payload());
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty('liveBudgetStage');
    });

    it.each([
      ['undefined', undefined],
      ['unknown stage', 'warning'],
      ['ok stage', 'ok'],
      ['empty string', ''],
      ['uppercase', 'LIMIT'],
      ['number', 1],
      ['boolean', false],
      ['object', { stage: 'limit' }],
    ])(
      'drops only the field for %s on a provisional snapshot',
      (_label, liveBudgetStage) => {
        const input = payload({ liveBudgetStage });
        const parsed = parseSessionStatsLivePayload(input);
        expect(parsed).not.toBeNull();
        expect(parsed?.sessionStats).toBe(input.sessionStats);
        expect(parsed?.context).toEqual({
          model: 'claude-sonnet-4-5',
          contextTokens: 4200,
        });
        expect(parsed).not.toHaveProperty('liveBudgetStage');
      },
    );

    it.each([
      ['handoff', 'handoff'],
      ['limit', 'limit'],
      ['null', null],
    ])(
      'drops %s on a non-provisional snapshot and keeps the payload',
      (_label, liveBudgetStage) => {
        const sessionStats = stats();
        delete (sessionStats as Record<string, unknown>)['provisional'];
        const parsed = parseSessionStatsLivePayload(
          payload({ sessionStats, liveBudgetStage }),
        );
        expect(parsed).toEqual({ sessionId, sessionStats });
        expect(parsed).not.toHaveProperty('liveBudgetStage');
      },
    );

    it('does not rescue a rejected envelope', () => {
      expect(
        parseSessionStatsLivePayload(
          payload({
            sessionStats: stats({ provisional: false }),
            liveBudgetStage: 'limit',
          }),
        ),
      ).toBeNull();
    });
  });
});
