/**
 * Unit tests for `ptah config` command.
 *
 * Coverage:
 *   - get / set / list / reset (file-backed via mock IWorkspaceProvider)
 *   - model-switch / model-get / models-list (RPC)
 *   - autopilot get / set (RPC; boolean parsing)
 *   - effort get / set (RPC; whitelist validation)
 *   - go-vet status / on / off (consent RPC; exit 0/1/2/5 per O2 §5.2)
 *   - missing args produce UsageError; redact applied to list unless --reveal
 */

import { execute, executeGoVet } from './config.js';
import type { ConfigExecuteHooks, ConfigOptions } from './config.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

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

interface WorkspaceProviderStub {
  store: Map<string, unknown>;
  provider: {
    getConfiguration<T>(section: string, key: string, def?: T): T | undefined;
    setConfiguration(
      section: string,
      key: string,
      value: unknown,
    ): Promise<void>;
  };
}

function makeWorkspaceProvider(
  initial: Record<string, unknown> = {},
): WorkspaceProviderStub {
  const store = new Map<string, unknown>(Object.entries(initial));
  const provider = {
    getConfiguration<T>(_section: string, key: string, def?: T): T | undefined {
      return store.has(key) ? (store.get(key) as T) : def;
    },
    setConfiguration: jest.fn(
      async (_section: string, key: string, value: unknown) => {
        store.set(key, value);
      },
    ),
  };
  return { store, provider };
}

interface MockEngine {
  withEngine: ConfigExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
}

function makeEngine(workspace: WorkspaceProviderStub['provider']): MockEngine {
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
    resolve: jest.fn((token: symbol) => {
      if (token === PLATFORM_TOKENS.WORKSPACE_PROVIDER) {
        return workspace;
      }
      throw new Error(`unexpected token: ${String(token)}`);
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
  }) as unknown as ConfigExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

interface BuildHooksOpts {
  initial?: Record<string, unknown>;
}

function buildHooks(opts: BuildHooksOpts = {}): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  workspace: WorkspaceProviderStub;
  hooks: ConfigExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const workspace = makeWorkspaceProvider(opts.initial);
  const engine = makeEngine(workspace.provider);
  const hooks: ConfigExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, workspace, hooks };
}

// ---------------------------------------------------------------------------
// File-backed sub-commands
// ---------------------------------------------------------------------------

describe('ptah config get', () => {
  it('exits 2 when <key> is missing', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'get' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('reads from IWorkspaceProvider.getConfiguration and emits config.value', async () => {
    const { formatterTrace, hooks } = buildHooks({
      initial: { 'agent.model': 'sonnet-4' },
    });
    const exit = await execute(
      { subcommand: 'get', key: 'agent.model' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe('config.value');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      key: 'agent.model',
      value: 'sonnet-4',
    });
  });
});

describe('ptah config set', () => {
  it('exits 2 when <value> is missing', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'set', key: 'k' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('parses booleans / numbers / JSON and writes via setConfiguration', async () => {
    const { workspace, hooks } = buildHooks();
    await execute(
      { subcommand: 'set', key: 'b', value: 'true' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    await execute(
      { subcommand: 'set', key: 'n', value: '42' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    await execute(
      { subcommand: 'set', key: 'a', value: '[1,2,3]' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(workspace.store.get('b')).toBe(true);
    expect(workspace.store.get('n')).toBe(42);
    expect(workspace.store.get('a')).toEqual([1, 2, 3]);
  });
});

describe('ptah config list', () => {
  it('emits config.list snapshot for FILE_BASED_SETTINGS_KEYS', async () => {
    const { formatterTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'list' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe('config.list');
    const params = formatterTrace.notifications[0]?.params as {
      settings: Record<string, unknown>;
    };
    expect(typeof params.settings).toBe('object');
  });

  it('keysOnly emits a sorted key list with no values (CLI bug #13)', async () => {
    const { formatterTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'list', keysOnly: true } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const params = formatterTrace.notifications[0]?.params as {
      keys: string[];
      keysOnly: boolean;
      settings?: unknown;
    };
    expect(params.keysOnly).toBe(true);
    expect(Array.isArray(params.keys)).toBe(true);
    expect(params.keys.length).toBeGreaterThan(0);
    expect(params.settings).toBeUndefined();
    // Keys must be sorted ascending.
    const sorted = [...params.keys].sort();
    expect(params.keys).toEqual(sorted);
  });

  it('prefix filters the snapshot to keys starting with <prefix> (CLI bug #13)', async () => {
    const { formatterTrace, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'list',
        prefix: 'provider.',
      } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const params = formatterTrace.notifications[0]?.params as {
      settings: Record<string, unknown>;
      prefix: string;
    };
    expect(params.prefix).toBe('provider.');
    const keys = Object.keys(params.settings);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith('provider.')).toBe(true);
    }
  });

  it('changedOnly omits keys equal to FILE_BASED_SETTINGS_DEFAULTS (CLI bug #13)', async () => {
    // Seed an override that diverges from defaults; `llm.defaultProvider` is
    // a real FILE_BASED_SETTINGS_KEYS entry, and any custom string we write
    // here is guaranteed to differ from whatever the registered default is.
    const { formatterTrace, hooks } = buildHooks({
      initial: { 'llm.defaultProvider': '__custom-override__' },
    });
    const exit = await execute(
      {
        subcommand: 'list',
        changedOnly: true,
      } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const params = formatterTrace.notifications[0]?.params as {
      settings: Record<string, unknown>;
      changedOnly: boolean;
    };
    expect(params.changedOnly).toBe(true);
    expect(params.settings['llm.defaultProvider']).toBe('__custom-override__');
  });
});

describe('ptah config reset', () => {
  it('exits 2 when <key> is missing', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'reset' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('writes the FILE_BASED_SETTINGS_DEFAULTS value back to settings', async () => {
    const { workspace, formatterTrace, hooks } = buildHooks({
      initial: { 'autopilot.enabled': true },
    });
    const exit = await execute(
      { subcommand: 'reset', key: 'autopilot.enabled' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    // Whatever the default is (FILE_BASED_SETTINGS_DEFAULTS may not declare
    // every key), setConfiguration must be called once with the section + key.
    expect(workspace.provider.setConfiguration).toHaveBeenCalledTimes(1);
    const callArgs =
      (workspace.provider.setConfiguration as jest.Mock).mock.calls[0] ?? [];
    expect(callArgs[0]).toBe('ptah');
    expect(callArgs[1]).toBe('autopilot.enabled');
    expect(formatterTrace.notifications[0]?.method).toBe('config.updated');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      reset: true,
    });
  });
});

// ---------------------------------------------------------------------------
// RPC sub-subcommands
// ---------------------------------------------------------------------------

describe('ptah config model-switch / model-get / models-list', () => {
  it('model-switch dispatches config:model-switch with model param', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'model-switch', value: 'opus-4' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'config:model-switch',
      params: { model: 'opus-4' },
    });
  });

  it('model-switch: exits 2 when <model> is missing', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'model-switch' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('model-get dispatches config:model-get and emits config.model', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'model-get' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('config:model-get');
    expect(formatterTrace.notifications[0]?.method).toBe('config.model');
  });

  it('models-list dispatches config:models-list and emits config.models', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'models-list' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('config:models-list');
    expect(formatterTrace.notifications[0]?.method).toBe('config.models');
  });
});

describe('ptah config autopilot', () => {
  it('autopilot get dispatches config:autopilot-get', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'autopilot-get' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('config:autopilot-get');
  });

  it('autopilot set parses true/false and dispatches config:autopilot-toggle', async () => {
    const { engine, hooks } = buildHooks();
    await execute(
      { subcommand: 'autopilot-set', value: 'true' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(engine.rpcCalls[0]).toEqual({
      method: 'config:autopilot-toggle',
      params: { enabled: true, permissionLevel: 'yolo' },
    });
  });

  it('autopilot set: rejects invalid boolean with UsageError', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'autopilot-set', value: 'maybe' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });
});

describe('ptah config effort', () => {
  it('effort get dispatches config:effort-get', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'effort-get' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('config:effort-get');
  });

  it('effort set: dispatches config:effort-set with valid effort', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'effort-set', value: 'medium' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'config:effort-set',
      params: { effort: 'medium' },
    });
  });

  it('effort set: rejects invalid effort with UsageError', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'effort-set', value: 'extreme' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });
});

describe('ptah config go-vet (TASK_2026_559 O2 §5.2 / §7.3)', () => {
  const GET = 'diagnostics:go-vet-consent-get';
  const SET = 'diagnostics:go-vet-consent-set';
  const ROOT = '/work/go-app';

  function scriptGet(engine: MockEngine, data: Record<string, unknown>): void {
    engine.scripted.set(GET, { success: true, data });
  }

  it('status emits config.goVet with root, state and binary, exit 0', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    scriptGet(engine, {
      supported: true,
      workspace: { root: ROOT },
      state: 'on',
      goBinary: '/usr/local/go/bin/go',
    });
    const exit = await executeGoVet('status', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([{ method: GET, params: {} }]);
    expect(formatterTrace.notifications).toEqual([
      {
        method: 'config.goVet',
        params: {
          supported: true,
          workspaceRoot: ROOT,
          state: 'on',
          goBinary: '/usr/local/go/bin/go',
        },
      },
    ]);
  });

  it('status shows stale with its reason, never as on', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    scriptGet(engine, {
      supported: true,
      workspace: { root: ROOT },
      state: 'stale',
      staleReason: 'go-changed',
    });
    const exit = await executeGoVet('status', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.params).toEqual({
      supported: true,
      workspaceRoot: ROOT,
      state: 'stale',
      staleReason: 'go-changed',
    });
  });

  it('status on an unsupported host → exit 1 with one fixed stderr line', async () => {
    const { engine, hooks, stderrTrace } = buildHooks();
    scriptGet(engine, { supported: false, workspace: null, state: 'off' });
    const exit = await executeGoVet('status', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.GeneralError);
    expect(stderrTrace.buffer).toBe('ptah config go-vet: unsupported\n');
  });

  it("on → GET then SET with GET's root and confirm token, source 'cli'; shows the binary the host committed", async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    scriptGet(engine, {
      supported: true,
      workspace: { root: ROOT },
      state: 'off',
      goBinary: '/usr/local/go/bin/go',
      confirmToken: 'root-part.binary-part',
    });
    engine.scripted.set(SET, {
      success: true,
      data: { success: true, state: 'on', goBinary: '/usr/local/go/bin/go' },
    });
    const exit = await executeGoVet('on', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      { method: GET, params: {} },
      {
        method: SET,
        params: {
          enabled: true,
          workspaceRoot: ROOT,
          confirmToken: 'root-part.binary-part',
          source: 'cli',
        },
      },
    ]);
    expect(formatterTrace.notifications).toEqual([
      {
        method: 'config.goVet',
        params: {
          supported: true,
          workspaceRoot: ROOT,
          state: 'on',
          goBinary: '/usr/local/go/bin/go',
        },
      },
    ]);
  });

  it('closing review 4: on never reports a binary the host did not commit', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    scriptGet(engine, {
      supported: true,
      workspace: { root: ROOT },
      state: 'off',
      goBinary: '/old/go/bin/go',
      confirmToken: 'r.b',
    });
    engine.scripted.set(SET, {
      success: true,
      data: { success: true, state: 'on', goBinary: '/usr/local/go/bin/go' },
    });
    await executeGoVet('on', baseGlobals, hooks);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      goBinary: '/usr/local/go/bin/go',
    });
  });

  it('off reports the read-back state from SET', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    scriptGet(engine, {
      supported: true,
      workspace: { root: ROOT },
      state: 'on',
    });
    engine.scripted.set(SET, {
      success: true,
      data: { success: true, state: 'off' },
    });
    const exit = await executeGoVet('off', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[1]?.params).toEqual({
      enabled: false,
      workspaceRoot: ROOT,
      source: 'cli',
    });
    expect(formatterTrace.notifications[0]).toEqual({
      method: 'config.goVet',
      params: { supported: true, workspaceRoot: ROOT, state: 'off' },
    });
  });

  it.each([
    'workspace-changed',
    'go-changed',
    'no-go-binary',
    'persist-failed',
  ])(
    'SET success:false (%s) → exit 1, fixed stderr line, no config.goVet notification',
    async (error) => {
      const { engine, hooks, formatterTrace, stderrTrace } = buildHooks();
      scriptGet(engine, {
        supported: true,
        workspace: { root: ROOT },
        state: 'off',
      });
      engine.scripted.set(SET, {
        success: true,
        data: { success: false, error },
      });
      const exit = await executeGoVet('on', baseGlobals, hooks);
      expect(exit).toBe(ExitCode.GeneralError);
      expect(stderrTrace.buffer).toBe(`ptah config go-vet: ${error}\n`);
      expect(formatterTrace.notifications).toEqual([]);
    },
  );

  it('SET claiming success with the wrong read-back state is not a success', async () => {
    const { engine, hooks, formatterTrace, stderrTrace } = buildHooks();
    scriptGet(engine, {
      supported: true,
      workspace: { root: ROOT },
      state: 'on',
    });
    engine.scripted.set(SET, {
      success: true,
      data: { success: true, state: 'on' },
    });
    const exit = await executeGoVet('off', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.GeneralError);
    expect(stderrTrace.buffer).toBe('ptah config go-vet: persist-failed\n');
    expect(formatterTrace.notifications).toEqual([]);
  });

  it('on with supported:false → exit 1, SET never called', async () => {
    const { engine, hooks, formatterTrace, stderrTrace } = buildHooks();
    scriptGet(engine, { supported: false, workspace: null, state: 'off' });
    const exit = await executeGoVet('on', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.GeneralError);
    expect(engine.rpcCalls.map((c) => c.method)).toEqual([GET]);
    expect(stderrTrace.buffer).toBe('ptah config go-vet: unsupported\n');
    expect(formatterTrace.notifications).toEqual([]);
  });

  it('on with no active workspace → exit 1 no-workspace, SET never called', async () => {
    const { engine, hooks, stderrTrace } = buildHooks();
    scriptGet(engine, { supported: true, workspace: null, state: 'off' });
    const exit = await executeGoVet('on', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.GeneralError);
    expect(engine.rpcCalls.map((c) => c.method)).toEqual([GET]);
    expect(stderrTrace.buffer).toBe('ptah config go-vet: no-workspace\n');
  });

  it('unknown action → exit 2, no RPC', async () => {
    const { engine, hooks, stderrTrace } = buildHooks();
    const exit = await executeGoVet('enable', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
    expect(stderrTrace.buffer).toContain("unknown sub-command 'enable'");
  });

  it('an inherited object key is not an action (exit 2)', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await executeGoVet('toString', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('transport failure → exit 5, no config.goVet notification', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set(GET, { success: false, error: 'transport down' });
    const exit = await executeGoVet('on', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.InternalFailure);
    expect(
      formatterTrace.notifications.some((n) => n.method === 'config.goVet'),
    ).toBe(false);
  });

  it('a malformed GET result is an internal failure, not a status', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    scriptGet(engine, { supported: true, state: 'enabled' });
    const exit = await executeGoVet('status', baseGlobals, hooks);
    expect(exit).toBe(ExitCode.InternalFailure);
    expect(formatterTrace.notifications[0]?.method).toBe('task.error');
  });
});

describe('ptah config unknown sub-command', () => {
  it('exits 2 (UsageError)', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'get' } satisfies ConfigOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });
});
