/**
 * Unit tests for `ptah gateway` command.
 *
 * Coverage:
 *   - status: dispatches gateway:status; attaches adaptersLive:false
 *   - start: dispatches gateway:start; emits adaptersLive:false honest notice
 *   - stop: dispatches gateway:stop
 *   - set-token: stdin path (piped non-TTY); empty token UsageError; platform
 *     validation; masked-prompt path under --human; slack two-line stdin; the
 *     secret never appears in notifications/stderr
 *   - bindings: filter validation + dispatch
 *   - approve: UsageError without bindingId/code; dispatch
 *   - block: UsageError without bindingId; status validation; dispatch
 *   - messages: UsageError without bindingId; dispatch
 *   - test: platform validation; dispatch
 *   - error mapping: RPC failure (success:false) bubbles via task.error
 *   - human output: --human mode drives the same notifications
 *   - unknown sub-command: usage error (exit 2)
 */

import { Readable } from 'node:stream';

import { execute } from './gateway.js';
import type { GatewayExecuteHooks, GatewayOptions } from './gateway.js';
import { ExitCode } from '../jsonrpc/types.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
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

interface MockEngine {
  withEngine: GatewayExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedResponse>;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
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

function buildHooks(extra: Partial<GatewayExecuteHooks> = {}): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: GatewayExecuteHooks;
} {
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

function findNotification(
  trace: FormatterTrace,
  method: string,
): { method: string; params?: unknown } | undefined {
  return trace.notifications.find((n) => n.method === method);
}

describe('ptah gateway status', () => {
  it('dispatches gateway:status and attaches adaptersLive:false', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:status', {
      success: true,
      data: {
        enabled: true,
        adapters: [{ platform: 'telegram', running: false }],
      },
    });
    const exit = await execute(
      { subcommand: 'status' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'gateway:status',
      params: {},
    });
    const note = findNotification(formatterTrace, 'gateway.status');
    expect(note?.params).toMatchObject({ enabled: true, adaptersLive: false });
  });
});

describe('ptah gateway start', () => {
  it('dispatches gateway:start and emits the adaptersLive:false honest notice', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:start', { success: true, data: { ok: true } });
    const exit = await execute(
      { subcommand: 'start' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({ method: 'gateway:start', params: {} });
    const note = findNotification(formatterTrace, 'gateway.started');
    expect(note?.params).toMatchObject({ adaptersLive: false });
    expect((note?.params as { notice: string }).notice).toMatch(
      /long-running Ptah process/,
    );
  });

  it('forwards a validated --platform scope', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('gateway:start', { success: true, data: { ok: true } });
    const exit = await execute(
      { subcommand: 'start', platform: 'discord' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.params).toEqual({ platform: 'discord' });
  });

  it('exits 2 (UsageError) on an unknown --platform', async () => {
    const { engine, hooks, stderrTrace } = buildHooks();
    const exit = await execute(
      { subcommand: 'start', platform: 'sms' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown platform/);
    expect(engine.rpcCalls).toHaveLength(0);
  });
});

describe('ptah gateway stop', () => {
  it('dispatches gateway:stop and emits gateway.stopped', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:stop', { success: true, data: { ok: true } });
    const exit = await execute(
      { subcommand: 'stop' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({ method: 'gateway:stop', params: {} });
    expect(findNotification(formatterTrace, 'gateway.stopped')).toBeDefined();
  });
});

describe('ptah gateway set-token', () => {
  it('reads the token from piped stdin (non-TTY) and never echoes it', async () => {
    const { formatterTrace, engine, hooks } = buildHooks({
      stdin: Readable.from(['7777:SECRET-BOT-TOKEN\n']),
    });
    engine.scripted.set('gateway:setToken', {
      success: true,
      data: { ok: true },
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
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'gateway:setToken');
    expect(call?.params).toEqual({
      platform: 'telegram',
      token: '7777:SECRET-BOT-TOKEN',
    });
    const note = findNotification(formatterTrace, 'gateway.token_set');
    expect(note?.params).toMatchObject({ platform: 'telegram', ok: true });
    const serialized = JSON.stringify(formatterTrace.notifications);
    expect(serialized).not.toMatch(/SECRET-BOT-TOKEN/);
  });

  it('defaults to stdin in machine mode even without --stdin', async () => {
    const { engine, hooks } = buildHooks({
      stdin: Readable.from(['MACHINE-TOKEN\n']),
    });
    engine.scripted.set('gateway:setToken', {
      success: true,
      data: { ok: true },
    });
    const exit = await execute(
      {
        subcommand: 'set-token',
        platform: 'telegram',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'gateway:setToken');
    expect(call?.params).toEqual({
      platform: 'telegram',
      token: 'MACHINE-TOKEN',
    });
  });

  it('reads slack bot + app tokens from two stdin lines', async () => {
    const { formatterTrace, engine, hooks } = buildHooks({
      stdin: Readable.from(['xoxb-bot\nxapp-app\n']),
    });
    engine.scripted.set('gateway:setToken', {
      success: true,
      data: { ok: true },
    });
    const exit = await execute(
      {
        subcommand: 'set-token',
        platform: 'slack',
        stdin: true,
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'gateway:setToken');
    expect(call?.params).toEqual({
      platform: 'slack',
      token: 'xoxb-bot',
      slackAppToken: 'xapp-app',
    });
    const note = findNotification(formatterTrace, 'gateway.token_set');
    expect(note?.params).toMatchObject({ slackAppToken: true });
  });

  it('exits 2 (UsageError) on empty stdin token', async () => {
    const { engine, stderrTrace, hooks } = buildHooks({
      stdin: Readable.from(['\n']),
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
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/empty token/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) on zero-byte stdin (immediately closed pipe)', async () => {
    const { engine, stderrTrace, hooks } = buildHooks({
      stdin: Readable.from([]),
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
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/empty token/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) when stdin never closes (timeout)', async () => {
    const neverEnds = new Readable({ read() {} });
    const { engine, stderrTrace, hooks } = buildHooks({
      stdin: neverEnds,
      stdinTimeoutMs: 5,
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
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/timed out/);
    expect(engine.rpcCalls).toHaveLength(0);
    neverEnds.destroy();
  });

  it('exits 2 (UsageError) on missing/unknown platform', async () => {
    const { engine, stderrTrace, hooks } = buildHooks({
      stdin: Readable.from(['x']),
    });
    const exit = await execute(
      {
        subcommand: 'set-token',
        platform: 'irc',
        stdin: true,
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown platform/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('uses the masked prompt under --human (interactive) and never echoes it', async () => {
    const password = jest.fn().mockResolvedValueOnce('PROMPTED-SECRET');
    const prompter = {
      password,
      isCancel: ((v: unknown): v is symbol => typeof v === 'symbol') as (
        v: unknown,
      ) => v is symbol,
    };
    const { formatterTrace, engine, hooks } = buildHooks({
      isInteractive: () => true,
      prompter,
    });
    engine.scripted.set('gateway:setToken', {
      success: true,
      data: { ok: true },
    });
    const exit = await execute(
      {
        subcommand: 'set-token',
        platform: 'telegram',
      } satisfies GatewayOptions,
      { ...baseGlobals, human: true, json: false },
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(password).toHaveBeenCalledTimes(1);
    const call = engine.rpcCalls.find((c) => c.method === 'gateway:setToken');
    expect(call?.params).toEqual({
      platform: 'telegram',
      token: 'PROMPTED-SECRET',
    });
    expect(JSON.stringify(formatterTrace.notifications)).not.toMatch(
      /PROMPTED-SECRET/,
    );
  });
});

describe('ptah gateway bindings', () => {
  it('dispatches gateway:listBindings with filters', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:listBindings', {
      success: true,
      data: { bindings: [{ id: 'b1' }] },
    });
    const exit = await execute(
      {
        subcommand: 'bindings',
        filterPlatform: 'telegram',
        status: 'pending',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:listBindings',
    );
    expect(call?.params).toEqual({ platform: 'telegram', status: 'pending' });
    expect(findNotification(formatterTrace, 'gateway.bindings')).toBeDefined();
  });

  it('exits 2 (UsageError) on an invalid --status', async () => {
    const { engine, stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bindings', status: 'bogus' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--status must be one of/);
    expect(engine.rpcCalls).toHaveLength(0);
  });
});

describe('ptah gateway approve', () => {
  it('exits 2 (UsageError) without bindingId', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'approve', code: '123456' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) without --code', async () => {
    const { engine, stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'approve', bindingId: 'b1' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--code/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches gateway:approveBinding and emits the result', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:approveBinding', {
      success: true,
      data: { ok: true, binding: { id: 'b1' } },
    });
    const exit = await execute(
      {
        subcommand: 'approve',
        bindingId: 'b1',
        code: '654321',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:approveBinding',
    );
    expect(call?.params).toEqual({ bindingId: 'b1', code: '654321' });
    const note = findNotification(formatterTrace, 'gateway.binding_approved');
    expect(note?.params).toMatchObject({ bindingId: 'b1', ok: true });
  });

  it('exits 2 (UsageError) on an ok:false invalid-code result after emitting it', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:approveBinding', {
      success: true,
      data: { ok: false, error: 'invalid-code' },
    });
    const exit = await execute(
      {
        subcommand: 'approve',
        bindingId: 'b1',
        code: '000000',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    const note = findNotification(formatterTrace, 'gateway.binding_approved');
    expect(note?.params).toMatchObject({ ok: false, error: 'invalid-code' });
  });
});

describe('ptah gateway block', () => {
  it('exits 2 (UsageError) without bindingId', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'block' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 (UsageError) on an invalid --status', async () => {
    const { engine, stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'block',
        bindingId: 'b1',
        blockStatus: 'pending',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--status must be one of/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches gateway:blockBinding with an explicit status', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:blockBinding', {
      success: true,
      data: { binding: { id: 'b1' } },
    });
    const exit = await execute(
      {
        subcommand: 'block',
        bindingId: 'b1',
        blockStatus: 'revoked',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:blockBinding',
    );
    expect(call?.params).toEqual({ bindingId: 'b1', status: 'revoked' });
    expect(
      findNotification(formatterTrace, 'gateway.binding_blocked'),
    ).toBeDefined();
  });
});

describe('ptah gateway messages', () => {
  it('exits 2 (UsageError) without bindingId', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'messages' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('forwards limit/before and emits gateway.messages', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:listMessages', {
      success: true,
      data: { messages: [] },
    });
    const exit = await execute(
      {
        subcommand: 'messages',
        bindingId: 'b1',
        limit: 20,
        before: 9999,
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find(
      (c) => c.method === 'gateway:listMessages',
    );
    expect(call?.params).toEqual({ bindingId: 'b1', limit: 20, before: 9999 });
    expect(findNotification(formatterTrace, 'gateway.messages')).toBeDefined();
  });
});

describe('ptah gateway test', () => {
  it('exits 2 (UsageError) on missing platform', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'test' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches gateway:test with an optional binding override', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:test', {
      success: true,
      data: { ok: true, bindingId: 'b1', externalMsgId: 'm1' },
    });
    const exit = await execute(
      {
        subcommand: 'test',
        platform: 'discord',
        testBindingId: 'b1',
      } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'gateway:test');
    expect(call?.params).toEqual({ platform: 'discord', bindingId: 'b1' });
    const note = findNotification(formatterTrace, 'gateway.test');
    expect(note?.params).toMatchObject({ ok: true, bindingId: 'b1' });
  });

  it('exits 2 (UsageError) on an ok:false test result after emitting it', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:test', {
      success: true,
      data: { ok: false, error: 'no-binding' },
    });
    const exit = await execute(
      { subcommand: 'test', platform: 'discord' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    const note = findNotification(formatterTrace, 'gateway.test');
    expect(note?.params).toMatchObject({ ok: false, error: 'no-binding' });
  });
});

describe('ptah gateway error mapping', () => {
  it('bubbles a gateway:status RPC failure as task.error (exit 5)', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('gateway:status', {
      success: false,
      error: 'gateway offline',
    });
    const exit = await execute(
      { subcommand: 'status' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({ message: 'gateway offline' });
  });
});

describe('ptah gateway human output', () => {
  it('renders status notification in --human mode without throwing', async () => {
    const chunks: string[] = [];
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    const formatter = buildFormatter({
      human: true,
      noColor: true,
      writer,
    });
    const engine = makeEngine();
    engine.scripted.set('gateway:status', {
      success: true,
      data: { enabled: false, adapters: [] },
    });
    const exit = await execute(
      { subcommand: 'status' } satisfies GatewayOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine, isInteractive: () => false },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/gateway\.status/);
  });
});

describe('ptah gateway unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'status' } satisfies GatewayOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
