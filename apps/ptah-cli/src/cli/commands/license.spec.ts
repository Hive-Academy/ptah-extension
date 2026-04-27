/**
 * Unit tests for `ptah license` command — TASK_2026_104 Sub-batch B5d.
 */

import { execute } from './license.js';
import type { LicenseExecuteHooks, LicenseOptions } from './license.js';
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
  withEngine: LicenseExecuteHooks['withEngine'];
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

  const container = { resolve: jest.fn() };

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
  }) as unknown as LicenseExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: LicenseExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: LicenseExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah license status', () => {
  it('emits license.status via license:getStatus', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('license:getStatus', {
      success: true,
      data: { tier: 'pro', valid: true },
    });

    const exit = await execute(
      { subcommand: 'status' } satisfies LicenseOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('license:getStatus');
    expect(formatterTrace.notifications[0]?.method).toBe('license.status');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      tier: 'pro',
      valid: true,
    });
  });
});

describe('ptah license set', () => {
  it('exits 2 (UsageError) when --key is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'set' } satisfies LicenseOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches license:setKey and emits license.updated', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('license:setKey', {
      success: true,
      data: { success: true, tier: 'pro', plan: { name: 'Pro' } },
    });

    const exit = await execute(
      { subcommand: 'set', key: 'ptah_lic_abc' } satisfies LicenseOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'license:setKey',
      params: { licenseKey: 'ptah_lic_abc' },
    });
    expect(formatterTrace.notifications[0]?.method).toBe('license.updated');
  });

  it('bubbles backend success: false as task.error + exit 5', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('license:setKey', {
      success: true,
      data: { success: false, error: 'invalid key' },
    });

    const exit = await execute(
      { subcommand: 'set', key: 'bad' } satisfies LicenseOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah license clear', () => {
  it('dispatches license:clearKey and emits license.cleared', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('license:clearKey', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      { subcommand: 'clear' } satisfies LicenseOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('license:clearKey');
    expect(formatterTrace.notifications[0]?.method).toBe('license.cleared');
  });
});

describe('ptah license unknown sub-command', () => {
  it('exits 2 (UsageError)', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'status' } satisfies LicenseOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });
});
