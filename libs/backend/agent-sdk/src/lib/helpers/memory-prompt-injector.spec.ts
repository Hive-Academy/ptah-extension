/**
 * Specs for MemoryPromptInjector.
 *
 * Covers:
 *   - query too short → returns ''
 *   - 0 hits → returns ''
 *   - hits below MIN_SCORE filtered → returns '' when all filtered
 *   - successful hits → block starts with '## Recalled Memory Context'
 *   - chunk text > MAX_CHUNK_CHARS (400) truncated with '…'
 *   - subject present → label is '[subject]'; absent → '[memory]'
 *   - search throws → returns '' (never rethrows)
 *   - workspaceRoot forwarded to reader.search
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  IMemoryReader,
  IMemoryLister,
  MemoryHit,
  MemoryHitPage,
  MemoryListPage,
  MemoryRecord,
} from '@ptah-extension/memory-contracts';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

import type { Logger } from '@ptah-extension/vscode-core';
import { MemoryPromptInjector } from './memory-prompt-injector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHit(overrides: Partial<MemoryHit> = {}): MemoryHit {
  return {
    memoryId: 'mem-1',
    subject: 'TypeScript',
    content: 'full content',
    chunkText: 'short chunk',
    score: 0.9,
    tier: 'core',
    ...overrides,
  };
}

function makeReader(page: MemoryHitPage): IMemoryReader {
  return { search: jest.fn().mockResolvedValue(page) };
}

function makeLister(
  page: MemoryListPage = { memories: [], total: 0 },
): IMemoryLister {
  return { listAll: jest.fn().mockReturnValue(page) };
}

interface WorkspaceProviderStubOptions {
  readonly injectionEnabled?: boolean;
  readonly observationCount?: number;
  readonly corpusCount?: number;
}

function makeWorkspace(
  opts: WorkspaceProviderStubOptions = {},
): IWorkspaceProvider {
  const map = new Map<string, unknown>([
    [
      'memory.triggers.sessionStart.injectionEnabled',
      opts.injectionEnabled ?? true,
    ],
  ]);
  if (opts.observationCount !== undefined) {
    map.set(
      'memory.triggers.sessionStart.observationCount',
      opts.observationCount,
    );
  }
  if (opts.corpusCount !== undefined) {
    map.set('memory.triggers.sessionStart.corpusCount', opts.corpusCount);
  }
  return {
    getConfiguration: jest.fn(
      <T>(_section: string, key: string, fallback?: T): T | undefined => {
        if (map.has(key)) return map.get(key) as T;
        return fallback;
      },
    ),
  } as unknown as IWorkspaceProvider;
}

function makeInjector(
  reader: IMemoryReader,
  lister: IMemoryLister = makeLister(),
  workspace: IWorkspaceProvider = makeWorkspace(),
): MemoryPromptInjector {
  const logger = createMockLogger() as unknown as Logger;
  return new MemoryPromptInjector(logger, reader, lister, workspace);
}

function makeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'm-1',
    subject: 'recall pattern',
    content: 'content',
    tier: 'core',
    kind: 'fact',
    salience: 0.8,
    createdAt: Date.now(),
    ...overrides,
  };
}

const LONG_QUERY = 'a long enough query string';

// ---------------------------------------------------------------------------
// Guard conditions
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildBlock — guard conditions', () => {
  it('returns empty string when query is shorter than 8 chars', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock('short');

    expect(result).toBe('');
    expect(reader.search).not.toHaveBeenCalled();
  });

  it('returns empty string when query is exactly 7 chars', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock('1234567');

    expect(result).toBe('');
  });

  it('calls reader when query is exactly 8 chars', async () => {
    const reader = makeReader({ hits: [], bm25Only: true });
    const injector = makeInjector(reader);

    await injector.buildBlock('12345678');

    expect(reader.search).toHaveBeenCalled();
  });

  it('returns empty string when there are 0 hits', async () => {
    const reader = makeReader({ hits: [], bm25Only: true });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toBe('');
  });

  it('returns empty string when all hits are below MIN_SCORE (0.05)', async () => {
    const reader = makeReader({
      hits: [makeHit({ score: 0.04 }), makeHit({ score: 0.01 })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Successful injection
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildBlock — successful injection', () => {
  it('returns block starting with ## Recalled Memory Context', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toMatch(/^## Recalled Memory Context/);
  });

  it('includes all qualifying hits as numbered lines', async () => {
    const reader = makeReader({
      hits: [
        makeHit({ score: 0.9 }),
        makeHit({ score: 0.8 }),
        makeHit({ score: 0.7 }),
      ],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('3.');
  });

  it('uses [subject] label when subject is present', async () => {
    const reader = makeReader({
      hits: [makeHit({ subject: 'TypeScript tips' })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toContain('[TypeScript tips]');
  });

  it('uses [memory] label when subject is null', async () => {
    const reader = makeReader({
      hits: [makeHit({ subject: null })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toContain('[memory]');
  });

  it('truncates chunk text longer than 400 chars with …', async () => {
    // Use a chunk with spaces so lastIndexOf finds a break point well below 400.
    // Each word is 5 chars + space; 80 words = 480 chars total.
    const word = 'alpha ';
    const longChunk = word.repeat(80); // 480 chars with spaces
    const reader = makeReader({
      hits: [makeHit({ chunkText: longChunk })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toContain('…');
    // Full original chunk must not appear verbatim — truncation happened.
    expect(result.includes(longChunk)).toBe(false);
  });

  it('does NOT truncate chunk text of exactly 400 chars', async () => {
    const exactChunk = 'y'.repeat(400);
    const reader = makeReader({
      hits: [makeHit({ chunkText: exactChunk })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).not.toContain('…');
    expect(result).toContain(exactChunk);
  });

  it('ends with a --- divider', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result.trimEnd().endsWith('---')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// workspaceRoot forwarding
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildBlock — workspaceRoot forwarding', () => {
  it('passes workspaceRoot to reader.search', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    await injector.buildBlock(LONG_QUERY, 'D:/myproject');

    expect(reader.search).toHaveBeenCalledWith(LONG_QUERY, 5, 'D:/myproject');
  });

  it('passes undefined workspaceRoot when not provided', async () => {
    const reader = makeReader({ hits: [], bm25Only: true });
    const injector = makeInjector(reader);

    await injector.buildBlock(LONG_QUERY);

    expect(reader.search).toHaveBeenCalledWith(LONG_QUERY, 5, undefined);
  });
});

// ---------------------------------------------------------------------------
// Error resilience
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildBlock — error resilience', () => {
  it('returns empty string when reader.search throws', async () => {
    const reader: IMemoryReader = {
      search: jest.fn().mockRejectedValue(new Error('database is locked')),
    };
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toBe('');
  });

  it('does not rethrow when reader.search rejects', async () => {
    const reader: IMemoryReader = {
      search: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const injector = makeInjector(reader);

    await expect(injector.buildBlock(LONG_QUERY)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildSessionStartBlock
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildSessionStartBlock — guard conditions', () => {
  it('returns empty string when workspaceRoot is undefined', async () => {
    const lister = makeLister({
      memories: [makeRecord()],
      total: 1,
    });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    const result = await injector.buildSessionStartBlock(undefined);

    expect(result).toBe('');
    expect(lister.listAll).not.toHaveBeenCalled();
  });

  it('returns empty string when injectionEnabled config is false', async () => {
    const lister = makeLister({ memories: [makeRecord()], total: 1 });
    const workspace = makeWorkspace({ injectionEnabled: false });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
      workspace,
    );

    const result = await injector.buildSessionStartBlock('D:/ws');

    expect(result).toBe('');
    expect(lister.listAll).not.toHaveBeenCalled();
  });

  it('returns empty string when listAll yields no memories and no corpora', async () => {
    const lister = makeLister({ memories: [], total: 0 });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    const result = await injector.buildSessionStartBlock('D:/ws');

    expect(result).toBe('');
  });

  it('returns empty string when listAll throws', async () => {
    const lister: IMemoryLister = {
      listAll: jest.fn().mockImplementation(() => {
        throw new Error('db locked');
      }),
    };
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    const result = await injector.buildSessionStartBlock('D:/ws');

    expect(result).toBe('');
  });

  it('does not rethrow when listAll throws', async () => {
    const lister: IMemoryLister = {
      listAll: jest.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
    };
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    await expect(
      injector.buildSessionStartBlock('D:/ws'),
    ).resolves.not.toThrow();
  });
});

describe('MemoryPromptInjector.buildSessionStartBlock — populated case', () => {
  it('returns block with workspace memory snapshot heading and subjects', async () => {
    const lister = makeLister({
      memories: [
        makeRecord({ subject: 'first subject' }),
        makeRecord({ id: 'm-2', subject: 'second subject' }),
      ],
      total: 2,
    });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    const result = await injector.buildSessionStartBlock('D:/ws');

    expect(result).toMatch(/^## Workspace Memory Snapshot/);
    expect(result).toContain('1. first subject');
    expect(result).toContain('2. second subject');
    expect(result.trimEnd().endsWith('---')).toBe(true);
  });

  it('forwards workspaceRoot to listAll for workspace scoping', async () => {
    const lister = makeLister({
      memories: [makeRecord()],
      total: 1,
    });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    await injector.buildSessionStartBlock('D:/myproject');

    expect(lister.listAll).toHaveBeenCalledWith(
      'D:/myproject',
      undefined,
      expect.any(Number),
      0,
    );
  });

  it('uses observationCount param to bound listAll limit', async () => {
    const lister = makeLister({
      memories: [makeRecord()],
      total: 1,
    });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    await injector.buildSessionStartBlock('D:/ws', 3);

    expect(lister.listAll).toHaveBeenCalledWith('D:/ws', undefined, 3, 0);
  });

  it('falls back to config observationCount when param omitted', async () => {
    const lister = makeLister({
      memories: [makeRecord()],
      total: 1,
    });
    const workspace = makeWorkspace({ observationCount: 7 });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
      workspace,
    );

    await injector.buildSessionStartBlock('D:/ws');

    expect(lister.listAll).toHaveBeenCalledWith('D:/ws', undefined, 7, 0);
  });

  it('skips memories whose subject is null or empty', async () => {
    const lister = makeLister({
      memories: [
        makeRecord({ subject: null }),
        makeRecord({ id: 'm-2', subject: '   ' }),
        makeRecord({ id: 'm-3', subject: 'kept' }),
      ],
      total: 3,
    });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    const result = await injector.buildSessionStartBlock('D:/ws');

    expect(result).toContain('1. kept');
    expect(result).not.toContain('null');
  });

  it('renders corpora when supplied alongside memories', async () => {
    const lister = makeLister({
      memories: [makeRecord({ subject: 'mem-subj' })],
      total: 1,
    });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    const result = await injector.buildSessionStartBlock('D:/ws', 10, 5, [
      { name: 'corpus-a', count: 12 },
    ]);

    expect(result).toContain('Available knowledge corpora');
    expect(result).toContain('1. corpus-a (12)');
  });

  it('renders only the corpora section when memories list is empty', async () => {
    const lister = makeLister({ memories: [], total: 0 });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    const result = await injector.buildSessionStartBlock('D:/ws', 10, 5, [
      { name: 'solo-corpus', count: 3 },
    ]);

    expect(result).toMatch(/^## Workspace Memory Snapshot/);
    expect(result).toContain('Available knowledge corpora');
    expect(result).toContain('1. solo-corpus (3)');
    expect(result).not.toContain('Recent observations');
  });
});

describe('MemoryPromptInjector.buildSessionStartBlock — privacy invariant', () => {
  it('does not surface memory content/chunk fields in the rendered block', async () => {
    const secret = 'SECRET-PAYLOAD-DO-NOT-LEAK';
    const lister = makeLister({
      memories: [
        makeRecord({
          subject: 'safe subject',
          content: secret,
        }),
      ],
      total: 1,
    });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    const result = await injector.buildSessionStartBlock('D:/ws');

    expect(result).toContain('safe subject');
    expect(result).not.toContain(secret);
  });

  it('passes workspaceRoot to listAll (no cross-workspace surfacing)', async () => {
    const lister = makeLister({ memories: [makeRecord()], total: 1 });
    const injector = makeInjector(
      makeReader({ hits: [], bm25Only: true }),
      lister,
    );

    await injector.buildSessionStartBlock('D:/ws-A');

    const call = (lister.listAll as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('D:/ws-A');
  });
});
