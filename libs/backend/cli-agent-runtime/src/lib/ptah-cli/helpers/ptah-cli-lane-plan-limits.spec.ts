/**
 * PtahCliLanePlanLimits (TASK_2026_596, Component 10; Decision 4 S2; Batch 11
 * carry-forward 1): the lane owner reaches `recordQuotaOwner` before a turn is
 * released, a failed owner read leaves the owner unknown without throwing, and
 * the lane stream's signals reach the ledger under that owner.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { QuotaOwnerRef } from '@ptah-extension/shared';
import {
  LANE_OWNER_READ_TIMEOUT_MS,
  PtahCliLanePlanLimits,
  isPlanBilledLaneProvider,
  type LaneOwnerReader,
  type LanePlanLimitWriter,
} from './ptah-cli-lane-plan-limits';

const claudeAccount: QuotaOwnerRef = {
  providerId: 'anthropic',
  identityKind: 'account',
  key: 'anthropic#account:0123456789abcdef',
  label: 'Claude account',
};
const ollamaKey: QuotaOwnerRef = {
  providerId: 'ollama-cloud',
  identityKind: 'credential',
  key: 'ollama-cloud#credential:0123456789abcdef',
  label: 'Ollama Cloud key',
};
const ollamaUnknown: QuotaOwnerRef = {
  providerId: 'ollama-cloud',
  identityKind: 'unknown',
  key: 'ollama-cloud#unknown:0123456789abcdef',
  label: 'Unknown owner',
};

function createLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createLedger(): jest.Mocked<LanePlanLimitWriter> {
  return {
    recordWindowEvidence: jest.fn(),
    recordOwnerEvidence: jest.fn(),
    recordCooldown: jest.fn(),
    recordSuccess: jest.fn(),
  };
}

function createOwners(): jest.Mocked<LaneOwnerReader> {
  return {
    ownerForClaudeLane: jest.fn<
      QuotaOwnerRef,
      Parameters<LaneOwnerReader['ownerForClaudeLane']>
    >(() => claudeAccount),
    ownerForPtahCliKey: jest.fn<
      Promise<QuotaOwnerRef>,
      Parameters<LaneOwnerReader['ownerForPtahCliKey']>
    >(async () => ollamaKey),
  };
}

interface Harness {
  lane: PtahCliLanePlanLimits;
  logger: jest.Mocked<Logger>;
  ledger: jest.Mocked<LanePlanLimitWriter>;
  owners: jest.Mocked<LaneOwnerReader>;
  recordOwner: jest.Mock;
}

function createLane(
  providerId: string,
  overrides: Partial<Pick<Harness, 'owners'>> = {},
): Harness {
  const logger = createLogger();
  const ledger = createLedger();
  const owners = overrides.owners ?? createOwners();
  const recordOwner = jest.fn(() => true);
  const lane = new PtahCliLanePlanLimits({
    logger,
    ledger,
    owners,
    recordOwner,
    ptahCliId: 'pc-1',
    providerId,
  });
  return { lane, logger, ledger, owners, recordOwner };
}

/** Let queued promise callbacks and microtasks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

const success = (billing: 'plan' | 'overage' | 'unknown') =>
  ({
    kind: 'success',
    turnScopes: ['sonnet'],
    billing,
    observedAt: 1_000,
  }) as const;

describe('PtahCliLanePlanLimits — lane owner', () => {
  it('records a claude-cli lane owner from its own accountInfo() once the run is tracked', async () => {
    const { lane, owners, recordOwner } = createLane('claude-cli');
    const account = { email: 'dev@example.test', organization: 'org' };
    const accountInfo = jest.fn(async () => account);

    lane.onSystemInit({ accountInfo });
    lane.onSystemInit({ accountInfo });
    await lane.settled;
    expect(recordOwner).not.toHaveBeenCalled();

    lane.attach('agent-1');
    await flush();

    expect(accountInfo).toHaveBeenCalledTimes(1);
    expect(owners.ownerForClaudeLane).toHaveBeenCalledWith(account, 'agent-1');
    expect(recordOwner).toHaveBeenCalledWith('agent-1', claudeAccount);
  });

  it('records the owner as soon as the read settles when the run is already tracked', async () => {
    const { lane, recordOwner } = createLane('claude-cli');
    lane.attach('agent-1');
    await flush();

    lane.onSystemInit({ accountInfo: async () => ({ email: 'a@b.test' }) });
    await lane.settled;

    expect(recordOwner).toHaveBeenCalledWith('agent-1', claudeAccount);
  });

  it('leaves the owner unknown, without throwing, when accountInfo() rejects', async () => {
    const { lane, logger, recordOwner, ledger } = createLane('claude-cli');
    lane.attach('agent-1');

    lane.onSystemInit({
      accountInfo: async () => {
        throw new Error('control request failed: secret detail');
      },
    });
    await lane.settled;
    await flush();
    lane.onSignal(success('plan'));
    await flush();

    expect(recordOwner).not.toHaveBeenCalled();
    expect(ledger.recordSuccess).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      '[PtahCliRegistry] Lane owner read failed; owner stays unknown',
      expect.objectContaining({ failure: 'rejected' }),
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(
      'secret detail',
    );
  });

  it('gives up on accountInfo() after the 3 s bound', async () => {
    jest.useFakeTimers();
    try {
      const { lane, logger, recordOwner } = createLane('claude-cli');
      lane.attach('agent-1');
      lane.onSystemInit({ accountInfo: () => new Promise(() => undefined) });

      jest.advanceTimersByTime(LANE_OWNER_READ_TIMEOUT_MS);
      await lane.settled;

      expect(recordOwner).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        '[PtahCliRegistry] Lane owner read failed; owner stays unknown',
        expect.objectContaining({ failure: 'timeout' }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the owner unknown when the query has no accountInfo()', async () => {
    const { lane, recordOwner } = createLane('claude-cli');
    lane.attach('agent-1');

    lane.onSystemInit({});
    await lane.settled;
    await flush();

    expect(recordOwner).not.toHaveBeenCalled();
  });

  it('settles with no owner when the stream ends before the system init', async () => {
    const { lane, recordOwner } = createLane('claude-cli');
    lane.attach('agent-1');

    lane.end();
    await lane.settled;
    lane.onSystemInit({ accountInfo: async () => ({ email: 'a@b.test' }) });
    await flush();

    expect(recordOwner).not.toHaveBeenCalled();
  });

  it('records an ollama-cloud lane owner from its stored key at spawn', async () => {
    const { lane, owners, recordOwner } = createLane('ollama-cloud');
    lane.attach('agent-2');
    await lane.settled;
    await flush();

    expect(owners.ownerForPtahCliKey).toHaveBeenCalledWith(
      'pc-1',
      'ollama-cloud',
    );
    expect(recordOwner).toHaveBeenCalledWith('agent-2', ollamaKey);
  });

  it('never reads the account of a provider without an owner rule', async () => {
    const { lane, owners, recordOwner } = createLane('z-ai');
    const accountInfo = jest.fn(async () => ({ email: 'a@b.test' }));
    lane.attach('agent-3');

    lane.onSystemInit({ accountInfo });
    await lane.settled;
    await flush();

    expect(accountInfo).not.toHaveBeenCalled();
    expect(owners.ownerForPtahCliKey).not.toHaveBeenCalled();
    expect(recordOwner).not.toHaveBeenCalled();
  });

  it('settles at once and records nothing on a host without an owner resolver', async () => {
    const recordOwner = jest.fn();
    const lane = new PtahCliLanePlanLimits({
      logger: createLogger(),
      ledger: createLedger(),
      owners: null,
      recordOwner,
      ptahCliId: 'pc-1',
      providerId: 'claude-cli',
    });

    lane.attach('agent-1');
    await lane.settled;
    await flush();

    expect(recordOwner).not.toHaveBeenCalled();
  });
});

describe('PtahCliLanePlanLimits — stream signals', () => {
  it('files a window signal that arrived before the owner under that owner', async () => {
    const { lane, ledger } = createLane('claude-cli');
    lane.onSignal({
      kind: 'evidence',
      evidence: {
        kind: 'window',
        windowKey: 'five_hour',
        status: 'rejected',
        exhausted: true,
        resetsAt: 9_000,
        source: 'stream-event',
        observedAt: 1_000,
      },
    });

    lane.attach('agent-1');
    lane.onSystemInit({ accountInfo: async () => ({ email: 'a@b.test' }) });
    await lane.settled;
    await flush();

    expect(ledger.recordWindowEvidence).toHaveBeenCalledWith(claudeAccount, {
      key: 'five_hour',
      kind: 'five_hour',
      label: '5-hour',
      resetsAt: 9_000,
      resetSource: 'stream-event',
      exhaustion: {
        observedAt: 1_000,
        source: 'stream-event',
        resetsAt: 9_000,
        resetSource: 'stream-event',
      },
      observedAt: 1_000,
    });
  });

  it('files owner evidence and its cooldown', async () => {
    const { lane, ledger } = createLane('ollama-cloud');
    lane.attach('agent-2');
    const cooldown = { until: 5_000, observedAt: 1_000, rawUntil: 5_000 };

    lane.onSignal({
      kind: 'evidence',
      evidence: {
        kind: 'owner',
        cause: 'api-retry',
        source: 'error-derived',
        observedAt: 1_000,
        cooldown,
      },
    });
    await lane.settled;
    await flush();

    expect(ledger.recordOwnerEvidence).toHaveBeenCalledWith(ollamaKey, {
      observedAt: 1_000,
      source: 'error-derived',
    });
    expect(ledger.recordCooldown).toHaveBeenCalledWith(ollamaKey, cooldown);
  });

  it('passes an overage success through as overage, which the ledger never clears on (F63)', async () => {
    const { lane, ledger } = createLane('claude-cli');
    lane.attach('agent-1');
    lane.onSystemInit({ accountInfo: async () => ({ email: 'a@b.test' }) });
    await lane.settled;

    lane.onSignal(success('overage'));
    await flush();

    expect(ledger.recordSuccess).toHaveBeenCalledWith({
      ownerKey: claudeAccount.key,
      modelScopes: ['sonnet'],
      billing: 'overage',
      observedAt: 1_000,
    });
  });

  it('skips a success on an unknown owner (F65) but still files its evidence', async () => {
    const owners = createOwners();
    owners.ownerForPtahCliKey.mockResolvedValue(ollamaUnknown);
    const { lane, ledger, recordOwner } = createLane('ollama-cloud', {
      owners,
    });
    lane.attach('agent-2');
    await lane.settled;
    await flush();

    lane.onSignal(success('plan'));
    lane.onSignal({
      kind: 'evidence',
      evidence: {
        kind: 'owner',
        cause: 'assistant-rate-limit',
        source: 'error-derived',
        observedAt: 2_000,
      },
    });
    await flush();

    expect(recordOwner).toHaveBeenCalledWith('agent-2', ollamaUnknown);
    expect(ledger.recordSuccess).not.toHaveBeenCalled();
    expect(ledger.recordOwnerEvidence).toHaveBeenCalledWith(
      ollamaUnknown,
      expect.objectContaining({ observedAt: 2_000 }),
    );
  });

  it('logs a ledger failure and keeps going', async () => {
    const { lane, ledger, logger } = createLane('ollama-cloud');
    ledger.recordSuccess.mockImplementation(() => {
      throw new Error('storage down');
    });
    lane.attach('agent-2');
    await lane.settled;

    lane.onSignal(success('plan'));
    await flush();

    expect(logger.warn).toHaveBeenCalledWith(
      '[PtahCliRegistry] Plan-limit ledger write failed',
      expect.objectContaining({ signal: 'success', errorName: 'Error' }),
    );
  });
});

describe('isPlanBilledLaneProvider', () => {
  it.each([
    ['ollama-cloud', true],
    ['claude-cli', false],
    ['z-ai', false],
  ])('%s → %s', (providerId, expected) => {
    expect(isPlanBilledLaneProvider(providerId)).toBe(expected);
  });
});

describe('PtahCliLanePlanLimits — window conversion', () => {
  it('files a model-scoped window that is not exhausted through the ledger conversion', async () => {
    const { lane, ledger } = createLane('claude-cli');
    lane.attach('agent-1');
    lane.onSystemInit({ accountInfo: async () => ({ email: 'a@b.test' }) });
    await lane.settled;

    lane.onSignal({
      kind: 'evidence',
      evidence: {
        kind: 'window',
        windowKey: 'weekly_model:opus',
        modelScope: 'opus',
        status: 'allowed_warning',
        exhausted: false,
        source: 'stream-event',
        observedAt: 1_000,
      },
    });
    await flush();

    expect(ledger.recordWindowEvidence).toHaveBeenCalledWith(claudeAccount, {
      key: 'weekly_model:opus',
      kind: 'weekly_model',
      label: 'Weekly · Opus',
      modelScope: 'opus',
      observedAt: 1_000,
    });
  });
});
