/**
 * CommandDiscoveryFacade unit specs.
 *
 * Mirrors agent-discovery.facade.spec.ts with command-specific additions
 * (getCommandIcon scope mapping).
 */

import { TestBed } from '@angular/core/testing';
import { CommandDiscoveryFacade } from './command-discovery.facade';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';

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

  beforeEach(() => {
    mockRpc = buildMockRpc();
    TestBed.configureTestingModule({
      providers: [
        CommandDiscoveryFacade,
        { provide: ClaudeRpcService, useValue: mockRpc },
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

  it('assigns ⚡ for builtin scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'builtin' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe('⚡');
  });

  it('assigns 📦 for project scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'project' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe('📦');
  });

  it('assigns 👤 for user scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'user' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe('👤');
  });

  it('assigns 🔌 for mcp scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'mcp' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe('🔌');
  });

  it('assigns 🧩 for plugin scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [{ name: 'cmd', description: 'desc', scope: 'plugin' }],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe('🧩');
  });

  it('assigns ❓ for unknown scope', async () => {
    mockRpc.call.mockResolvedValueOnce(
      rpcSuccess({
        commands: [
          { name: 'cmd', description: 'desc', scope: 'unknown-scope' },
        ],
      }),
    );
    await facade.fetchCommands();
    expect(facade.commands()[0].icon).toBe('❓');
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
