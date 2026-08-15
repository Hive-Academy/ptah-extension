/**
 * P0-4, P0-5, P0-6 and the ORDER the gates run in.
 *
 * Each gate is proved twice: the exact `reason` string, and `tryClaim` never
 * called — a gate that returns the right string after claiming a row has
 * already spent the thing it was supposed to protect.
 *
 * The order matters as much as the individual gates. `skillSynthesis.enabled`
 * is what the Electron tray's "Pause background learning" writes (decision
 * Q-B), so it must short-circuit before the drain reads the budget, the battery
 * or the foreground clock. The `describe('gate order')` block below turns every
 * gate on at once and peels them off one at a time; the sequence of reasons IS
 * the contract.
 *
 * These specs use a fully stubbed queue store on purpose. The gates are pure
 * control flow above the database, and "no claim was attempted" is only
 * assertable against a mock.
 */
import 'reflect-metadata';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  MAX_STAGE_TIMEOUT_MS,
  SkillDrainService,
  SKILL_DRAIN_KEYS,
  STALE_CLAIM_TTL_SAFETY_FACTOR,
  type DrainTier,
} from './skill-drain.service';
import type { SkillQueueStore } from './skill-queue.store';
import type { SkillQueueRow, SkillQueueStage } from './skill-queue.types';
import {
  liveSignal,
  makeBudgetStub,
  makeDrain,
  makeLogger,
  makeQueueStub,
  makeTracker,
  type DrainSettings,
} from './skill-drain.test-support';

const ALL_GATES_TRIPPED: DrainSettings = {
  [SKILL_DRAIN_KEYS.enabled]: false,
  [SKILL_DRAIN_KEYS.maxTokensPerDay]: 1_000,
  [SKILL_DRAIN_KEYS.pauseOnBattery]: true,
  [SKILL_DRAIN_KEYS.foregroundBackoffMs]: 300_000,
};

describe('SkillDrainService — gates', () => {
  it('P0-4: skips while a foreground session is active', async () => {
    const queue = makeQueueStub();
    const drain = makeDrain({
      queue: queue.store,
      budget: makeBudgetStub(0).store,
      foreground: makeTracker(1_000),
      settings: { [SKILL_DRAIN_KEYS.foregroundBackoffMs]: 300_000 },
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({
      skipped: true,
      reason: 'foreground-active',
    });
    expect(queue.tryClaim).not.toHaveBeenCalled();
    expect(queue.reapStale).not.toHaveBeenCalled();
  });

  it('P0-4: runs once the foreground has been quiet for the backoff', async () => {
    const queue = makeQueueStub();
    const drain = makeDrain({
      queue: queue.store,
      budget: makeBudgetStub(0).store,
      foreground: makeTracker(300_001),
      settings: { [SKILL_DRAIN_KEYS.foregroundBackoffMs]: 300_000 },
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary.skipped).toBe(false);
    expect(queue.reapStale).toHaveBeenCalledTimes(1);
  });

  it('P0-4: a foregroundBackoffMs of 0 disables the gate entirely', async () => {
    const queue = makeQueueStub();
    const drain = makeDrain({
      queue: queue.store,
      budget: makeBudgetStub(0).store,
      foreground: makeTracker(1),
      settings: { [SKILL_DRAIN_KEYS.foregroundBackoffMs]: 0 },
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary.skipped).toBe(false);
  });

  it('P0-5: skips while on battery when pauseOnBattery is set', async () => {
    const queue = makeQueueStub();
    const drain = makeDrain({
      queue: queue.store,
      budget: makeBudgetStub(0).store,
      settings: { [SKILL_DRAIN_KEYS.pauseOnBattery]: true },
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: true,
    });

    expect(summary).toMatchObject({ skipped: true, reason: 'on-battery' });
    expect(queue.tryClaim).not.toHaveBeenCalled();
  });

  it('P0-5: runs on battery when pauseOnBattery is off', async () => {
    const queue = makeQueueStub();
    const drain = makeDrain({
      queue: queue.store,
      budget: makeBudgetStub(0).store,
      settings: { [SKILL_DRAIN_KEYS.pauseOnBattery]: false },
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: true,
    });

    expect(summary.skipped).toBe(false);
  });

  it('P0-6: the daily token budget is a hard stop', async () => {
    const queue = makeQueueStub();
    const drain = makeDrain({
      queue: queue.store,
      budget: makeBudgetStub(2_000_000).store,
      settings: { [SKILL_DRAIN_KEYS.maxTokensPerDay]: 2_000_000 },
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({
      skipped: true,
      reason: 'daily-token-budget-exhausted',
      budgetExhausted: true,
    });
    expect(queue.tryClaim).not.toHaveBeenCalled();
  });

  it('P0-6: maxTokensPerDay = 0 means unlimited, not "always exhausted"', async () => {
    const queue = makeQueueStub();
    const drain = makeDrain({
      queue: queue.store,
      budget: makeBudgetStub(9_999_999).store,
      settings: { [SKILL_DRAIN_KEYS.maxTokensPerDay]: 0 },
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary.skipped).toBe(false);
  });

  it('skips when the master switch is off', async () => {
    const queue = makeQueueStub();
    const budget = makeBudgetStub(0);
    const drain = makeDrain({
      queue: queue.store,
      budget: budget.store,
      settings: { [SKILL_DRAIN_KEYS.enabled]: false },
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({ skipped: true, reason: 'disabled' });
    expect(queue.tryClaim).not.toHaveBeenCalled();
    // The tray's pause must cost nothing at all — not even a budget read.
    expect(budget.spentToday).not.toHaveBeenCalled();
  });

  it('skips when the cron slot was already cancelled', async () => {
    const queue = makeQueueStub();
    const controller = new AbortController();
    controller.abort();
    const drain = makeDrain({
      queue: queue.store,
      budget: makeBudgetStub(0).store,
    });

    const summary = await drain.drain({
      tier: 'frequent',
      signal: controller.signal,
      onBattery: false,
    });

    expect(summary).toMatchObject({ skipped: true, reason: 'aborted' });
    expect(queue.reapStale).not.toHaveBeenCalled();
  });

  describe('gate order', () => {
    /** Runs with every gate tripped, peeling one off per step. */
    const run = async (settings: DrainSettings) => {
      const queue = makeQueueStub();
      const drain = makeDrain({
        queue: queue.store,
        budget: makeBudgetStub(1_000).store,
        foreground: makeTracker(1_000),
        settings: { ...ALL_GATES_TRIPPED, ...settings },
      });
      const summary = await drain.drain({
        tier: 'frequent',
        signal: liveSignal(),
        onBattery: true,
      });
      expect(queue.tryClaim).not.toHaveBeenCalled();
      return summary.reason;
    };

    it('is enabled → budget → battery → foreground', async () => {
      await expect(run({})).resolves.toBe('disabled');
      await expect(run({ [SKILL_DRAIN_KEYS.enabled]: true })).resolves.toBe(
        'daily-token-budget-exhausted',
      );
      await expect(
        run({
          [SKILL_DRAIN_KEYS.enabled]: true,
          [SKILL_DRAIN_KEYS.maxTokensPerDay]: 0,
        }),
      ).resolves.toBe('on-battery');
      await expect(
        run({
          [SKILL_DRAIN_KEYS.enabled]: true,
          [SKILL_DRAIN_KEYS.maxTokensPerDay]: 0,
          [SKILL_DRAIN_KEYS.pauseOnBattery]: false,
        }),
      ).resolves.toBe('foreground-active');
    });
  });

  describe('never throws', () => {
    it('resolves with an error field when the store throws', async () => {
      const queue = makeQueueStub();
      queue.reapStale.mockImplementation(() => {
        throw new Error('database is locked');
      });
      const logger = makeLogger();
      const drain = makeDrain({
        logger,
        queue: queue.store,
        budget: makeBudgetStub(0).store,
      });

      const summary = await drain.drain({
        tier: 'nightly',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(summary.error).toBe('database is locked');
      expect(summary.skipped).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('resolves when reading settings throws', async () => {
      const queue = makeQueueStub();
      // A provider whose getConfiguration throws must degrade to defaults, not
      // take the cron handler down with it.
      const exploding = {
        getConfiguration: () => {
          throw new Error('settings file unreadable');
        },
      } as unknown as IWorkspaceProvider;
      const drain = new SkillDrainService(
        makeLogger(),
        queue.store,
        makeBudgetStub(0).store,
        makeTracker(),
        exploding,
      );

      await expect(
        drain.drain({
          tier: 'frequent',
          signal: liveSignal(),
          onBattery: false,
        }),
      ).resolves.toMatchObject({ skipped: false });
    });
  });

  /**
   * B3.5.1 — the three phase-3 gates are WEEKLY-tier stages, and the weekly
   * tick is the only one that may dispatch them.
   *
   * `DRAIN_TIER_STAGES` is a plain data table, so asserting against it directly
   * would only prove the table equals itself. These run the REAL drain over a
   * queue holding one row per gate stage and assert on what was CLAIMED and
   * which handler actually ran — the two things a tier filter can get wrong
   * without the table changing at all.
   *
   * The negative half is the half that matters. A frequent tick that dispatched
   * `judge-panel` would spend judge tokens 96 times a day instead of once a
   * week, and nothing about the summary would look unusual.
   */
  describe('weekly-tier gate stages (B3.5.1)', () => {
    const GATE_STAGES: SkillQueueStage[] = [
      'judge-panel',
      'replay',
      'trigger-eval',
    ];
    const WS = 'D:/repo';

    function gateRow(stage: SkillQueueStage, i: number): SkillQueueRow {
      return {
        id: `row-${i}`,
        sessionId: `s-${i}`,
        workspaceRoot: WS,
        transcriptPath: null,
        source: 'session-end',
        stage,
        dependsOn: null,
        status: 'queued',
        turnCount: 6,
        attemptCount: 0,
        enqueuedAt: 1_770_000_000_000 + i,
        notBefore: 0,
        claimedBy: null,
        claimedAt: null,
        finishedAt: null,
        lane: null,
        reason: null,
        lastError: null,
        candidateId: null,
        payload: { candidateId: 'cand-1' },
      };
    }

    /** A stub serving one queued row per gate stage, from one workspace. */
    function makeGateQueue() {
      const rows = GATE_STAGES.map(gateRow);
      const parts = {
        reapStale: jest.fn(() => 0),
        listEligibleWorkspaces: jest.fn(() => [WS]),
        listEligible: jest.fn(() => rows),
        markWorkspaceDrained: jest.fn(),
        tryClaim: jest.fn((id: string) => {
          const row = rows.find((r) => r.id === id);
          return row ? { ...row, status: 'claimed' as const } : null;
        }),
        touchClaim: jest.fn(() => true),
        mergePayload: jest.fn(),
        requeue: jest.fn(() => true),
        markDone: jest.fn(),
        markFailed: jest.fn(),
        markUnscored: jest.fn(),
        markSkipped: jest.fn(),
      };
      return { ...parts, store: parts as unknown as SkillQueueStore };
    }

    /**
     * `perWorkspaceBatch` is raised to 3 for these runs ONLY. The weekly tier is
     * single-round, so with the shipped batch of 1 a tick would claim exactly
     * one of the three rows and the assertion would say nothing about the other
     * two. This is a test-fixture concern, not a recommendation — the shipped
     * value stays 1 (see `DRAIN_TIER_LIMITS`).
     */
    function run(tier: DrainTier) {
      const queue = makeGateQueue();
      const drain = makeDrain({
        queue: queue.store,
        budget: makeBudgetStub(0).store,
        settings: {
          [SKILL_DRAIN_KEYS.maxItemsPerRun]: 4,
          [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 3,
        },
      });
      const handlers = new Map<SkillQueueStage, jest.Mock>();
      for (const stage of GATE_STAGES) {
        const handler = jest.fn(async () => ({ outcome: 'done' as const }));
        handlers.set(stage, handler);
        drain.registerStageHandler(stage, handler);
      }
      return {
        queue,
        handlers,
        summary: drain.drain({ tier, signal: liveSignal(), onBattery: false }),
      };
    }

    it('a weekly tick claims and dispatches all three', async () => {
      const { queue, handlers, summary } = run('weekly');

      expect(await summary).toMatchObject({ claimed: 3, done: 3 });
      expect(queue.tryClaim).toHaveBeenCalledTimes(3);
      for (const stage of GATE_STAGES) {
        expect(handlers.get(stage)).toHaveBeenCalledTimes(1);
      }
      // Dispatched to a real handler, not swallowed by the "no handler" path.
      expect(queue.markSkipped).not.toHaveBeenCalled();
    });

    it('hands the handler the claimed row and a live touch()', async () => {
      const { handlers, summary } = run('weekly');
      await summary;

      const ctx = handlers.get('replay')?.mock.calls[0][0];
      expect(ctx.row).toMatchObject({ stage: 'replay', status: 'claimed' });
      expect(ctx.tier).toBe('weekly');
      expect(ctx.touch()).toBe(true);
    });

    it.each(['frequent', 'nightly'] as const)(
      'a %s tick claims none of them',
      async (tier) => {
        const { queue, handlers, summary } = run(tier);

        expect(await summary).toMatchObject({ claimed: 0, skippedItems: 0 });
        expect(queue.tryClaim).not.toHaveBeenCalled();
        for (const stage of GATE_STAGES) {
          expect(handlers.get(stage)).not.toHaveBeenCalled();
        }
      },
    );

    it('NEGATIVE CONTROL — the same queue is not simply empty', async () => {
      // Without this, "claimed 0" above would also hold for a stub that served
      // no rows at all, and the tier filter would be untested.
      const { queue } = run('nightly');
      expect(queue.listEligible()).toHaveLength(3);
    });
  });

  describe('R5 — stale-claim TTL assertion', () => {
    it('warns when the TTL is below 3x the longest stage timeout', () => {
      const logger = makeLogger();
      const drain = makeDrain({
        logger,
        queue: makeQueueStub().store,
        budget: makeBudgetStub(0).store,
        settings: {
          [SKILL_DRAIN_KEYS.staleClaimTtlMs]:
            STALE_CLAIM_TTL_SAFETY_FACTOR * MAX_STAGE_TIMEOUT_MS - 1,
        },
      });

      expect(drain.assertStaleClaimTtl()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('staleClaimTtlMs'),
        expect.objectContaining({
          required: STALE_CLAIM_TTL_SAFETY_FACTOR * MAX_STAGE_TIMEOUT_MS,
        }),
      );
    });

    it('accepts the shipped default of 900000ms', () => {
      const logger = makeLogger();
      const drain = makeDrain({
        logger,
        queue: makeQueueStub().store,
        budget: makeBudgetStub(0).store,
      });

      expect(drain.assertStaleClaimTtl()).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('runs the assertion and the reap at the head of every tick', async () => {
      const queue = makeQueueStub();
      const logger = makeLogger();
      const drain = makeDrain({
        logger,
        queue: queue.store,
        budget: makeBudgetStub(0).store,
        settings: { [SKILL_DRAIN_KEYS.staleClaimTtlMs]: 60_000 },
      });

      await drain.drain({
        tier: 'frequent',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(logger.warn).toHaveBeenCalled();
      expect(queue.reapStale).toHaveBeenCalledWith(60_000, expect.any(Number));
    });
  });
});
