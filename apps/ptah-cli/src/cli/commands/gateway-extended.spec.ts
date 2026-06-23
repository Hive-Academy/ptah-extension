import { Readable } from 'node:stream';

import { execute } from './gateway.js';
import type { GatewayExecuteHooks, GatewayOptions } from './gateway.js';
import { ExitCode } from '../jsonrpc/types.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';
import { StdoutWriter } from '../io/stdout-writer.js';

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

type ScriptedResponse =
  | { success: true; data?: unknown }
  | { success: false; error: string; errorCode?: string };

function makeEngine(): {
  withEngine: GatewayExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedResponse>;
} {
  const rpcCalls: Array<{ method: string; params: unknown }> = [];
  const scripted: Map<string, ScriptedResponse> = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: {} };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => {
      throw new Error(
        'container.resolve hit — gateway cmd should not reach DI',
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
  }) as unknown as GatewayExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(extra: Partial<GatewayExecuteHooks> = {}) {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: GatewayExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
    isInteractive: () => false,
    ...extra,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah gateway — exit-code contract for transport failures', () => {
  it('stop transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('gateway:stop', {
      success: false,
      error: 'stop failed',
    });
    const exit = await execute(
      { subcommand: 'stop' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });

  it('start transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('gateway:start', {
      success: false,
      error: 'start failed',
    });
    const exit = await execute(
      { subcommand: 'start' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });

  it('bindings transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('gateway:listBindings', {
      success: false,
      error: 'bindings failed',
    });
    const exit = await execute(
      { subcommand: 'bindings' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });

  it('approve transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('gateway:approveBinding', {
      success: false,
      error: 'rpc error',
    });
    const exit = await execute(
      {
        subcommand: 'approve',
        bindingId: 'b1',
        code: '123456',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });

  it('block transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('gateway:blockBinding', {
      success: false,
      error: 'block rpc error',
    });
    const exit = await execute(
      { subcommand: 'block', bindingId: 'b1' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });

  it('messages transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('gateway:listMessages', {
      success: false,
      error: 'messages unavailable',
    });
    const exit = await execute(
      { subcommand: 'messages', bindingId: 'b1' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });

  it('test transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('gateway:test', {
      success: false,
      error: 'test unavailable',
    });
    const exit = await execute(
      { subcommand: 'test', platform: 'discord' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });

  it('set-token transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks({
      stdin: Readable.from(['xoxb-bot\n']),
    });
    engine.scripted.set('gateway:setToken', {
      success: false,
      error: 'vault error',
    });
    const exit = await execute(
      {
        subcommand: 'set-token',
        platform: 'telegram',
        stdin: true,
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah gateway bindings — filter edge cases', () => {
  it('dispatches with no filters when both are omitted', async () => {
    const { engine, formatterTrace, hooks } = buildHooks();
    engine.scripted.set('gateway:listBindings', {
      success: true,
      data: { bindings: [] },
    });
    const exit = await execute(
      { subcommand: 'bindings' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:listBindings',
    );
    expect(call?.params).toEqual({});
    expect(
      formatterTrace.notifications.find((n) => n.method === 'gateway.bindings'),
    ).toBeDefined();
  });

  it('dispatches with only --platform filter', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('gateway:listBindings', {
      success: true,
      data: { bindings: [] },
    });
    await execute(
      {
        subcommand: 'bindings',
        filterPlatform: 'slack',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:listBindings',
    );
    expect(call?.params).toEqual({ platform: 'slack' });
  });

  it('dispatches with only --status filter', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('gateway:listBindings', {
      success: true,
      data: { bindings: [] },
    });
    await execute(
      { subcommand: 'bindings', status: 'approved' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:listBindings',
    );
    expect(call?.params).toEqual({ status: 'approved' });
  });
});

describe('ptah gateway messages — optional params', () => {
  it('dispatches with no limit or before when omitted', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('gateway:listMessages', {
      success: true,
      data: { messages: [] },
    });
    const exit = await execute(
      { subcommand: 'messages', bindingId: 'b1' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:listMessages',
    );
    expect(call?.params).toEqual({ bindingId: 'b1' });
  });
});

describe('ptah gateway block — default status (unblocked)', () => {
  it('dispatches with status=blocked when no --status given', async () => {
    const { engine, formatterTrace, hooks } = buildHooks();
    engine.scripted.set('gateway:blockBinding', {
      success: true,
      data: { binding: { id: 'b1' } },
    });
    const exit = await execute(
      { subcommand: 'block', bindingId: 'b1' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:blockBinding',
    );
    expect((call?.params as { bindingId: string }).bindingId).toBe('b1');
    expect(
      formatterTrace.notifications.find(
        (n) => n.method === 'gateway.binding_blocked',
      ),
    ).toBeDefined();
  });
});

describe('ptah gateway — --human rendering for additional verbs', () => {
  function makeHumanFormatter(chunks: string[]) {
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    return buildFormatter({ human: true, noColor: true, writer });
  }

  it('renders gateway.bindings in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('gateway:listBindings', {
      success: true,
      data: { bindings: [] },
    });
    const exit = await execute(
      { subcommand: 'bindings' } satisfies GatewayOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine, isInteractive: () => false },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/gateway\.bindings/);
  });

  it('renders gateway.stopped in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('gateway:stop', { success: true, data: { ok: true } });
    const exit = await execute(
      { subcommand: 'stop' } satisfies GatewayOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine, isInteractive: () => false },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/gateway\.stopped/);
  });

  it('renders gateway.messages in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('gateway:listMessages', {
      success: true,
      data: { messages: [] },
    });
    const exit = await execute(
      { subcommand: 'messages', bindingId: 'b1' } satisfies GatewayOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine, isInteractive: () => false },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/gateway\.messages/);
  });
});
