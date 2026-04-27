/**
 * Unit tests for `ptah agent` command — TASK_2026_104 B7.
 *
 * Coverage:
 *   - `packs list`     RPC → emits `agent.packs.list`
 *   - `packs install`  resolves pack from list, calls install RPC, emits
 *                      `agent.pack.install.{start,progress,complete}`. Second
 *                      run with `fromCache: true` emits `changed: false`.
 *   - `list`           pure fs.readdir, NO DI bootstrap (withEngine never
 *                      called); filters `.md` entries.
 *   - `apply <name>`   reads source from plugin path, writes target if
 *                      content differs. Re-run with same content emits
 *                      `changed: false` and skips writeFile.
 *   - `apply` rejects missing template.
 */

import { execute, type AgentExecuteHooks, type AgentOptions } from './agent.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/tmp/ws',
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
  withEngine: AgentExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
  invoked: { count: number };
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const invoked = { count: 0 };

  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const r = scripted.get(method);
      if (r) return r;
      return { success: true, data: undefined };
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
    invoked.count += 1;
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as AgentExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted, invoked };
}

// ---------------------------------------------------------------------------
// packs list
// ---------------------------------------------------------------------------

describe('ptah agent packs list', () => {
  it('emits agent.packs.list with packs payload', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const packs = [
      {
        name: 'core-pack',
        source: 'github:org/repo',
        agents: [{ file: 'a.md', name: 'a' }],
      },
    ];
    engine.scripted.set('wizard:list-agent-packs', {
      success: true,
      data: { packs },
    });

    const code = await execute(
      { subcommand: 'packs-list' } satisfies AgentOptions,
      baseGlobals,
      {
        formatter: ft.formatter,
        stderr: st.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(code).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      { method: 'wizard:list-agent-packs', params: {} },
    ]);
    expect(ft.notifications).toEqual([
      { method: 'agent.packs.list', params: { packs } },
    ]);
  });

  it('falls back to empty list when RPC returns null data', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:list-agent-packs', { success: true });

    const code = await execute({ subcommand: 'packs-list' }, baseGlobals, {
      formatter: ft.formatter,
      withEngine: engine.withEngine,
    });

    expect(code).toBe(ExitCode.Success);
    expect(ft.notifications[0]).toEqual({
      method: 'agent.packs.list',
      params: { packs: [] },
    });
  });
});

// ---------------------------------------------------------------------------
// packs install
// ---------------------------------------------------------------------------

describe('ptah agent packs install', () => {
  it('rejects missing pack-id with UsageError', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute({ subcommand: 'packs-install' }, baseGlobals, {
      formatter: ft.formatter,
      stderr: st.stderr,
      withEngine: engine.withEngine,
    });

    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('<pack-id> is required');
    expect(engine.invoked.count).toBe(0);
  });

  it('streams start → progress → complete with changed:true on first run', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    engine.scripted.set('wizard:list-agent-packs', {
      success: true,
      data: {
        packs: [
          {
            name: 'core-pack',
            source: 'github:org/repo',
            agents: [
              { file: 'a.md', name: 'a' },
              { file: 'b.md', name: 'b' },
            ],
          },
        ],
      },
    });
    engine.scripted.set('wizard:install-pack-agents', {
      success: true,
      data: { agentsDownloaded: 2, fromCache: false },
    });

    const code = await execute(
      { subcommand: 'packs-install', packId: 'core-pack' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    const methods = ft.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'agent.pack.install.start',
      'agent.pack.install.progress',
      'agent.pack.install.complete',
    ]);
    const completeParams = ft.notifications[2]?.params as { changed: boolean };
    expect(completeParams.changed).toBe(true);

    expect(engine.rpcCalls.map((c) => c.method)).toEqual([
      'wizard:list-agent-packs',
      'wizard:install-pack-agents',
    ]);
    expect(engine.rpcCalls[1]?.params).toEqual({
      source: 'github:org/repo',
      agentFiles: ['a.md', 'b.md'],
    });
  });

  it('emits changed:false on second run (fromCache:true)', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    engine.scripted.set('wizard:list-agent-packs', {
      success: true,
      data: {
        packs: [
          { name: 'p', source: 'src', agents: [{ file: 'x.md', name: 'x' }] },
        ],
      },
    });
    engine.scripted.set('wizard:install-pack-agents', {
      success: true,
      data: { agentsDownloaded: 1, fromCache: true },
    });

    const code = await execute(
      { subcommand: 'packs-install', packId: 'p' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.Success);
    const completeParams = ft.notifications.at(-1)?.params as {
      changed: boolean;
    };
    expect(completeParams.changed).toBe(false);
  });

  it('emits task.error and InternalFailure when pack-id is unknown', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    engine.scripted.set('wizard:list-agent-packs', {
      success: true,
      data: { packs: [{ name: 'other', source: 's', agents: [] }] },
    });

    const code = await execute(
      { subcommand: 'packs-install', packId: 'nope' },
      baseGlobals,
      { formatter: ft.formatter, withEngine: engine.withEngine },
    );

    expect(code).toBe(ExitCode.InternalFailure);
    const errorEvent = ft.notifications.find((n) => n.method === 'task.error');
    expect(errorEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// list (pure fs, NO DI)
// ---------------------------------------------------------------------------

describe('ptah agent list', () => {
  it('reads .ptah/agents and filters .md entries — withEngine never called', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    const readdir = jest.fn(async (_p: string) => [
      'one.md',
      'two.md',
      'README.txt',
    ]);

    const code = await execute({ subcommand: 'list' }, baseGlobals, {
      formatter: ft.formatter,
      withEngine: engine.withEngine,
      readdir,
    });

    expect(code).toBe(ExitCode.Success);
    expect(engine.invoked.count).toBe(0); // CRITICAL — list bypasses DI
    expect(readdir).toHaveBeenCalledTimes(1);

    expect(ft.notifications[0]?.method).toBe('agent.list');
    const params = ft.notifications[0]?.params as {
      path: string;
      agents: Array<{ name: string; file: string; path: string }>;
    };
    expect(params.agents.map((a) => a.name)).toEqual(['one', 'two']);
    expect(params.agents.map((a) => a.file)).toEqual(['one.md', 'two.md']);
  });

  it('returns empty list when .ptah/agents does not exist', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();
    const readdir = jest.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const code = await execute({ subcommand: 'list' }, baseGlobals, {
      formatter: ft.formatter,
      withEngine: engine.withEngine,
      readdir,
    });

    expect(code).toBe(ExitCode.Success);
    expect(engine.invoked.count).toBe(0);
    const params = ft.notifications[0]?.params as { agents: unknown[] };
    expect(params.agents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// apply <name> — content-diff aware
// ---------------------------------------------------------------------------

describe('ptah agent apply', () => {
  it('rejects missing name with UsageError', async () => {
    const ft = makeFormatter();
    const st = makeStderr();
    const engine = makeEngine();

    const code = await execute({ subcommand: 'apply' }, baseGlobals, {
      formatter: ft.formatter,
      stderr: st.stderr,
      withEngine: engine.withEngine,
    });

    expect(code).toBe(ExitCode.UsageError);
    expect(st.buffer).toContain('<name> is required');
  });

  it('writes target on first run (no existing file) with changed:true', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const reads: string[] = [];
    const writes: Array<{ path: string; data: string }> = [];
    const mkdirs: Array<{ path: string; recursive: boolean }> = [];

    const code = await execute(
      { subcommand: 'apply', name: 'reviewer' },
      baseGlobals,
      {
        formatter: ft.formatter,
        withEngine: engine.withEngine,
        resolvePluginsPath: () => 'D:/plugins',
        readFile: async (p: string) => {
          reads.push(p);
          if (p.endsWith('agent.md')) return '# reviewer body';
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
        writeFile: async (p: string, d: string) => {
          writes.push({ path: p, data: d });
        },
        mkdir: async (p: string, o: { recursive: boolean }) => {
          mkdirs.push({ path: p, recursive: o.recursive });
        },
        stat: async () => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      },
    );

    expect(code).toBe(ExitCode.Success);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data).toBe('# reviewer body');
    expect(mkdirs).toHaveLength(1);
    expect(mkdirs[0]?.recursive).toBe(true);

    const applied = ft.notifications.find((n) => n.method === 'agent.applied');
    expect(applied).toBeDefined();
    const p = applied?.params as { changed: boolean; name: string };
    expect(p.changed).toBe(true);
    expect(p.name).toBe('reviewer');
  });

  it('emits changed:false on second run with identical content (no write)', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const writes: Array<{ path: string; data: string }> = [];

    const code = await execute(
      { subcommand: 'apply', name: 'reviewer' },
      baseGlobals,
      {
        formatter: ft.formatter,
        withEngine: engine.withEngine,
        resolvePluginsPath: () => 'D:/plugins',
        readFile: async (_p: string) => '# same content',
        writeFile: async (p: string, d: string) => {
          writes.push({ path: p, data: d });
        },
        mkdir: async () => undefined,
        stat: async () => ({ isFile: () => true }),
      },
    );

    expect(code).toBe(ExitCode.Success);
    expect(writes).toHaveLength(0); // CRITICAL — no write on identical content
    const applied = ft.notifications.find((n) => n.method === 'agent.applied');
    expect((applied?.params as { changed: boolean }).changed).toBe(false);
  });

  it('emits changed:true when existing content differs', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const writes: Array<{ path: string; data: string }> = [];

    const code = await execute(
      { subcommand: 'apply', name: 'reviewer' },
      baseGlobals,
      {
        formatter: ft.formatter,
        withEngine: engine.withEngine,
        resolvePluginsPath: () => 'D:/plugins',
        readFile: async (p: string) =>
          p.endsWith('agent.md') ? '# new' : '# old',
        writeFile: async (p: string, d: string) => {
          writes.push({ path: p, data: d });
        },
        mkdir: async () => undefined,
        stat: async () => ({ isFile: () => true }),
      },
    );

    expect(code).toBe(ExitCode.Success);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data).toBe('# new');
    const applied = ft.notifications.find((n) => n.method === 'agent.applied');
    expect((applied?.params as { changed: boolean }).changed).toBe(true);
  });

  it('emits task.error + InternalFailure when source template missing', async () => {
    const ft = makeFormatter();
    const engine = makeEngine();

    const code = await execute(
      { subcommand: 'apply', name: 'ghost' },
      baseGlobals,
      {
        formatter: ft.formatter,
        withEngine: engine.withEngine,
        resolvePluginsPath: () => 'D:/plugins',
        readFile: async () => {
          throw Object.assign(new Error('ENOENT: missing'), {
            code: 'ENOENT',
          });
        },
        stat: async () => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
      },
    );

    expect(code).toBe(ExitCode.InternalFailure);
    const errorEvent = ft.notifications.find((n) => n.method === 'task.error');
    expect(errorEvent).toBeDefined();
  });
});
