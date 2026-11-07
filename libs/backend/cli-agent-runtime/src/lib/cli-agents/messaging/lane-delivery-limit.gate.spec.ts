import {
  AgentId,
  type AgentProcessInfo,
  type LaneStateReason,
  type PlanLimitWindow,
  type PlanWindowKey,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { LaneLimitResult } from '../limits/lane-limit-lookup.service';
import {
  LANE_LIMIT_GATE_DEADLINE_MS,
  LANE_LIMIT_RESET_RETRY_DELAY_MS,
  LaneDeliveryLimitGate,
  planLimitRetry,
  type LaneDeliveryLimitLookup,
} from './lane-delivery-limit.gate';

const OWNER: QuotaOwnerRef = {
  providerId: 'anthropic',
  identityKind: 'account',
  key: 'anthropic#account:1111111111111111',
  label: 'Claude Account',
};

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

function makeLogger(): jest.Mocked<Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>> & Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as jest.Mocked<Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>> & Logger;
}

function makeInfo(overrides: Partial<AgentProcessInfo> = {}): AgentProcessInfo {
  return {
    agentId: AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000001'),
    cli: 'claude',
    role: 'backend-developer',
    task: 'implement limit gate',
    workingDirectory: '/workspace',
    status: 'stopped',
    startedAt: new Date(NOW - 10_000).toISOString(),
    ...overrides,
  };
}

function makeWindow(key: PlanWindowKey, resetsAt?: number): PlanLimitWindow {
  return {
    key,
    kind: key === 'weekly' ? 'weekly' : 'five_hour',
    label: key,
    observedAt: NOW,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

function windowLimitReason(key: PlanWindowKey, resetsAt?: number): LaneStateReason {
  const window = makeWindow(key, resetsAt);
  return {
    kind: 'window-limit',
    window,
    evidence: {
      source: 'provider-api',
      observedAt: NOW,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    },
  };
}

function lookupResult(
  state: LaneLimitResult<AgentProcessInfo>['state']['state'],
  reasons: readonly LaneStateReason[] = [],
  lookup: LaneLimitResult<AgentProcessInfo>['lookup'] = 'ok',
): LaneLimitResult<AgentProcessInfo> {
  return {
    row: makeInfo(),
    owner: lookup === 'no-owner' ? undefined : OWNER,
    lookup,
    state: {
      state,
      reasons,
      windows: [],
    },
  };
}

describe('LaneDeliveryLimitGate', () => {
  describe('Source 1: lane stopReason === usage-limit', () => {
    it('blocks immediately using stopResetAt when stopResetAt is in the future without calling lookup', async () => {
      const lookup: jest.Mocked<LaneDeliveryLimitLookup> = {
        lookup: jest.fn(),
      };
      const gate = new LaneDeliveryLimitGate(lookup, makeLogger(), LANE_LIMIT_GATE_DEADLINE_MS, () => NOW);
      const info = makeInfo({
        stopReason: 'usage-limit',
        stopResetAt: NOW + 300_000,
      });

      const decision = await gate.check(info);

      expect(decision).toEqual({
        kind: 'blocked',
        limitKnown: true,
        resetAt: NOW + 300_000,
      });
      expect(lookup.lookup).not.toHaveBeenCalled();
    });

    it('treats elapsed stopResetAt evidence as historical and consults lookup so a reset retry can proceed', async () => {
      let currentNow = NOW;
      const resetAt = NOW + 120_000;
      const lookup: jest.Mocked<LaneDeliveryLimitLookup> = {
        lookup: jest
          .fn()
          .mockResolvedValueOnce([lookupResult('confirmed-room')])
          .mockResolvedValueOnce([
            lookupResult('at-limit', [windowLimitReason('five_hour', resetAt + 300_000)]),
          ]),
      };
      const gate = new LaneDeliveryLimitGate(
        lookup,
        makeLogger(),
        LANE_LIMIT_GATE_DEADLINE_MS,
        () => currentNow,
      );
      const info = makeInfo({
        stopReason: 'usage-limit',
        stopResetAt: resetAt,
      });

      // Before reset: blocks from stopResetAt without calling lookup.
      await expect(gate.check(info)).resolves.toEqual({
        kind: 'blocked',
        limitKnown: true,
        resetAt,
      });
      expect(lookup.lookup).not.toHaveBeenCalled();

      // At/after reset: stopResetAt is historical; lookup says confirmed-room -> proceed.
      currentNow = resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS;
      await expect(gate.check(info)).resolves.toEqual({ kind: 'proceed' });
      expect(lookup.lookup).toHaveBeenCalledTimes(1);

      // If lookup independently reports at-limit after reset, blocks with the lookup's resetAt.
      await expect(gate.check(info)).resolves.toEqual({
        kind: 'blocked',
        limitKnown: true,
        resetAt: resetAt + 300_000,
      });
      expect(lookup.lookup).toHaveBeenCalledTimes(2);
    });

    it('blocks with no resetAt when stopReason is usage-limit and stopResetAt is absent', async () => {
      const gate = new LaneDeliveryLimitGate(null, makeLogger(), LANE_LIMIT_GATE_DEADLINE_MS, () => NOW);
      const info = makeInfo({
        stopReason: 'usage-limit',
      });

      const decision = await gate.check(info);

      expect(decision).toEqual({
        kind: 'blocked',
        limitKnown: true,
      });
      expect('resetAt' in decision).toBe(false);
    });
  });

  describe('Source 2: LaneLimitLookupService', () => {
    it('blocks when a known limit window is at-limit and picks the earliest window.resetsAt', async () => {
      const lookup: jest.Mocked<LaneDeliveryLimitLookup> = {
        lookup: jest.fn().mockResolvedValue([
          lookupResult('at-limit', [
            windowLimitReason('weekly', NOW + 600_000),
            windowLimitReason('five_hour', NOW + 120_000),
          ]),
        ]),
      };
      const gate = new LaneDeliveryLimitGate(lookup, makeLogger());
      const info = makeInfo();

      const decision = await gate.check(info);

      expect(lookup.lookup).toHaveBeenCalledWith([info], {
        deadlineMs: LANE_LIMIT_GATE_DEADLINE_MS,
      });
      expect(decision).toEqual({
        kind: 'blocked',
        limitKnown: true,
        resetAt: NOW + 120_000,
      });
    });

    it('never invents a resetAt when at-limit windows carry no reset timestamp', async () => {
      const lookup: jest.Mocked<LaneDeliveryLimitLookup> = {
        lookup: jest.fn().mockResolvedValue([
          lookupResult('at-limit', [windowLimitReason('five_hour', undefined)]),
        ]),
      };
      const gate = new LaneDeliveryLimitGate(lookup, makeLogger());

      const decision = await gate.check(makeInfo());

      expect(decision).toEqual({
        kind: 'blocked',
        limitKnown: true,
      });
      expect('resetAt' in decision).toBe(false);
    });

    it('falls back to owner-limit evidence resetsAt when no window-limit reason has one', async () => {
      const lookup: jest.Mocked<LaneDeliveryLimitLookup> = {
        lookup: jest.fn().mockResolvedValue([
          lookupResult('at-limit', [
            {
              kind: 'owner-limit',
              evidence: {
                source: 'error-derived',
                observedAt: NOW,
                resetsAt: NOW + 90_000,
              },
            },
          ]),
        ]),
      };
      const gate = new LaneDeliveryLimitGate(lookup, makeLogger());

      const decision = await gate.check(makeInfo());

      expect(decision).toEqual({
        kind: 'blocked',
        limitKnown: true,
        resetAt: NOW + 90_000,
      });
    });
  });

  describe('Source 3: non-blocking outcomes', () => {
    it.each([
      ['no-owner', lookupResult('unknown', [], 'no-owner')],
      ['unknown state', lookupResult('unknown')],
      ['near-limit state', lookupResult('near-limit')],
      ['confirmed-room state', lookupResult('confirmed-room')],
    ])('proceeds when lookup reports %s', async (_label, result) => {
      const lookup: jest.Mocked<LaneDeliveryLimitLookup> = {
        lookup: jest.fn().mockResolvedValue([result]),
      };
      const gate = new LaneDeliveryLimitGate(lookup, makeLogger());

      await expect(gate.check(makeInfo())).resolves.toEqual({ kind: 'proceed' });
    });

    it('proceeds and logs at debug when lookup times out or fails', async () => {
      const logger = makeLogger();
      const lookup: jest.Mocked<LaneDeliveryLimitLookup> = {
        lookup: jest
          .fn()
          .mockResolvedValueOnce([lookupResult('unknown', [], 'timeout')])
          .mockResolvedValueOnce([lookupResult('unknown', [], 'failed')])
          .mockRejectedValueOnce(new Error('unexpected failure')),
      };
      const gate = new LaneDeliveryLimitGate(lookup, logger);

      await expect(gate.check(makeInfo())).resolves.toEqual({ kind: 'proceed' });
      await expect(gate.check(makeInfo())).resolves.toEqual({ kind: 'proceed' });
      await expect(gate.check(makeInfo())).resolves.toEqual({ kind: 'proceed' });
      expect(logger.debug).toHaveBeenCalledTimes(3);
    });

    it('proceeds when LaneLimitLookupService is not registered', async () => {
      const gate = new LaneDeliveryLimitGate(null, makeLogger());

      await expect(gate.check(makeInfo())).resolves.toEqual({ kind: 'proceed' });
    });
  });

  describe('planLimitRetry', () => {
    it('schedules one retry at resetAt + 60_000 on the first limit hit with known resetAt', () => {
      expect(planLimitRetry(undefined, NOW + 100_000)).toEqual({
        limit: { known: true, resetAt: NOW + 100_000 },
        nextRetryAt: NOW + 100_000 + LANE_LIMIT_RESET_RETRY_DELAY_MS,
      });
    });

    it('leaves nextRetryAt undefined when resetAt is unknown', () => {
      const planned = planLimitRetry(undefined, undefined);
      expect(planned).toEqual({
        limit: { known: true },
      });
      expect(planned.nextRetryAt).toBeUndefined();
    });

    it('makes a second hit with the same or no new resetAt manual (no tight loop)', () => {
      const first = planLimitRetry(undefined, NOW + 100_000);

      const sameReset = planLimitRetry(first.limit, NOW + 100_000);
      expect(sameReset).toEqual({
        limit: { known: true, resetAt: NOW + 100_000 },
      });
      expect(sameReset.nextRetryAt).toBeUndefined();

      const noReset = planLimitRetry(first.limit, undefined);
      expect(noReset).toEqual({
        limit: { known: true },
      });
      expect(noReset.nextRetryAt).toBeUndefined();

      const nextWindow = planLimitRetry(first.limit, NOW + 200_000);
      expect(nextWindow).toEqual({
        limit: { known: true, resetAt: NOW + 200_000 },
        nextRetryAt: NOW + 200_000 + LANE_LIMIT_RESET_RETRY_DELAY_MS,
      });
    });
  });
});
