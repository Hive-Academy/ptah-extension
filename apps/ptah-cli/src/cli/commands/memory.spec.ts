/**
 * Unit tests for `ptah memory` command.
 *
 * Coverage:
 *   - list: dispatches memory:list; attaches degraded; --tier validation
 *   - search: dispatches memory:search; UsageError without query
 *   - get / pin / unpin / forget: UsageError without id; dispatch + emit
 *   - stats: dispatches memory:stats; attaches degraded
 *   - degradation: db:health vecExtensionLoaded=false -> degraded.vec=true;
 *     embedder:status ready=false -> degraded.embedder=true; RPC throw -> true
 *   - error mapping: RPC failure (success:false) bubbles via task.error
 *   - human output: --human mode still drives the same notifications
 *   - unknown sub-command: usage error (exit 2)
 */

import { execute } from './memory.js';
import type { MemoryExecuteHooks, MemoryOptions } from './memory.js';
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

interface MockEngine {
  withEngine: MemoryExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedResponse>;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
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

  return { withEngine, rpcCalls, scripted };
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

describe('ptah memory list', () => {
  it('dispatches memory:list and attaches degraded', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:list', {
      success: true,
      data: { memories: [{ id: 'm1' }], total: 1 },
    });
    const exit = await execute(
      { subcommand: 'list', limit: 10 } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const listCall = engine.rpcCalls.find((c) => c.method === 'memory:list');
    expect(listCall?.params).toMatchObject({ limit: 10 });
    const note = findNotification(formatterTrace, 'memory.list');
    expect(note?.params).toMatchObject({
      total: 1,
      degraded: { vec: false, embedder: false },
    });
  });

  it('exits 2 (UsageError) for an invalid --tier', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'list', tier: 'bogus' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('marks degraded.vec when sqlite-vec is not loaded', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:list', {
      success: true,
      data: { memories: [], total: 0 },
    });
    engine.scripted.set('db:health', {
      success: true,
      data: { vecExtensionLoaded: false },
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'memory.list');
    expect(note?.params).toMatchObject({ degraded: { vec: true } });
  });

  it('marks degraded.embedder when the embedder is not ready', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:list', {
      success: true,
      data: { memories: [], total: 0 },
    });
    engine.scripted.set('embedder:status', {
      success: true,
      data: { status: { ready: false, downloading: true } },
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'memory.list');
    expect(note?.params).toMatchObject({ degraded: { embedder: true } });
  });

  it('treats a db:health RPC failure as degraded.vec=true', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:list', {
      success: true,
      data: { memories: [], total: 0 },
    });
    engine.scripted.set('db:health', {
      success: false,
      error: 'connection unavailable',
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'memory.list');
    expect(note?.params).toMatchObject({ degraded: { vec: true } });
  });
});

describe('ptah memory search', () => {
  it('exits 2 (UsageError) when query is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'search' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches memory:search and emits memory.search with bm25Only', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:search', {
      success: true,
      data: { hits: [{ score: 0.9 }], bm25Only: true },
    });
    const exit = await execute(
      { subcommand: 'search', query: 'auth', topK: 5 } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const call = engine.rpcCalls.find((c) => c.method === 'memory:search');
    expect(call?.params).toMatchObject({ query: 'auth', topK: 5 });
    const note = findNotification(formatterTrace, 'memory.search');
    expect(note?.params).toMatchObject({ query: 'auth', bm25Only: true });
  });
});

describe('ptah memory get / pin / unpin / forget', () => {
  it.each(['get', 'pin', 'unpin', 'forget'] as const)(
    'exits 2 (UsageError) when id is missing (%s)',
    async (subcommand) => {
      const { hooks, engine } = buildHooks();
      const exit = await execute(
        { subcommand } satisfies MemoryOptions,
        baseGlobals,
        hooks,
      );
      expect(exit).toBe(ExitCode.UsageError);
      expect(engine.rpcCalls).toHaveLength(0);
    },
  );

  it('get dispatches memory:get and emits memory.entry', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:get', {
      success: true,
      data: { memory: { id: 'm1' }, chunks: [{ id: 'c1' }] },
    });
    const exit = await execute(
      { subcommand: 'get', id: 'm1' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'memory:get')?.params,
    ).toEqual({ id: 'm1' });
    const note = findNotification(formatterTrace, 'memory.entry');
    expect(note?.params).toMatchObject({ id: 'm1' });
  });

  it('pin dispatches memory:pin and emits memory.pinned', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:pin', {
      success: true,
      data: { success: true, pinned: true },
    });
    const exit = await execute(
      { subcommand: 'pin', id: 'm1' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'memory:pin'),
    ).toBeDefined();
    const note = findNotification(formatterTrace, 'memory.pinned');
    expect(note?.params).toMatchObject({ id: 'm1', pinned: true });
  });

  it('unpin dispatches memory:unpin', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('memory:unpin', {
      success: true,
      data: { success: true, pinned: false },
    });
    const exit = await execute(
      { subcommand: 'unpin', id: 'm1' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(
      engine.rpcCalls.find((c) => c.method === 'memory:unpin'),
    ).toBeDefined();
  });

  it('forget dispatches memory:forget and emits memory.forgotten', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:forget', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      { subcommand: 'forget', id: 'm1' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'memory.forgotten');
    expect(note?.params).toMatchObject({ id: 'm1', success: true });
  });
});

describe('ptah memory stats', () => {
  it('dispatches memory:stats and attaches degraded', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:stats', {
      success: true,
      data: {
        core: 1,
        recall: 2,
        archival: 3,
        codeIndex: 4,
        lastCuratedAt: 1234,
      },
    });
    const exit = await execute(
      { subcommand: 'stats' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const note = findNotification(formatterTrace, 'memory.stats');
    expect(note?.params).toMatchObject({
      core: 1,
      recall: 2,
      archival: 3,
      codeIndex: 4,
      degraded: { vec: false, embedder: false },
    });
  });
});

describe('ptah memory error mapping', () => {
  it('bubbles a memory:list RPC failure as task.error (exit 7)', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('memory:list', {
      success: false,
      error: 'store unavailable',
    });
    const exit = await execute(
      { subcommand: 'list' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({ message: 'store unavailable' });
  });
});

describe('ptah memory human output', () => {
  it('renders search notification in --human mode without throwing', async () => {
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
    engine.scripted.set('memory:search', {
      success: true,
      data: { hits: [], bm25Only: false },
    });
    const exit = await execute(
      { subcommand: 'search', query: 'x' } satisfies MemoryOptions,
      { ...baseGlobals, human: true },
      { formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(chunks.join('')).toMatch(/memory\.search/);
  });
});

describe('ptah memory unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'list' } satisfies MemoryOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
