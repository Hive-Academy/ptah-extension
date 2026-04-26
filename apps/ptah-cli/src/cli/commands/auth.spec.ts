/**
 * Unit tests for `ptah auth` command dispatcher.
 *
 * TASK_2026_104 Batch 8d.
 *
 * Coverage:
 *   - status: emits auth.status / auth.health / auth.api_key.status, redacts
 *     api keys unless --reveal
 *   - login copilot: delegates to runHeadlessLogin with stderr opener and the
 *     resolved CopilotAuthService; returns the helper's exit code
 *   - login codex: prints OOB instructions to stderr, exits 0, emits
 *     auth.login.start + auth.login.url
 *   - login claude/anthropic: prints "use provider set-key" instruction
 *   - logout copilot: calls auth:copilotLogout RPC, emits logout.complete
 *   - logout codex --force: invokes unlinkFile and emits logout.complete
 *   - logout codex without --force: usage error (exit 2)
 *   - test <provider>: emits auth.test.result with RPC payload
 *   - missing provider on login/logout: usage error (exit 2)
 *   - unsupported provider: usage error (exit 2)
 *   - RPC failure: bubbles up as task.error + exit 5
 */

import type { ICopilotAuthService } from '@ptah-extension/agent-sdk';

// Stub the agent-sdk module so ts-jest does not have to compile the entire
// SDK transitive graph (pre-existing Zod schema TS errors in libs/shared
// otherwise prevent the import from resolving in jest). The auth command only
// reads SDK_TOKENS.SDK_COPILOT_AUTH at runtime.
jest.mock(
  '@ptah-extension/agent-sdk',
  () => ({
    SDK_TOKENS: {
      SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth'),
    },
  }),
  { virtual: true },
);

import { execute } from './auth.js';
import type { AuthExecuteHooks, AuthOptions } from './auth.js';
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
  withEngine: AuthExecuteHooks['withEngine'];
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

  // Container resolution stub — only `auth login copilot` reaches it. The
  // hook system in auth.ts substitutes `runHeadlessLogin` so the real
  // SDK_TOKENS lookup never executes in the spec — but we still satisfy
  // the typing surface.
  const container = {
    resolve: jest.fn(() => {
      throw new Error(
        'container.resolve was hit — test should override runHeadlessLogin',
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
  }) as unknown as AuthExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(extra: Partial<AuthExecuteHooks> = {}): {
  formatterTrace: FormatterTrace;
  stderrTrace: StderrTrace;
  engine: MockEngine;
  hooks: AuthExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: AuthExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
    ...extra,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

// ---------------------------------------------------------------------------
// Tests — `auth status`
// ---------------------------------------------------------------------------

describe('ptah auth status', () => {
  it('emits auth.status / auth.health / auth.api_key.status and exits 0', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('auth:getAuthStatus', {
      success: true,
      data: { authMethod: 'apiKey', hasApiKey: true, apiKey: 'sk-real-key' },
    });
    engine.scripted.set('auth:getHealth', {
      success: true,
      data: { health: { status: 'available' } },
    });
    engine.scripted.set('auth:getApiKeyStatus', {
      success: true,
      data: {
        providers: [
          { provider: 'anthropic', hasApiKey: true, isDefault: true },
        ],
      },
    });

    const exit = await execute(
      { subcommand: 'status' } satisfies AuthOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'auth.status',
      'auth.health',
      'auth.api_key.status',
    ]);

    // Redaction: the literal apiKey field (and any key matching the
    // sensitive pattern, including `hasApiKey`) must be masked when
    // --reveal is off. The redactor uses a substring match on
    // /apikey|api_key|token|secret|password/i.
    const status = formatterTrace.notifications[0]?.params as Record<
      string,
      unknown
    >;
    expect(status?.['apiKey']).toBe('<redacted>');
    expect(status?.['hasApiKey']).toBe('<redacted>');
    // Non-sensitive fields pass through untouched.
    expect(status?.['authMethod']).toBe('apiKey');
  });

  it('honors --reveal: leaves apiKey verbatim', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('auth:getAuthStatus', {
      success: true,
      data: { apiKey: 'sk-real-key', hasApiKey: true },
    });

    await execute(
      { subcommand: 'status' },
      { ...baseGlobals, reveal: true },
      hooks,
    );

    const status = formatterTrace.notifications[0]?.params as Record<
      string,
      unknown
    >;
    expect(status?.['apiKey']).toBe('sk-real-key');
  });

  it('on RPC failure: emits task.error + exit 5', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('auth:getAuthStatus', {
      success: false,
      error: 'auth backend unavailable',
    });

    const exit = await execute({ subcommand: 'status' }, baseGlobals, hooks);

    expect(exit).toBe(ExitCode.InternalFailure);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({ ptah_code: 'internal_failure' });
  });
});

// ---------------------------------------------------------------------------
// Tests — `auth login`
// ---------------------------------------------------------------------------

describe('ptah auth login copilot', () => {
  it('delegates to runHeadlessLogin and forwards the exit code', async () => {
    const headlessRun = jest.fn(async (_input: unknown) => ({
      exitCode: ExitCode.Success,
      outcome: 'success' as const,
      deviceCode: 'dc-1',
    }));
    // The `resolveCopilotAuth` hook bypasses the production `await import(
    // '@ptah-extension/agent-sdk')`, so the scripted `runHeadlessLogin`
    // mock is what actually executes against a vanilla copilotAuth stub.
    const copilotAuthStub = {
      beginLogin: jest.fn(),
      pollLogin: jest.fn(),
      cancelLogin: jest.fn(),
    };
    const { hooks } = buildHooks({
      runHeadlessLogin:
        headlessRun as unknown as AuthExecuteHooks['runHeadlessLogin'],
      resolveCopilotAuth: () =>
        copilotAuthStub as unknown as ICopilotAuthService,
    });

    const exit = await execute(
      { subcommand: 'login', provider: 'copilot' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(headlessRun).toHaveBeenCalledTimes(1);
    const headlessInput = headlessRun.mock.calls[0]?.[0] as {
      provider: string;
      formatter: unknown;
      copilotAuth: unknown;
    };
    expect(headlessInput?.provider).toBe('copilot');
    expect(headlessInput?.copilotAuth).toBe(copilotAuthStub);
  });

  it('forwards a non-zero exit code from runHeadlessLogin (timeout path)', async () => {
    const headlessRun = jest.fn(async (_input: unknown) => ({
      exitCode: ExitCode.AuthRequired,
      outcome: 'timeout' as const,
      deviceCode: 'dc-2',
    }));
    const copilotAuthStub = {
      beginLogin: jest.fn(),
      pollLogin: jest.fn(),
      cancelLogin: jest.fn(),
    };
    const { hooks } = buildHooks({
      runHeadlessLogin:
        headlessRun as unknown as AuthExecuteHooks['runHeadlessLogin'],
      resolveCopilotAuth: () =>
        copilotAuthStub as unknown as ICopilotAuthService,
    });

    const exit = await execute(
      { subcommand: 'login', provider: 'copilot' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.AuthRequired);
  });
});

describe('ptah auth login codex', () => {
  it('prints OOB instructions to stderr, emits start+url, exits 0', async () => {
    const { formatterTrace, stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'login', provider: 'codex' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(stderrTrace.buffer).toContain('codex login --device-auth');
    expect(stderrTrace.buffer).toContain('ptah auth status');
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual(['auth.login.start', 'auth.login.url']);
  });
});

describe('ptah auth login claude', () => {
  it('prints "use provider set-key" instruction, exits 0', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'login', provider: 'claude' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(stderrTrace.buffer).toContain(
      'ptah provider set-key --provider anthropic',
    );
  });

  it('also accepts "anthropic" as the provider alias', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'login', provider: 'anthropic' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(stderrTrace.buffer).toContain('provider set-key');
  });
});

describe('ptah auth login (validation)', () => {
  it('missing provider: usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute({ subcommand: 'login' }, baseGlobals, hooks);
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('provider is required');
  });

  it('unsupported provider: usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'login', provider: 'bogus-provider' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('unsupported provider');
  });
});

// ---------------------------------------------------------------------------
// Tests — `auth logout`
// ---------------------------------------------------------------------------

describe('ptah auth logout copilot', () => {
  it('calls auth:copilotLogout RPC, emits logout.complete, exits 0', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('auth:copilotLogout', {
      success: true,
      data: { success: true },
    });

    const exit = await execute(
      { subcommand: 'logout', provider: 'copilot' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);

    const rpcMethods = engine.rpcCalls.map((c) => c.method);
    expect(rpcMethods).toContain('auth:copilotLogout');

    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('auth.logout.complete');
    expect(last?.params).toMatchObject({ provider: 'copilot', success: true });
  });
});

describe('ptah auth logout codex', () => {
  it('without --force: usage error and no file deletion', async () => {
    const unlinkFile = jest.fn();
    const { stderrTrace, hooks } = buildHooks({
      unlinkFile,
      codexAuthPath: 'C:/tmp/codex-auth.json',
    });
    const exit = await execute(
      { subcommand: 'logout', provider: 'codex' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(unlinkFile).not.toHaveBeenCalled();
    expect(stderrTrace.buffer).toContain('--force');
  });

  it('with --force: invokes unlinkFile and emits logout.complete', async () => {
    const unlinkFile = jest.fn(async () => undefined);
    const { formatterTrace, hooks } = buildHooks({
      unlinkFile,
      codexAuthPath: 'C:/tmp/codex-auth.json',
    });
    const exit = await execute(
      { subcommand: 'logout', provider: 'codex', force: true },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(unlinkFile).toHaveBeenCalledWith('C:/tmp/codex-auth.json');

    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('auth.logout.complete');
    expect(last?.params).toMatchObject({ provider: 'codex', success: true });
  });

  it('idempotent on ENOENT: still exits 0', async () => {
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    const unlinkFile = jest.fn(async () => {
      throw enoent;
    });
    const { hooks } = buildHooks({
      unlinkFile,
      codexAuthPath: 'C:/tmp/missing.json',
    });
    const exit = await execute(
      { subcommand: 'logout', provider: 'codex', force: true },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
  });

  it('non-ENOENT error: emits task.error + exit 5', async () => {
    const eperm = Object.assign(new Error('permission denied'), {
      code: 'EPERM',
    });
    const unlinkFile = jest.fn(async () => {
      throw eperm;
    });
    const { formatterTrace, hooks } = buildHooks({
      unlinkFile,
      codexAuthPath: 'C:/tmp/locked.json',
    });
    const exit = await execute(
      { subcommand: 'logout', provider: 'codex', force: true },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah auth logout (validation)', () => {
  it('missing provider: usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute({ subcommand: 'logout' }, baseGlobals, hooks);
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('provider is required');
  });

  it('unsupported provider: usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'logout', provider: 'unknown' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('unsupported provider');
  });
});

// ---------------------------------------------------------------------------
// Tests — `auth test <provider>`
// ---------------------------------------------------------------------------

describe('ptah auth test', () => {
  it('emits auth.test.result with the RPC payload + provider', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('auth:testConnection', {
      success: true,
      data: { success: true, health: { status: 'available' } },
    });

    const exit = await execute(
      { subcommand: 'test', provider: 'anthropic' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);

    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('auth.test.result');
    expect(last?.params).toMatchObject({
      provider: 'anthropic',
      success: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Unknown sub-command
// ---------------------------------------------------------------------------

describe('ptah auth (validation)', () => {
  it('unknown sub-command: usage error', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'status' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toContain('unknown sub-command');
  });
});
