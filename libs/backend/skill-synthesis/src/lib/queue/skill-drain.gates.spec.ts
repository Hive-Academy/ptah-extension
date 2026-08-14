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
} from './skill-drain.service';
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
