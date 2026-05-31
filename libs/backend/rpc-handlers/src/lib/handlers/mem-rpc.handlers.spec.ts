/**
 * Unit tests for `MemRpcHandlers` (`mem:searchIndex`, `mem:timeline`,
 * `mem:getObservations`).
 *
 * Mocking posture: direct constructor injection with a fake `MemorySearchService`,
 * following the `MemoryRpcHandlers` pattern.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import {
  TOKENS,
  RpcUserError,
  ALLOWED_METHOD_PREFIXES,
} from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import { MemRpcHandlers } from './mem-rpc.handlers';

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };
}

function makeRpcHandler() {
  const methods = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    registerMethod: jest.fn(
      (name: string, fn: (p: unknown) => Promise<unknown>) => {
        methods.set(name, fn);
      },
    ),
    call: async (name: string, params: unknown) => {
      const fn = methods.get(name);
      if (!fn) throw new Error(`No handler registered for ${name}`);
      return fn(params);
    },
  };
}

function makeSearch() {
  return {
    searchIndex: jest.fn().mockResolvedValue({ rows: [], bm25Only: true }),
    timeline: jest.fn().mockReturnValue({ rows: [], anchorIndex: 0 }),
    getObservations: jest
      .fn()
      .mockReturnValue({ memories: [], observationsBySession: {} }),
  };
}

function buildHandlers() {
  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
  const search = makeSearch();

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(MEMORY_TOKENS.MEMORY_SEARCH, search);
  child.register(MemRpcHandlers, { useClass: MemRpcHandlers });

  const handlers = child.resolve(MemRpcHandlers);
  handlers.register();

  return { handlers, rpcHandler, search, logger };
}

describe('MemRpcHandlers — runtime allowlist', () => {
  it("'mem:' prefix appears in ALLOWED_METHOD_PREFIXES (atomic dual-registration)", () => {
    expect(ALLOWED_METHOD_PREFIXES).toContain('mem:');
  });
});

describe('MemRpcHandlers.register', () => {
  it('registers all three methods', () => {
    const { rpcHandler } = buildHandlers();
    const calls = (rpcHandler.registerMethod as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(calls).toEqual([
      'mem:searchIndex',
      'mem:timeline',
      'mem:getObservations',
    ]);
  });

  it('static METHODS matches the registration tuple', () => {
    expect(MemRpcHandlers.METHODS).toEqual([
      'mem:searchIndex',
      'mem:timeline',
      'mem:getObservations',
    ]);
  });
});

describe('MemRpcHandlers — mem:searchIndex', () => {
  it('treats absent params as empty filter (pure-filter path)', async () => {
    const { rpcHandler, search } = buildHandlers();
    await rpcHandler.call('mem:searchIndex', undefined);
    expect(search.searchIndex).toHaveBeenCalledWith({
      query: undefined,
      topK: undefined,
      workspaceRoot: undefined,
      type: undefined,
      concepts: undefined,
      files: undefined,
      dateRange: undefined,
    });
  });

  it('forwards full filter blob to the service', async () => {
    const { rpcHandler, search } = buildHandlers();
    await rpcHandler.call('mem:searchIndex', {
      query: 'bug',
      topK: 10,
      workspaceRoot: '/ws',
      type: ['bugfix'],
      concepts: ['react'],
      files: ['a.ts'],
      dateRange: { fromMs: 1 },
    });
    expect(search.searchIndex).toHaveBeenCalledWith({
      query: 'bug',
      topK: 10,
      workspaceRoot: '/ws',
      type: ['bugfix'],
      concepts: ['react'],
      files: ['a.ts'],
      dateRange: { fromMs: 1 },
    });
  });

  it('maps `project` alias onto workspaceRoot when workspaceRoot is absent', async () => {
    const { rpcHandler, search } = buildHandlers();
    await rpcHandler.call('mem:searchIndex', {
      query: 'x',
      project: '/ws',
    });
    expect(search.searchIndex).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: '/ws' }),
    );
  });

  it('returns rows + bm25Only flag from service unchanged', async () => {
    const { rpcHandler, search } = buildHandlers();
    search.searchIndex.mockResolvedValue({
      rows: [
        {
          id: 'mem-1',
          subject: 'subj',
          type: 'bugfix',
          concepts: [],
          files: [],
          capturedAt: 1,
          score: 0.5,
          workspaceRoot: '/ws',
        },
      ],
      bm25Only: true,
    });
    const result = (await rpcHandler.call('mem:searchIndex', {})) as {
      rows: Array<{ id: string }>;
      bm25Only: boolean;
    };
    expect(result.bm25Only).toBe(true);
    expect(result.rows[0].id).toBe('mem-1');
    expect(result.rows[0]).not.toHaveProperty('content');
  });

  it('rejects invalid topK with INVALID_PARAMS', async () => {
    const { rpcHandler, search } = buildHandlers();
    await expect(
      rpcHandler.call('mem:searchIndex', { topK: 200 }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(search.searchIndex).not.toHaveBeenCalled();
  });

  it('wraps service errors in RpcUserError without leaking message', async () => {
    const { rpcHandler, search } = buildHandlers();
    search.searchIndex.mockRejectedValueOnce(
      new Error('internal db corruption details'),
    );
    let caught: unknown;
    try {
      await rpcHandler.call('mem:searchIndex', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RpcUserError);
    expect((caught as RpcUserError).message).not.toMatch(/db corruption/);
  });
});

describe('MemRpcHandlers — mem:timeline', () => {
  it('forwards anchorId + before/after to the service', async () => {
    const { rpcHandler, search } = buildHandlers();
    await rpcHandler.call('mem:timeline', {
      anchorId: 'mem-anchor',
      before: 3,
      after: 7,
      workspaceRoot: '/ws',
    });
    expect(search.timeline).toHaveBeenCalledWith({
      anchorId: 'mem-anchor',
      before: 3,
      after: 7,
      workspaceRoot: '/ws',
    });
  });

  it('rejects missing anchorId with INVALID_PARAMS', async () => {
    const { rpcHandler, search } = buildHandlers();
    await expect(
      rpcHandler.call('mem:timeline', undefined),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(search.timeline).not.toHaveBeenCalled();
  });

  it('returns the anchorIndex flag from the service', async () => {
    const { rpcHandler, search } = buildHandlers();
    search.timeline.mockReturnValue({ rows: [], anchorIndex: 5 });
    const result = (await rpcHandler.call('mem:timeline', {
      anchorId: 'mem-anchor',
    })) as { anchorIndex: number };
    expect(result.anchorIndex).toBe(5);
  });
});

describe('MemRpcHandlers — mem:getObservations', () => {
  it('forwards ids and includeQueueRows', async () => {
    const { rpcHandler, search } = buildHandlers();
    await rpcHandler.call('mem:getObservations', {
      ids: ['mem-1', 'mem-2'],
      includeQueueRows: false,
    });
    expect(search.getObservations).toHaveBeenCalledWith({
      ids: ['mem-1', 'mem-2'],
      includeQueueRows: false,
    });
  });

  it('rejects empty ids list with INVALID_PARAMS', async () => {
    const { rpcHandler, search } = buildHandlers();
    await expect(
      rpcHandler.call('mem:getObservations', { ids: [] }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(search.getObservations).not.toHaveBeenCalled();
  });

  it('returns memories + observationsBySession unchanged', async () => {
    const { rpcHandler, search } = buildHandlers();
    search.getObservations.mockReturnValue({
      memories: [
        {
          id: 'mem-1',
          subject: 's',
          content: 'c',
          type: 'discovery',
          request: null,
          investigated: null,
          learned: null,
          completed: null,
          nextSteps: null,
          concepts: [],
          files: [],
          sessionId: 'sess-1',
          workspaceRoot: '/ws',
          capturedAt: 100,
        },
      ],
      observationsBySession: {
        'sess-1': [
          {
            id: 1,
            kind: 'tool-use',
            toolName: 'Read',
            filePath: 'a.ts',
            capturedAt: 99,
          },
        ],
      },
    });
    const result = (await rpcHandler.call('mem:getObservations', {
      ids: ['mem-1'],
    })) as {
      memories: unknown[];
      observationsBySession: Record<string, unknown[]>;
    };
    expect(result.memories).toHaveLength(1);
    expect(Object.keys(result.observationsBySession)).toContain('sess-1');
  });
});
