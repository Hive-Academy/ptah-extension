/**
 * Unit tests for `ptah provider` command dispatcher.
 *
 * TASK_2026_104 Batch 8d.
 *
 * Coverage:
 *   - status: emits provider.status, redacts secret-like fields unless --reveal
 *   - status with --reveal: leaves api keys verbatim
 *   - set-key: validates --provider/--key, calls llm:setApiKey, emits
 *     provider.key.set without echoing the key
 *   - set-key RPC failure: emits task.error and exits 5
 *   - remove-key: validates --provider, calls llm:removeApiKey, emits
 *     provider.key.removed
 *   - default get: calls llm:getDefaultProvider, emits provider.default
 *   - default set <id>: validates id, calls llm:setDefaultProvider, emits
 *     provider.default.updated
 *   - default with unknown action: usage error
 *   - models list --provider: calls llm:listProviderModels, emits
 *     provider.models with the returned model list
 *   - models list missing --provider: usage error
 *   - models with non-list action: usage error
 *   - tier set --model --tier: calls provider:setModelTier, emits
 *     provider.tier.updated (the canonical assertion required by spec)
 *   - tier set missing --tier or --model: usage error
 *   - tier get: calls provider:getModelTiers, emits provider.tiers
 *   - tier clear --tier: calls provider:clearModelTier, emits
 *     provider.tier.cleared
 *   - tier with unknown action: usage error
 *   - unknown sub-command: usage error
 *   - RPC error: bubbles up to task.error + exit 5
 */

import { execute } from './provider.js';
import type { ProviderExecuteHooks, ProviderOptions } from './provider.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

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

interface StderrTrace {
  stderr: { write: jest.Mock };
  buffer: string;
}

function makeStderr(): StderrTrace {
  const trace: StderrTrace = {
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

interface RpcCall {
  method: string;
  params: unknown;
}

interface MockEngine {
  withEngine: ProviderExecuteHooks['withEngine'];
  rpcCalls: RpcCall[];
  /** Mutated by tests to script per-method responses. */
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
}

function makeEngine(): MockEngine {
  const rpcCalls: RpcCall[] = [];
  const scripted = new Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scripted_response = scripted.get(method);
      if (scripted_response) return scripted_response;
      return { success: true, data: { __default: method } };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => {
      throw new Error(
        'container.resolve hit — provider command should not resolve directly',
      );
    }),
    clearInstances: jest.fn(),
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
  }) as unknown as ProviderExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(extra: Partial<ProviderExecuteHooks> = {}): {
  formatterTrace: FormatterTrace;
  stderrTrace: StderrTrace;
  engine: MockEngine;
  hooks: ProviderExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: ProviderExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
    ...extra,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

// ---------------------------------------------------------------------------
// `provider status`
// ---------------------------------------------------------------------------

describe('ptah provider status', () => {
  it('emits provider.status and redacts secret-like fields without --reveal', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:getProviderStatus', {
      success: true,
      data: {
        providers: [
          {
            name: 'anthropic',
            displayName: 'Anthropic (Claude)',
            hasApiKey: true,
            isDefault: true,
            apiKey: 'sk-ant-real-secret',
          },
        ],
        defaultProvider: 'anthropic',
      },
    });

    const exit = await execute(
      { subcommand: 'status' } satisfies ProviderOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      { method: 'llm:getProviderStatus', params: undefined },
    ]);
    expect(formatterTrace.notifications.map((n) => n.method)).toEqual([
      'provider.status',
    ]);

    const params = formatterTrace.notifications[0]?.params as Record<
      string,
      unknown
    >;
    const providers = params?.['providers'] as Array<Record<string, unknown>>;
    // Both `apiKey` and `hasApiKey` match the redactor's substring pattern
    // (/apikey/i) — the redactor masks every key matching the pattern.
    expect(providers?.[0]?.['apiKey']).toBe('<redacted>');
    expect(providers?.[0]?.['hasApiKey']).toBe('<redacted>');
    // Non-sensitive fields pass through.
    expect(providers?.[0]?.['name']).toBe('anthropic');
    expect(providers?.[0]?.['displayName']).toBe('Anthropic (Claude)');
  });

  it('honors --reveal — leaves api keys verbatim', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:getProviderStatus', {
      success: true,
      data: {
        providers: [{ name: 'anthropic', apiKey: 'sk-ant-real-secret' }],
      },
    });

    const exit = await execute(
      { subcommand: 'status' },
      { ...baseGlobals, reveal: true },
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const params = formatterTrace.notifications[0]?.params as Record<
      string,
      unknown
    >;
    const providers = params?.['providers'] as Array<Record<string, unknown>>;
    expect(providers?.[0]?.['apiKey']).toBe('sk-ant-real-secret');
  });

  it('on RPC failure emits task.error and exits with InternalFailure', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:getProviderStatus', {
      success: false,
      error: 'backend offline',
    });

    const exit = await execute({ subcommand: 'status' }, baseGlobals, hooks);

    expect(exit).toBe(ExitCode.InternalFailure);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    expect((last?.params as Record<string, unknown>)?.['ptah_code']).toBe(
      'internal_failure',
    );
  });
});

// ---------------------------------------------------------------------------
// `provider set-key --provider --key`
// ---------------------------------------------------------------------------

describe('ptah provider set-key', () => {
  it('calls llm:setApiKey and emits provider.key.set without echoing the key', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:setApiKey', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      {
        subcommand: 'set-key',
        provider: 'anthropic',
        key: 'sk-ant-secret-12345',
      },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      {
        method: 'llm:setApiKey',
        params: { provider: 'anthropic', apiKey: 'sk-ant-secret-12345' },
      },
    ]);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('provider.key.set');
    const params = last?.params as Record<string, unknown>;
    expect(params?.['provider']).toBe('anthropic');
    expect(params?.['success']).toBe(true);
    // SECURITY: api key MUST never appear in the emitted notification.
    expect(JSON.stringify(params)).not.toContain('sk-ant-secret-12345');
  });

  it('rejects missing --provider with usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'set-key', key: 'k' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--provider is required');
  });

  it('rejects missing --key with usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'set-key', provider: 'anthropic' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--key is required');
  });

  it('on RPC success=false emits task.error and exits InternalFailure', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:setApiKey', {
      success: true,
      data: { success: false, error: 'invalid key prefix' },
    });

    const exit = await execute(
      { subcommand: 'set-key', provider: 'anthropic', key: 'bad' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    expect((last?.params as Record<string, unknown>)?.['message']).toBe(
      'invalid key prefix',
    );
  });
});

// ---------------------------------------------------------------------------
// `provider remove-key --provider`
// ---------------------------------------------------------------------------

describe('ptah provider remove-key', () => {
  it('calls llm:removeApiKey and emits provider.key.removed', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:removeApiKey', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      { subcommand: 'remove-key', provider: 'openrouter' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      { method: 'llm:removeApiKey', params: { provider: 'openrouter' } },
    ]);
    expect(formatterTrace.notifications.at(-1)?.method).toBe(
      'provider.key.removed',
    );
  });

  it('rejects missing --provider with usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'remove-key' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--provider is required');
  });
});

// ---------------------------------------------------------------------------
// `provider default get|set`
// ---------------------------------------------------------------------------

describe('ptah provider default', () => {
  it('get: calls llm:getDefaultProvider and emits provider.default', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:getDefaultProvider', {
      success: true,
      data: { provider: 'anthropic' },
    });

    const exit = await execute(
      { subcommand: 'default', action: 'get' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      { method: 'llm:getDefaultProvider', params: undefined },
    ]);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('provider.default');
    expect((last?.params as Record<string, unknown>)?.['provider']).toBe(
      'anthropic',
    );
  });

  it('set <id>: calls llm:setDefaultProvider and emits provider.default.updated', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    // CLI bug item #10: `default set` validates against the live registry
    // before issuing the write, so the test must script
    // `llm:getProviderStatus` first.
    engine.scripted.set('llm:getProviderStatus', {
      success: true,
      data: {
        providers: [
          { name: 'openrouter' },
          { name: 'moonshot' },
          { name: 'anthropic' },
        ],
        defaultProvider: 'anthropic',
      },
    });
    engine.scripted.set('llm:setDefaultProvider', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      { subcommand: 'default', action: 'set', provider: 'openrouter' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const calls = engine.rpcCalls.map((c) => c.method);
    expect(calls).toEqual(['llm:getProviderStatus', 'llm:setDefaultProvider']);
    expect(engine.rpcCalls.at(-1)).toEqual({
      method: 'llm:setDefaultProvider',
      params: { provider: 'openrouter' },
    });
    expect(formatterTrace.notifications.at(-1)?.method).toBe(
      'provider.default.updated',
    );
  });

  it('set <id>: rejects an unknown id with a `did you mean?` suggestion (CLI bug #10)', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:getProviderStatus', {
      success: true,
      data: {
        providers: [{ name: 'openrouter' }, { name: 'moonshot' }],
        defaultProvider: 'openrouter',
      },
    });

    const exit = await execute(
      { subcommand: 'default', action: 'set', provider: 'openroutr' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain("unknown provider 'openroutr'");
    expect(stderrTrace.buffer).toContain("Did you mean 'openrouter'");
  });

  it('set without provider id is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'default', action: 'set' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('provider id is required');
  });

  it('unknown action is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'default', action: 'list' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('unknown action');
  });
});

// ---------------------------------------------------------------------------
// `provider models list --provider`
// ---------------------------------------------------------------------------

describe('ptah provider models list', () => {
  it('calls llm:listProviderModels and emits provider.models with the list', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:listProviderModels', {
      success: true,
      data: {
        models: [
          { id: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-opus', displayName: 'Claude 3 Opus' },
        ],
      },
    });

    const exit = await execute(
      { subcommand: 'models', action: 'list', provider: 'anthropic' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      {
        method: 'llm:listProviderModels',
        params: { provider: 'anthropic' },
      },
    ]);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('provider.models');
    const params = last?.params as Record<string, unknown>;
    expect(params?.['provider']).toBe('anthropic');
    expect((params?.['models'] as Array<unknown>).length).toBe(2);
  });

  it('missing --provider is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'models', action: 'list' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--provider is required');
  });

  it('non-list action is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'models', action: 'get', provider: 'anthropic' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('unknown action');
  });

  it('error field in RPC payload bubbles to task.error + exit 5', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:listProviderModels', {
      success: true,
      data: { models: [], error: 'discovery failed' },
    });

    const exit = await execute(
      { subcommand: 'models', action: 'list', provider: 'anthropic' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    expect((last?.params as Record<string, unknown>)?.['message']).toBe(
      'discovery failed',
    );
  });
});

// ---------------------------------------------------------------------------
// `provider tier set|get|clear`
// ---------------------------------------------------------------------------

describe('ptah provider tier', () => {
  it('set --model --tier emits provider.tier.updated (canonical assertion)', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:setModelTier', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      {
        subcommand: 'tier',
        action: 'set',
        tier: 'opus',
        model: 'gpt-4',
      },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      {
        method: 'provider:setModelTier',
        params: { tier: 'opus', modelId: 'gpt-4', scope: 'mainAgent' },
      },
    ]);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('provider.tier.updated');
    const params = last?.params as Record<string, unknown>;
    expect(params?.['tier']).toBe('opus');
    expect(params?.['model']).toBe('gpt-4');
    expect(params?.['success']).toBe(true);
  });

  it('set missing --tier is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'tier', action: 'set', model: 'gpt-4' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--tier is required');
  });

  it('set missing --model is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'tier', action: 'set', tier: 'opus' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--model is required');
  });

  it('get: calls provider:getModelTiers and emits provider.tiers', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:getModelTiers', {
      success: true,
      data: { sonnet: 'claude-3-5-sonnet', opus: 'claude-3-opus' },
    });

    const exit = await execute(
      { subcommand: 'tier', action: 'get' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      { method: 'provider:getModelTiers', params: { scope: 'mainAgent' } },
    ]);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('provider.tiers');
    const tiers = (last?.params as Record<string, unknown>)?.[
      'tiers'
    ] as Record<string, unknown>;
    expect(tiers?.['sonnet']).toBe('claude-3-5-sonnet');
  });

  it('clear --tier: calls provider:clearModelTier and emits provider.tier.cleared', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:clearModelTier', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      { subcommand: 'tier', action: 'clear', tier: 'opus' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      {
        method: 'provider:clearModelTier',
        params: { tier: 'opus', scope: 'mainAgent' },
      },
    ]);
    expect(formatterTrace.notifications.at(-1)?.method).toBe(
      'provider.tier.cleared',
    );
  });

  it('clear missing --tier is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'tier', action: 'clear' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--tier is required');
  });

  it('unknown action is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'tier', action: 'list' as never },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('unknown action');
  });
});

// ---------------------------------------------------------------------------
// Misc: unknown sub-command + RPC throw path
// ---------------------------------------------------------------------------

describe('ptah provider — fallthrough', () => {
  it('unknown sub-command is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'frobnicate' as never },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('unknown sub-command');
  });

  it('RPC error response throws → caught as task.error + exit 5', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:getDefaultProvider', {
      success: false,
      error: 'transport failure',
    });

    const exit = await execute(
      { subcommand: 'default', action: 'get' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    expect((last?.params as Record<string, unknown>)?.['message']).toBe(
      'transport failure',
    );
  });
});
