import { execute } from './cron.js';
import type { CronExecuteHooks, CronOptions } from './cron.js';
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
  withEngine: CronExecuteHooks['withEngine'];
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

function buildHooks() {
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

describe('ptah cron — exit-code contract for transport failures', () => {
  it.each([
    ['get', { subcommand: 'get' as const, id: 'j1' }, 'cron:get'],
    ['delete', { subcommand: 'delete' as const, id: 'j1' }, 'cron:delete'],
    ['run-now', { subcommand: 'run-now' as const, id: 'j1' }, 'cron:runNow'],
    ['runs', { subcommand: 'runs' as const, id: 'j1' }, 'cron:runs'],
    [
      'next-fire',
      { subcommand: 'next-fire' as const, id: 'j1' },
      'cron:nextFire',
    ],
    [
      'toggle',
      { subcommand: 'toggle' as const, id: 'j1', enabled: false },
      'cron:toggle',
    ],
    [
      'update',
      { subcommand: 'update' as const, id: 'j1', prompt: 'x' },
      'cron:update',
    ],
  ] as const)(
    '%s transport failure → InternalFailure',
    async (_name, opts, rpcMethod) => {
      const { engine, hooks, formatterTrace } = buildHooks();
      engine.scripted.set(rpcMethod, {
        success: false,
        error: `${rpcMethod} unavailable`,
      });
      const exit = await execute(opts as CronOptions, baseGlobals, hooks);
      expect(exit).toBe(ExitCode.InternalFailure);
      const last =
        formatterTrace.notifications[formatterTrace.notifications.length - 1];
      expect(last?.method).toBe('task.error');
    },
  );

  it('create transport failure → InternalFailure', async () => {
    const { engine, hooks, formatterTrace } = buildHooks();
    engine.scripted.set('cron:create', {
      success: false,
      error: 'create failed',
    });
    const exit = await execute(
      {
        subcommand: 'create',
        name: 'x',
        cronExpr: '0 9 * * *',
        prompt: 'p',
      } satisfies CronOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah cron — --human rendering for additional verbs', () => {
  function makeHumanFormatter(chunks: string[]) {
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    return buildFormatter({ human: true, noColor: true, writer });
  }

  it('renders cron.job in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('cron:get', {
      success: true,
      data: { job: { id: 'j1' } },
    });
    const exit = await execute(
      { subcommand: 'get', id: 'j1' } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.job/);
  });

  it('renders cron.next_fire in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('cron:nextFire', {
      success: true,
      data: { nextRunAt: 1234567890 },
    });
    const exit = await execute(
      { subcommand: 'next-fire', id: 'j1' } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.next_fire/);
  });

  it('renders cron.created in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('cron:create', {
      success: true,
      data: { job: { id: 'j1' } },
    });
    const exit = await execute(
      {
        subcommand: 'create',
        name: 'x',
        cronExpr: '0 9 * * *',
        prompt: 'do it',
      } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.created/);
  });

  it('renders cron.updated in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('cron:update', {
      success: true,
      data: { job: { id: 'j1' } },
    });
    const exit = await execute(
      {
        subcommand: 'update',
        id: 'j1',
        prompt: 'new prompt',
      } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.updated/);
  });

  it('renders cron.deleted in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('cron:delete', { success: true, data: { ok: true } });
    const exit = await execute(
      { subcommand: 'delete', id: 'j1' } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.deleted/);
  });

  it('renders cron.toggled in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('cron:toggle', {
      success: true,
      data: { job: { id: 'j1', enabled: true } },
    });
    const exit = await execute(
      { subcommand: 'toggle', id: 'j1', enabled: true } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.toggled/);
  });

  it('renders cron.run in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('cron:runNow', {
      success: true,
      data: { run: { id: 'r1', status: 'running' } },
    });
    const exit = await execute(
      { subcommand: 'run-now', id: 'j1' } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.run/);
  });

  it('renders cron.runs in --human mode', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('cron:runs', { success: true, data: { runs: [] } });
    const exit = await execute(
      { subcommand: 'runs', id: 'j1' } satisfies CronOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/cron\.runs/);
  });
});
