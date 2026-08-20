/**
 * Unit tests for `CorpusRpcHandlers` (9 `corpus:*` methods).
 *
 * Mocking posture: direct constructor injection with a fake
 * `KnowledgeAgentService` + `CorpusSuggestionService`, mirroring the
 * `MemRpcHandlers` spec layout.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import {
  TOKENS,
  RpcUserError,
  ALLOWED_METHOD_PREFIXES,
} from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import { CorpusRpcHandlers } from './corpus-rpc.handlers';

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

function makeKnowledgeAgent() {
  return {
    listCorpora: jest.fn().mockReturnValue([]),
    buildCorpus: jest.fn().mockResolvedValue({
      id: 'corp-1',
      name: 'react',
      count: 0,
      builtAt: 100,
      rebuiltAt: null,
      workspaceRoot: '/ws',
    }),
    primeCorpus: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    queryCorpus: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    reprimeCorpus: jest.fn().mockResolvedValue({ sessionId: 'sess-2' }),
    rebuildCorpus: jest.fn().mockResolvedValue({ added: 0, removed: 0 }),
    deleteCorpus: jest.fn().mockResolvedValue({ deleted: true }),
  };
}

function makeSuggestionService() {
  return {
    suggestCorpora: jest.fn().mockReturnValue([]),
  };
}

function buildHandlers() {
  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
  const knowledgeAgent = makeKnowledgeAgent();
  const suggestionService = makeSuggestionService();

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(MEMORY_TOKENS.KNOWLEDGE_AGENT_SERVICE, knowledgeAgent);
  child.registerInstance(
    MEMORY_TOKENS.CORPUS_SUGGESTION_SERVICE,
    suggestionService,
  );
  child.register(CorpusRpcHandlers, { useClass: CorpusRpcHandlers });

  const handlers = child.resolve(CorpusRpcHandlers);
  handlers.register();

  return { handlers, rpcHandler, knowledgeAgent, suggestionService, logger };
}

describe('CorpusRpcHandlers — runtime allowlist', () => {
  it("'corpus:' prefix appears in ALLOWED_METHOD_PREFIXES (atomic dual-registration)", () => {
    expect(ALLOWED_METHOD_PREFIXES).toContain('corpus:');
  });
});

describe('CorpusRpcHandlers.register', () => {
  it('registers all nine methods in order', () => {
    const { rpcHandler } = buildHandlers();
    const calls = (rpcHandler.registerMethod as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(calls).toEqual([
      'corpus:list',
      'corpus:get',
      'corpus:build',
      'corpus:prime',
      'corpus:query',
      'corpus:reprime',
      'corpus:rebuild',
      'corpus:delete',
      'corpus:suggest',
    ]);
  });

  it('static METHODS matches the registration tuple', () => {
    expect(CorpusRpcHandlers.METHODS).toEqual([
      'corpus:list',
      'corpus:get',
      'corpus:build',
      'corpus:prime',
      'corpus:query',
      'corpus:reprime',
      'corpus:rebuild',
      'corpus:delete',
      'corpus:suggest',
    ]);
  });

  it("includes 'corpus:suggest' in static METHODS", () => {
    expect(CorpusRpcHandlers.METHODS).toContain('corpus:suggest');
  });
});

describe('CorpusRpcHandlers — corpus:list', () => {
  it('treats absent params as empty filter', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    await rpcHandler.call('corpus:list', undefined);
    expect(knowledgeAgent.listCorpora).toHaveBeenCalledWith(undefined);
  });

  it('forwards workspaceRoot filter', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    await rpcHandler.call('corpus:list', { workspaceRoot: '/ws' });
    expect(knowledgeAgent.listCorpora).toHaveBeenCalledWith('/ws');
  });

  it('maps store entries to wire entries (strips queryJson/primedSessionIds)', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.listCorpora.mockReturnValue([
      {
        id: 'c-1',
        name: 'r',
        count: 5,
        builtAt: 100,
        rebuiltAt: 200,
        workspaceRoot: '/ws',
      },
    ]);
    const result = (await rpcHandler.call('corpus:list', {})) as {
      corpora: Array<Record<string, unknown>>;
    };
    expect(result.corpora).toHaveLength(1);
    expect(result.corpora[0]).toEqual({
      id: 'c-1',
      name: 'r',
      count: 5,
      builtAt: 100,
      rebuiltAt: 200,
      workspaceRoot: '/ws',
    });
    expect(result.corpora[0]).not.toHaveProperty('queryJson');
    expect(result.corpora[0]).not.toHaveProperty('primedSessionIds');
  });

  it('rejects empty workspaceRoot with INVALID_PARAMS', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    await expect(
      rpcHandler.call('corpus:list', { workspaceRoot: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(knowledgeAgent.listCorpora).not.toHaveBeenCalled();
  });
});

describe('CorpusRpcHandlers — corpus:get', () => {
  it('returns null when no matching corpus exists', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.listCorpora.mockReturnValue([]);
    const result = (await rpcHandler.call('corpus:get', { name: 'r' })) as {
      corpus: unknown;
    };
    expect(result.corpus).toBeNull();
  });

  it('returns the matching corpus wire entry', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.listCorpora.mockReturnValue([
      {
        id: 'c-1',
        name: 'react',
        count: 3,
        builtAt: 100,
        rebuiltAt: null,
        workspaceRoot: '/ws',
      },
      {
        id: 'c-2',
        name: 'angular',
        count: 5,
        builtAt: 200,
        rebuiltAt: null,
        workspaceRoot: '/ws',
      },
    ]);
    const result = (await rpcHandler.call('corpus:get', {
      name: 'angular',
    })) as { corpus: { id: string } };
    expect(result.corpus.id).toBe('c-2');
  });

  it('rejects missing name with INVALID_PARAMS', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    await expect(
      rpcHandler.call('corpus:get', undefined),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(knowledgeAgent.listCorpora).not.toHaveBeenCalled();
  });
});

describe('CorpusRpcHandlers — corpus:build', () => {
  it('forwards full filter blob to the service', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    await rpcHandler.call('corpus:build', {
      name: 'react',
      workspaceRoot: '/ws',
      type: ['bugfix'],
      concepts: ['hooks'],
      files: ['App.tsx'],
      query: 'caching',
      dateRange: { fromMs: 1 },
      limit: 25,
    });
    expect(knowledgeAgent.buildCorpus).toHaveBeenCalledWith({
      name: 'react',
      workspaceRoot: '/ws',
      type: ['bugfix'],
      concepts: ['hooks'],
      files: ['App.tsx'],
      query: 'caching',
      dateRange: { fromMs: 1 },
      limit: 25,
    });
  });

  it('returns the wire entry from the built corpus', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.buildCorpus.mockResolvedValue({
      id: 'c-1',
      name: 'r',
      count: 7,
      builtAt: 50,
      rebuiltAt: null,
      workspaceRoot: '/ws',
    });
    const result = (await rpcHandler.call('corpus:build', {
      name: 'r',
    })) as { corpus: { id: string; count: number } };
    expect(result.corpus.id).toBe('c-1');
    expect(result.corpus.count).toBe(7);
  });

  it('wraps service errors in RpcUserError without leaking message', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.buildCorpus.mockRejectedValueOnce(
      new Error('internal SQL trace'),
    );
    let caught: unknown;
    try {
      await rpcHandler.call('corpus:build', { name: 'r' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RpcUserError);
    expect((caught as RpcUserError).message).not.toMatch(/SQL/);
  });
});

describe('CorpusRpcHandlers — corpus:prime', () => {
  it('forwards name to the service and returns sessionId', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.primeCorpus.mockResolvedValue({ sessionId: 'sess-42' });
    const result = (await rpcHandler.call('corpus:prime', {
      name: 'react',
    })) as { sessionId: string };
    expect(knowledgeAgent.primeCorpus).toHaveBeenCalledWith('react');
    expect(result.sessionId).toBe('sess-42');
  });

  it('rejects empty name with INVALID_PARAMS', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    await expect(
      rpcHandler.call('corpus:prime', { name: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(knowledgeAgent.primeCorpus).not.toHaveBeenCalled();
  });
});

describe('CorpusRpcHandlers — corpus:query', () => {
  it('forwards name + question and returns sessionId (stream subscription path)', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.queryCorpus.mockResolvedValue({
      sessionId: 'sess-7',
    });
    const result = (await rpcHandler.call('corpus:query', {
      name: 'react',
      question: 'how do hooks compose?',
    })) as { sessionId: string };
    expect(knowledgeAgent.queryCorpus).toHaveBeenCalledWith(
      'react',
      'how do hooks compose?',
    );
    expect(result.sessionId).toBe('sess-7');
    expect(
      (result as unknown as Record<string, unknown>)['answer'],
    ).toBeUndefined();
  });

  it('rejects empty question with INVALID_PARAMS', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    await expect(
      rpcHandler.call('corpus:query', { name: 'r', question: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(knowledgeAgent.queryCorpus).not.toHaveBeenCalled();
  });
});

describe('CorpusRpcHandlers — corpus:reprime', () => {
  it('forwards name and returns sessionId', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.reprimeCorpus.mockResolvedValue({ sessionId: 'sess-new' });
    const result = (await rpcHandler.call('corpus:reprime', {
      name: 'react',
    })) as { sessionId: string };
    expect(knowledgeAgent.reprimeCorpus).toHaveBeenCalledWith('react');
    expect(result.sessionId).toBe('sess-new');
  });
});

describe('CorpusRpcHandlers — corpus:rebuild', () => {
  it('returns added + removed counts', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.rebuildCorpus.mockResolvedValue({ added: 3, removed: 1 });
    const result = (await rpcHandler.call('corpus:rebuild', {
      name: 'react',
    })) as { added: number; removed: number };
    expect(knowledgeAgent.rebuildCorpus).toHaveBeenCalledWith('react');
    expect(result).toEqual({ added: 3, removed: 1 });
  });

  it('rejects missing name with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('corpus:rebuild', undefined),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

describe('CorpusRpcHandlers — corpus:delete', () => {
  it('returns deleted flag from the service', async () => {
    const { rpcHandler, knowledgeAgent } = buildHandlers();
    knowledgeAgent.deleteCorpus.mockResolvedValue({ deleted: false });
    const result = (await rpcHandler.call('corpus:delete', {
      name: 'missing',
    })) as { deleted: boolean };
    expect(knowledgeAgent.deleteCorpus).toHaveBeenCalledWith('missing');
    expect(result.deleted).toBe(false);
  });
});

describe('CorpusRpcHandlers — corpus:suggest', () => {
  it('treats absent params as empty options', async () => {
    const { rpcHandler, suggestionService } = buildHandlers();
    await rpcHandler.call('corpus:suggest', undefined);
    expect(suggestionService.suggestCorpora).toHaveBeenCalledWith({
      workspaceRoot: undefined,
      minClusterSize: undefined,
      limit: undefined,
    });
  });

  it('forwards validated options to the service', async () => {
    const { rpcHandler, suggestionService } = buildHandlers();
    await rpcHandler.call('corpus:suggest', {
      workspaceRoot: '/ws',
      minClusterSize: 3,
      limit: 4,
    });
    expect(suggestionService.suggestCorpora).toHaveBeenCalledWith({
      workspaceRoot: '/ws',
      minClusterSize: 3,
      limit: 4,
    });
  });

  it('maps domain suggestions to the wire shape', async () => {
    const { rpcHandler, suggestionService } = buildHandlers();
    suggestionService.suggestCorpora.mockReturnValue([
      {
        suggestedName: 'auth',
        filter: {
          name: 'auth',
          workspaceRoot: '/ws',
          concepts: ['auth'],
          limit: 100,
        },
        memberCount: 8,
        topConcepts: ['auth', 'jwt'],
        rationale: '8 memories tagged "auth"',
        signal: 'concept',
      },
    ]);
    const result = (await rpcHandler.call('corpus:suggest', {})) as {
      suggestions: Array<Record<string, unknown>>;
    };
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual({
      suggestedName: 'auth',
      filter: {
        name: 'auth',
        workspaceRoot: '/ws',
        type: undefined,
        concepts: ['auth'],
        files: undefined,
        query: undefined,
        dateRange: undefined,
        limit: 100,
      },
      memberCount: 8,
      topConcepts: ['auth', 'jwt'],
      rationale: '8 memories tagged "auth"',
      signal: 'concept',
    });
  });

  it('preserves a type suggestion filter through the mapper', async () => {
    const { rpcHandler, suggestionService } = buildHandlers();
    suggestionService.suggestCorpora.mockReturnValue([
      {
        suggestedName: 'Bugfix memories',
        filter: {
          name: 'Bugfix memories',
          workspaceRoot: null,
          type: ['bugfix'],
          limit: 100,
        },
        memberCount: 14,
        topConcepts: [],
        rationale: '14 bugfix memories',
        signal: 'type',
      },
    ]);
    const result = (await rpcHandler.call('corpus:suggest', {})) as {
      suggestions: Array<{
        filter: { type: readonly string[]; workspaceRoot: string | null };
      }>;
    };
    expect(result.suggestions[0].filter.type).toEqual(['bugfix']);
    expect(result.suggestions[0].filter.workspaceRoot).toBeNull();
  });

  it('rejects an empty workspaceRoot with INVALID_PARAMS', async () => {
    const { rpcHandler, suggestionService } = buildHandlers();
    await expect(
      rpcHandler.call('corpus:suggest', { workspaceRoot: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(suggestionService.suggestCorpora).not.toHaveBeenCalled();
  });

  it('rejects a non-positive limit with INVALID_PARAMS', async () => {
    const { rpcHandler, suggestionService } = buildHandlers();
    await expect(
      rpcHandler.call('corpus:suggest', { limit: -1 }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(suggestionService.suggestCorpora).not.toHaveBeenCalled();
  });

  it('wraps service errors in RpcUserError without leaking the message', async () => {
    const { rpcHandler, suggestionService } = buildHandlers();
    suggestionService.suggestCorpora.mockImplementationOnce(() => {
      throw new Error('internal SQL trace');
    });
    let caught: unknown;
    try {
      await rpcHandler.call('corpus:suggest', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RpcUserError);
    expect((caught as RpcUserError).message).not.toMatch(/SQL/);
    expect((caught as RpcUserError).errorCode).toBe('PERSISTENCE_UNAVAILABLE');
  });
});
