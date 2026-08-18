/**
 * Unit tests for `ptah provider` command dispatcher.
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
 *   - custom list/add/update/remove/test: user-defined provider CRUD, the
 *     non-interactive missing-flag contract, and key masking in list output
 */

import * as clack from '@clack/prompts';

import { execute } from './provider.js';
import type { ProviderExecuteHooks, ProviderOptions } from './provider.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';

// `provider custom add` is the only sub-command that can prompt. Mocked at the
// module level (as `init.spec.ts` does) so the production default
// `hooks.clack ?? clack` resolves to these fakes and a stray prompt in machine
// mode is observable rather than a hang.
jest.mock('@clack/prompts', () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  cancel: jest.fn(),
  text: jest.fn(),
  password: jest.fn(),
  select: jest.fn(),
  isCancel: jest.fn(() => false),
}));

const CANCEL_SYMBOL = Symbol('clack:cancel');

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
    expect(providers?.[0]?.['apiKey']).toBe('<redacted>');
    expect(providers?.[0]?.['hasApiKey']).toBe(true);
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
      data: { success: true, verified: true },
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
    expect(params?.['verified']).toBe(true);
    // SECURITY: api key MUST never appear in the emitted notification.
    expect(JSON.stringify(params)).not.toContain('sk-ant-secret-12345');
  });

  it('stored-but-not-verified key emits provider.key.set with verified=false and exits AuthRequired', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('llm:setApiKey', {
      success: true,
      data: { success: true, verified: false },
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

    expect(exit).toBe(ExitCode.AuthRequired);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('provider.key.set');
    expect((last?.params as Record<string, unknown>)?.['verified']).toBe(false);
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

  it('on RPC success=false (rejected key) emits task.error and exits AuthRequired', async () => {
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

    expect(exit).toBe(ExitCode.AuthRequired);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    const params = last?.params as Record<string, unknown>;
    expect(params?.['message']).toBe('invalid key prefix');
    expect(params?.['ptah_code']).toBe('auth_required');
    expect(params?.['verified']).toBe(false);
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
// `provider custom …` — user-defined provider entries
// ---------------------------------------------------------------------------

/** A complete, valid flag set for `custom add` — individual tests drop fields. */
const fullAddOptions: ProviderOptions = {
  subcommand: 'custom',
  action: 'add',
  provider: 'my-gateway',
  name: 'My Gateway',
  baseUrl: 'https://gateway.example.com',
  lane: 'openai',
  key: 'sk-super-secret-key',
};

/** Every prompt fake, reset between tests so call counts mean something. */
function resetClack(): void {
  for (const fn of [
    clack.intro,
    clack.outro,
    clack.cancel,
    clack.text,
    clack.password,
    clack.select,
    clack.isCancel,
  ]) {
    (fn as unknown as jest.Mock).mockReset();
  }
  (clack.isCancel as unknown as jest.Mock).mockImplementation(() => false);
}

describe('ptah provider custom list', () => {
  beforeEach(resetClack);

  it('emits provider.custom.entries with the stored metadata', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:listCustomEntries', {
      success: true,
      data: {
        entries: [
          {
            id: 'my-gateway',
            name: 'My Gateway',
            baseUrl: 'https://gateway.example.com',
            lane: 'openai',
            authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
            keyPrefix: '',
            helpUrl: '',
          },
        ],
      },
    });

    const exit = await execute(
      { subcommand: 'custom', action: 'list' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      { method: 'provider:listCustomEntries', params: undefined },
    ]);
    const notification = formatterTrace.notifications[0];
    expect(notification?.method).toBe('provider.custom.entries');
    const entries = (notification?.params as Record<string, unknown>)[
      'entries'
    ] as Array<Record<string, unknown>>;
    expect(entries[0]?.['id']).toBe('my-gateway');
    expect(entries[0]?.['lane']).toBe('openai');
    // The env var NAME is metadata, not a credential — it must survive.
    expect(entries[0]?.['authEnvVar']).toBe('ANTHROPIC_AUTH_TOKEN');
  });

  /**
   * Entries are non-secret metadata by contract, but `list` is the surface a
   * leak would show up on, so it is masked unconditionally — `--reveal` does
   * NOT open it, unlike `provider status`.
   */
  it('masks any credential-shaped field, even with --reveal', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:listCustomEntries', {
      success: true,
      data: {
        entries: [
          {
            id: 'my-gateway',
            name: 'My Gateway',
            apiKey: 'sk-should-never-appear',
            authToken: 'tok-should-never-appear',
          },
        ],
      },
    });

    const exit = await execute(
      { subcommand: 'custom', action: 'list' },
      { ...baseGlobals, reveal: true },
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const serialized = JSON.stringify(formatterTrace.notifications[0]?.params);
    expect(serialized).not.toContain('sk-should-never-appear');
    expect(serialized).not.toContain('tok-should-never-appear');
    expect(serialized).toContain('<redacted>');
  });
});

describe('ptah provider custom add — non-interactive', () => {
  beforeEach(resetClack);

  it('sends the entry and the key separately, echoing neither', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:addCustomEntry', {
      success: true,
      data: {
        entry: {
          id: 'my-gateway',
          name: 'My Gateway',
          baseUrl: 'https://gateway.example.com',
          lane: 'openai',
          authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
          keyPrefix: '',
          helpUrl: '',
        },
      },
    });

    const exit = await execute(fullAddOptions, baseGlobals, hooks);

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toHaveLength(1);
    const call = engine.rpcCalls[0];
    expect(call?.method).toBe('provider:addCustomEntry');
    const params = call?.params as {
      entry: Record<string, unknown>;
      apiKey?: string;
    };
    expect(params.entry['id']).toBe('my-gateway');
    expect(params.entry['lane']).toBe('openai');
    // Lane maps to the proxy decision, so it must be carried verbatim, and the
    // key must NOT be part of the persisted metadata blob.
    expect(params.entry).not.toHaveProperty('apiKey');
    expect(params.apiKey).toBe('sk-super-secret-key');

    const notification = formatterTrace.notifications.at(-1);
    expect(notification?.method).toBe('provider.custom.added');
    expect(JSON.stringify(notification?.params)).not.toContain(
      'sk-super-secret-key',
    );
    expect((notification?.params as Record<string, unknown>)['keyStored']).toBe(
      true,
    );
  });

  it('omits apiKey entirely when no --key was supplied', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('provider:addCustomEntry', {
      success: true,
      data: { entry: { id: 'my-gateway' } },
    });

    const exit = await execute(
      { ...fullAddOptions, key: undefined },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.params).not.toHaveProperty('apiKey');
  });

  it.each([
    ['<id>', { ...fullAddOptions, provider: undefined }, '<id> is required'],
    ['--name', { ...fullAddOptions, name: undefined }, '--name is required'],
    [
      '--base-url',
      { ...fullAddOptions, baseUrl: undefined },
      '--base-url is required',
    ],
    ['--lane', { ...fullAddOptions, lane: undefined }, '--lane is required'],
  ])(
    'fails fast (never prompts) when %s is missing in machine mode',
    async (_label, opts, expected) => {
      const { stderrTrace, engine, hooks } = buildHooks();

      const exit = await execute(opts as ProviderOptions, baseGlobals, hooks);

      expect(exit).toBe(ExitCode.UsageError);
      expect(stderrTrace.buffer).toContain(expected);
      expect(engine.rpcCalls).toHaveLength(0);
      // The whole point: a scripted/CI run must not block on stdin.
      expect(clack.text).not.toHaveBeenCalled();
      expect(clack.select).not.toHaveBeenCalled();
      expect(clack.password).not.toHaveBeenCalled();
    },
  );

  it('rejects a lane outside the constrained set instead of guessing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();

    const exit = await execute(
      { ...fullAddOptions, lane: 'gemini' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--lane must be one of');
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('rejects a non-http base URL through the shared entry schema', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();

    const exit = await execute(
      { ...fullAddOptions, baseUrl: 'ftp://gateway.example.com' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('baseUrl');
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('rejects an id the settings-key patterns could not round-trip', async () => {
    const { stderrTrace, hooks } = buildHooks();

    const exit = await execute(
      { ...fullAddOptions, provider: 'My Gateway!' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('id');
  });

  it('rejects a partial tier map — a half-mapped tier cannot resolve', async () => {
    const { stderrTrace, hooks } = buildHooks();

    const exit = await execute(
      { ...fullAddOptions, tierSonnet: 'gw/medium' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('must be supplied together');
  });

  it('accepts a complete tier map and manual pricing', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('provider:addCustomEntry', {
      success: true,
      data: { entry: { id: 'my-gateway' } },
    });

    const exit = await execute(
      {
        ...fullAddOptions,
        tierSonnet: 'gw/medium',
        tierOpus: 'gw/large',
        tierHaiku: 'gw/small',
        inputPrice: '1.5',
        outputPrice: '7',
        modelsEndpoint: 'https://gateway.example.com/v1/models',
      },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const params = engine.rpcCalls[0]?.params as {
      entry: Record<string, unknown>;
    };
    expect(params.entry['defaultTiers']).toEqual({
      sonnet: 'gw/medium',
      opus: 'gw/large',
      haiku: 'gw/small',
    });
    expect(params.entry['pricing']).toEqual({
      inputPerMillion: 1.5,
      outputPerMillion: 7,
    });
    expect(params.entry['modelsEndpoint']).toBe(
      'https://gateway.example.com/v1/models',
    );
  });

  it.each([
    [
      'a lone --input-price',
      { inputPrice: '1.5' },
      'must be supplied together',
    ],
    [
      'a non-numeric price',
      { inputPrice: 'cheap', outputPrice: '7' },
      'must be a non-negative number',
    ],
    [
      'a negative price',
      { inputPrice: '-1', outputPrice: '7' },
      'must be a non-negative number',
    ],
  ])('rejects %s', async (_label, extra, expected) => {
    const { stderrTrace, hooks } = buildHooks();

    const exit = await execute(
      { ...fullAddOptions, ...extra },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain(expected);
  });
});

describe('ptah provider custom add — interactive', () => {
  beforeEach(resetClack);

  it('prompts only for the fields the flags did not supply', async () => {
    const { engine, hooks } = buildHooks({ isInteractive: () => true });
    engine.scripted.set('provider:addCustomEntry', {
      success: true,
      data: { entry: { id: 'my-gateway' } },
    });
    (clack.text as unknown as jest.Mock)
      .mockResolvedValueOnce('My Gateway') // display name
      .mockResolvedValueOnce(''); // models endpoint (skipped)
    (clack.select as unknown as jest.Mock).mockResolvedValueOnce('anthropic');
    (clack.password as unknown as jest.Mock).mockResolvedValueOnce(
      'sk-prompted-key',
    );

    const exit = await execute(
      {
        subcommand: 'custom',
        action: 'add',
        provider: 'my-gateway',
        baseUrl: 'https://gateway.example.com',
      },
      { ...baseGlobals, json: false, human: true },
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const params = engine.rpcCalls[0]?.params as {
      entry: Record<string, unknown>;
      apiKey?: string;
    };
    expect(params.entry['name']).toBe('My Gateway');
    expect(params.entry['lane']).toBe('anthropic');
    expect(params.entry).not.toHaveProperty('modelsEndpoint');
    expect(params.apiKey).toBe('sk-prompted-key');
    // id and base URL came from flags, so they were never asked for.
    expect((clack.text as unknown as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('exits 130 and saves nothing when the user cancels a prompt', async () => {
    const { engine, hooks } = buildHooks({ isInteractive: () => true });
    (clack.text as unknown as jest.Mock).mockResolvedValueOnce(CANCEL_SYMBOL);
    (clack.isCancel as unknown as jest.Mock).mockImplementation(
      (value: unknown) => value === CANCEL_SYMBOL,
    );

    const exit = await execute(
      { subcommand: 'custom', action: 'add' },
      { ...baseGlobals, json: false, human: true },
      hooks,
    );

    expect(exit).toBe(130);
    expect(engine.rpcCalls).toHaveLength(0);
    expect(clack.cancel).toHaveBeenCalled();
  });
});

describe('ptah provider custom update', () => {
  beforeEach(resetClack);

  it('sends only the fields that were supplied', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:updateCustomEntry', {
      success: true,
      data: { entry: { id: 'my-gateway', name: 'Renamed' } },
    });

    const exit = await execute(
      {
        subcommand: 'custom',
        action: 'update',
        provider: 'my-gateway',
        name: 'Renamed',
      },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'provider:updateCustomEntry',
      params: { id: 'my-gateway', changes: { name: 'Renamed' } },
    });
    expect(formatterTrace.notifications.at(-1)?.method).toBe(
      'provider.custom.updated',
    );
  });

  it('rotates the key without touching metadata', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:updateCustomEntry', {
      success: true,
      data: { entry: { id: 'my-gateway' } },
    });

    const exit = await execute(
      {
        subcommand: 'custom',
        action: 'update',
        provider: 'my-gateway',
        key: 'sk-rotated-secret',
      },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.params).toEqual({
      id: 'my-gateway',
      changes: {},
      apiKey: 'sk-rotated-secret',
    });
    expect(JSON.stringify(formatterTrace.notifications)).not.toContain(
      'sk-rotated-secret',
    );
  });

  it('never prompts — a no-op update is a usage error', async () => {
    const { stderrTrace, engine, hooks } = buildHooks({
      isInteractive: () => true,
    });

    const exit = await execute(
      { subcommand: 'custom', action: 'update', provider: 'my-gateway' },
      { ...baseGlobals, json: false, human: true },
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('nothing to update');
    expect(engine.rpcCalls).toHaveLength(0);
    expect(clack.text).not.toHaveBeenCalled();
  });

  it('rejects an invalid base URL before the RPC', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();

    const exit = await execute(
      {
        subcommand: 'custom',
        action: 'update',
        provider: 'my-gateway',
        baseUrl: 'not-a-url',
      },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('--base-url:');
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('missing <id> is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'custom', action: 'update', name: 'Renamed' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('<id> is required');
  });
});

describe('ptah provider custom remove', () => {
  beforeEach(resetClack);

  it('emits provider.custom.removed on success', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:removeCustomEntry', {
      success: true,
      data: { removed: true },
    });

    const exit = await execute(
      { subcommand: 'custom', action: 'remove', provider: 'my-gateway' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'provider:removeCustomEntry',
      params: { id: 'my-gateway' },
    });
    expect(formatterTrace.notifications.at(-1)).toEqual({
      method: 'provider.custom.removed',
      params: { id: 'my-gateway', removed: true },
    });
  });

  it('reports an unknown id as a usage error rather than a silent success', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:removeCustomEntry', {
      success: true,
      data: { removed: false },
    });

    const exit = await execute(
      { subcommand: 'custom', action: 'remove', provider: 'ghost' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(formatterTrace.notifications).toHaveLength(0);
  });

  it('missing <id> is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'custom', action: 'remove' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('<id> is required');
  });
});

describe('ptah provider custom test', () => {
  beforeEach(resetClack);

  it('surfaces the probe message verbatim and exits 0 when it passes', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:testCustomEntry', {
      success: true,
      data: { ok: true, message: 'Tool round-trip succeeded', latencyMs: 412 },
    });

    const exit = await execute(
      { subcommand: 'custom', action: 'test', provider: 'my-gateway' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications.at(-1)).toEqual({
      method: 'provider.custom.test',
      params: {
        id: 'my-gateway',
        ok: true,
        message: 'Tool round-trip succeeded',
        latencyMs: 412,
      },
    });
  });

  /**
   * A failed probe is a RESULT, not a crash — the message still has to reach
   * the caller, so the notification is emitted and only the exit code differs.
   */
  it('still emits the notification and exits non-zero when the probe fails', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('provider:testCustomEntry', {
      success: true,
      data: { ok: false, message: 'HTTP 401 from gateway.example.com' },
    });

    const exit = await execute(
      { subcommand: 'custom', action: 'test', provider: 'my-gateway' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.GeneralError);
    const params = formatterTrace.notifications.at(-1)?.params as Record<
      string,
      unknown
    >;
    expect(params['ok']).toBe(false);
    expect(params['message']).toBe('HTTP 401 from gateway.example.com');
  });

  it('missing <id> is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'custom', action: 'test' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('<id> is required');
  });

  it('unknown action is a usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'custom', action: 'get' },
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
