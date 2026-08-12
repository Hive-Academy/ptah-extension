/**
 * CommandDiscoveryFacade unit specs.
 *
 * Mirrors agent-discovery.facade.spec.ts with command-specific additions
 * (getCommandIcon scope mapping).
 */

import { TestBed } from '@angular/core/testing';
import {
  type LucideIconData,
  Zap,
  Package,
  User,
  Plug,
  Puzzle,
  HelpCircle,
} from 'lucide-angular';
import { CommandDiscoveryFacade } from './command-discovery.facade';
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

describe('CommandDiscoveryFacade', () => {
  let facade: CommandDiscoveryFacade;
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
        CommandDiscoveryFacade,
        { provide: ClaudeRpcService, useValue: mockRpc },
        { provide: VSCodeService, useValue: mockVsCode },
      ],
    });
    facade = TestBed.inject(CommandDiscoveryFacade);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts with isLoading=false, commands=[], isCached=false, error=null', () => {
    expect(facade.isLoading()).toBe(false);
    expect(facade.commands()).toEqual([]);
    expect(facade.isCached()).toBe(false);
    expect(facade.error()).toBeNull();
  });

  // ── Workspace-switch invalidation (TASK_2026_200) ─────────────────────────

  describe('clearCache() on workspace switch', () => {
    it('forces a refetch of the / picker after a switch', async () => {
      mockRpc.call.mockResolvedValueOnce(
        rpcSuccess({
          commands: [
            { name: 'alpha-cmd', description: 'A only', scope: 'project' },
          ],
        }),
      );
      await facade.fetchCommands();
      expect(facade.isCached()).toBe(true);

      facade.clearCache();
      workspaceRoot = 'D:\\ws\\beta';
      mockRpc.call.mockResolvedValueOnce(
        rpcSuccess({
          commands: [
            { name: 'beta-cmd', description: 'B only', scope: 'project' },
          ],
        }),
      );

      await facade.fetchCommands();

      expect(facade.commands().map((c) => c.name)).toEqual(['beta-cmd']);
      expect(mockRpc.call).toHaveBeenCalledTimes(2);
      expect(mockRpc.call).toHaveBeenLastCalledWith(
        'autocomplete:commands',
        expect.objectContaining({ workspaceRoot: 'D:\\ws\\beta' }),
      );
    });

    it('drops an in-flight pre-switch response that resolves after the clear', async () => {
      let release!: (value: RpcResult<{ commands: unknown[] }>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<{ commands: unknown[] }>>((resolve) => {
          release = resolve;
        }),
      );

      const fetching = facade.fetchCommands();
      facade.clearCache();

      release(
        rpcSuccess({
          commands: [
            { name: 'alpha-cmd', description: 'A only', scope: 'project' },
          ],
        }),
      );
      await fetching;

      expect(facade.commands()).toEqual([]);
      // isCached has no TTL — a stale response pinning it true would freeze
      // workspace A's commands into the / picker for the process lifetime.
      expect(facade.isCached()).toBe(false);
    });

    it('still refetches after a stale response was dropped', async () => {
      let release!: (value: RpcResult<{ commands: unknown[] }>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<{ commands: unknown[] }>>((resolve) => {
          release = resolve;
        }),
      );

      const fetching = facade.fetchCommands();
      facade.clearCache();
      release(
        rpcSuccess({
          commands: [
            { name: 'alpha-cmd', description: 'A only', scope: 'project' },
          ],
        }),
      );
      await fetching;

      mockRpc.call.mockResolvedValueOnce(
        rpcSuccess({
          commands: [
            { name: 'beta-cmd', description: 'B only', scope: 'project' },
          ],
        }),
      );
      await facade.fetchCommands();

      expect(facade.commands().map((c) => c.name)).toEqual(['beta-cmd']);
    });

    it('leaves isLoading false after a clear, so fetchCommands is not wedged', async () => {
      let release!: (value: RpcResult<{ commands: unknown[] }>) => void;
      mockRpc.call.mockReturnValueOnce(
        new Promise<RpcResult<{ commands: unknown[] }>>((resolve) => {
          release = resolve;
        }),
      );

      const fetching = facade.fetchCommands();
      expect(facade.isLoading()).toBe(true);

      facade.clearCache();
      expect(facade.isLoading()).toBe(false);

      release(rpcSuccess({ commands: [] }));
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

      const fetching = facade.fetchCommands();
      facade.clearCache();
      reject(new Error('alpha discovery blew up'));
      await fetching;

      expect(facade.error()).toBeNull();
    });
  });

  // ── Workspace scoping (TASK_2026_200, criterion 10 call-site half) ────────

  describe('workspace scoping on autocomplete:commands', () => {
    it('sends the active workspaceRoot with the request', async () => {
      mockRpc.call.mockResolvedValueOnce(rpcSuccess({ commands: [] }));

      await facade.fetchCommands();

      expect(mockRpc.call).toHaveBeenCalledWith('autocomplete:commands', {
        query: '',
        maxResults: 100,
        workspaceRoot: 'D:\\ws\\alpha',
      });
    });

    it('omits workspaceRoot entirely when no root is known — never sends ""', async () => {
      workspaceRoot = '';
      mockRpc.call.mockResolvedValueOnce(rpcSuccess({ commands: [] }));

      await facade.fetchCommands();

      const params = mockRpc.call.mock.calls[0][1] as Record<string, unknown>;
      expect('workspaceRoot' in params).toBe(false);
      expect(params).toEqual({ query: '', maxResults: 100 });
    });
  });

  // ── fetchCommands — happy paths ───────────────────────────────────────────

  it('fetchCommands() populates commands and sets isCached=true', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [
          {
            name: 'orchestrate',
            description: 'Start workflow',
            scope: 'builtin',
          },
          { name: 'my-cmd', description: 'Project cmd', scope: 'project' },
        ],
      }),
    );

    await facade.fetchCommands();

    expect(facade.commands()).toHaveLength(2);
    expect(facade.isCached()).toBe(true);
    expect(facade.isLoading()).toBe(false);
  });

  it('fetchCommands() does NOT set isCached when commands array is empty', async () => {
    mockRpc.call.mockResolvedValueOnce(rpcSuccess({ commands: [] }));

    await facade.fetchCommands();

    expect(facade.commands()).toEqual([]);
    expect(facade.isCached()).toBe(false);
  });

  // ── getCommandIcon scope mapping ──────────────────────────────────────────

  it('assigns Zap icon for builtin scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'builtin' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe(Zap);
  });

  it('assigns Package icon for project scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'project' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe(Package);
  });

  it('assigns User icon for user scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'user' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe(User);
  });

  it('assigns Plug icon for mcp scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'mcp' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe(Plug);
  });

  it('assigns Puzzle icon for plugin scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'plugin' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe(Puzzle);
  });

  it('assigns HelpCircle icon for unknown scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [
          { name: 'cmd', description: 'desc', scope: 'unknown-scope' },
        ],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe(HelpCircle);
  });

  // ── fetchCommands — cache guard ───────────────────────────────────────────

  it('fetchCommands() skips RPC on second call when cache is valid', async () => {
    mockRpc.call.mockResolvedValue(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'builtin' }],
      }),
    );

    await facade.fetchCommands();
    mockRpc.call.mockClear();
    await facade.fetchCommands();

    expect(mockRpc.call).not.toHaveBeenCalled();
  });

  // ── fetchCommands — loading guard ─────────────────────────────────────────

  it('fetchCommands() skips concurrent second call while loading', async () => {
    let resolveFirst!: (v: RpcResult<unknown>) => void;
    mockRpc.call.mockReturnValue(
      new Promise<RpcResult<unknown>>((res) => {
        resolveFirst = res;
      }),
    );

    const first = facade.fetchCommands();
    const second = facade.fetchCommands();

    resolveFirst(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'builtin' }],
      }),
    );
    await Promise.all([first, second]);

    expect(mockRpc.call).toHaveBeenCalledTimes(1);
  });

  // ── fetchCommands — error paths ───────────────────────────────────────────

  it('fetchCommands() sets commands=[] and logs warn for RPC error string', async () => {
    const consoleSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockRpc.call.mockResolvedValueOnce(rpcError('discovery failed'));

    await facade.fetchCommands();

    expect(facade.commands()).toEqual([]);
    expect(facade.error()).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('fetchCommands() sets error signal when RPC throws Error', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockRpc.call.mockRejectedValueOnce(new Error('network failure'));

    await facade.fetchCommands();

    expect(facade.error()).toBe('network failure');
    expect(facade.commands()).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('fetchCommands() uses fallback error string for non-Error throws', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockRpc.call.mockRejectedValueOnce('string-error');

    await facade.fetchCommands();

    expect(facade.error()).toBe('Failed to fetch commands');
    consoleSpy.mockRestore();
  });

  it('fetchCommands() resets isLoading to false after error', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockRpc.call.mockRejectedValueOnce(new Error('fail'));

    await facade.fetchCommands();

    expect(facade.isLoading()).toBe(false);
    consoleSpy.mockRestore();
  });

  // ── searchCommands ────────────────────────────────────────────────────────

  describe('searchCommands()', () => {
    beforeEach(async () => {
      mockRpc.call.mockResolvedValueOnce(
        rpcSuccess({
          commands: [
            {
              name: 'orchestrate',
              description: 'Start a workflow',
              scope: 'builtin',
            },
            {
              name: 'review-code',
              description: 'Review code quality',
              scope: 'builtin',
            },
            {
              name: 'my-project-cmd',
              description: 'Project-specific',
              scope: 'project',
            },
          ],
        }),
      );
      await facade.fetchCommands();
    });

    it('returns all commands when query is empty', () => {
      expect(facade.searchCommands('')).toHaveLength(3);
    });

    it('filters by name substring (case-insensitive)', () => {
      const result = facade.searchCommands('review');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('review-code');
    });

    it('filters by description substring (case-insensitive)', () => {
      const result = facade.searchCommands('workflow');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('orchestrate');
    });

    it('returns empty array for no-match query', () => {
      expect(facade.searchCommands('xyz-nomatch')).toHaveLength(0);
    });

    it('matches upper-case query against lower-case name', () => {
      const result = facade.searchCommands('ORCHESTRATE');
      expect(result).toHaveLength(1);
    });
  });

  // ── clearCache ────────────────────────────────────────────────────────────

  it('clearCache() resets isCached, commands, and error signals', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'builtin' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.isCached()).toBe(true);

    facade.clearCache();

    expect(facade.isCached()).toBe(false);
    expect(facade.commands()).toHaveLength(0);
    expect(facade.error()).toBeNull();
  });

  it('clearCache() allows re-fetching after clear', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'builtin' }],
      }),
    );
    await facade.fetchCommands();
    facade.clearCache();

    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd2', description: 'new', scope: 'user' }],
      }),
    );
    await facade.fetchCommands();

    expect(mockRpc.call).toHaveBeenCalledTimes(2);
    expect(facade.commands()[0].name).toBe('cmd2');
  });
});
