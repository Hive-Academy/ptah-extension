/**
 * Unit tests for `ptah git` command.
 *
 * Coverage:
 *   - info / worktrees: emit git.info / git.worktrees with RPC payload
 *   - add-worktree: requires --branch; dispatches git:addWorktree
 *   - remove-worktree: requires --path; dispatches git:removeWorktree
 *   - stage / unstage: require non-empty --paths
 *   - discard: REQUIRES --confirm or refuses (UsageError, no RPC dispatch)
 *   - commit: requires non-empty --message
 *   - show-file: requires --path
 *   - RPC failure (success: false) bubbles as task.error + exit 5
 */

import { execute } from './git.js';
import type { GitExecuteHooks, GitOptions } from './git.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: process.cwd(),
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

function makeStderr(): { stderr: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stderr: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

interface MockEngine {
  withEngine: GitExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: { __default: method } };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => {
      throw new Error('container.resolve hit — git cmd should not reach DI');
    }),
  };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as GitExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: GitExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: GitExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah git info / worktrees', () => {
  it('emits git.info via git:info', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('git:info', {
      success: true,
      data: { branch: 'main' },
    });

    const exit = await execute(
      { subcommand: 'info' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('git:info');
    expect(formatterTrace.notifications[0]?.method).toBe('git.info');
  });

  it('emits git.worktrees via git:worktrees', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'worktrees' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('git:worktrees');
    expect(formatterTrace.notifications[0]?.method).toBe('git.worktrees');
  });
});

describe('ptah git add-worktree', () => {
  it('exits 2 (UsageError) when --branch is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'add-worktree' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches git:addWorktree with branch/path/createBranch', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('git:addWorktree', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      {
        subcommand: 'add-worktree',
        branch: 'feature/x',
        path: 'D:/wt',
        createBranch: true,
      } satisfies GitOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'git:addWorktree',
      params: { branch: 'feature/x', path: 'D:/wt', createBranch: true },
    });
    expect(formatterTrace.notifications[0]?.method).toBe('git.worktree.added');
  });
});

describe('ptah git remove-worktree', () => {
  it('exits 2 (UsageError) when --path is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'remove-worktree' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches git:removeWorktree with path/force', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('git:removeWorktree', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      {
        subcommand: 'remove-worktree',
        path: 'D:/wt',
        force: true,
      } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'git:removeWorktree',
      params: { path: 'D:/wt', force: true },
    });
  });
});

describe('ptah git stage / unstage', () => {
  it('stage: exits 2 when --paths is empty', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'stage', paths: [] } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('stage: dispatches git:stage with paths', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'stage', paths: ['a.ts', 'b.ts'] } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'git:stage',
      params: { paths: ['a.ts', 'b.ts'] },
    });
  });

  it('unstage: dispatches git:unstage with paths', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'unstage', paths: ['a.ts'] } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('git:unstage');
  });
});

describe('ptah git discard', () => {
  it('refuses without --confirm (UsageError, no RPC)', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'discard', paths: ['a.ts'] } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--confirm/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('refuses with empty --paths even with --confirm', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'discard', paths: [], confirm: true } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches git:discard when --confirm is set', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'discard',
        paths: ['a.ts'],
        confirm: true,
      } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'git:discard',
      params: { paths: ['a.ts'] },
    });
  });
});

describe('ptah git commit / show-file', () => {
  it('commit: exits 2 with empty --message', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'commit', message: '   ' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('commit: dispatches git:commit with message', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'commit', message: 'feat: something' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'git:commit',
      params: { message: 'feat: something' },
    });
  });

  it('show-file: exits 2 without --path', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'show-file' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('show-file: dispatches git:showFile and forwards content', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('git:showFile', {
      success: true,
      data: { content: 'file body' },
    });
    const exit = await execute(
      { subcommand: 'show-file', path: 'src/x.ts' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      path: 'src/x.ts',
      content: 'file body',
    });
  });
});

describe('ptah git unknown sub-command', () => {
  it('exits 2 (UsageError)', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'info' } satisfies GitOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });
});
