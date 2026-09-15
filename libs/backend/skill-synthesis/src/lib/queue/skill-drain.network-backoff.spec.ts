/**
 * The drain and the network back-off — TASK_2026_437 C14 (f).
 *
 * While every lane's provider has its network back-off window open, token-spending rows stay
 * `queued` WITHOUT a claim (a claim would bump `attempt_count` toward the
 * `timeout` ceiling for an outage that is not the row's fault) and the free
 * stages keep draining. A `network-unreachable` lane failure requeues behind
 * the window and, like `quota-exhausted`, never goes terminal.
 */
import 'reflect-metadata';
import {
  SkillDrainService,
  SKILL_DRAIN_KEYS,
  type SkillStageContext,
  type SkillStageResult,
} from './skill-drain.service';
import type { SkillQueueRow, SkillQueueStage } from './skill-queue.types';
import type { SkillBudgetStore } from './skill-budget.store';
import type { SkillQueueStore } from './skill-queue.store';
import { ProviderNetworkBackoffs } from '../lanes/provider-network-backoffs';
import {
  liveSignal,
  makeLogger,
  makeTracker,
  makeWorkspace,
} from './skill-drain.test-support';

const ROOT = '/ws';

function makeRow(
  id: string,
  stage: SkillQueueStage,
  attemptCount = 1,
): SkillQueueRow {
  return {
    id,
    sessionId: `session-${id}`,
    workspaceRoot: ROOT,
    transcriptPath: null,
    source: 'session-end',
    stage,
    dependsOn: null,
    status: 'queued',
    turnCount: 6,
    attemptCount,
    enqueuedAt: 1_770_000_000_000,
    notBefore: 0,
    claimedBy: null,
    claimedAt: null,
    finishedAt: null,
    lane: null,
    reason: null,
    lastError: null,
    candidateId: null,
    payload: {},
  };
}

function makeQueue(rows: SkillQueueRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parts = {
    reapStale: jest.fn(() => 0),
    listEligibleWorkspaces: jest.fn(() => [ROOT]),
    listEligible: jest.fn(() => rows),
    markWorkspaceDrained: jest.fn(),
    tryClaim: jest.fn((id: string) => byId.get(id) ?? null),
    touchClaim: jest.fn(() => true),
    markDone: jest.fn(),
    markFailed: jest.fn(),
    markUnscored: jest.fn(),
    markSkipped: jest.fn(),
    requeue: jest.fn(() => true),
    countEligibleByStage: jest.fn(() => {
      const counts = new Map<SkillQueueStage, number>();
      for (const row of rows) {
        counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
      }
      return counts;
    }),
  };
  return { ...parts, store: parts as unknown as SkillQueueStore };
}

const budget = {
  spentToday: () => 0,
  withStage: <T>(_stage: string, fn: () => T): T => fn(),
} as unknown as SkillBudgetStore;

function harness(
  rows: SkillQueueRow[],
  settings: Record<string, unknown> = {},
) {
  let now = 1_800_000_000_000;
  const backoffs = new ProviderNetworkBackoffs({
    logger: makeLogger(),
    logPrefix: '[skill-synthesis]',
    now: () => now,
    random: () => 0.5,
  });
  // No lane names a provider: the one key is the active provider.
  const backoff = backoffs.for('');
  const queue = makeQueue(rows);
  const logger = makeLogger();
  const drain = new SkillDrainService(
    logger,
    queue.store,
    budget,
    makeTracker(),
    makeWorkspace(settings),
    backoffs,
  );
  const handler = jest.fn<Promise<SkillStageResult>, [SkillStageContext]>(
    async () => ({ outcome: 'done', reason: 'ok' }),
  );
  drain.registerStageHandler('judge', handler);
  drain.registerStageHandler('embedding', handler);
  return {
    drain,
    queue,
    backoff,
    backoffs,
    handler,
    logger,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('SkillDrainService — network back-off row filter (C14 f)', () => {
  it('leaves token-spending rows queued and unclaimed while the window is open; free stages still drain', async () => {
    const h = harness([
      makeRow('judge-1', 'judge'),
      makeRow('embed-1', 'embedding'),
    ]);
    h.backoff.recordFailure('dns');

    const summary = await h.drain.drain({
      tier: 'nightly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(h.queue.tryClaim.mock.calls.map((call) => call[0])).toEqual([
      'embed-1',
    ]);
    expect(summary).toMatchObject({ networkDeferred: 1, done: 1, claimed: 1 });
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('claims them again once the window has passed', async () => {
    const h = harness([makeRow('judge-1', 'judge')]);
    h.backoff.recordFailure('dns');
    h.advance(30_000);

    const summary = await h.drain.drain({
      tier: 'nightly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(h.queue.tryClaim).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ networkDeferred: 0, done: 1 });
  });

  it('requeues a network-unreachable lane failure behind its window and never marks it terminal', async () => {
    const h = harness([makeRow('judge-1', 'judge', 99)], {
      [SKILL_DRAIN_KEYS.maxAttempts]: 3,
    });
    h.handler.mockResolvedValueOnce({
      outcome: 'lane-failed',
      failure: {
        kind: 'network-unreachable',
        reason: 'Lane judge: provider unreachable (dns)',
        retryAfterMs: 30_000,
      },
    });

    const summary = await h.drain.drain({
      tier: 'nightly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(h.queue.markFailed).not.toHaveBeenCalled();
    expect(h.queue.markUnscored).not.toHaveBeenCalled();
    expect(h.queue.requeue).toHaveBeenCalledWith(
      'judge-1',
      expect.any(Number),
      'Lane judge: provider unreachable (dns)',
    );
    expect(summary.stalled).toBe(1);
  });

  it('filters nothing with no back-off injected', async () => {
    const queue = makeQueue([makeRow('judge-1', 'judge')]);
    const drain = new SkillDrainService(
      makeLogger(),
      queue.store,
      budget,
      makeTracker(),
      makeWorkspace({}),
    );
    drain.registerStageHandler('judge', async () => ({
      outcome: 'done',
      reason: 'ok',
    }));

    const summary = await drain.drain({
      tier: 'nightly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({ networkDeferred: 0, done: 1 });
  });
});

describe('SkillDrainService — network back-off scan short-circuit and provider keying (C14 f)', () => {
  const liveTick = { tier: 'nightly' as const, onBattery: false };

  it('does not walk the queue when every lane is held and only spending rows are eligible', async () => {
    const h = harness([
      makeRow('judge-1', 'judge'),
      makeRow('judge-2', 'judge'),
    ]);
    h.backoff.recordFailure('dns');

    const summary = await h.drain.drain({ ...liveTick, signal: liveSignal() });

    expect(h.queue.countEligibleByStage).toHaveBeenCalledTimes(1);
    expect(h.queue.listEligibleWorkspaces).not.toHaveBeenCalled();
    expect(h.queue.listEligible).not.toHaveBeenCalled();
    expect(h.queue.markWorkspaceDrained).not.toHaveBeenCalled();
    expect(h.queue.tryClaim).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ networkDeferred: 2, claimed: 0 });
  });

  it('still walks the queue when a free-stage row is eligible', async () => {
    const h = harness([
      makeRow('judge-1', 'judge'),
      makeRow('embed-1', 'embedding'),
    ]);
    h.backoff.recordFailure('dns');

    await h.drain.drain({ ...liveTick, signal: liveSignal() });

    expect(h.queue.listEligibleWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('never runs the aggregate count while no window is open', async () => {
    const h = harness([makeRow('judge-1', 'judge')]);

    await h.drain.drain({ ...liveTick, signal: liveSignal() });

    expect(h.queue.countEligibleByStage).not.toHaveBeenCalled();
  });

  it('dispatches spending rows while at least one lane provider is still reachable', async () => {
    const h = harness([makeRow('judge-1', 'judge')], {
      'skillSynthesis.judge.provider': 'provider-healthy',
    });
    // The active provider (three inheriting lanes) is down; the judge lane's own
    // provider is not, and the drain cannot tell which lane a row will ride.
    h.backoff.recordFailure('dns');

    const summary = await h.drain.drain({ ...liveTick, signal: liveSignal() });

    expect(h.queue.tryClaim).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ networkDeferred: 0, done: 1 });
  });

  it('holds them once every lane provider is down', async () => {
    const h = harness(
      [makeRow('judge-1', 'judge'), makeRow('embed-1', 'embedding')],
      {
        'skillSynthesis.judge.provider': 'provider-b',
      },
    );
    h.backoff.recordFailure('dns');
    h.backoffs.for('provider-b').recordFailure('connection');

    const summary = await h.drain.drain({ ...liveTick, signal: liveSignal() });

    expect(h.queue.tryClaim.mock.calls.map((call) => call[0])).toEqual([
      'embed-1',
    ]);
    expect(summary.networkDeferred).toBe(1);
  });
});
