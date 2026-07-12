/**
 * Specs for buildCorpusNamespace.
 *
 * Covers (implementation-plan.md §7):
 *   1. build happy path — { corpus }; injected workspaceRoot + parsed filter reach the service
 *   2. build with a model-supplied workspaceRoot in the filter — rejected by .strict(),
 *      buildCorpus NOT called (security-critical: no attacker-controlled root reaches the service)
 *   3. build invalid args (name '', limit -1, type ['nope']) — { error }, service not called
 *   4. build when getKnowledgeAgent() returns undefined — { error } "not available"
 *   5. build when buildCorpus throws — { error }, no throw escapes the boundary
 *   6. list — { corpora }; injected workspaceRoot passed through
 *   7. rebuild — { added, removed }; error + unavailable variants
 *   8. prime — { sessionId }; error + unavailable variants; name validation
 *   9. namespace shape — exactly build/list/rebuild/prime; no query/delete/reprime/get
 */

import type {
  IKnowledgeAgent,
  CorpusRef,
  CorpusListEntry,
} from '@ptah-extension/memory-contracts';
import {
  buildCorpusNamespace,
  type CorpusNamespaceDependencies,
} from './corpus-namespace.builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCorpusRef(overrides: Partial<CorpusRef> = {}): CorpusRef {
  return {
    id: 'corpus-1',
    name: 'Auth System',
    count: 12,
    builtAt: 1000,
    rebuiltAt: null,
    workspaceRoot: 'D:/ws',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<IKnowledgeAgent> = {}): IKnowledgeAgent {
  return {
    buildCorpus: jest.fn().mockResolvedValue(makeCorpusRef()),
    listCorpora: jest.fn().mockReturnValue([]),
    rebuildCorpus: jest.fn().mockResolvedValue({ added: 0, removed: 0 }),
    primeCorpus: jest.fn().mockResolvedValue({ sessionId: 'session-1' }),
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<CorpusNamespaceDependencies> = {},
): CorpusNamespaceDependencies {
  return {
    getKnowledgeAgent: overrides.getKnowledgeAgent ?? (() => undefined),
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => 'D:/ws'),
  };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildCorpusNamespace — shape', () => {
  it('exposes exactly build/list/rebuild/prime — no query/delete/reprime/get', () => {
    const ns = buildCorpusNamespace(makeDeps());

    expect(typeof ns.build).toBe('function');
    expect(typeof ns.list).toBe('function');
    expect(typeof ns.rebuild).toBe('function');
    expect(typeof ns.prime).toBe('function');

    expect(Object.keys(ns).sort()).toEqual([
      'build',
      'list',
      'prime',
      'rebuild',
    ]);
    expect('query' in ns).toBe(false);
    expect('delete' in ns).toBe(false);
    expect('reprime' in ns).toBe(false);
    expect('get' in ns).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

describe('buildCorpusNamespace — build', () => {
  it('happy path — returns { corpus } and calls buildCorpus with the INJECTED workspaceRoot + parsed filter', async () => {
    const corpus = makeCorpusRef({ id: 'corpus-42' });
    const agent = makeAgent({
      buildCorpus: jest.fn().mockResolvedValue(corpus),
    });
    const ns = buildCorpusNamespace(
      makeDeps({
        getKnowledgeAgent: () => agent,
        getWorkspaceRoot: () => 'D:/injected',
      }),
    );

    const result = await ns.build('Auth System', {
      concepts: ['auth', 'jwt'],
      query: 'authentication flow',
      limit: 50,
    });

    expect(result).toEqual({ corpus });
    expect(agent.buildCorpus).toHaveBeenCalledTimes(1);
    expect(agent.buildCorpus).toHaveBeenCalledWith({
      name: 'Auth System',
      workspaceRoot: 'D:/injected',
      concepts: ['auth', 'jwt'],
      query: 'authentication flow',
      limit: 50,
    });
  });

  it('omitted filter — defaults to {} and still injects workspaceRoot', async () => {
    const agent = makeAgent();
    const ns = buildCorpusNamespace(
      makeDeps({
        getKnowledgeAgent: () => agent,
        getWorkspaceRoot: () => 'D:/ws',
      }),
    );

    await ns.build('Some Corpus');

    expect(agent.buildCorpus).toHaveBeenCalledWith({
      name: 'Some Corpus',
      workspaceRoot: 'D:/ws',
    });
  });

  it('SECURITY: a model-supplied workspaceRoot inside the filter is rejected by .strict() — buildCorpus is NOT called with an attacker-controlled root', async () => {
    const agent = makeAgent();
    const ns = buildCorpusNamespace(
      makeDeps({
        getKnowledgeAgent: () => agent,
        getWorkspaceRoot: () => 'D:/real-ws',
      }),
    );

    const result = await ns.build('Auth System', {
      concepts: ['auth'],
      workspaceRoot: 'C:/attacker-controlled',
    } as unknown);

    expect('error' in result).toBe(true);
    expect(agent.buildCorpus).not.toHaveBeenCalled();
  });

  it('invalid args: empty name → { error }, service not called', async () => {
    const agent = makeAgent();
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    const result = await ns.build('');

    expect('error' in result).toBe(true);
    expect(agent.buildCorpus).not.toHaveBeenCalled();
  });

  it('invalid args: negative limit → { error }, service not called', async () => {
    const agent = makeAgent();
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    const result = await ns.build('Valid Name', { limit: -1 });

    expect('error' in result).toBe(true);
    expect(agent.buildCorpus).not.toHaveBeenCalled();
  });

  it('invalid args: unknown type value → { error }, service not called', async () => {
    const agent = makeAgent();
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    const result = await ns.build('Valid Name', { type: ['nope'] });

    expect('error' in result).toBe(true);
    expect(agent.buildCorpus).not.toHaveBeenCalled();
  });

  it('service unavailable — getKnowledgeAgent() returns undefined → { error } mentions "not available"', async () => {
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => undefined }),
    );

    const result = await ns.build('Auth System');

    expect('error' in result && result.error).toMatch(/not available/i);
  });

  it('service unavailable takes precedence over invalid args (agent checked first)', async () => {
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => undefined }),
    );

    const result = await ns.build('');

    expect('error' in result && result.error).toMatch(/not available/i);
  });

  it('underlying service throws (e.g. "already exists") — { error }, no throw escapes the boundary', async () => {
    const agent = makeAgent({
      buildCorpus: jest
        .fn()
        .mockRejectedValue(new Error('Corpus "Auth System" already exists')),
    });
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    let threw = false;
    let result: Awaited<ReturnType<typeof ns.build>> | undefined;
    try {
      result = await ns.build('Auth System');
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result && 'error' in result && result.error).toBe(
      'Corpus "Auth System" already exists',
    );
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('buildCorpusNamespace — list', () => {
  it('happy path — returns { corpora } and passes the injected workspaceRoot', async () => {
    const entries: CorpusListEntry[] = [
      makeCorpusRef({ id: 'a' }),
      makeCorpusRef({ id: 'b' }),
    ];
    const agent = makeAgent({
      listCorpora: jest.fn().mockReturnValue(entries),
    });
    const ns = buildCorpusNamespace(
      makeDeps({
        getKnowledgeAgent: () => agent,
        getWorkspaceRoot: () => 'D:/injected',
      }),
    );

    const result = await ns.list();

    expect(result).toEqual({ corpora: entries });
    expect(agent.listCorpora).toHaveBeenCalledWith('D:/injected');
  });

  it('service unavailable — { error } mentions "not available"', async () => {
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => undefined }),
    );

    const result = await ns.list();

    expect('error' in result && result.error).toMatch(/not available/i);
  });

  it('underlying service throws — { error }, no throw escapes the boundary', async () => {
    const agent = makeAgent({
      listCorpora: jest.fn().mockImplementation(() => {
        throw new Error('DB closed');
      }),
    });
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    const result = await ns.list();

    expect('error' in result && result.error).toBe('DB closed');
  });
});

// ---------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------

describe('buildCorpusNamespace — rebuild', () => {
  it('happy path — returns { added, removed } and delegates with the validated name', async () => {
    const agent = makeAgent({
      rebuildCorpus: jest.fn().mockResolvedValue({ added: 3, removed: 1 }),
    });
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    const result = await ns.rebuild('Auth System');

    expect(result).toEqual({ added: 3, removed: 1 });
    expect(agent.rebuildCorpus).toHaveBeenCalledWith('Auth System');
  });

  it('service unavailable — { error } mentions "not available"', async () => {
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => undefined }),
    );

    const result = await ns.rebuild('Auth System');

    expect('error' in result && result.error).toMatch(/not available/i);
  });

  it('invalid name — { error }, service not called', async () => {
    const agent = makeAgent();
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    const result = await ns.rebuild('');

    expect('error' in result).toBe(true);
    expect(agent.rebuildCorpus).not.toHaveBeenCalled();
  });

  it('underlying service throws — { error }, no throw escapes the boundary', async () => {
    const agent = makeAgent({
      rebuildCorpus: jest.fn().mockRejectedValue(new Error('Corpus not found')),
    });
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    let threw = false;
    let result: Awaited<ReturnType<typeof ns.rebuild>> | undefined;
    try {
      result = await ns.rebuild('Missing');
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result && 'error' in result && result.error).toBe(
      'Corpus not found',
    );
  });
});

// ---------------------------------------------------------------------------
// prime
// ---------------------------------------------------------------------------

describe('buildCorpusNamespace — prime', () => {
  it('happy path — returns { sessionId } and delegates with the validated name', async () => {
    const agent = makeAgent({
      primeCorpus: jest.fn().mockResolvedValue({ sessionId: 'corpus-abc-123' }),
    });
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    const result = await ns.prime('Auth System');

    expect(result).toEqual({ sessionId: 'corpus-abc-123' });
    expect(agent.primeCorpus).toHaveBeenCalledWith('Auth System');
  });

  it('service unavailable — { error } mentions "not available"', async () => {
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => undefined }),
    );

    const result = await ns.prime('Auth System');

    expect('error' in result && result.error).toMatch(/not available/i);
  });

  it('invalid name — { error }, service not called', async () => {
    const agent = makeAgent();
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    const result = await ns.prime('');

    expect('error' in result).toBe(true);
    expect(agent.primeCorpus).not.toHaveBeenCalled();
  });

  it('underlying service throws — { error }, no throw escapes the boundary', async () => {
    const agent = makeAgent({
      primeCorpus: jest.fn().mockRejectedValue(new Error('Corpus not found')),
    });
    const ns = buildCorpusNamespace(
      makeDeps({ getKnowledgeAgent: () => agent }),
    );

    let threw = false;
    let result: Awaited<ReturnType<typeof ns.prime>> | undefined;
    try {
      result = await ns.prime('Missing');
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result && 'error' in result && result.error).toBe(
      'Corpus not found',
    );
  });
});
