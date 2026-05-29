import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  MemoryWriterAdapter,
  formatSeedPrefix,
  sha256Hex,
} from './memory-writer.adapter';
import type { MemoryStore } from './memory.store';
import { memoryId, type Memory, type MemoryTier } from './memory.types';

interface ListBackedStore {
  list: jest.Mock;
  findBySubjectAndTier: jest.Mock;
  forget: jest.Mock;
  insertMemoryWithChunks: jest.Mock;
}

interface IndexedStore {
  findBySubjectAndTier: jest.Mock;
  forget: jest.Mock;
  insertMemoryWithChunks: jest.Mock;
}

function makeIndexedStore(initial: readonly Memory[]): IndexedStore {
  const mems = [...initial];
  return {
    findBySubjectAndTier: jest.fn(
      (subject: string, tier: MemoryTier): readonly Memory[] =>
        mems.filter((m) => m.subject === subject && m.tier === tier),
    ),
    forget: jest.fn(),
    insertMemoryWithChunks: jest.fn(async () => 'new-id'),
  };
}

function makeListBackedStore(initial: readonly Memory[]): ListBackedStore {
  const mems = [...initial];
  const listFn = (opts: {
    tier?: MemoryTier;
    limit?: number;
  }): readonly Memory[] => {
    const limit = opts?.limit ?? Number.POSITIVE_INFINITY;
    const filtered = opts?.tier
      ? mems.filter((m) => m.tier === opts.tier)
      : mems.slice();
    return filtered.slice(0, limit);
  };
  return {
    list: jest.fn(listFn),
    findBySubjectAndTier: jest.fn(
      (subject: string, tier: MemoryTier): readonly Memory[] =>
        listFn({ tier, limit: 500 }).filter((m) => m.subject === subject),
    ),
    forget: jest.fn(),
    insertMemoryWithChunks: jest.fn(async () => 'new-id'),
  };
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = Date.now();
  return {
    id: memoryId('mem-' + now + Math.random()),
    sessionId: null,
    workspaceRoot: '/ws',
    tier: 'core',
    kind: 'preference',
    subject: 'project-profile',
    content: 'body',
    sourceMessageIds: [],
    salience: 1,
    decayRate: 0,
    hits: 0,
    pinned: true,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    expiresAt: null,
    ...overrides,
  };
}

const FP = '0123456789abcdef';
const FP_OTHER = 'fedcba9876543210';
const baseReq = {
  workspaceFingerprint: FP,
  workspaceRoot: '/ws',
  subject: 'project-profile',
  content: 'Hello world',
  tier: 'core' as const,
  kind: 'preference' as const,
  pinned: true,
};

const scenarios: Array<{
  name: string;
  preexisting: () => readonly Memory[];
  request: typeof baseReq;
  expectedStatus: 'inserted' | 'replaced' | 'unchanged';
  expectedForgetCount: number;
  expectedInsertCount: number;
}> = [
  {
    name: 'insert when no match',
    preexisting: () => [],
    request: baseReq,
    expectedStatus: 'inserted',
    expectedForgetCount: 0,
    expectedInsertCount: 1,
  },
  {
    name: 'unchanged when hash matches',
    preexisting: () => [
      makeMemory({
        id: memoryId('unchanged'),
        content:
          formatSeedPrefix(sha256Hex('project-profile Hello world'), FP) +
          'Hello world',
      }),
    ],
    request: baseReq,
    expectedStatus: 'unchanged',
    expectedForgetCount: 0,
    expectedInsertCount: 0,
  },
  {
    name: 'replace when content changed',
    preexisting: () => [
      makeMemory({
        id: memoryId('replace-me'),
        content: formatSeedPrefix(sha256Hex('project-profile old'), FP) + 'old',
      }),
    ],
    request: { ...baseReq, content: 'new-content' },
    expectedStatus: 'replaced',
    expectedForgetCount: 1,
    expectedInsertCount: 1,
  },
  {
    name: 'ignore matches with different fingerprint',
    preexisting: () => [
      makeMemory({
        id: memoryId('decoy-fp'),
        content:
          formatSeedPrefix(sha256Hex('project-profile Hello world'), FP_OTHER) +
          'Hello world',
      }),
    ],
    request: baseReq,
    expectedStatus: 'inserted',
    expectedForgetCount: 0,
    expectedInsertCount: 1,
  },
];

describe.each(scenarios)('MemoryWriterAdapter dedup parity — $name', (s) => {
  it('indexed store produces the expected status/forget/insert counts', async () => {
    const store = makeIndexedStore(s.preexisting());
    const adapter = new MemoryWriterAdapter(
      store as unknown as MemoryStore,
      makeLogger(),
    );

    const result = await adapter.upsert(s.request);

    expect(result.status).toBe(s.expectedStatus);
    expect(store.forget).toHaveBeenCalledTimes(s.expectedForgetCount);
    expect(store.insertMemoryWithChunks).toHaveBeenCalledTimes(
      s.expectedInsertCount,
    );
  });

  it('list-backed store produces the SAME decision as indexed store', async () => {
    const indexed = makeIndexedStore(s.preexisting());
    const listed = makeListBackedStore(s.preexisting());

    const a1 = new MemoryWriterAdapter(
      indexed as unknown as MemoryStore,
      makeLogger(),
    );
    const a2 = new MemoryWriterAdapter(
      listed as unknown as MemoryStore,
      makeLogger(),
    );

    const r1 = await a1.upsert(s.request);
    const r2 = await a2.upsert(s.request);

    expect(r1.status).toBe(r2.status);
    expect(indexed.forget.mock.calls.length).toBe(listed.forget.mock.calls.length);
    expect(indexed.insertMemoryWithChunks.mock.calls.length).toBe(
      listed.insertMemoryWithChunks.mock.calls.length,
    );
  });
});
