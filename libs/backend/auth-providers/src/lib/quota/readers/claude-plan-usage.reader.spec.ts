import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ClaudePlanUsage } from '@ptah-extension/agent-sdk';
import {
  quotaOwnerRefFromKey,
  accountOwnerKey,
} from '../provider-owner.resolver';
import {
  PlanUsageParseError,
  createClaudePlanUsageReader,
  mapClaudePlanUsage,
} from './claude-plan-usage.reader';
import type { PlanOwnerTarget } from './plan-usage-reader.types';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const OWNER = quotaOwnerRefFromKey(accountOwnerKey('anthropic', 'a@x\0org'));

function target(sessionId?: string): PlanOwnerTarget {
  return {
    providerId: 'anthropic',
    ownerRef: OWNER,
    ...(sessionId && { sessionHandle: { kind: 'session', sessionId } }),
  };
}

/** `SDKControlGetUsageResponse` (`sdk.d.ts:4012-4104`), a Max subscription. */
function fullUsage(): ClaudePlanUsage {
  return {
    session: {
      total_cost_usd: 0,
      total_api_duration_ms: 0,
      total_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      model_usage: {},
    },
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 42, resets_at: '2026-10-04T15:00:00Z' },
      seven_day: { utilization: 7, resets_at: '2026-10-09T00:00:00Z' },
      seven_day_opus: { utilization: 100, resets_at: '2026-10-09T00:00:00Z' },
      seven_day_sonnet: { utilization: null, resets_at: null },
      seven_day_oauth_apps: null,
      model_scoped: [
        { display_name: 'Fable', utilization: 12, resets_at: null },
        { display_name: 'Opus', utilization: 1, resets_at: null },
      ],
      extra_usage: {
        is_enabled: true,
        monthly_limit: 50,
        used_credits: 12.5,
        utilization: 25,
        currency: 'USD',
      },
    },
  } as ClaudePlanUsage;
}

function harness(usage: ClaudePlanUsage | null) {
  const logger = createMockLogger();
  const readPlanUsage = jest.fn(async () => usage);
  const reader = createClaudePlanUsageReader(
    { readPlanUsage },
    logger as unknown as Logger,
    () => NOW,
  );
  return { reader, readPlanUsage, logger };
}

describe('Claude plan-usage reader', () => {
  it('F26: maps the full /usage table with provider-api sources', async () => {
    const { reader, readPlanUsage } = harness(fullUsage());

    const reading = await reader({ target: target('s-1'), refresh: true });

    expect(readPlanUsage).toHaveBeenCalledWith('s-1');
    expect(reading.status).toBe('available');
    expect(reading.windowSetEstablished).toBe(true);
    expect(reading.fetchedAt).toBe(NOW);
    expect(reading.account).toEqual({ planType: 'max' });
    expect(reading.windows.map((w) => w.key)).toEqual([
      'five_hour',
      'weekly',
      'weekly_model:opus',
      'weekly_model:sonnet',
      'weekly_model:fable',
      'overage',
    ]);
    const fiveHour = reading.windows[0];
    expect(fiveHour).toEqual({
      key: 'five_hour',
      kind: 'five_hour',
      label: '5-hour session',
      durationMins: 300,
      used: { kind: 'percent', percent: 42 },
      usedSource: 'provider-api',
      usedObservedAt: NOW,
      resetsAt: Date.UTC(2026, 9, 4, 15, 0, 0),
      resetSource: 'provider-api',
      observedAt: NOW,
    });
    const opus = reading.windows[2];
    expect(opus.modelScope).toBe('opus');
    // The model_scoped "Opus" row repeats seven_day_opus; the first one wins.
    expect(opus.used).toEqual({ kind: 'percent', percent: 100 });
    expect(reading.windows[4]).toMatchObject({
      kind: 'weekly_model',
      label: 'Weekly · Fable',
      modelScope: 'fable',
    });
    expect(reading.windows[5]).toMatchObject({
      kind: 'overage',
      used: { kind: 'amount', amount: 12.5, limit: 50, unit: 'USD' },
      usedSource: 'provider-api',
    });
  });

  it('keeps an unknown utilization and reset unknown, never 0', async () => {
    const { reader } = harness(fullUsage());
    const reading = await reader({ target: target(), refresh: false });
    const sonnet = reading.windows.find((w) => w.key === 'weekly_model:sonnet');
    expect(sonnet).toBeDefined();
    expect(sonnet?.used).toBeUndefined();
    expect(sonnet?.resetsAt).toBeUndefined();
  });

  it('maps the OAuth-apps window to other and skips a disabled extra usage', () => {
    const usage = fullUsage();
    const limits = usage.rate_limits as NonNullable<
      ClaudePlanUsage['rate_limits']
    >;
    const reading = mapClaudePlanUsage(
      {
        ...usage,
        rate_limits: {
          ...limits,
          seven_day_oauth_apps: { utilization: 3, resets_at: null },
          extra_usage: {
            is_enabled: false,
            monthly_limit: null,
            used_credits: null,
            utilization: null,
          },
        },
      },
      NOW,
      createMockLogger() as unknown as Logger,
    );
    expect(reading.windows.find((w) => w.kind === 'overage')).toBeUndefined();
    expect(
      reading.windows.find((w) => w.key === 'other:oauth_apps'),
    ).toMatchObject({
      kind: 'other',
      used: { kind: 'percent', percent: 3 },
    });
  });

  it('F27: with no open session (probe null) reports no-open-session and no windows', async () => {
    const { reader, readPlanUsage } = harness(null);

    const reading = await reader({ target: target(), refresh: false });

    expect(readPlanUsage).toHaveBeenCalledWith(undefined);
    expect(reading).toEqual({
      status: 'service-unavailable',
      unavailableReason: 'no-open-session',
      windowSetEstablished: false,
      windows: [],
    });
  });

  it('F28: an API-key session (rate limits unavailable) is unsupported-auth', async () => {
    const { reader } = harness({
      ...fullUsage(),
      subscription_type: null,
      rate_limits_available: false,
      rate_limits: null,
    });

    await expect(
      reader({ target: target('s-1'), refresh: false }),
    ).resolves.toEqual({
      status: 'unsupported-auth',
      windowSetEstablished: false,
      windows: [],
    });
  });

  it('Req 2.7: a malformed response logs only provider, field path and reason, then throws', async () => {
    const usage = fullUsage();
    const { reader, logger } = harness({
      ...usage,
      rate_limits: {
        ...(usage.rate_limits as object),
        five_hour: { utilization: 'secret-body-text', resets_at: null },
      },
    } as unknown as ClaudePlanUsage);

    await expect(
      reader({ target: target(), refresh: false }),
    ).rejects.toBeInstanceOf(PlanUsageParseError);
    expect(logger.warn).toHaveBeenCalledWith(
      '[PlanUsage] usage response rejected',
      {
        providerId: 'anthropic',
        fieldPath: 'rate_limits.five_hour.utilization',
        reason: 'invalid_type',
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'secret-body-text',
    );
  });

  it('treats available rate limits with a null table as a parse failure', async () => {
    const { reader } = harness({ ...fullUsage(), rate_limits: null });
    await expect(
      reader({ target: target(), refresh: false }),
    ).rejects.toMatchObject({ fieldPath: 'rate_limits' });
  });
});
