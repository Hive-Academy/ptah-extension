/**
 * Specs for buildMemoryNamespace (TASK_2026_THOTH_MEMORY_READ).
 *
 * Covers:
 *   - shape: exposes search and list
 *   - search: delegates to IMemoryReader with correct args; error envelope when
 *     reader is absent or throws
 *   - list: delegates to IMemoryLister with correct args; applies defaults;
 *     error envelope when lister is absent or throws
 */

import type {
  IMemoryReader,
  IMemoryLister,
  MemoryHit,
  MemoryRecord,
} from '@ptah-extension/memory-contracts';
import {
  buildMemoryNamespace,
  type MemoryNamespaceDependencies,
} from './memory-namespace.builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHit(overrides: Partial<MemoryHit> = {}): MemoryHit {
  return {
    memoryId: 'mem-1',
    subject: 'TypeScript tips',
    content: 'full content',
    chunkText: 'chunk text here',
    score: 0.9,
    tier: 'core',
    ...overrides,
  };
}

function makeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem-1',
    subject: 'subject',
    content: 'content',
    tier: 'core',
    kind: 'fact',
    salience: 0.8,
    createdAt: 1000,
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<MemoryNamespaceDependencies> = {},
): MemoryNamespaceDependencies {
  return {
    getMemorySearch: overrides.getMemorySearch ?? (() => undefined),
    getMemoryStore: overrides.getMemoryStore ?? (() => undefined),
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => 'D:/ws'),
  };
}

function makeReader(hits: MemoryHit[] = []): IMemoryReader {
  return {
    search: jest.fn().mockResolvedValue({ hits, bm25Only: false }),
  };
}

function makeLister(records: MemoryRecord[] = []): IMemoryLister {
  return {
    listAll: jest
      .fn()
      .mockReturnValue({ memories: records, total: records.length }),
  };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildMemoryNamespace — shape', () => {
  it('exposes search and list', () => {
    const ns = buildMemoryNamespace(makeDeps());
    expect(typeof ns.search).toBe('function');
    expect(typeof ns.list).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('buildMemoryNamespace — search', () => {
  it('delegates to reader with correct args', async () => {
    const reader = makeReader([makeHit()]);
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('TypeScript', 5);

    expect(reader.search).toHaveBeenCalledWith('TypeScript', 5, 'D:/ws');
    expect('hits' in result).toBe(true);
  });

  it('uses workspaceRoot from getter', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemorySearch: () => reader,
        getWorkspaceRoot: () => 'D:/project',
      }),
    );

    await ns.search('query');

    expect(reader.search).toHaveBeenCalledWith('query', 10, 'D:/project');
  });

  it('defaults maxResults to 10', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    await ns.search('query');

    expect((reader.search as jest.Mock).mock.calls[0][1]).toBe(10);
  });

  it('returns error envelope when reader is undefined', async () => {
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => undefined }),
    );

    const result = await ns.search('TypeScript');

    expect(result.hits).toEqual([]);
    expect('error' in result && result.error).toMatch(/not available/i);
  });

  it('returns error envelope when reader throws', async () => {
    const reader: IMemoryReader = {
      search: jest.fn().mockRejectedValue(new Error('DB locked')),
    };
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('TypeScript');

    expect(result.hits).toEqual([]);
    expect('error' in result && result.error).toBe('DB locked');
  });

  it('returns hits array from reader on success', async () => {
    const hits = [makeHit({ memoryId: 'a' }), makeHit({ memoryId: 'b' })];
    const reader = makeReader(hits);
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('query');

    expect(result.hits).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('buildMemoryNamespace — list', () => {
  it('delegates to lister with correct args', async () => {
    const lister = makeLister([makeRecord()]);
    const ns = buildMemoryNamespace(makeDeps({ getMemoryStore: () => lister }));

    await ns.list({ tier: 'core', limit: 20, offset: 5 });

    expect(lister.listAll).toHaveBeenCalledWith('D:/ws', 'core', 20, 5);
  });

  it('applies defaults limit=50 offset=0 when options absent', async () => {
    const lister = makeLister();
    const ns = buildMemoryNamespace(makeDeps({ getMemoryStore: () => lister }));

    await ns.list();

    expect(lister.listAll).toHaveBeenCalledWith('D:/ws', undefined, 50, 0);
  });

  it('returns error envelope when lister is undefined', async () => {
    const ns = buildMemoryNamespace(
      makeDeps({ getMemoryStore: () => undefined }),
    );

    const result = await ns.list();

    expect(result.memories).toEqual([]);
    expect('error' in result && result.error).toMatch(/not available/i);
  });

  it('returns error envelope when lister throws', async () => {
    const lister: IMemoryLister = {
      listAll: jest.fn().mockImplementation(() => {
        throw new Error('DB closed');
      }),
    };
    const ns = buildMemoryNamespace(makeDeps({ getMemoryStore: () => lister }));

    const result = await ns.list();

    expect(result.memories).toEqual([]);
    expect('error' in result && result.error).toBe('DB closed');
  });

  it('returns memories from lister on success', async () => {
    const records = [makeRecord({ id: 'r1' }), makeRecord({ id: 'r2' })];
    const lister = makeLister(records);
    const ns = buildMemoryNamespace(makeDeps({ getMemoryStore: () => lister }));

    const result = await ns.list();

    expect(result.memories).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('uses workspaceRoot from getter', async () => {
    const lister = makeLister();
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemoryStore: () => lister,
        getWorkspaceRoot: () => 'D:/other',
      }),
    );

    await ns.list();

    expect(lister.listAll).toHaveBeenCalledWith('D:/other', undefined, 50, 0);
  });
});
