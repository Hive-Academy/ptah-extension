import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import type { ClaudePlanUsage } from '@ptah-extension/agent-sdk';
import { PlanUsageService, PLAN_USAGE_MAX_OWNERS } from './plan-usage.service';
import {
  claudeAccountOwnerKey,
  quotaOwnerRefFromKey,
  unknownOwnerKey,
} from './provider-owner.resolver';
import type { PlanOwnerTarget } from './readers/plan-usage-reader.types';

const account = { email: 'a@example.test', organization: 'org' };
const usage: ClaudePlanUsage = {
  session: {
    total_cost_usd: 0,
    total_api_duration_ms: 0,
    total_duration_ms: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    model_usage: {},
  },
  behaviors: null,
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 42, resets_at: null } },
};
function target(fingerprint = 'one', authEpoch = 1): PlanOwnerTarget {
  return {
    providerId: 'anthropic',
    ownerRef: quotaOwnerRefFromKey(claudeAccountOwnerKey(account)!),
    sessionHandle: { kind: 'session', sessionId: fingerprint },
    claudeRoute: {
      kind: 'named',
      provider: 'claude',
      profileId: fingerprint,
      canonicalConfigDir: `/private/${fingerprint}`,
      routeFingerprint: fingerprint,
      routeRevision: 1,
      authEpoch,
      runId: 'run',
    } as ClaudeAccountNamedRoute,
  };
}
function harness() {
  const readAccountForRoute = jest
    .fn()
    .mockResolvedValue({ status: 'available', value: account });
  const readPlanUsageForRoute = jest
    .fn()
    .mockResolvedValue({ status: 'available', value: usage });
  const readPlanUsage = jest.fn().mockResolvedValue(usage);
  const recordWindowEvidence = jest.fn();
  const logger: Pick<Logger, 'debug' | 'warn'> = createMockLogger();
  const service = new PlanUsageService(
    logger as Logger,
    { snapshotFor: () => undefined, recordWindowEvidence },
    { resolve: jest.fn() },
    { readAccountForRoute, readPlanUsageForRoute, readPlanUsage },
    { getAccountUsage: jest.fn() },
  );
  return {
    service,
    readAccountForRoute,
    readPlanUsageForRoute,
    readPlanUsage,
    recordWindowEvidence,
  };
}

describe('Claude owner cache and source handles', () => {
  it('shares same-owner stale windows across directories only after current proof', async () => {
    const { service, readPlanUsageForRoute, recordWindowEvidence } = harness();
    expect((await service.getOwnerSnapshot(target())).status).toBe('available');
    readPlanUsageForRoute.mockResolvedValue({
      status: 'unavailable',
      code: 'service-unavailable',
    });
    const stale = await service.getOwnerSnapshot(target('two'));
    expect(stale.status).toBe('stale');
    expect(recordWindowEvidence).toHaveBeenLastCalledWith(
      target().ownerRef,
      expect.objectContaining({ key: 'five_hour' }),
      { stale: true },
    );
    expect(JSON.stringify(stale)).not.toMatch(
      /private|example|canonicalConfigDir|claudeRoute/,
    );
  });

  it.each(['stale-epoch', 'account-mismatch', 'no-open-session'])(
    'discards %s without stale fallback',
    async (code) => {
      const { service, readPlanUsageForRoute, recordWindowEvidence } = harness();
      await service.getOwnerSnapshot(target());
      recordWindowEvidence.mockClear();
      readPlanUsageForRoute.mockResolvedValue({ status: 'unavailable', code });
      expect((await service.getOwnerSnapshot(target())).status).toBe(
        'service-unavailable',
      );
      expect(recordWindowEvidence).not.toHaveBeenCalled();
    },
  );

  it('rejects changed identity after a delayed usage read', async () => {
    const { service, readAccountForRoute, readPlanUsageForRoute, recordWindowEvidence } =
      harness();
    let finish!: (value: {
      status: 'available';
      value: ClaudePlanUsage;
    }) => void;
    readPlanUsageForRoute.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = service.getOwnerSnapshot(target());
    await Promise.resolve();
    readAccountForRoute.mockResolvedValue({
      status: 'available',
      value: { email: 'other' },
    });
    finish({ status: 'available', value: usage });
    expect((await pending).status).toBe('service-unavailable');
    expect(recordWindowEvidence).not.toHaveBeenCalled();
  });

  it('does not join a different source or epoch for the same owner', async () => {
    const { service, readPlanUsageForRoute } = harness();
    await Promise.all([
      service.getOwnerSnapshot(target()),
      service.getOwnerSnapshot(target('two')),
      service.getOwnerSnapshot(target('one', 2)),
    ]);
    expect(readPlanUsageForRoute).toHaveBeenCalledTimes(3);
  });

  it('keeps unknown owners unavailable and never chooses an unrelated query', async () => {
    const { service, readPlanUsageForRoute } = harness();
    const unknown = {
      ...target(),
      ownerRef: quotaOwnerRefFromKey(unknownOwnerKey('anthropic', 'run')),
    };
    expect((await service.getOwnerSnapshot(unknown)).status).toBe(
      'service-unavailable',
    );
    const missing = await service.getOwnerSnapshot({
      ...target(),
      sessionHandle: undefined,
    });
    expect(missing.unavailableReason).toBe('no-open-session');
    expect(readPlanUsageForRoute).not.toHaveBeenCalled();
  });

  it('retains ambient selection and its cached reading', async () => {
    const { service, readPlanUsage } = harness();
    readPlanUsage.mockResolvedValue(usage);
    const ambient = { ...target(), claudeRoute: undefined };
    await service.getOwnerSnapshot(ambient);
    await service.getOwnerSnapshot(ambient);
    expect(readPlanUsage).toHaveBeenCalledTimes(1);
    expect(readPlanUsage).toHaveBeenCalledWith('one');
  });

  it('discards late success after disposal and releases its cache', async () => {
    const { service, readPlanUsageForRoute, recordWindowEvidence } = harness();
    let finish!: (value: {
      status: 'available';
      value: ClaudePlanUsage;
    }) => void;
    readPlanUsageForRoute.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = service.getOwnerSnapshot(target());
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await Promise.resolve();
    service.dispose();
    finish({ status: 'available', value: usage });
    await rejected;
    expect(recordWindowEvidence).not.toHaveBeenCalled();
    await expect(service.getOwnerSnapshot(target())).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('bounds settled owner entries after concurrent reads finish', async () => {
    const { service, readPlanUsage } = harness();
    readPlanUsage.mockResolvedValue(usage);
    const targets = Array.from(
      { length: PLAN_USAGE_MAX_OWNERS + 1 },
      (_, index) => ({
        ...target(),
        claudeRoute: undefined,
        ownerRef: quotaOwnerRefFromKey(
          claudeAccountOwnerKey({ email: String(index) })!,
        ),
      }),
    );
    await Promise.all(targets.map((entry) => service.getOwnerSnapshot(entry)));
    const calls = readPlanUsage.mock.calls.length;
    await service.getOwnerSnapshot(targets[0]);
    expect(readPlanUsage).toHaveBeenCalledTimes(calls + 1);
  });
});
