import type {
  BackgroundWorkAdmission,
  Logger,
} from '@ptah-extension/vscode-core';
import { MEMORY_RETENTION_LIMITS } from './memory-retention-config';
import { GOVERNOR_LANE, RetentionRunBudget } from './retention-run-budget';

function logger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeBudget(
  input: {
    time?: number;
    governor?: BackgroundWorkAdmission | null;
    signal?: AbortSignal;
    onBattery?: () => boolean;
    foreground?: () => number;
  } = {},
) {
  const clock = { value: input.time ?? 0 };
  const log = logger();
  const budget = new RetentionRunBudget({
    options: {
      signal: input.signal ?? new AbortController().signal,
      isOnBattery: input.onBattery ?? (() => false),
      msSinceForegroundActivity: input.foreground ?? (() => Infinity),
    },
    limits: MEMORY_RETENTION_LIMITS,
    now: () => clock.value,
    startedAt: 0,
    logger: log,
    governor: input.governor ?? null,
    queueBatchSize: 500,
    archiveBatchSize: 400,
    deleteBatchSize: 200,
  });
  return { budget, clock, log };
}

describe('RetentionRunBudget', () => {
  it('applies hard stops in abort, battery, foreground, time order', () => {
    const controller = new AbortController();
    let battery = true;
    let foreground = 0;
    const { budget, clock } = makeBudget({
      signal: controller.signal,
      onBattery: () => battery,
      foreground: () => foreground,
    });
    controller.abort();
    expect(budget.hardStop()).toBe('aborted');
    const second = makeBudget({
      onBattery: () => battery,
      foreground: () => foreground,
    });
    expect(second.budget.hardStop()).toBe('on-battery');
    battery = false;
    expect(second.budget.hardStop()).toBe('foreground-active');
    foreground = Infinity;
    second.clock.value = MEMORY_RETENTION_LIMITS.maxRunMs;
    expect(second.budget.hardStop()).toBe('time-budget');
    clock.value = 1;
  });

  it('keeps queue and memory row allowances independent', () => {
    const { budget } = makeBudget();
    budget.consumeQueueRows(10);
    budget.consumeMemoryRows(25);
    expect(budget.queueRowRoom()).toBe(
      MEMORY_RETENTION_LIMITS.maxRowsPerRun - 10,
    );
    expect(budget.memoryRowRoom()).toBe(
      MEMORY_RETENTION_LIMITS.maxMemoryRowsPerRun - 25,
    );
  });

  it('halves each batch kind independently down to the floor', () => {
    const { budget } = makeBudget();
    budget.observe('queue', 121);
    budget.observe('archive', 121);
    budget.observe('delete', 121);
    expect([
      budget.batchSize('queue'),
      budget.batchSize('archive'),
      budget.batchSize('delete'),
    ]).toEqual([250, 200, 100]);
    budget.observe('delete', 121);
    budget.observe('delete', 121);
    expect(budget.batchSize('delete')).toBe(
      MEMORY_RETENTION_LIMITS.minBatchSize,
    );
    expect(budget.batchSize('queue')).toBe(250);
  });

  it('yields through setImmediate', async () => {
    const spy = jest.spyOn(global, 'setImmediate');
    await makeBudget().budget.yieldToEventLoop();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('fast-paths absent and clear governors', async () => {
    await expect(makeBudget().budget.waitForGovernor()).resolves.toBeNull();
    const governor = {
      isClear: () => true,
      whenClear: jest.fn(),
    } as BackgroundWorkAdmission;
    await expect(
      makeBudget({ governor }).budget.waitForGovernor(),
    ).resolves.toBeNull();
    expect(governor.whenClear).not.toHaveBeenCalled();
  });

  it.each([
    [1_000, 59_000],
    [59_500, 500],
  ])(
    'caps the governor at the remaining budget at %i ms',
    async (elapsed, remaining) => {
      const governor = {
        isClear: () => false,
        whenClear: jest.fn(async () => 'clear' as const),
      };
      const { budget } = makeBudget({ time: elapsed, governor });
      await expect(budget.waitForGovernor()).resolves.toBeNull();
      expect(governor.whenClear).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal),
        lane: GOVERNOR_LANE,
        maxDeferMs: remaining,
      });
    },
  );

  it('does not call the governor after the deadline', async () => {
    const governor = {
      isClear: () => false,
      whenClear: jest.fn(),
    } as BackgroundWorkAdmission;
    await expect(
      makeBudget({ time: 60_000, governor }).budget.waitForGovernor(),
    ).resolves.toBe('time-budget');
    expect(governor.whenClear).not.toHaveBeenCalled();
  });

  it('maps AbortError to aborted', async () => {
    const governor = {
      isClear: () => false,
      whenClear: jest.fn(async () => {
        throw Object.assign(new Error('disposed'), { name: 'AbortError' });
      }),
    };
    await expect(
      makeBudget({ governor }).budget.waitForGovernor(),
    ).resolves.toBe('aborted');
  });

  it('warns once per budget when an unexpected governor failure fails open', async () => {
    const governor = {
      isClear: () => false,
      whenClear: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    const first = makeBudget({ governor });
    await first.budget.waitForGovernor();
    await first.budget.waitForGovernor();
    expect(first.log.warn).toHaveBeenCalledTimes(1);
    const second = makeBudget({ governor });
    await second.budget.waitForGovernor();
    expect(second.log.warn).toHaveBeenCalledTimes(1);
  });
});
