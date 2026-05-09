import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  MemoryWriterAdapter,
  formatSeedPrefix,
  parseSeedPrefix,
  sha256Hex,
} from './memory-writer.adapter';
import type { MemoryStore } from './memory.store';
import { memoryId, type Memory, type MemoryListResponse } from './memory.types';

interface StoreMock {
  list: jest.Mock;
  forget: jest.Mock;
  insertMemoryWithChunks: jest.Mock;
}

interface LoggerMock {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function makeStore(initial: readonly Memory[] = []): StoreMock {
  const memories = [...initial];
  return {
    list: jest.fn(
      (): MemoryListResponse => ({
        memories: [...memories],
        total: memories.length,
      }),
    ),
    forget: jest.fn(),
    insertMemoryWithChunks: jest.fn(
      async () => 'new-id-' + (Math.random() * 1e6).toFixed(0),
    ),
  };
}

function makeLogger(): LoggerMock {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeAdapter(
  store: StoreMock,
  logger: LoggerMock,
): MemoryWriterAdapter {
  return new MemoryWriterAdapter(
    store as unknown as MemoryStore,
    logger as unknown as Logger,
  );
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = Date.now();
  return {
    id: memoryId('mem-' + now),
    sessionId: null,
    workspaceRoot: '/workspace/foo',
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
  workspaceRoot: '/workspace/foo',
  subject: 'project-profile',
  content: 'Hello world',
  tier: 'core' as const,
  kind: 'preference' as const,
  pinned: true,
};

describe('MemoryWriterAdapter.upsert', () => {
  it('upsert-inserts-when-no-match: writes a new memory with the prefix line', async () => {
    const store = makeStore([]);
    const logger = makeLogger();
    const adapter = makeAdapter(store, logger);

    const result = await adapter.upsert(baseReq);

    expect(store.list).toHaveBeenCalledWith({ tier: 'core', limit: 500 });
    expect(store.forget).not.toHaveBeenCalled();
    expect(store.insertMemoryWithChunks).toHaveBeenCalledTimes(1);
    const [insert, chunks] = store.insertMemoryWithChunks.mock.calls[0] as [
      {
        content: string;
        subject: string;
        workspaceRoot: string;
        tier: string;
        kind: string;
        pinned: boolean;
        salience: number;
        decayRate: number;
        sourceMessageIds: readonly string[];
        expiresAt: null;
        sessionId: null;
      },
      ReadonlyArray<{ ord: number; text: string; tokenCount: number }>,
    ];
    expect(insert.content.startsWith('<!-- ptah-seed:hash=')).toBe(true);
    expect(
      /^<!-- ptah-seed:hash=[a-f0-9]{64};fp=[a-f0-9]{16};v=1 -->\n/.test(
        insert.content,
      ),
    ).toBe(true);
    expect(insert.subject).toBe('project-profile');
    expect(insert.workspaceRoot).toBe('/workspace/foo');
    expect(insert.tier).toBe('core');
    expect(insert.kind).toBe('preference');
    expect(insert.pinned).toBe(true);
    expect(insert.salience).toBe(1.0);
    expect(insert.decayRate).toBe(0);
    expect(insert.sourceMessageIds).toEqual([]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].ord).toBe(0);
    expect(chunks[0].text).toBe(insert.content);
    expect(chunks[0].tokenCount).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe('inserted');
    expect(typeof result.id).toBe('string');
  });

  it('upsert-replaces-when-content-changed: forgets existing then inserts', async () => {
    const oldHash = sha256Hex('project-profile old-content');
    const existing = makeMemory({
      id: memoryId('existing-1'),
      content: formatSeedPrefix(oldHash, FP) + 'old-content',
    });
    const store = makeStore([existing]);
    const logger = makeLogger();
    const adapter = makeAdapter(store, logger);

    const result = await adapter.upsert({ ...baseReq, content: 'new-content' });

    expect(store.forget).toHaveBeenCalledTimes(1);
    expect(store.forget).toHaveBeenCalledWith(existing.id);
    expect(store.insertMemoryWithChunks).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('replaced');
  });

  it('upsert-skips-when-hash-unchanged: zero forget, zero insert, debug log', async () => {
    const hash = sha256Hex('project-profile Hello world');
    const existing = makeMemory({
      id: memoryId('existing-unchanged'),
      content: formatSeedPrefix(hash, FP) + 'Hello world',
    });
    const store = makeStore([existing]);
    const logger = makeLogger();
    const adapter = makeAdapter(store, logger);

    const result = await adapter.upsert(baseReq);

    expect(store.forget).not.toHaveBeenCalled();
    expect(store.insertMemoryWithChunks).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'unchanged', id: existing.id });
    expect(logger.debug).toHaveBeenCalledWith(
      "[SetupWizard] Memory 'project-profile' unchanged; skipping reseed",
    );
  });

  it('upsert-survives-workspace-move: matches by fingerprint regardless of workspaceRoot', async () => {
    const hash = sha256Hex('project-profile Hello world');
    const existing = makeMemory({
      id: memoryId('existing-moved'),
      workspaceRoot: '/old/path',
      content: formatSeedPrefix(hash, FP) + 'Hello world',
    });
    const store = makeStore([existing]);
    const logger = makeLogger();
    const adapter = makeAdapter(store, logger);

    // Same content, new workspaceRoot — should be unchanged.
    const r1 = await adapter.upsert({
      ...baseReq,
      workspaceRoot: '/new/path',
      content: 'Hello world',
    });
    expect(r1).toEqual({ status: 'unchanged', id: existing.id });
    expect(store.forget).not.toHaveBeenCalled();
    expect(store.insertMemoryWithChunks).not.toHaveBeenCalled();

    // Now change content — should replace and write with new workspaceRoot.
    const r2 = await adapter.upsert({
      ...baseReq,
      workspaceRoot: '/new/path',
      content: 'Different body',
    });
    expect(r2.status).toBe('replaced');
    expect(store.forget).toHaveBeenCalledWith(existing.id);
    expect(store.insertMemoryWithChunks).toHaveBeenCalledTimes(1);
    const [insert] = store.insertMemoryWithChunks.mock.calls[0] as [
      { workspaceRoot: string },
      unknown,
    ];
    expect(insert.workspaceRoot).toBe('/new/path');
  });

  it('prefix-format-roundtrip: format then parse recovers the same fields', () => {
    const hash = sha256Hex('subj content');
    const fp = '0123456789abcdef';
    const prefixed = formatSeedPrefix(hash, fp) + 'arbitrary body';
    expect(parseSeedPrefix(prefixed)).toEqual({ hash, fp });

    // Body without prefix returns null.
    expect(parseSeedPrefix('just some markdown body')).toBeNull();
    expect(
      parseSeedPrefix('<!-- ptah-seed:hash=tooShort;fp=zz;v=1 -->\nbody'),
    ).toBeNull();
    // Wrong version line.
    expect(
      parseSeedPrefix(
        `<!-- ptah-seed:hash=${'a'.repeat(64)};fp=${'b'.repeat(16)};v=2 -->\nbody`,
      ),
    ).toBeNull();
  });

  it('multiple-stale-matches-cleanup: forgets all matches, inserts one new entry', async () => {
    const someHash = sha256Hex('whatever');
    const m1 = makeMemory({
      id: memoryId('stale-1'),
      content: formatSeedPrefix(someHash, FP) + 'a',
    });
    const m2 = makeMemory({
      id: memoryId('stale-2'),
      content: formatSeedPrefix(someHash, FP) + 'b',
    });
    const m3 = makeMemory({
      id: memoryId('stale-3'),
      content: formatSeedPrefix(someHash, FP) + 'c',
    });
    // Decoy: different fingerprint, must NOT be touched.
    const decoy = makeMemory({
      id: memoryId('decoy'),
      content: formatSeedPrefix(someHash, FP_OTHER) + 'd',
    });
    const store = makeStore([m1, m2, m3, decoy]);
    const logger = makeLogger();
    const adapter = makeAdapter(store, logger);

    const result = await adapter.upsert(baseReq);

    expect(store.forget).toHaveBeenCalledTimes(3);
    expect(store.forget).toHaveBeenCalledWith(m1.id);
    expect(store.forget).toHaveBeenCalledWith(m2.id);
    expect(store.forget).toHaveBeenCalledWith(m3.id);
    expect(store.forget).not.toHaveBeenCalledWith(decoy.id);
    expect(store.insertMemoryWithChunks).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('replaced');
  });
});
