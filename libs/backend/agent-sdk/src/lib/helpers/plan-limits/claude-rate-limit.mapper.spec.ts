import type {
  SDKAPIRetryMessage,
  SDKAssistantMessage,
  SDKMessage,
  SDKRateLimitInfo,
} from '../../types/sdk-types/claude-sdk.types';
import {
  billingFromRateLimitInfo,
  claudeModelFamily,
  mapClaudeApiRetry,
  mapClaudeAssistantRateLimit,
  mapClaudePlanLimitMessage,
  mapClaudeRateLimitInfo,
  opensClaudeTurn,
} from './claude-rate-limit.mapper';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const RESET_SECONDS = Math.floor(Date.UTC(2026, 9, 6, 0, 0, 0) / 1000);

function rateLimitEvent(info: SDKRateLimitInfo): SDKMessage {
  return {
    type: 'rate_limit_event',
    rate_limit_info: info,
    uuid: 'u-1',
    session_id: 's-1',
  } as unknown as SDKMessage;
}

function apiRetry(
  overrides: Partial<SDKAPIRetryMessage> = {},
): SDKAPIRetryMessage {
  return {
    type: 'system',
    subtype: 'api_retry',
    attempt: 1,
    max_retries: 10,
    retry_delay_ms: 30_000,
    error_status: 429,
    error: 'rate_limit',
    uuid: 'u-2',
    session_id: 's-1',
    ...overrides,
  } as SDKAPIRetryMessage;
}

function assistant(error?: string): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: { id: 'm', content: [] },
    parent_tool_use_id: null,
    ...(error !== undefined && { error }),
    uuid: 'u-3',
    session_id: 's-1',
  } as unknown as SDKAssistantMessage;
}

describe('claude-rate-limit.mapper', () => {
  describe('mapClaudeRateLimitInfo', () => {
    it('F13: seven_day_opus rejected → weekly_model:opus exhausted, reset normalised to ms', () => {
      const { evidence } = mapClaudeRateLimitInfo(
        {
          status: 'rejected',
          rateLimitType: 'seven_day_opus',
          resetsAt: RESET_SECONDS,
        },
        NOW,
      );
      expect(evidence).toEqual({
        kind: 'window',
        windowKey: 'weekly_model:opus',
        modelScope: 'opus',
        status: 'rejected',
        exhausted: true,
        resetsAt: RESET_SECONDS * 1000,
        source: 'stream-event',
        observedAt: NOW,
      });
    });

    it('F13: names only its own window; other windows are untouched', () => {
      const { evidence } = mapClaudeRateLimitInfo(
        { status: 'rejected', rateLimitType: 'seven_day_opus' },
        NOW,
      );
      // One window evidence for one window — nothing for five_hour / weekly / sonnet.
      expect(evidence?.kind).toBe('window');
      expect(evidence && 'windowKey' in evidence && evidence.windowKey).toBe(
        'weekly_model:opus',
      );
    });

    it.each([
      ['five_hour', 'five_hour', undefined],
      ['seven_day', 'weekly', undefined],
      ['seven_day_opus', 'weekly_model:opus', 'opus'],
      ['seven_day_sonnet', 'weekly_model:sonnet', 'sonnet'],
      ['seven_day_overage_included', 'overage', undefined],
      ['overage', 'overage', undefined],
    ] as const)('maps %s → %s', (rateLimitType, windowKey, modelScope) => {
      const { evidence } = mapClaudeRateLimitInfo(
        { status: 'allowed', rateLimitType },
        NOW,
      );
      expect(evidence).toMatchObject({ kind: 'window', windowKey });
      expect(evidence && 'modelScope' in evidence && evidence.modelScope).toBe(
        modelScope ?? false,
      );
    });

    it('F14: allowed and allowed_warning give no exhaustion', () => {
      for (const status of ['allowed', 'allowed_warning'] as const) {
        const { evidence } = mapClaudeRateLimitInfo(
          { status, rateLimitType: 'five_hour', resetsAt: RESET_SECONDS },
          NOW,
        );
        expect(evidence).toMatchObject({
          kind: 'window',
          exhausted: false,
          status,
        });
      }
    });

    it.each([0.82, 82, 1])(
      'F13a: utilization %p is never ingested — no used value on the evidence',
      (utilization) => {
        const { evidence } = mapClaudeRateLimitInfo(
          {
            status: 'allowed_warning',
            rateLimitType: 'five_hour',
            resetsAt: RESET_SECONDS,
            utilization,
            surpassedThreshold: 0.8,
          },
          NOW,
        );
        expect(evidence).toEqual({
          kind: 'window',
          windowKey: 'five_hour',
          status: 'allowed_warning',
          exhausted: false,
          resetsAt: RESET_SECONDS * 1000,
          source: 'stream-event',
          observedAt: NOW,
        });
        expect(evidence).not.toHaveProperty('used');
        expect(evidence).not.toHaveProperty('utilization');
      },
    );

    it('rejected with no window type → owner-level evidence keeping the stated reset', () => {
      expect(
        mapClaudeRateLimitInfo(
          { status: 'rejected', resetsAt: RESET_SECONDS },
          NOW,
        ).evidence,
      ).toEqual({
        kind: 'owner',
        cause: 'rejected-unknown-window',
        source: 'stream-event',
        observedAt: NOW,
        resetsAt: RESET_SECONDS * 1000,
      });
    });

    it('an unknown future window type that is allowed yields no evidence', () => {
      const info = {
        status: 'allowed',
        rateLimitType: 'thirty_day',
      } as unknown as SDKRateLimitInfo;
      expect(mapClaudeRateLimitInfo(info, NOW)).toEqual({
        billing: 'plan',
        evidence: null,
      });
    });

    it('an unparseable reset is left absent, never invented', () => {
      const info = {
        status: 'rejected',
        rateLimitType: 'five_hour',
        resetsAt: Number.NaN,
      } as SDKRateLimitInfo;
      const { evidence } = mapClaudeRateLimitInfo(info, NOW);
      expect(evidence).not.toHaveProperty('resetsAt');
    });
  });

  describe('billingFromRateLimitInfo (Decision 4, S1)', () => {
    it('either overage flag → overage', () => {
      expect(
        billingFromRateLimitInfo({ status: 'allowed', isUsingOverage: true }),
      ).toBe('overage');
      expect(
        billingFromRateLimitInfo({ status: 'allowed', overageInUse: true }),
      ).toBe('overage');
      expect(
        billingFromRateLimitInfo({ status: 'rejected', overageInUse: true }),
      ).toBe('overage');
    });

    it('no overage and not rejected → plan', () => {
      expect(billingFromRateLimitInfo({ status: 'allowed' })).toBe('plan');
      expect(
        billingFromRateLimitInfo({
          status: 'allowed_warning',
          isUsingOverage: false,
          overageInUse: false,
        }),
      ).toBe('plan');
    });

    it('rejected without overage → unknown', () => {
      expect(billingFromRateLimitInfo({ status: 'rejected' })).toBe('unknown');
    });
  });

  describe('mapClaudeApiRetry', () => {
    it('F15: 429 → owner-level evidence; retry_delay_ms is a cooldown, never a reset', () => {
      const evidence = mapClaudeApiRetry(
        apiRetry({ error: 'server_error', error_status: 429 }),
        NOW,
      );
      expect(evidence).toEqual({
        kind: 'owner',
        cause: 'api-retry',
        source: 'error-derived',
        observedAt: NOW,
        cooldown: {
          until: NOW + 30_000,
          observedAt: NOW,
          rawUntil: NOW + 30_000,
        },
      });
      expect(evidence).not.toHaveProperty('resetsAt');
    });

    it('error rate_limit without a status is still owner-level evidence', () => {
      expect(
        mapClaudeApiRetry(apiRetry({ error_status: null }), NOW),
      ).toMatchObject({ kind: 'owner', cause: 'api-retry' });
    });

    it('a negative or non-finite delay gives no cooldown', () => {
      for (const retry_delay_ms of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          mapClaudeApiRetry(apiRetry({ retry_delay_ms }), NOW),
        ).not.toHaveProperty('cooldown');
      }
    });

    it('a retry for another cause is not limit evidence', () => {
      expect(
        mapClaudeApiRetry(
          apiRetry({ error: 'overloaded', error_status: 529 }),
          NOW,
        ),
      ).toBeNull();
    });
  });

  describe('mapClaudeAssistantRateLimit', () => {
    it('F16: assistant error rate_limit → owner level, no window, no reset', () => {
      expect(mapClaudeAssistantRateLimit(assistant('rate_limit'), NOW)).toEqual(
        {
          kind: 'owner',
          cause: 'assistant-rate-limit',
          source: 'error-derived',
          observedAt: NOW,
        },
      );
    });

    it('other assistant errors and plain assistants are not limit evidence', () => {
      expect(
        mapClaudeAssistantRateLimit(assistant('authentication_failed'), NOW),
      ).toBeNull();
      expect(mapClaudeAssistantRateLimit(assistant(), NOW)).toBeNull();
    });
  });

  describe('mapClaudePlanLimitMessage', () => {
    it('dispatches the three limit message kinds', () => {
      expect(
        mapClaudePlanLimitMessage(
          rateLimitEvent({ status: 'allowed', isUsingOverage: true }),
          NOW,
        ),
      ).toEqual({ billing: 'overage', evidence: null });
      expect(
        mapClaudePlanLimitMessage(apiRetry() as unknown as SDKMessage, NOW)
          ?.evidence,
      ).toMatchObject({ cause: 'api-retry' });
      expect(
        mapClaudePlanLimitMessage(
          assistant('rate_limit') as unknown as SDKMessage,
          NOW,
        ),
      ).toEqual({
        evidence: expect.objectContaining({ cause: 'assistant-rate-limit' }),
      });
    });

    it('returns null for every other message', () => {
      expect(
        mapClaudePlanLimitMessage(assistant() as unknown as SDKMessage, NOW),
      ).toBeNull();
      expect(
        mapClaudePlanLimitMessage(
          apiRetry({
            error: 'server_error',
            error_status: 500,
          }) as unknown as SDKMessage,
          NOW,
        ),
      ).toBeNull();
      expect(
        mapClaudePlanLimitMessage(
          { type: 'system', subtype: 'init' } as unknown as SDKMessage,
          NOW,
        ),
      ).toBeNull();
    });
  });

  describe('claudeModelFamily', () => {
    it.each([
      ['claude-opus-4-5-20251101', 'opus'],
      ['claude-opus-5[1m]', 'opus'],
      ['claude-sonnet-4-20250514', 'sonnet'],
      ['claude-3-5-sonnet-latest', 'sonnet'],
      ['Claude-Haiku-4-5', 'haiku'],
      ['gpt-5-codex', undefined],
      ['', undefined],
      [null, undefined],
    ])('%p → %p', (model, family) => {
      expect(claudeModelFamily(model)).toBe(family);
    });
  });

  describe('opensClaudeTurn', () => {
    const msg = (m: object): SDKMessage => m as unknown as SDKMessage;

    it('documented post-result trailers do not open a turn', () => {
      expect(opensClaudeTurn(msg({ type: 'result', subtype: 'success' }))).toBe(
        false,
      );
      expect(opensClaudeTurn(msg({ type: 'prompt_suggestion' }))).toBe(false);
      expect(
        opensClaudeTurn(msg({ type: 'system', subtype: 'task_notification' })),
      ).toBe(false);
      expect(
        opensClaudeTurn(
          msg({
            type: 'system',
            subtype: 'session_state_changed',
            state: 'idle',
          }),
        ),
      ).toBe(false);
    });

    it('turn activity opens a turn', () => {
      expect(
        opensClaudeTurn(
          msg({
            type: 'system',
            subtype: 'session_state_changed',
            state: 'running',
          }),
        ),
      ).toBe(true);
      expect(opensClaudeTurn(msg({ type: 'stream_event' }))).toBe(true);
      expect(opensClaudeTurn(msg({ type: 'assistant' }))).toBe(true);
      expect(opensClaudeTurn(msg({ type: 'rate_limit_event' }))).toBe(true);
      expect(opensClaudeTurn(msg({ type: 'system', subtype: 'init' }))).toBe(
        true,
      );
    });
  });
});
