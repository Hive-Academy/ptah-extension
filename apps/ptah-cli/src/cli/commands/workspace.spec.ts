/**
 * Unit tests for `ptah workspace` command — TASK_2026_104 Sub-batch B5d.
 *
 * Coverage:
 *   - info: emits workspace.info with the RPC payload
 *   - add: dispatches workspace:registerFolder; usage error without --path
 *   - remove: dispatches workspace:removeFolder; usage error without --path
 *   - switch: dispatches workspace:switch; usage error without --path
 *   - RPC failure (success: false) bubbles as task.error + exit 5
 *   - unknown sub-command: usage error (exit 2)
 */

import { execute } from './workspace.js';
import type { WorkspaceExecuteHooks, WorkspaceOptions } from './workspace.js';
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
  withEngine: WorkspaceExecuteHooks['withEngine'];
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
      throw new Error(
        'container.resolve hit — workspace cmd should not reach DI',
      );
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
  }) as unknown as WorkspaceExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: WorkspaceExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: WorkspaceExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah workspace info', () => {
  it('emits workspace.info via workspace:getInfo and exits 0', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('workspace:getInfo', {
      success: true,
      data: { folders: [{ path: 'D:/proj', name: 'proj' }] },
    });

    const exit = await execute(
      { subcommand: 'info' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('workspace:getInfo');
    expect(formatterTrace.notifications[0]?.method).toBe('workspace.info');
  });
});

describe('ptah workspace add', () => {
  it('exits 2 (UsageError) when --path is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'add' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--path is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches workspace:registerFolder and emits workspace.added', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('workspace:registerFolder', {
      success: true,
      data: { success: true, path: 'D:/new', name: 'new' },
    });

    const exit = await execute(
      { subcommand: 'add', path: 'D:/new' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'workspace:registerFolder',
      params: { path: 'D:/new' },
    });
    expect(formatterTrace.notifications[0]?.method).toBe('workspace.added');
  });

  it('bubbles RPC failure as task.error + exit 5', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('workspace:registerFolder', {
      success: true,
      data: { success: false, error: 'folder exists' },
    });

    const exit = await execute(
      { subcommand: 'add', path: 'D:/dup' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const lastNotification =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(lastNotification?.method).toBe('task.error');
  });
});

describe('ptah workspace remove', () => {
  it('exits 2 (UsageError) when --path is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'remove' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches workspace:removeFolder and emits workspace.removed', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('workspace:removeFolder', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      { subcommand: 'remove', path: 'D:/old' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'workspace:removeFolder',
      params: { path: 'D:/old' },
    });
    expect(formatterTrace.notifications[0]?.method).toBe('workspace.removed');
  });
});

describe('ptah workspace switch', () => {
  it('exits 2 (UsageError) when --path is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'switch' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches workspace:switch and emits workspace.switched', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('workspace:switch', {
      success: true,
      data: {
        success: true,
        path: 'D:/target',
        name: 'target',
        encodedPath: 'D__target',
      },
    });

    const exit = await execute(
      { subcommand: 'switch', path: 'D:/target' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('workspace:switch');
    expect(formatterTrace.notifications[0]?.method).toBe('workspace.switched');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      path: 'D:/target',
      encodedPath: 'D__target',
    });
  });
});

describe('ptah workspace unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'info' } satisfies WorkspaceOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
