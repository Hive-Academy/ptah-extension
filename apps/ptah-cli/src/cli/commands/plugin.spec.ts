/**
 * Unit tests for `ptah plugin` command.
 *
 * Coverage:
 *   - list:         dispatches plugins:list-available; emits plugin.list
 *   - enable:
 *       * UsageError without <id>
 *       * already-enabled → emits changed:false, skips plugins:save-config
 *       * not-enabled    → emits changed:true, runs plugins:save-config
 *   - disable:
 *       * UsageError without <id>
 *       * not-enabled    → emits changed:false, skips plugins:save-config
 *       * already-enabled → emits changed:true, runs plugins:save-config
 *   - config get:    dispatches plugins:get-config; emits plugin.config.value
 *   - config set:
 *       * UsageError when both --enabled and --disabled-skills missing
 *       * identical state → emits changed:false, skips plugins:save-config
 *       * mutating state  → emits changed:true, runs plugins:save-config
 *   - skills list:
 *       * defaults to currently-enabled plugin set
 *       * --plugins overrides the default
 *   - unknown sub-command → exit 2
 */

import { execute } from './plugin.js';
import type { PluginExecuteHooks, PluginOptions } from './plugin.js';
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
  withEngine: PluginExecuteHooks['withEngine'];
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
      throw new Error('container.resolve hit — plugin cmd should not reach DI');
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
  }) as unknown as PluginExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: PluginExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: PluginExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah plugin list', () => {
  it('dispatches plugins:list-available and emits plugin.list', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:list-available', {
      success: true,
      data: { plugins: [{ id: 'p1', name: 'Plugin 1' }] },
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('plugins:list-available');
    expect(formatterTrace.notifications[0]?.method).toBe('plugin.list');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      plugins: [{ id: 'p1', name: 'Plugin 1' }],
    });
  });
});

describe('ptah plugin enable', () => {
  it('exits 2 (UsageError) when <id> is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'enable' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/<id> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('emits changed:false and skips save when already enabled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:get-config', {
      success: true,
      data: {
        enabledPluginIds: ['existing-plugin'],
        disabledSkillIds: [],
      },
    });
    const exit = await execute(
      { subcommand: 'enable', id: 'existing-plugin' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'plugins:save-config'),
    ).toBeUndefined();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('plugin.config.updated');
    expect(last?.params).toMatchObject({ changed: false, action: 'enable' });
  });

  it('emits changed:true and runs save when not yet enabled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:get-config', {
      success: true,
      data: { enabledPluginIds: [], disabledSkillIds: [] },
    });
    engine.scripted.set('plugins:save-config', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      { subcommand: 'enable', id: 'new-plugin' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const saveCall = engine.rpcCalls.find(
      (c) => c.method === 'plugins:save-config',
    );
    expect(saveCall).toBeDefined();
    expect(saveCall?.params).toMatchObject({
      enabledPluginIds: ['new-plugin'],
      disabledSkillIds: [],
    });
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('plugin.config.updated');
    expect(last?.params).toMatchObject({ changed: true, action: 'enable' });
  });
});

describe('ptah plugin disable', () => {
  it('exits 2 (UsageError) when <id> is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'disable' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/<id> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('emits changed:false when not currently enabled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:get-config', {
      success: true,
      data: { enabledPluginIds: ['other'], disabledSkillIds: [] },
    });
    const exit = await execute(
      { subcommand: 'disable', id: 'absent' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'plugins:save-config'),
    ).toBeUndefined();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.params).toMatchObject({ changed: false, action: 'disable' });
  });

  it('emits changed:true and runs save when currently enabled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:get-config', {
      success: true,
      data: { enabledPluginIds: ['p1', 'p2'], disabledSkillIds: ['s1'] },
    });
    engine.scripted.set('plugins:save-config', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      { subcommand: 'disable', id: 'p1' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const saveCall = engine.rpcCalls.find(
      (c) => c.method === 'plugins:save-config',
    );
    expect(saveCall?.params).toMatchObject({
      enabledPluginIds: ['p2'],
      disabledSkillIds: ['s1'],
    });
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.params).toMatchObject({ changed: true, action: 'disable' });
  });
});

describe('ptah plugin config get', () => {
  it('dispatches plugins:get-config and emits plugin.config.value', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:get-config', {
      success: true,
      data: {
        enabledPluginIds: ['a'],
        disabledSkillIds: ['b'],
        lastUpdated: '2026-01-01T00:00:00Z',
      },
    });
    const exit = await execute(
      { subcommand: 'config-get' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('plugins:get-config');
    expect(formatterTrace.notifications[0]?.method).toBe('plugin.config.value');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      enabledPluginIds: ['a'],
      disabledSkillIds: ['b'],
      lastUpdated: '2026-01-01T00:00:00Z',
    });
  });
});

describe('ptah plugin config set', () => {
  it('exits 2 when both --enabled and --disabled-skills are missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'config-set' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/at least one of --enabled/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('emits changed:false and skips save when state matches', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:get-config', {
      success: true,
      data: { enabledPluginIds: ['a', 'b'], disabledSkillIds: ['s1'] },
    });
    const exit = await execute(
      {
        subcommand: 'config-set',
        // Same set in different order — must still match.
        enabled: ['b', 'a'],
        disabledSkills: ['s1'],
      } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'plugins:save-config'),
    ).toBeUndefined();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.params).toMatchObject({
      changed: false,
      action: 'config-set',
    });
  });

  it('emits changed:true and runs save when state differs', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:get-config', {
      success: true,
      data: { enabledPluginIds: ['a'], disabledSkillIds: [] },
    });
    engine.scripted.set('plugins:save-config', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      {
        subcommand: 'config-set',
        enabled: ['a', 'b'],
      } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const saveCall = engine.rpcCalls.find(
      (c) => c.method === 'plugins:save-config',
    );
    expect(saveCall?.params).toMatchObject({
      enabledPluginIds: ['a', 'b'],
      disabledSkillIds: [],
    });
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.params).toMatchObject({
      changed: true,
      action: 'config-set',
    });
  });
});

describe('ptah plugin skills list', () => {
  it('uses currently-enabled plugin ids when --plugins is omitted', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:get-config', {
      success: true,
      data: { enabledPluginIds: ['p1', 'p2'], disabledSkillIds: [] },
    });
    engine.scripted.set('plugins:list-skills', {
      success: true,
      data: {
        skills: [{ id: 's1', name: 'skill 1', pluginId: 'p1' }],
      },
    });
    const exit = await execute(
      { subcommand: 'skills-list' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const listCall = engine.rpcCalls.find(
      (c) => c.method === 'plugins:list-skills',
    );
    expect(listCall?.params).toMatchObject({ pluginIds: ['p1', 'p2'] });
    expect(formatterTrace.notifications[0]?.method).toBe('plugin.skills.list');
  });

  it('honors --plugins override', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('plugins:list-skills', {
      success: true,
      data: { skills: [] },
    });
    const exit = await execute(
      {
        subcommand: 'skills-list',
        plugins: ['custom-1', 'custom-2'],
      } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    // Should NOT issue plugins:get-config when override is provided.
    expect(
      engine.rpcCalls.find((c) => c.method === 'plugins:get-config'),
    ).toBeUndefined();
    const listCall = engine.rpcCalls.find(
      (c) => c.method === 'plugins:list-skills',
    );
    expect(listCall?.params).toMatchObject({
      pluginIds: ['custom-1', 'custom-2'],
    });
    expect(formatterTrace.notifications[0]?.method).toBe('plugin.skills.list');
  });
});

describe('ptah plugin unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'list' } satisfies PluginOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
