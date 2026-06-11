/**
 * Unit tests for `ptah cron` command.
 *
 * Coverage:
 *   - list: dispatches cron:list with enabledOnly
 *   - get / delete / run-now / runs / next-fire: UsageError without id; dispatch
 *   - create: UsageError without name/cron-expr/prompt; dispatch + emit
 *   - update: UsageError when no patch field given; builds a partial patch
 *   - toggle: UsageError without --enabled; dispatch
 *   - error mapping: RPC failure (success:false) bubbles via task.error
 *   - human output: --human mode drives the same notifications
 *   - unknown sub-command: usage error (exit 2)
 */

import { execute } from './cron.js';
import type { CronExecuteHooks, CronOptions } from './cron.js';
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
  withEngine: CronExecuteHooks['withEngine'];
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
      throw new Error('container.resolve hit — cron cmd should not reach DI');
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
  }) as unknown as CronExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: CronExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: CronExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

function findNotification(
  trace: FormatterTrace,
  method: string,
): { method: string; params?: unknown } | undefined {
  return trace.notifications.find((n) => n.method === method);
}

describe('ptah cron list', () => {
  it('dispatches cron:list with enabledOnly and emits cron.list', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:list', {
      success: true,
      data: { jobs: [{ id: 'j1' }] },
    });
    const exit = await execute(
      { subcommand: 'list', enabledOnly: true } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'cron:list',
      params: { enabledOnly: true },
    });
    const note = findNotification(formatterTrace, 'cron.list');
    expect(note?.params).toMatchObject({ jobs: [{ id: 'j1' }] });
  });
});

describe('ptah cron get / delete / run-now / runs / next-fire', () => {
  it.each(['get', 'delete', 'run-now', 'runs', 'next-fire'] as const)(
    'exits 2 (UsageError) when id is missing (%s)',
    async (subcommand) => {
      const { hooks, engine } = buildHooks();
      const exit = await execute(
        { subcommand } satisfies CronOptions,
        baseGlobals,
        hooks,
      );
      expect(exit).toBe(ExitCode.UsageError);
      expect(engine.rpcCalls).toHaveLength(0);
    },
  );

  it('get dispatches cron:get and emits cron.job', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:get', {
      success: true,
      data: { job: { id: 'j1' } },
    });
    const exit = await execute(
      { subcommand: 'get', id: 'j1' } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'cron:get')?.params,
    ).toEqual({ id: 'j1' });
    const note = findNotification(formatterTrace, 'cron.job');
    expect(note?.params).toMatchObject({ id: 'j1' });
  });

  it('run-now dispatches cron:runNow and emits cron.run', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:runNow', {
      success: true,
      data: { run: { id: 'r1', status: 'running' } },
    });
    const exit = await execute(
      { subcommand: 'run-now', id: 'j1' } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'cron:runNow'),
    ).toBeDefined();
    const note = findNotification(formatterTrace, 'cron.run');
    expect(note?.params).toMatchObject({ id: 'j1' });
  });

  it('runs forwards limit/offset and emits cron.runs', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:runs', {
      success: true,
      data: { runs: [] },
    });
    const exit = await execute(
      {
        subcommand: 'runs',
        id: 'j1',
        limit: 5,
        offset: 10,
      } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'cron:runs');
    expect(call?.params).toMatchObject({ id: 'j1', limit: 5, offset: 10 });
    expect(findNotification(formatterTrace, 'cron.runs')).toBeDefined();
  });

  it('next-fire dispatches cron:nextFire and emits cron.next_fire', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:nextFire', {
      success: true,
      data: { nextRunAt: 9999 },
    });
    const exit = await execute(
      { subcommand: 'next-fire', id: 'j1' } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'cron.next_fire');
    expect(note?.params).toMatchObject({ id: 'j1', nextRunAt: 9999 });
  });

  it('delete dispatches cron:delete and emits cron.deleted', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:delete', {
      success: true,
      data: { ok: true },
    });
    const exit = await execute(
      { subcommand: 'delete', id: 'j1' } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'cron.deleted');
    expect(note?.params).toMatchObject({ id: 'j1', ok: true });
  });
});

describe('ptah cron create', () => {
  it.each([
    [{ cronExpr: '0 9 * * *', prompt: 'p' }, /--name/],
    [{ name: 'j', prompt: 'p' }, /--cron-expr/],
    [{ name: 'j', cronExpr: '0 9 * * *' }, /--prompt/],
  ] as const)(
    'exits 2 (UsageError) on missing required field',
    async (partial, matcher) => {
      const { hooks, engine, stderrTrace } = buildHooks();
      const exit = await execute(
        { subcommand: 'create', ...partial } satisfies CronOptions,
        baseGlobals,
        hooks,
      );
      expect(exit).toBe(ExitCode.UsageError);
      expect(stderrTrace.buffer).toMatch(matcher);
      expect(engine.rpcCalls).toHaveLength(0);
    },
  );

  it('dispatches cron:create with optional fields and emits cron.created', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:create', {
      success: true,
      data: { job: { id: 'j1' } },
    });
    const exit = await execute(
      {
        subcommand: 'create',
        name: 'nightly',
        cronExpr: '0 0 * * *',
        prompt: 'do the thing',
        timezone: 'UTC',
        enabled: false,
      } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'cron:create');
    expect(call?.params).toMatchObject({
      name: 'nightly',
      cronExpr: '0 0 * * *',
      prompt: 'do the thing',
      timezone: 'UTC',
      enabled: false,
    });
    expect(findNotification(formatterTrace, 'cron.created')).toBeDefined();
  });
});

describe('ptah cron update', () => {
  it('exits 2 (UsageError) with no patch fields', async () => {
    const { hooks, engine, stderrTrace } = buildHooks();
    const exit = await execute(
      { subcommand: 'update', id: 'j1' } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/at least one of/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('builds a partial patch from the supplied flags', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:update', {
      success: true,
      data: { job: { id: 'j1' } },
    });
    const exit = await execute(
      {
        subcommand: 'update',
        id: 'j1',
        prompt: 'new prompt',
        enabled: true,
      } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'cron:update');
    expect(call?.params).toEqual({
      id: 'j1',
      patch: { prompt: 'new prompt', enabled: true },
    });
    expect(findNotification(formatterTrace, 'cron.updated')).toBeDefined();
  });
});

describe('ptah cron toggle', () => {
  it('exits 2 (UsageError) when --enabled is missing', async () => {
    const { hooks, engine, stderrTrace } = buildHooks();
    const exit = await execute(
      { subcommand: 'toggle', id: 'j1' } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--enabled/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches cron:toggle and emits cron.toggled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:toggle', {
      success: true,
      data: { job: { id: 'j1', enabled: false } },
    });
    const exit = await execute(
      { subcommand: 'toggle', id: 'j1', enabled: false } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'cron:toggle');
    expect(call?.params).toEqual({ id: 'j1', enabled: false });
    const note = findNotification(formatterTrace, 'cron.toggled');
    expect(note?.params).toMatchObject({ id: 'j1', enabled: false });
  });
});

describe('ptah cron error mapping', () => {
  it('bubbles a cron:list RPC failure as task.error (exit 7)', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('cron:list', {
      success: false,
      error: 'scheduler unavailable',
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({ message: 'scheduler unavailable' });
  });
});

describe('ptah cron human output', () => {
  it('renders list notification in --human mode without throwing', async () => {
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
    engine.scripted.set('cron:list', {
      success: true,
      data: { jobs: [] },
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.list/);
  });
});

describe('ptah cron unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'list' } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
