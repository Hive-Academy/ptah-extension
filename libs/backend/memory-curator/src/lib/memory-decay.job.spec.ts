import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { MemoryDecayJob } from './memory-decay.job';
import type { MemoryCuratorService } from './memory-curator.service';
import type { MemoryStore } from './memory.store';
import { memoryId, type Memory } from './memory.types';

function logger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: memoryId('01J000000000000000000000D1'),
    sessionId: null,
    workspaceRoot: '/ws',
    tier: 'recall',
    kind: 'fact',
    subject: null,
    content: 'content',
    sourceMessageIds: [],
    salience: 1,
    decayRate: 0.01,
    hits: 0,
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: 0,
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
  };
}

function harness(rows: readonly Memory[]) {
  const store = {
    all: jest.fn(() => rows),
    forget: jest.fn(),
    updateTier: jest.fn(),
  } as unknown as MemoryStore;
  const curator = {
    recordDecayEvent: jest.fn(),
  } as unknown as MemoryCuratorService;
  return { store, curator };
}

describe('MemoryDecayJob during ranking-only transition', () => {
  it('changes tiers without rewriting stored base salience', async () => {
    const now = 100 * 86_400_000;
    const archivalCandidate = memory({
      salience: 0,
      lastUsedAt: now - 30 * 86_400_000,
    });
    const { store, curator } = harness([archivalCandidate]);
    const job = new MemoryDecayJob(logger(), store, curator);

    await expect(
      job.run({ halflifeDays: 7, nowMs: now }),
    ).resolves.toMatchObject({ archived: 1 });
    expect(store.updateTier).toHaveBeenCalledWith(
      archivalCandidate.id,
      'archival',
    );
  });

  it('expires rows and records the diagnostic event', async () => {
    const expired = memory({ expiresAt: 1 });
    const { store, curator } = harness([expired]);
    const job = new MemoryDecayJob(logger(), store, curator);

    await expect(
      job.run({ halflifeDays: 7, nowMs: 2 }),
    ).resolves.toMatchObject({ expired: 1 });
    expect(store.forget).toHaveBeenCalledWith(expired.id);
    expect(curator.recordDecayEvent).toHaveBeenCalledTimes(1);
  });

  it('swallows diagnostic recording failures', async () => {
    const log = logger();
    const { store, curator } = harness([]);
    (curator.recordDecayEvent as jest.Mock).mockImplementation(() => {
      throw new Error('closed');
    });
    const job = new MemoryDecayJob(log, store, curator);

    await expect(job.run({ halflifeDays: 7 })).resolves.toBeDefined();
    expect(log.warn).toHaveBeenCalledWith(
      '[memory-curator] failed to record decay event',
      expect.objectContaining({ error: 'closed' }),
    );
  });
});
