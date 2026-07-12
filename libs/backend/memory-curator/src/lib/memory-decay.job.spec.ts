import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { MemoryDecayJob } from './memory-decay.job';
import type { MemoryStore } from './memory.store';
import type { SalienceScorer } from './salience-scorer';
import type { MemoryCuratorService } from './memory-curator.service';
import type { Memory, MemoryId, MemoryTier } from './memory.types';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

const NOW = 1_700_000_000_000;

function makeMemory(
  overrides: Partial<Omit<Memory, 'id'>> & { id: string },
): Memory {
  return {
    sessionId: null,
    workspaceRoot: null,
    tier: 'recall',
    kind: 'fact',
    subject: null,
    content: 'test content',
    sourceMessageIds: [],
    salience: 0.5,
    decayRate: 1,
    hits: 0,
    pinned: false,
    createdAt: NOW,
    updatedAt: NOW,
    lastUsedAt: NOW,
    expiresAt: null,
    request: null,
    investigated: null,
    learned: null,
    completed: null,
    nextSteps: null,
    type: 'discovery',
    concepts: [],
    files: [],
    ...overrides,
  } as Memory;
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

  describe('recall → core promotion', () => {
    it('promotes a recall memory with hits >= 10 and recomputed salience >= 0.9', async () => {
      const memory = makeMemory({
        id: 'm-promote',
        tier: 'recall',
        hits: 10,
        salience: 0.6,
        lastUsedAt: NOW,
      });
      const store = {
        all: jest.fn(() => [memory]),
        forget: jest.fn(),
        updateSalience: jest.fn(),
      } as unknown as MemoryStore;
      const scorer = {
        score: jest.fn(),
        scoreMemory: jest.fn(() => 0.9),
      } as unknown as SalienceScorer;
      const curator = {
        recordDecayEvent: jest.fn(),
      } as unknown as MemoryCuratorService;
      const job = new MemoryDecayJob(makeLogger(), store, scorer, curator);

      const stats = await job.run({ halflifeDays: 7, nowMs: NOW });

      expect(stats).toMatchObject({
        scanned: 1,
        promoted: 1,
        demoted: 0,
        archived: 0,
        expired: 0,
      });
      expect(store.updateSalience).toHaveBeenCalledWith(memory.id, 0.9, 'core');
    });

    it('does NOT promote a recall memory with hits just below the threshold (hits === 9)', async () => {
      const memory = makeMemory({
        id: 'm-low-hits',
        tier: 'recall',
        hits: 9,
        salience: 0.6,
        lastUsedAt: NOW,
      });
      const store = {
        all: jest.fn(() => [memory]),
        forget: jest.fn(),
        updateSalience: jest.fn(),
      } as unknown as MemoryStore;
      const scorer = {
        score: jest.fn(),
        // High salience, but hits is below PROMOTE_HITS_THRESHOLD (10).
        scoreMemory: jest.fn(() => 0.95),
      } as unknown as SalienceScorer;
      const curator = {
        recordDecayEvent: jest.fn(),
      } as unknown as MemoryCuratorService;
      const job = new MemoryDecayJob(makeLogger(), store, scorer, curator);

      const stats = await job.run({ halflifeDays: 7, nowMs: NOW });

      expect(stats).toMatchObject({
        promoted: 0,
        demoted: 0,
        archived: 0,
        expired: 0,
      });
      // Salience is refreshed but the tier argument must be omitted (no transition).
      expect(store.updateSalience).toHaveBeenCalledWith(
        memory.id,
        0.95,
        undefined,
      );
    });

    it('does NOT promote a recall memory with hits >= 10 but salience just below 0.9', async () => {
      const memory = makeMemory({
        id: 'm-low-salience',
        tier: 'recall',
        hits: 12,
        salience: 0.6,
        lastUsedAt: NOW,
      });
      const store = {
        all: jest.fn(() => [memory]),
        forget: jest.fn(),
        updateSalience: jest.fn(),
      } as unknown as MemoryStore;
      const scorer = {
        score: jest.fn(),
        scoreMemory: jest.fn(() => 0.899999),
      } as unknown as SalienceScorer;
      const curator = {
        recordDecayEvent: jest.fn(),
      } as unknown as MemoryCuratorService;
      const job = new MemoryDecayJob(makeLogger(), store, scorer, curator);

      const stats = await job.run({ halflifeDays: 7, nowMs: NOW });

      expect(stats).toMatchObject({
        promoted: 0,
        demoted: 0,
        archived: 0,
        expired: 0,
      });
      expect(store.updateSalience).toHaveBeenCalledWith(
        memory.id,
        0.899999,
        undefined,
      );
    });

    it('handles a demotion-eligible core memory and a promotion-eligible recall memory independently in the same sweep', async () => {
      const demotable = makeMemory({
        id: 'm-demote',
        tier: 'core',
        pinned: false,
        hits: 1,
        salience: 0.8,
        lastUsedAt: NOW,
      });
      const promotable = makeMemory({
        id: 'm-promote',
        tier: 'recall',
        pinned: false,
        hits: 15,
        salience: 0.6,
        lastUsedAt: NOW,
      });
      const store = {
        all: jest.fn(() => [demotable, promotable]),
        forget: jest.fn(),
        updateSalience: jest.fn(),
      } as unknown as MemoryStore;
      const scorer = {
        score: jest.fn(),
        scoreMemory: jest.fn((m: Memory) => {
          if (m.id === demotable.id) return 0.3; // < 0.5 -> demote
          if (m.id === promotable.id) return 0.95; // >= 0.9 & hits >= 10 -> promote
          return 0;
        }),
      } as unknown as SalienceScorer;
      const curator = {
        recordDecayEvent: jest.fn(),
      } as unknown as MemoryCuratorService;
      const job = new MemoryDecayJob(makeLogger(), store, scorer, curator);

      const stats = await job.run({ halflifeDays: 7, nowMs: NOW });

      expect(stats).toMatchObject({
        scanned: 2,
        demoted: 1,
        promoted: 1,
        archived: 0,
        expired: 0,
      });
      expect(store.updateSalience).toHaveBeenCalledWith(
        demotable.id,
        0.3,
        'recall' as MemoryTier,
      );
      expect(store.updateSalience).toHaveBeenCalledWith(
        promotable.id,
        0.95,
        'core' as MemoryTier,
      );
      expect(store.updateSalience).toHaveBeenCalledTimes(2);
    });
  });
});
