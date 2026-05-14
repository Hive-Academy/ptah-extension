/**
 * Specs for buildMemoryNamespace (TASK_2026_THOTH_MEMORY_READ).
 *
 * Covers:
 *   - shape: exposes search and list
 *   - search: delegates to IMemoryReader with correct args; error envelope when
 *     reader is absent or throws
 *   - search scope: global default, { workspace: true }, { workspaceRoot }, combos,
 *     no-workspace fallback, backward-compat positional maxResults
 *   - list: delegates to IMemoryLister with correct args; applies defaults;
 *     error envelope when lister is absent or throws
 *   - purgeBySubjectPattern: delegates to IMemoryWriter; all error envelopes
 *   - input validation: Zod boundary guard at MCP boundary (TASK_2026_122 Critical Issue 1)
 *
 * TASK_2026_122 (follow-up B): added workspace-scope tests
 * TASK_2026_122 (Critical Issue 1): added MCP boundary input validation tests
 */

import type {
  IMemoryReader,
  IMemoryLister,
  MemoryHit,
  MemoryRecord,
} from '@ptah-extension/memory-contracts';
import type { IMemoryWriter } from '@ptah-extension/platform-core';
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
    getMemoryWriter: overrides.getMemoryWriter ?? (() => undefined),
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => 'D:/ws'),
  };
}

function makeWriter(deleted = 0): IMemoryWriter {
  return {
    upsert: jest.fn(),
    purgeBySubjectPattern: jest.fn().mockReturnValue(deleted),
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

describe('buildMemoryNamespace — search (global default)', () => {
  it('plain search(query) → reader called with workspaceRoot=undefined, scope=global', async () => {
    const reader = makeReader([makeHit()]);
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('TypeScript');

    expect(reader.search).toHaveBeenCalledWith('TypeScript', 10, undefined);
    expect('hits' in result).toBe(true);
    expect('scope' in result && result.scope).toBe('global');
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
// search — workspace scope options
// ---------------------------------------------------------------------------

describe('buildMemoryNamespace — search (workspace scope options)', () => {
  it('{ workspace: true } with workspace available → service called with active workspace path', async () => {
    const reader = makeReader([makeHit()]);
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemorySearch: () => reader,
        getWorkspaceRoot: () => 'D:/project',
      }),
    );

    const result = await ns.search('query', { workspace: true });

    expect(reader.search).toHaveBeenCalledWith('query', 10, 'D:/project');
    expect('scope' in result && result.scope).toBe('workspace');
    expect('reason' in result ? result.reason : undefined).toBeUndefined();
  });

  it('{ workspace: true } with no workspace open → falls back to global, result includes reason=no_workspace', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemorySearch: () => reader,
        getWorkspaceRoot: () => '',
      }),
    );

    const result = await ns.search('query', { workspace: true });

    expect(reader.search).toHaveBeenCalledWith('query', 10, undefined);
    expect('scope' in result && result.scope).toBe('global');
    expect('reason' in result && result.reason).toBe('no_workspace');
  });

  it('{ workspaceRoot: "/explicit" } → service called with /explicit', async () => {
    const reader = makeReader([makeHit()]);
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('query', { workspaceRoot: '/explicit' });

    expect(reader.search).toHaveBeenCalledWith('query', 10, '/explicit');
    expect('scope' in result && result.scope).toBe('workspace');
  });

  it('{ workspace: true, workspaceRoot: "/explicit" } → explicit wins', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemorySearch: () => reader,
        getWorkspaceRoot: () => 'D:/auto',
      }),
    );

    await ns.search('query', { workspace: true, workspaceRoot: '/explicit' });

    expect(reader.search).toHaveBeenCalledWith('query', 10, '/explicit');
  });

  it('{ maxResults: 5 } → service called with topK=5, global scope', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('query', { maxResults: 5 });

    expect(reader.search).toHaveBeenCalledWith('query', 5, undefined);
    expect('scope' in result && result.scope).toBe('global');
  });

  it('{ workspace: true, maxResults: 20 } → workspace path and topK=20', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemorySearch: () => reader,
        getWorkspaceRoot: () => 'D:/project',
      }),
    );

    await ns.search('query', { workspace: true, maxResults: 20 });

    expect(reader.search).toHaveBeenCalledWith('query', 20, 'D:/project');
  });

  it('backward-compat: positional search(query, 5) → topK=5, global scope', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemorySearch: () => reader,
        getWorkspaceRoot: () => 'D:/project',
      }),
    );

    const result = await ns.search('query', 5);

    expect(reader.search).toHaveBeenCalledWith('query', 5, undefined);
    expect('scope' in result && result.scope).toBe('global');
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

// ---------------------------------------------------------------------------
// purgeBySubjectPattern
// ---------------------------------------------------------------------------

describe('buildMemoryNamespace — purgeBySubjectPattern', () => {
  it('happy path — writer returns 5, namespace returns { deleted: 5 }', async () => {
    const writer = makeWriter(5);
    const ns = buildMemoryNamespace(
      makeDeps({ getMemoryWriter: () => writer }),
    );

    const result = await ns.purgeBySubjectPattern('agent:', 'substring');

    expect(result).toEqual({ deleted: 5 });
    expect(writer.purgeBySubjectPattern).toHaveBeenCalledWith(
      'agent:',
      'substring',
      'D:/ws',
    );
  });

  it('writer undefined → { deleted: 0, error: "Memory writer not available" }', async () => {
    const ns = buildMemoryNamespace(
      makeDeps({ getMemoryWriter: () => undefined }),
    );

    const result = await ns.purgeBySubjectPattern('agent:', 'substring');

    expect(result).toEqual({
      deleted: 0,
      error: 'Memory writer not available',
    });
  });

  it('empty pattern → { deleted: 0, error: "Pattern must not be empty" }', async () => {
    const writer = makeWriter();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemoryWriter: () => writer }),
    );

    const result = await ns.purgeBySubjectPattern('', 'substring');

    expect(result).toEqual({ deleted: 0, error: 'Pattern must not be empty' });
  });

  it('empty workspace root → { deleted: 0, error: /No active workspace/ }', async () => {
    const writer = makeWriter();
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemoryWriter: () => writer,
        getWorkspaceRoot: () => '',
      }),
    );

    const result = await ns.purgeBySubjectPattern('agent:', 'substring');

    expect('error' in result && result.error).toMatch(/No active workspace/);
    expect(result.deleted).toBe(0);
  });

  it('invalid mode → { deleted: 0, error: "Invalid mode" }', async () => {
    const writer = makeWriter();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemoryWriter: () => writer }),
    );

    const result = await ns.purgeBySubjectPattern(
      'agent:',
      'regex' as 'substring' | 'like',
    );

    expect(result).toEqual({ deleted: 0, error: 'Invalid mode' });
  });

  it('writer throws → caught, returns { deleted: 0, error: <message> }', async () => {
    const writer: IMemoryWriter = {
      upsert: jest.fn(),
      purgeBySubjectPattern: jest.fn().mockImplementation(() => {
        throw new Error('DB locked');
      }),
    };
    const ns = buildMemoryNamespace(
      makeDeps({ getMemoryWriter: () => writer }),
    );

    const result = await ns.purgeBySubjectPattern('agent:', 'substring');

    expect(result).toEqual({ deleted: 0, error: 'DB locked' });
  });
});

// ---------------------------------------------------------------------------
// ptah.memory.search input validation — MCP boundary (TASK_2026_122 Critical Issue 1)
// ---------------------------------------------------------------------------

describe('ptah.memory.search input validation', () => {
  it('{ workspaceRoot: 123 } → does NOT throw; treated as no opts; reader called with workspaceRoot=undefined', async () => {
    const reader = makeReader([makeHit()]);
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    // Cast through unknown to simulate untrusted MCP JSON with wrong type
    let threw = false;
    let result: Awaited<ReturnType<typeof ns.search>> | undefined;
    try {
      result = await ns.search('query', { workspaceRoot: 123 } as unknown);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(reader.search).toHaveBeenCalledWith('query', 10, undefined);
    expect(result && 'scope' in result && result.scope).toBe('global');
  });

  it('{ workspaceRoot: null } → does NOT throw; treated as no opts; global search', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    let threw = false;
    try {
      await ns.search('query', { workspaceRoot: null } as unknown);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(reader.search).toHaveBeenCalledWith('query', 10, undefined);
  });

  it('{ workspace: "yes" } → string is not boolean; Zod rejects; treated as no workspace opt-in → global', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('query', { workspace: 'yes' } as unknown);

    expect(reader.search).toHaveBeenCalledWith('query', 10, undefined);
    expect('scope' in result && result.scope).toBe('global');
  });

  it('{ maxResults: -1 } → negative fails .positive(); whole opts bag invalid; falls back to default maxResults=10', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    await ns.search('query', { maxResults: -1 } as unknown);

    expect((reader.search as jest.Mock).mock.calls[0][1]).toBe(10);
  });

  it('{ maxResults: 100 } → exceeds max(50) cap; whole opts bag invalid; falls back to default maxResults=10', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    await ns.search('query', { maxResults: 100 } as unknown);

    expect((reader.search as jest.Mock).mock.calls[0][1]).toBe(10);
  });

  it('null opts → treated as no opts; global search', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('query', null as unknown);

    expect(reader.search).toHaveBeenCalledWith('query', 10, undefined);
    expect('scope' in result && result.scope).toBe('global');
  });

  it('"oops" string opts → treated as no opts; global search', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({ getMemorySearch: () => reader }),
    );

    const result = await ns.search('query', 'oops' as unknown);

    expect(reader.search).toHaveBeenCalledWith('query', 10, undefined);
    expect('scope' in result && result.scope).toBe('global');
  });

  it('{ workspaceRoot: "" } → empty string rejected by min(1); whole opts bag invalid; treated as no workspaceRoot → global', async () => {
    const reader = makeReader();
    const ns = buildMemoryNamespace(
      makeDeps({
        getMemorySearch: () => reader,
        getWorkspaceRoot: () => 'D:/ws',
      }),
    );

    const result = await ns.search('query', { workspaceRoot: '' } as unknown);

    expect(reader.search).toHaveBeenCalledWith('query', 10, undefined);
    expect('scope' in result && result.scope).toBe('global');
  });
});
