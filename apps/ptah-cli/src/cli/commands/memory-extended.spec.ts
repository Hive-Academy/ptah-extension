import { execute } from './memory.js';
import type { MemoryExecuteHooks, MemoryOptions } from './memory.js';
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
  withEngine: MemoryExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedResponse>;
  throws: Map<string, Error>;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const throws: MockEngine['throws'] = new Map();
  scripted.set('db:health', {
    success: true,
    data: { vecExtensionLoaded: true },
  });
  scripted.set('embedder:status', {
    success: true,
    data: { status: { ready: true, downloading: false } },
  });
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const shouldThrow = throws.get(method);
      if (shouldThrow) throw shouldThrow;
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: {} };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => {
      throw new Error('container.resolve hit — memory cmd should not reach DI');
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
  }) as unknown as MemoryExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted, throws };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: MemoryExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: MemoryExecuteHooks = {
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

describe('ptah memory — degraded probe-throw semantics', () => {
  it('marks degraded.vec=true when db:health RPC throws an exception (not just success:false)', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:stats', {
      success: true,
      data: { core: 0, recall: 0, archival: 0, codeIndex: 0 },
    });
    engine.throws.set('db:health', new Error('transport error'));

    const exit = await execute(
      { subcommand: 'stats' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'memory.stats');
    expect(note?.params).toMatchObject({ degraded: { vec: true } });
  });

  it('marks degraded.embedder=true when embedder:status RPC throws an exception', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:list', {
      success: true,
      data: { memories: [], total: 0 },
    });
    engine.throws.set('embedder:status', new Error('worker offline'));

    const exit = await execute(
      { subcommand: 'list' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'memory.list');
    expect(note?.params).toMatchObject({ degraded: { embedder: true } });
  });

  it('marks both degraded fields when both probes throw', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:search', {
      success: true,
      data: { hits: [], bm25Only: true },
    });
    engine.throws.set('db:health', new Error('db gone'));
    engine.throws.set('embedder:status', new Error('embedder gone'));

    const exit = await execute(
      { subcommand: 'search', query: 'test' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'memory.search');
    expect(note?.params).toMatchObject({
      degraded: { vec: true, embedder: true },
    });
  });

  it('get attaches degraded field; transport failure → InternalFailure', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:get', {
      success: false,
      error: 'not found',
    });

    const exit = await execute(
      { subcommand: 'get', id: 'm1' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const note = findNotification(formatterTrace, 'task.error');
    expect(note?.params).toMatchObject({ message: 'not found' });
  });

  it('pin transport failure → InternalFailure', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('memory:pin', { success: false, error: 'pin failed' });

    const exit = await execute(
      { subcommand: 'pin', id: 'm1' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
  });

  it('unpin transport failure → InternalFailure', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('memory:unpin', {
      success: false,
      error: 'unpin failed',
    });

    const exit = await execute(
      { subcommand: 'unpin', id: 'm1' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
  });

  it('forget transport failure → InternalFailure', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('memory:forget', {
      success: false,
      error: 'forget failed',
    });

    const exit = await execute(
      { subcommand: 'forget', id: 'm1' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
  });

  it('stats transport failure → InternalFailure', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('memory:stats', {
      success: false,
      error: 'stats failed',
    });

    const exit = await execute(
      { subcommand: 'stats' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
  });
});

describe('ptah memory — --human rendering branches for additional verbs', () => {
  function makeHumanFormatter(chunks: string[]) {
    const writer = {
      write: jest.fn(async (chunk: string) => {
        chunks.push(chunk);
      }),
      flush: jest.fn(async () => undefined),
    } as unknown as StdoutWriter;
    return buildFormatter({ human: true, noColor: true, writer });
  }

  it('renders get notification in --human mode without throwing', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('memory:get', {
      success: true,
      data: { memory: { id: 'm1' }, chunks: [] },
    });
    const exit = await execute(
      { subcommand: 'get', id: 'm1' } satisfies MemoryOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/memory\.entry/);
  });

  it('renders stats notification in --human mode without throwing', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('memory:stats', {
      success: true,
      data: { core: 1, recall: 2, archival: 3, codeIndex: 4 },
    });
    const exit = await execute(
      { subcommand: 'stats' } satisfies MemoryOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/memory\.stats/);
  });

  it('renders pin notification in --human mode without throwing', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('memory:pin', {
      success: true,
      data: { success: true, pinned: true },
    });
    const exit = await execute(
      { subcommand: 'pin', id: 'm1' } satisfies MemoryOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/memory\.pinned/);
  });

  it('renders forget notification in --human mode without throwing', async () => {
    const chunks: string[] = [];
    const formatter = makeHumanFormatter(chunks);
    const engine = makeEngine();
    engine.scripted.set('memory:forget', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      { subcommand: 'forget', id: 'm1' } satisfies MemoryOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/memory\.forgotten/);
  });
});
