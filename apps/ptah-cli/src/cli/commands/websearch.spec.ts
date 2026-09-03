/**
 * Unit tests for `ptah websearch` command.
 */

import { execute } from './websearch.js';
import type { WebsearchExecuteHooks, WebsearchOptions } from './websearch.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';

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

const revealGlobals: GlobalOptions = { ...baseGlobals, reveal: true };

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
  withEngine: WebsearchExecuteHooks['withEngine'];
  engineRuns: Array<{ globals: unknown; opts: unknown }>;
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
}

function makeEngine(): MockEngine {
  const engineRuns: MockEngine['engineRuns'] = [];
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
    engineRuns.push({ globals: _globals, opts: _opts });
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as WebsearchExecuteHooks['withEngine'];

  return { withEngine, engineRuns, rpcCalls, scripted };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: WebsearchExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: WebsearchExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah websearch status', () => {
  it('queries and emits status once per configured provider', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('webSearch:getConfig', {
      success: true,
      data: { providers: ['tavily', 'serper'], maxResults: 5 },
    });
    engine.scripted.set('webSearch:getApiKeyStatus', {
      success: true,
      data: { configured: true },
    });

    const exit = await execute(
      { subcommand: 'status' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls.map((c) => c.method)).toEqual([
      'webSearch:getConfig',
      'webSearch:getApiKeyStatus',
      'webSearch:getApiKeyStatus',
    ]);
    expect(engine.rpcCalls[1]?.params).toEqual({ provider: 'tavily' });
    expect(engine.rpcCalls[2]?.params).toEqual({ provider: 'serper' });
    expect(formatterTrace.notifications).toEqual([
      {
        method: 'websearch.status',
        params: { provider: 'tavily', configured: true, maxResults: 5 },
      },
      {
        method: 'websearch.status',
        params: { provider: 'serper', configured: true, maxResults: 5 },
      },
    ]);
  });

  it('honors --provider override', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('webSearch:getConfig', {
      success: true,
      data: { providers: ['tavily', 'exa'] },
    });
    const exit = await execute(
      { subcommand: 'status', provider: 'serper' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toHaveLength(2);
    expect(engine.rpcCalls[1]?.params).toEqual({ provider: 'serper' });
  });
});

describe('ptah websearch set-key', () => {
  it('exits 2 when --provider is missing', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'set-key', key: 'k' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 when --key is missing', async () => {
    const { hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'set-key', provider: 'tavily' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('dispatches webSearch:setApiKey', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'set-key',
        provider: 'tavily',
        key: 'sk-secret',
      } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'webSearch:setApiKey',
      params: { provider: 'tavily', apiKey: 'sk-secret' },
    });
  });
});

describe('ptah websearch remove-key', () => {
  it('dispatches webSearch:deleteApiKey', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'remove-key',
        provider: 'tavily',
      } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'webSearch:deleteApiKey',
      params: { provider: 'tavily' },
    });
  });
});

describe('ptah websearch test', () => {
  it('returns Success on test success', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('webSearch:test', {
      success: true,
      data: {
        success: true,
        results: [{ provider: 'tavily', success: true }],
      },
    });
    const exit = await execute(
      { subcommand: 'test' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications).toEqual([
      {
        method: 'websearch.test',
        params: { provider: 'tavily', success: true, error: undefined },
      },
    ]);
  });

  it('emits one line per provider and succeeds on a partial pass', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('webSearch:test', {
      success: true,
      data: {
        success: true,
        results: [
          { provider: 'tavily', success: true },
          {
            provider: 'serper',
            success: false,
            error: 'No API key configured for serper',
          },
        ],
      },
    });

    const exit = await execute(
      { subcommand: 'test' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications).toEqual([
      {
        method: 'websearch.test',
        params: { provider: 'tavily', success: true, error: undefined },
      },
      {
        method: 'websearch.test',
        params: {
          provider: 'serper',
          success: false,
          error: 'No API key configured for serper',
        },
      },
    ]);
  });

  it('returns GeneralError on test failure', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('webSearch:test', {
      success: true,
      data: {
        success: false,
        results: [{ provider: 'tavily', success: false, error: 'no key' }],
      },
    });
    const exit = await execute(
      { subcommand: 'test' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.GeneralError);
  });
});

describe('ptah websearch config', () => {
  it('config-get: emits websearch.config (redacted by default)', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('webSearch:getConfig', {
      success: true,
      data: { providers: ['tavily'], apiKey: 'sk-secret' },
    });
    const exit = await execute(
      { subcommand: 'config-get' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const params = formatterTrace.notifications[0]?.params as Record<
      string,
      unknown
    >;
    expect(params['apiKey']).not.toBe('sk-secret');
  });

  it('config-get: --reveal exposes the raw key', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('webSearch:getConfig', {
      success: true,
      data: { providers: ['tavily'], apiKey: 'sk-secret' },
    });
    const exit = await execute(
      { subcommand: 'config-get' } satisfies WebsearchOptions,
      revealGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const params = formatterTrace.notifications[0]?.params as Record<
      string,
      unknown
    >;
    expect(params['apiKey']).toBe('sk-secret');
  });

  it('config-set: requires at least one of --provider / --max-results', async () => {
    const { hooks, engine } = buildHooks();
    const exit = await execute(
      { subcommand: 'config-set' } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('config-set: parses, trims, and de-duplicates comma-separated providers', async () => {
    const { engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'config-set',
        provider: 'serper, tavily,serper, exa',
        maxResults: 10,
      } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'webSearch:setConfig',
      params: { providers: ['serper', 'tavily', 'exa'], maxResults: 10 },
    });
  });

  it('config-set: rejects an unknown provider before booting the engine', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'config-set',
        provider: 'tavily,bing',
      } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain("unknown provider 'bing'");
    expect(engine.engineRuns).toHaveLength(0);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('config-set: rejects an empty provider list before booting the engine', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'config-set',
        provider: ' , ',
      } satisfies WebsearchOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('must contain at least one provider');
    expect(engine.engineRuns).toHaveLength(0);
    expect(engine.rpcCalls).toHaveLength(0);
  });
});
