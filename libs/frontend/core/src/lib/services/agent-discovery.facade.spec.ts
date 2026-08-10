/**
 * AgentDiscoveryFacade unit specs.
 *
 * Strategy: Mock ClaudeRpcService at the provider level. Test all
 * signal states, cache guard, loading guard, error paths, and search.
 */

import { TestBed } from '@angular/core/testing';
import { AgentDiscoveryFacade } from './agent-discovery.facade';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { VSCodeService, type WebviewConfig } from './vscode.service';

function rpcSuccess<T>(data: T): RpcResult<T> {
  return new RpcResult<T>(true, data, undefined, undefined);
}

function rpcError(message: string): RpcResult<never> {
  return new RpcResult<never>(false, undefined, message);
}

function buildMockRpc() {
  return {
    call: jest.fn(),
    handledMessageTypes: [],
    handleMessage: jest.fn(),
  };
}

describe('AgentDiscoveryFacade', () => {
  let facade: AgentDiscoveryFacade;
  let mockRpc: ReturnType<typeof buildMockRpc>;
  let workspaceRoot: string;

  beforeEach(() => {
    mockRpc = buildMockRpc();
    workspaceRoot = 'D:\\ws\\alpha';
    const mockVsCode = {
      config: () => ({ workspaceRoot }) as WebviewConfig,
    } as unknown as VSCodeService;
    TestBed.configureTestingModule({
      providers: [
        AgentDiscoveryFacade,
        { provide: ClaudeRpcService, useValue: mockRpc },
        { provide: VSCodeService, useValue: mockVsCode },
      ],
    });
    facade = TestBed.inject(AgentDiscoveryFacade);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts with isLoading=false, agents=[], isCached=false, error=null', () => {
    expect(facade.isLoading()).toBe(false);
    expect(facade.agents()).toEqual([]);
    expect(facade.isCached()).toBe(false);
    expect(facade.error()).toBeNull();
  });

  // ── Workspace-switch invalidation (TASK_2026_200) ─────────────────────────

  describe('clearCache() on workspace switch', () => {
    it('forces a refetch of the / picker after a switch', async () => {
      mockRpc.call.mockResolvedValueOnce(
        rpcSuccess({
          agents: [
            { name: 'alpha-agent', description: 'A only', scope: 'project' },
          ],
        }),
      );
      await facade.fetchAgents();
      expect(facade.isCached()).toBe(true);

      // The coordinator's switch fan-out.
      facade.clearCache();
      workspaceRoot = 'D:\\ws\\beta';
      mockRpc.call.mockResolvedValueOnce(
        rpcSuccess({
          agents: [
            { name: 'beta-agent', description: 'B only', scope: 'project' },
          ],
        }),
      );

      await facade.fetchAgents();

      expect(facade.agents().map((a) => a.name)).toEqual(['beta-agent']);
      expect(mockRpc.call).toHaveBeenCalledTimes(2);
      expect(mockRpc.call).toHaveBeenLastCalledWith(
        'autocomplete:agents',
        expect.objectContaining({ workspaceRoot: 'D:\\ws\\beta' }),
      );
    });

    it('drops an in-flight pre-switch response that resolves after the clear', async () => {
      let release!: (value: RpcResult<{ agents: unknown[] }>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<{ agents: unknown[] }>>((resolve) => {
          release = resolve;
        }),
      );

      const fetching = facade.fetchAgents();
      facade.clearCache();

      release(
        rpcSuccess({
          agents: [
            { name: 'alpha-agent', description: 'A only', scope: 'project' },
          ],
        }),
      );
      await fetching;

      expect(facade.agents()).toEqual([]);
      // isCached is the dangerous one: it has no TTL, so a stale response
      // pinning it true would freeze workspace A's agents into the / picker for
      // the rest of the process lifetime.
      expect(facade.isCached()).toBe(false);
    });

    it('still refetches after a stale response was dropped', async () => {
      let release!: (value: RpcResult<{ agents: unknown[] }>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<{ agents: unknown[] }>>((resolve) => {
          release = resolve;
        }),
      );

      const fetching = facade.fetchAgents();
      facade.clearCache();
      release(
        rpcSuccess({
          agents: [
            { name: 'alpha-agent', description: 'A only', scope: 'project' },
          ],
        }),
      );
      await fetching;

      mockRpc.call.mockResolvedValueOnce(
        rpcSuccess({
          agents: [
            { name: 'beta-agent', description: 'B only', scope: 'project' },
          ],
        }),
      );
      await facade.fetchAgents();

      expect(facade.agents().map((a) => a.name)).toEqual(['beta-agent']);
    });

    it('leaves isLoading false after a clear, so fetchAgents is not wedged', async () => {
      let release!: (value: RpcResult<{ agents: unknown[] }>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<{ agents: unknown[] }>>((resolve) => {
          release = resolve;
        }),
      );

      const fetching = facade.fetchAgents();
      expect(facade.isLoading()).toBe(true);

      facade.clearCache();
      // The generation guard stops the stale fetch clearing the flag itself, so
      // clearCache() must do it — otherwise every later fetchAgents() would
      // early-return on the isLoading guard forever.
      expect(facade.isLoading()).toBe(false);

      release(rpcSuccess({ agents: [] }));
      await fetching;
      expect(facade.isLoading()).toBe(false);
    });

    it('does not surface a pre-switch failure as the new workspace\u2019s error', async () => {
      let reject!: (reason: Error) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise((_resolve, r) => {
          reject = r;
        }),
      );

      const fetching = facade.fetchAgents();
      facade.clearCache();
      reject(new Error('alpha discovery blew up'));
      await fetching;

      expect(facade.error()).toBeNull();
    });
  });

  // ── Workspace scoping (TASK_2026_200, criterion 10 call-site half) ────────

  describe('workspace scoping on autocomplete:agents', () => {
    it('sends the active workspaceRoot with the request', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess({ agents: [] }));

      await facade.fetchAgents();

      expect(mockRpc.call).toHaveBeenCalledWith('autocomplete:agents', {
        query: '',
        maxResults: 100,
        workspaceRoot: 'D:\\ws\\alpha',
      });
    });

    it('omits workspaceRoot entirely when no root is known — never sends ""', async () => {
      // The backend rejects '' at the Zod boundary because it resolves to the
      // process CWD; absent is the contractual "process-global active folder".
      workspaceRoot = '';
      mockRpc.call.mockResolvedValueOnce(rpcSuccess({ agents: [] }));

      await facade.fetchAgents();

      const params = mockRpc.call.mock.calls[0][1] as Record<string, unknown>;
      expect('workspaceRoot' in params).toBe(false);
      expect(params).toEqual({ query: '', maxResults: 100 });
    });
  });

  // ── fetchAgents — happy paths ─────────────────────────────────────────────

  it('fetchAgents() populates agents and sets isCached=true when agents returned', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        agents: [
          {
            name: 'Senior Tester',
            description: 'Tests stuff',
            scope: 'builtin',
          },
          { name: 'My Agent', description: 'Custom agent', scope: 'project' },
          { name: 'User Agent', description: 'User agent', scope: 'user' },
        ],
      }),
    );

    await facade.fetchAgents();

    expect(facade.agents()).toHaveLength(3);
    expect(facade.isCached()).toBe(true);
    expect(facade.isLoading()).toBe(false);
    expect(facade.error()).toBeNull();
  });

  it('fetchAgents() assigns builtin icon 🤖 for builtin scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        agents: [{ name: 'A', description: 'B', scope: 'builtin' }],
      }),
    );

    await facade.fetchAgents();

    expect(facade.agents()[0].icon).toBe('🤖');
  });

  it('fetchAgents() assigns project icon 🛠️ for project scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        agents: [{ name: 'A', description: 'B', scope: 'project' }],
      }),
    );

    await facade.fetchAgents();

    expect(facade.agents()[0].icon).toBe('🛠️');
  });

  it('fetchAgents() assigns user icon 👤 for user scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({ agents: [{ name: 'A', description: 'B', scope: 'user' }] }),
    );

    await facade.fetchAgents();

    expect(facade.agents()[0].icon).toBe('👤');
  });

  it('fetchAgents() does NOT set isCached when agents array is empty', async () => {
    mockRpc.call.mockResolvedValueOnce(rpcSuccess({ agents: [] }));

    await facade.fetchAgents();

    expect(facade.agents()).toEqual([]);
    expect(facade.isCached()).toBe(false);
  });

  // ── fetchAgents — cache guard ─────────────────────────────────────────────

  it('fetchAgents() skips RPC on second call when cache is valid', async () => {
    mockRpc.call.mockResolvedValue(
      rpcSuccess({
        agents: [{ name: 'Agent', description: 'desc', scope: 'builtin' }],
      }),
    );

    await facade.fetchAgents();
    mockRpc.call.mockClear();
    await facade.fetchAgents();

    expect(mockRpc.call).not.toHaveBeenCalled();
  });

  // ── fetchAgents — loading guard ───────────────────────────────────────────

  it('fetchAgents() skips concurrent second call while loading', async () => {
    let resolveFirst!: (v: RpcResult<unknown>) => void;
    mockRpc.call.mockReturnValue(
      new Promise<RpcResult<unknown>>((res) => {
        resolveFirst = res;
      }),
    );

    const first = facade.fetchAgents();
    const second = facade.fetchAgents(); // should be skipped by loading guard

    resolveFirst(
      rpcSuccess({
        agents: [{ name: 'A', description: 'B', scope: 'builtin' }],
      }),
    );
    await Promise.all([first, second]);

    expect(mockRpc.call).toHaveBeenCalledTimes(1);
  });

  // ── fetchAgents — error paths ─────────────────────────────────────────────

  it('fetchAgents() sets agents=[] and logs warn when result has error string', async () => {
    const consoleSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockRpc.call.mockResolvedValueOnce(rpcError('discovery failed'));

    await facade.fetchAgents();

    expect(facade.agents()).toEqual([]);
    expect(facade.error()).toBeNull(); // error signal not set for RPC error string path
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AgentDiscoveryFacade]'),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('fetchAgents() sets error signal when RPC throws Error instance', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockRpc.call.mockRejectedValueOnce(new Error('network failure'));

    await facade.fetchAgents();

    expect(facade.error()).toBe('network failure');
    expect(facade.agents()).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('fetchAgents() sets fallback error string when thrown value is not an Error', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockRpc.call.mockRejectedValueOnce('string-error');

    await facade.fetchAgents();

    expect(facade.error()).toBe('Failed to fetch agents');
    consoleSpy.mockRestore();
  });

  it('fetchAgents() resets isLoading to false even after error', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockRpc.call.mockRejectedValueOnce(new Error('fail'));

    await facade.fetchAgents();

    expect(facade.isLoading()).toBe(false);
    consoleSpy.mockRestore();
  });

  // ── searchAgents ──────────────────────────────────────────────────────────

  describe('searchAgents()', () => {
    beforeEach(async () => {
      mockRpc.call.mockResolvedValueOnce(
        rpcSuccess({
          agents: [
            {
              name: 'Senior Tester',
              description: 'Writes tests',
              scope: 'builtin',
            },
            {
              name: 'Code Reviewer',
              description: 'Reviews code quality',
              scope: 'builtin',
            },
            {
              name: 'My Custom Agent',
              description: 'Does custom things',
              scope: 'user',
            },
          ],
        }),
      );
      await facade.fetchAgents();
    });

    it('returns all agents when query is empty string', () => {
      const result = facade.searchAgents('');
      expect(result).toHaveLength(3);
    });

    it('filters by name substring (case-insensitive)', () => {
      const result = facade.searchAgents('tester');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Senior Tester');
    });

    it('filters by description substring (case-insensitive)', () => {
      const result = facade.searchAgents('reviews');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Code Reviewer');
    });

    it('returns empty array when no agents match', () => {
      const result = facade.searchAgents('xyz-nomatch');
      expect(result).toHaveLength(0);
    });

    it('matches upper-case query against lower-case name', () => {
      const result = facade.searchAgents('SENIOR');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Senior Tester');
    });
  });

  // ── clearCache ────────────────────────────────────────────────────────────

  it('clearCache() resets isCached, agents, and error signals', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        agents: [{ name: 'A', description: 'B', scope: 'builtin' }],
      }),
    );
    await facade.fetchAgents();
    expect(facade.isCached()).toBe(true);
    expect(facade.agents()).toHaveLength(1);

    facade.clearCache();

    expect(facade.isCached()).toBe(false);
    expect(facade.agents()).toHaveLength(0);
    expect(facade.error()).toBeNull();
  });

  it('clearCache() allows re-fetching after clearing', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        agents: [{ name: 'A', description: 'B', scope: 'builtin' }],
      }),
    );
    await facade.fetchAgents();
    facade.clearCache();

    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({ agents: [{ name: 'B', description: 'C', scope: 'user' }] }),
    );
    await facade.fetchAgents();

    expect(mockRpc.call).toHaveBeenCalledTimes(2);
    expect(facade.agents()[0].name).toBe('B');
  });
});
