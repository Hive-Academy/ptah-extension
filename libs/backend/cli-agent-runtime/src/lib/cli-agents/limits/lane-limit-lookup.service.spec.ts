/**
 * LaneLimitLookupService (TASK_2026_596, Component 10; F41, Req 5.4).
 *
 * One slow reader costs only its own lane ("limit lookup timed out"); a
 * throwing read is `failed`; the lookup never rejects; a run's recorded owner
 * wins over the lane rule; the lane's model scope narrows the owner's limits.
 */
import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  PlanLimitOwnerSnapshot,
  PlanLimitWindow,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import type { PlanOwnerTarget } from '@ptah-extension/auth-providers';
import {
  LaneLimitLookupService,
  type LaneLimitLedger,
  type LaneLimitOwnerRules,
  type LaneLimitSnapshots,
} from './lane-limit-lookup.service';

const owner = (
  providerId: string,
  identityKind: QuotaOwnerRef['identityKind'],
  suffix: string,
): QuotaOwnerRef => ({
  providerId,
  identityKind,
  key: `${providerId}#${identityKind}:${suffix.padEnd(16, '0')}`,
  label: `${providerId} owner`,
});

const CODEX = owner('openai-codex', 'account', 'c0de');
const OPENCODE = owner('opencode', 'cli-store', '0c0d');
const ANTIGRAVITY = owner('antigravity', 'cli-store', 'a9a9');
const OLLAMA = owner('ollama-cloud', 'credential', '011a');
const CLAUDE_RUN = owner('anthropic', 'account', 'aaaa');

function snapshot(
  ownerRef: QuotaOwnerRef,
  windows: PlanLimitWindow[] = [],
): PlanLimitOwnerSnapshot {
  return {
    owner: ownerRef,
    status: 'available',
    windowSetEstablished: false,
    windows,
    ownerEvidence: [],
  };
}

interface Harness {
  service: LaneLimitLookupService;
  rules: jest.Mocked<LaneLimitOwnerRules>;
  snapshots: { getOwnerSnapshot: jest.Mock };
  ledger: jest.Mocked<LaneLimitLedger>;
}

function createHarness(
  getOwnerSnapshot: (
    target: PlanOwnerTarget,
    options?: { signal?: AbortSignal },
  ) => Promise<PlanLimitOwnerSnapshot>,
): Harness {
  const rules = {
    ownerForLane: jest.fn((cli: string) =>
      cli === 'codex'
        ? CODEX
        : cli === 'opencode'
          ? OPENCODE
          : cli === 'antigravity'
            ? ANTIGRAVITY
            : undefined,
    ),
    ownerForPtahCliKey: jest.fn(async () => OLLAMA),
  } as unknown as jest.Mocked<LaneLimitOwnerRules>;
  const snapshots = { getOwnerSnapshot: jest.fn(getOwnerSnapshot) };
  const ledger = {
    snapshotFor: jest.fn(() => undefined),
  } as unknown as jest.Mocked<LaneLimitLedger>;
  const service = new LaneLimitLookupService(
    createMockLogger() as unknown as Logger,
    rules,
    snapshots as unknown as LaneLimitSnapshots,
    ledger,
  );
  return { service, rules, snapshots, ledger };
}

describe('LaneLimitLookupService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('F41: a reader slower than the deadline times out only its own lane', async () => {
    jest.useFakeTimers();
    let slowSignal: AbortSignal | undefined;
    const { service } = createHarness((target, options) => {
      if (target.providerId === 'antigravity') {
        slowSignal = options?.signal;
        return new Promise(() => undefined);
      }
      return Promise.resolve(snapshot(target.ownerRef));
    });

    const pending = service.lookup([
      { cli: 'codex' as const },
      { cli: 'antigravity' as const },
      { cli: 'opencode' as const },
    ]);
    // The fast lanes settle on their own; only then does the deadline pass.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    jest.advanceTimersByTime(2_999);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    jest.advanceTimersByTime(1);
    const results = await pending;

    expect(results.map((r) => r.lookup)).toEqual(['ok', 'timeout', 'ok']);
    expect(results[1].state).toEqual({
      state: 'unknown',
      reasons: [{ kind: 'lookup-failed', failure: 'timed-out' }],
      windows: [],
    });
    expect(results[0].snapshot?.owner).toEqual(CODEX);
    expect(results[2].owner).toEqual(OPENCODE);
    // The read still waiting is released once the deadline has passed.
    expect(slowSignal?.aborted).toBe(true);
  });

  it('honours a custom deadline', async () => {
    jest.useFakeTimers();
    const { service } = createHarness(() => new Promise(() => undefined));

    const pending = service.lookup([{ cli: 'codex' as const }], {
      deadlineMs: 500,
    });
    jest.advanceTimersByTime(500);

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ lookup: 'timeout' }),
    ]);
  });

  it('a throwing read is `failed`, the lookup never rejects, and other lanes are returned', async () => {
    const { service } = createHarness(async (target) => {
      if (target.providerId === 'openai-codex') {
        throw new Error('reader exploded: secret-body');
      }
      return snapshot(target.ownerRef);
    });

    const results = await service.lookup([
      { cli: 'codex' as const },
      { cli: 'opencode' as const },
    ]);

    expect(results[0]).toEqual(
      expect.objectContaining({
        lookup: 'failed',
        state: {
          state: 'unknown',
          reasons: [{ kind: 'lookup-failed', failure: 'failed' }],
          windows: [],
        },
      }),
    );
    expect(results[1].lookup).toBe('ok');
  });

  it('a throwing owner rule is `failed` too', async () => {
    const { service, rules } = createHarness(async (target) =>
      snapshot(target.ownerRef),
    );
    rules.ownerForLane.mockImplementation(() => {
      throw new Error('store unreadable');
    });

    const [result] = await service.lookup([{ cli: 'codex' as const }]);

    expect(result.lookup).toBe('failed');
  });

  it('a lane with no owner rule reads nothing and is unknown with no snapshot', async () => {
    const { service, snapshots } = createHarness(async (target) =>
      snapshot(target.ownerRef),
    );

    const [result] = await service.lookup([{ cli: 'copilot' as const }]);

    expect(snapshots.getOwnerSnapshot).not.toHaveBeenCalled();
    expect(result.lookup).toBe('no-owner');
    expect(result.state.reasons).toEqual([{ kind: 'no-snapshot' }]);
  });

  it('reads a Ptah CLI Ollama Cloud lane with that agent key', async () => {
    const { service, rules, snapshots } = createHarness(async (target) =>
      snapshot(target.ownerRef),
    );

    await service.lookup([
      {
        cli: 'ptah-cli' as const,
        ptahCliId: 'pc-glm',
        providerId: 'ollama-cloud',
      },
    ]);

    expect(rules.ownerForPtahCliKey).toHaveBeenCalledWith(
      'pc-glm',
      'ollama-cloud',
    );
    expect(snapshots.getOwnerSnapshot).toHaveBeenCalledWith(
      {
        providerId: 'ollama-cloud',
        ownerRef: OLLAMA,
        credentialRef: { kind: 'ptah-cli-key', ptahCliId: 'pc-glm' },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("a run's recorded owner wins over the lane rule; a Claude run is never read through another session", async () => {
    const { service, rules, snapshots, ledger } = createHarness(async (t) =>
      snapshot(t.ownerRef),
    );

    const [result] = await service.lookup([
      { cli: 'ptah-cli' as const, ptahCliId: 'pc-1', quotaOwner: CLAUDE_RUN },
    ]);

    expect(rules.ownerForLane).not.toHaveBeenCalled();
    expect(snapshots.getOwnerSnapshot).not.toHaveBeenCalled();
    expect(ledger.snapshotFor).toHaveBeenCalledWith(CLAUDE_RUN.key);
    expect(result.owner).toEqual(CLAUDE_RUN);
    expect(result.snapshot).toEqual(
      expect.objectContaining({
        status: 'service-unavailable',
        unavailableReason: 'no-open-session',
      }),
    );
    expect(result.state.state).toBe('unknown');
  });

  it("passes the lane's model scope: an Opus-only exhaustion is at-limit for Opus and not for Sonnet", async () => {
    const now = Date.now();
    const opusExhausted: PlanLimitWindow = {
      key: 'weekly_model:opus',
      kind: 'weekly_model',
      label: 'Weekly · Opus',
      modelScope: 'opus',
      resetsAt: now + 3_600_000,
      resetSource: 'stream-event',
      exhaustion: {
        observedAt: now - 1_000,
        source: 'stream-event',
        resetsAt: now + 3_600_000,
        resetSource: 'stream-event',
        modelScope: 'opus',
      },
      observedAt: now - 1_000,
    };
    const { service } = createHarness(async (target) =>
      snapshot(target.ownerRef, [opusExhausted]),
    );

    const [opus, sonnet] = await service.lookup([
      { cli: 'codex' as const, modelScope: 'opus' },
      { cli: 'codex' as const, modelScope: 'sonnet' },
    ]);

    expect(opus.state.state).toBe('at-limit');
    expect(sonnet.state.state).not.toBe('at-limit');
    expect(sonnet.state.windows).toEqual([]);
  });

  it("a caller's abort ends the lanes still waiting as `failed`", async () => {
    const { service } = createHarness(() => new Promise(() => undefined));
    const controller = new AbortController();

    const pending = service.lookup([{ cli: 'codex' as const }], {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toEqual([
      expect.objectContaining({ lookup: 'failed' }),
    ]);
  });

  it('returns nothing for no rows', async () => {
    const { service } = createHarness(async (t) => snapshot(t.ownerRef));

    await expect(service.lookup([])).resolves.toEqual([]);
  });
});
