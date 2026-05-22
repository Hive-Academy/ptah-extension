import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { MemoryDecayJob } from './memory-decay.job';
import type { MemoryStore } from './memory.store';
import type { SalienceScorer } from './salience-scorer';
import type { MemoryCuratorService } from './memory-curator.service';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

describe('MemoryDecayJob', () => {
  it('pushes a decay-run event into the curator ring buffer after a successful run', async () => {
    const store = {
      all: jest.fn(() => []),
      forget: jest.fn(),
      updateSalience: jest.fn(),
    } as unknown as MemoryStore;
    const scorer = {
      score: jest.fn(),
      scoreMemory: jest.fn(() => 0),
    } as unknown as SalienceScorer;
    const recordDecayEvent = jest.fn();
    const curator = {
      recordDecayEvent,
    } as unknown as MemoryCuratorService;
    const job = new MemoryDecayJob(makeLogger(), store, scorer, curator);
    const stats = await job.run({ halflifeDays: 7 });
    expect(stats).toMatchObject({
      scanned: 0,
      demoted: 0,
      archived: 0,
      expired: 0,
    });
    expect(recordDecayEvent).toHaveBeenCalledTimes(1);
    expect(recordDecayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scanned: 0,
        demoted: 0,
        archived: 0,
        expired: 0,
      }),
      expect.any(Number),
    );
  });

  it('does not throw when curator.recordDecayEvent throws', async () => {
    const store = {
      all: jest.fn(() => []),
      forget: jest.fn(),
      updateSalience: jest.fn(),
    } as unknown as MemoryStore;
    const scorer = {
      score: jest.fn(),
      scoreMemory: jest.fn(() => 0),
    } as unknown as SalienceScorer;
    const curator = {
      recordDecayEvent: jest.fn(() => {
        throw new Error('ring buffer wedged');
      }),
    } as unknown as MemoryCuratorService;
    const logger = makeLogger();
    const job = new MemoryDecayJob(logger, store, scorer, curator);
    await expect(job.run({ halflifeDays: 7 })).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[memory-curator] failed to record decay event',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});
