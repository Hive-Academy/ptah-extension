/**
 * TASK_2026_352 — boot-sourced rows wait for the host to settle.
 *
 * `ForegroundActivityTracker.msSinceLastActivity` returns
 * `Number.POSITIVE_INFINITY` until the first chat turn, deliberately, so that a
 * host nobody has touched is not treated as busy forever. The consequence is
 * that gate 4 is GUARANTEED to pass at boot — exactly when the host is least
 * idle. On the baseline that let a `frequent` tick spend 122 s and a `nightly`
 * tick 156 s while the window was still coming up
 * (`tmp/logs/log.log:1095,1453`), draining a backlog the boot scan had just
 * enqueued from sessions that ended before the process started
 * (`:694,853,882`).
 *
 * These tests drive the REAL `SkillDrainService` against a stubbed store, and
 * assert on `tryClaim` — a gate is only provable by "the claim was never
 * attempted", not by a summary field that a handler could also produce.
 */
import 'reflect-metadata';

import { SKILL_DRAIN_KEYS } from './skill-drain.service';
import type { SkillQueueRow, SkillQueueSource } from './skill-queue.types';
import {
  liveSignal,
  makeBudgetStub,
  makeDrain,
  makeLogger,
  type DrainSettings,
} from './skill-drain.test-support';

const WS = 'D:/repo';
const BOOT_DEFERRAL_MS = 300_000;

function row(id: string, source: SkillQueueSource): SkillQueueRow {
  return {
    id,
    sessionId: `s-${id}`,
    workspaceRoot: WS,
    transcriptPath: null,
    source,
    stage: 'prefilter',
    dependsOn: null,
    status: 'queued',
    turnCount: 6,
    attemptCount: 0,
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
  const parts = {
    reapStale: jest.fn(() => 0),
    listEligibleWorkspaces: jest.fn(() => [WS]),
    listEligible: jest.fn(() => rows),
    markWorkspaceDrained: jest.fn(),
    tryClaim: jest.fn((id: string) => {
      const found = rows.find((r) => r.id === id);
      return found ? { ...found, status: 'claimed' as const } : null;
    }),
    touchClaim: jest.fn(() => true),
    markDone: jest.fn(),
    markFailed: jest.fn(),
    markUnscored: jest.fn(),
    markSkipped: jest.fn(),
  };
  return parts;
}

function makeHarness(rows: SkillQueueRow[], settings: DrainSettings = {}) {
  const queue = makeQueue(rows);
  const budget = makeBudgetStub();
  const logger = makeLogger();
  const drain = makeDrain({
    logger,
    queue: queue as never,
    budget: budget.store,
    settings,
  });
  drain.registerStageHandler('prefilter', async () => ({
    outcome: 'done' as const,
  }));
  return { drain, queue, logger };
}

/** Claimed row ids, in the order the drain tried them. */
function claimedIds(queue: ReturnType<typeof makeQueue>): string[] {
  return queue.tryClaim.mock.calls.map((c) => c[0] as string);
}

describe('SkillDrainService — boot deferral', () => {
  it('does not claim a boot-sourced row inside the window', async () => {
    const { drain, queue } = makeHarness([row('boot-1', 'boot')]);

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: Date.now() + BOOT_DEFERRAL_MS - 1_000,
    });

    expect(queue.tryClaim).not.toHaveBeenCalled();
    expect(summary.bootDeferred).toBe(1);
    expect(summary.claimed).toBe(0);
    // Not a skip: the tick ran, it just had nothing it was willing to take.
    expect(summary.skipped).toBe(false);
  });

  it('claims the same row once the window has passed', async () => {
    const { drain, queue } = makeHarness([row('boot-1', 'boot')]);

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: Date.now() + BOOT_DEFERRAL_MS + 1_000,
    });

    expect(claimedIds(queue)).toEqual(['boot-1']);
    expect(summary.bootDeferred).toBe(0);
    expect(summary.claimed).toBe(1);
  });

  /**
   * The reason the deferral is a row FILTER and not a whole-tick gate. A gate
   * above the loop would have held back the user's own session work too, which
   * is a worse trade than the one it replaces.
   */
  it('drains live-triggered rows in the same tick it defers boot rows', async () => {
    // The boot row is FIRST in the eligible window, and the frequent tier is
    // single-round with `perWorkspaceBatch: 1` — so it takes exactly one row,
    // and without the filter that row would be `boot-1`. Which id comes back is
    // therefore the whole assertion.
    const { drain, queue } = makeHarness([
      row('boot-1', 'boot'),
      row('live-1', 'session-end'),
    ]);

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: Date.now() + 1_000,
    });

    expect(claimedIds(queue)).toEqual(['live-1']);
    expect(summary.bootDeferred).toBe(1);
    expect(summary.claimed).toBe(1);
  });

  it('counts every deferred row, not just the first', async () => {
    const { drain } = makeHarness([
      row('boot-1', 'boot'),
      row('boot-2', 'boot'),
      row('boot-3', 'boot'),
    ]);

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: Date.now() + 1_000,
    });

    expect(summary.bootDeferred).toBe(3);
  });

  it('is disabled by bootDeferralMs: 0', async () => {
    const { drain, queue } = makeHarness([row('boot-1', 'boot')], {
      [SKILL_DRAIN_KEYS.bootDeferralMs]: 0,
    });

    await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: Date.now() + 1_000,
    });

    expect(claimedIds(queue)).toEqual(['boot-1']);
  });

  it('honours a configured window longer than the default', async () => {
    const { drain, queue } = makeHarness([row('boot-1', 'boot')], {
      [SKILL_DRAIN_KEYS.bootDeferralMs]: 3_600_000,
    });

    await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      // Past the DEFAULT window, inside the configured one.
      now: Date.now() + BOOT_DEFERRAL_MS + 60_000,
    });

    expect(queue.tryClaim).not.toHaveBeenCalled();
  });

  /**
   * The deferral composes with gate 4 rather than replacing it: one answers
   * "has the host settled", the other "is the user typing". A tick stopped by
   * the foreground gate never reaches selection, so nothing is counted as
   * deferred — the row was not considered at all.
   */
  it('leaves the earlier gates in charge when they fire', async () => {
    const { drain } = makeHarness([row('boot-1', 'boot')], {
      [SKILL_DRAIN_KEYS.enabled]: false,
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: Date.now() + 1_000,
    });

    expect(summary.skipped).toBe(true);
    expect(summary.reason).toBe('disabled');
    expect(summary.bootDeferred).toBe(0);
  });
});
