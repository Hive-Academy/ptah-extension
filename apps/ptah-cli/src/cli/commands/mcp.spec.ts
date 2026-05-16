/**
 * Unit tests for `ptah mcp` command.
 *
 * Coverage:
 *   - search: dispatches mcpDirectory:search; usage error without query
 *   - details: dispatches mcpDirectory:getDetails; usage error without name
 *   - install:
 *       * UsageError when --target invalid or missing
 *       * derives stdio/npx config from version_detail
 *       * second invocation against an identical existing config →
 *         `changed: false` and skips the install RPC
 *       * partial-failure (results[].success === false) bubbles via task.error
 *   - uninstall:
 *       * UsageError when --target invalid or missing
 *       * absent server short-circuits with `changed: false`
 *   - list / popular: emit the correct notification methods
 *   - unknown sub-command: usage error (exit 2)
 */

import { execute } from './mcp.js';
import type { McpExecuteHooks, McpOptions } from './mcp.js';
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
  withEngine: McpExecuteHooks['withEngine'];
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
      throw new Error('container.resolve hit — mcp cmd should not reach DI');
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
  }) as unknown as McpExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: McpExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: McpExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

// A minimal registry-entry fixture whose first stdio package resolves to
// `npx -y <pkg>`. Used by every install-flow test.
function makeNpmEntry(name: string, pkg: string): unknown {
  return {
    name,
    description: 'fixture',
    version_detail: {
      version: '1.0.0',
      transports: [{ type: 'stdio' }],
      packages: [{ registry_name: 'npm', name: pkg, version: '1.0.0' }],
    },
  };
}

describe('ptah mcp search', () => {
  it('exits 2 (UsageError) when query is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'search' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/<query> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches mcpDirectory:search and emits mcp.search', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('mcpDirectory:search', {
      success: true,
      data: { servers: [{ name: 'foo' }], nextCursor: 'cur1' },
    });
    const exit = await execute(
      { subcommand: 'search', query: 'github' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'mcpDirectory:search',
      params: { query: 'github' },
    });
    expect(formatterTrace.notifications[0]).toEqual({
      method: 'mcp.search',
      params: {
        query: 'github',
        servers: [{ name: 'foo' }],
        nextCursor: 'cur1',
      },
    });
  });
});

describe('ptah mcp details', () => {
  it('exits 2 (UsageError) when name is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'details' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches mcpDirectory:getDetails and emits mcp.details', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('mcpDirectory:getDetails', {
      success: true,
      data: { name: 'io.github.x/y', description: 'd' },
    });
    const exit = await execute(
      { subcommand: 'details', name: 'io.github.x/y' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe('mcp.details');
  });
});

describe('ptah mcp install', () => {
  it('exits 2 (UsageError) when --target is missing', async () => {
    const { hooks, engine, stderrTrace } = buildHooks();
    const exit = await execute(
      { subcommand: 'install', name: 'io.github.x/y' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--target is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) for unrecognized --target', async () => {
    const { hooks, engine, stderrTrace } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'install',
        name: 'io.github.x/y',
        target: 'bogus',
      } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--target is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('writes once and emits mcp.installed { changed: true } on first install', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('mcpDirectory:listInstalled', {
      success: true,
      data: { servers: [] },
    });
    engine.scripted.set('mcpDirectory:getDetails', {
      success: true,
      data: makeNpmEntry('io.github.x/y', '@scope/foo'),
    });
    engine.scripted.set('mcpDirectory:install', {
      success: true,
      data: {
        results: [
          {
            target: 'claude',
            success: true,
            configPath: 'D:/proj/.mcp.json',
          },
        ],
      },
    });

    const exit = await execute(
      {
        subcommand: 'install',
        name: 'io.github.x/y',
        target: 'claude',
      } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);

    const installCall = engine.rpcCalls.find(
      (c) => c.method === 'mcpDirectory:install',
    );
    expect(installCall).toBeDefined();
    expect(installCall?.params).toMatchObject({
      serverName: 'io.github.x/y',
      serverKey: 'y',
      targets: ['claude'],
      config: { type: 'stdio', command: 'npx', args: ['-y', '@scope/foo'] },
    });
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('mcp.installed');
    expect(last?.params).toMatchObject({ changed: true, target: 'claude' });
  });

  it('is idempotent — second install with identical config emits changed:false and skips the install RPC', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    // Pre-existing identical config in listInstalled.
    engine.scripted.set('mcpDirectory:listInstalled', {
      success: true,
      data: {
        servers: [
          {
            serverKey: 'y',
            target: 'claude',
            configPath: 'D:/proj/.mcp.json',
            config: {
              type: 'stdio',
              command: 'npx',
              args: ['-y', '@scope/foo'],
            },
            managedByPtah: true,
          },
        ],
      },
    });
    engine.scripted.set('mcpDirectory:getDetails', {
      success: true,
      data: makeNpmEntry('io.github.x/y', '@scope/foo'),
    });

    const exit = await execute(
      {
        subcommand: 'install',
        name: 'io.github.x/y',
        target: 'claude',
      } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);

    expect(
      engine.rpcCalls.find((c) => c.method === 'mcpDirectory:install'),
    ).toBeUndefined();

    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('mcp.installed');
    expect(last?.params).toMatchObject({ changed: false, target: 'claude' });
  });

  it('bubbles install RPC failure (results[].success=false) as task.error', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('mcpDirectory:listInstalled', {
      success: true,
      data: { servers: [] },
    });
    engine.scripted.set('mcpDirectory:getDetails', {
      success: true,
      data: makeNpmEntry('io.github.x/y', '@scope/foo'),
    });
    engine.scripted.set('mcpDirectory:install', {
      success: true,
      data: {
        results: [
          {
            target: 'claude',
            success: false,
            configPath: '',
            error: 'EACCES',
          },
        ],
      },
    });

    const exit = await execute(
      {
        subcommand: 'install',
        name: 'io.github.x/y',
        target: 'claude',
      } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah mcp uninstall', () => {
  it('exits 2 (UsageError) when --target is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'uninstall', key: 'foo' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('emits changed:false and skips uninstall when not installed', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('mcpDirectory:listInstalled', {
      success: true,
      data: { servers: [] },
    });
    const exit = await execute(
      {
        subcommand: 'uninstall',
        key: 'foo',
        target: 'claude',
      } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'mcpDirectory:uninstall'),
    ).toBeUndefined();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('mcp.uninstalled');
    expect(last?.params).toMatchObject({ changed: false });
  });

  it('runs uninstall and emits changed:true when installed', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('mcpDirectory:listInstalled', {
      success: true,
      data: {
        servers: [
          {
            serverKey: 'foo',
            target: 'claude',
            configPath: 'D:/proj/.mcp.json',
            config: { type: 'stdio', command: 'npx', args: ['-y', 'foo-pkg'] },
            managedByPtah: true,
          },
        ],
      },
    });
    engine.scripted.set('mcpDirectory:uninstall', {
      success: true,
      data: {
        results: [
          { target: 'claude', success: true, configPath: 'D:/proj/.mcp.json' },
        ],
      },
    });
    const exit = await execute(
      {
        subcommand: 'uninstall',
        key: 'foo',
        target: 'claude',
      } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const uninstallCall = engine.rpcCalls.find(
      (c) => c.method === 'mcpDirectory:uninstall',
    );
    expect(uninstallCall).toBeDefined();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('mcp.uninstalled');
    expect(last?.params).toMatchObject({ changed: true });
  });
});

describe('ptah mcp list', () => {
  it('emits mcp.list via mcpDirectory:listInstalled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('mcpDirectory:listInstalled', {
      success: true,
      data: { servers: [{ serverKey: 'a' }] },
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('mcpDirectory:listInstalled');
    expect(formatterTrace.notifications[0]?.method).toBe('mcp.list');
  });
});

describe('ptah mcp popular', () => {
  it('emits mcp.popular via mcpDirectory:getPopular', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('mcpDirectory:getPopular', {
      success: true,
      data: { servers: [{ name: 'p1' }] },
    });
    const exit = await execute(
      { subcommand: 'popular' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('mcpDirectory:getPopular');
    expect(formatterTrace.notifications[0]?.method).toBe('mcp.popular');
  });
});

describe('ptah mcp unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'list' } satisfies McpOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
