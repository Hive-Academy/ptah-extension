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
//
// `ANTHROPIC_PROVIDERS` is consumed transitively by `auth-rpc.schema.ts`
// (`ANTHROPIC_PROVIDERS.map(p => p.id)` at module load → Zod enum). The
// fixture lives in `test-utils/agent-sdk-mock.ts` so it stays in sync with
// `settings.spec.ts` and is type-anchored against the real registry shape.
// `require()` is used inside the factory because jest hoists `jest.mock`
// above module-scope `import` statements.
jest.mock(
  '@ptah-extension/agent-sdk',
  () => {
    const {
      mockAnthropicProviders,
    } = require('../../test-utils/agent-sdk-mock');
    return {
      SDK_TOKENS: {
        SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth'),
        SDK_CLI_DETECTOR: Symbol.for('SdkCliDetector'),
      },
      ANTHROPIC_PROVIDERS: mockAnthropicProviders(),
      // Stub: tests inject `spawnCodexLogin` via hooks, so the real
      // `spawnCli` is never reached. We only need a callable export so
      // the value import in `auth.ts` resolves at module load.
      spawnCli: jest.fn(),
    };
  },
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
    // The `resolveCopilotAuth` hook returns a vanilla stub so the scripted
    // `runHeadlessLogin` mock is what actually executes.
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
  // Helper — produces a fake CodexChildLike whose stdout emits a single
  // chunk and which exits with the supplied code on the next tick.
  function makeCodexChild(opts: {
    stdoutChunks?: string[];
    stderrChunks?: string[];
    exitCode?: number | null;
    fireError?: Error;
  }): {
    child: import('./auth.js').CodexChildLike;
    killed: jest.Mock;
  } {
    const exitListeners: Array<(code: number | null) => void> = [];
    const errorListeners: Array<(err: Error) => void> = [];
    const stdoutDataListeners: Array<(chunk: Buffer | string) => void> = [];
    const stderrDataListeners: Array<(chunk: Buffer | string) => void> = [];
    const killed = jest.fn(() => true);
    const child: import('./auth.js').CodexChildLike = {
      on: ((event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'exit' || event === 'close') {
          exitListeners.push(listener as (code: number | null) => void);
        } else if (event === 'error') {
          errorListeners.push(listener as (err: Error) => void);
        }
        return child;
      }) as import('./auth.js').CodexChildLike['on'],
      stdout: {
        on(event: string, listener: (chunk: Buffer | string) => void) {
          if (event === 'data') stdoutDataListeners.push(listener);
          return this;
        },
      } as unknown as NodeJS.ReadableStream,
      stderr: {
        on(event: string, listener: (chunk: Buffer | string) => void) {
          if (event === 'data') stderrDataListeners.push(listener);
          return this;
        },
      } as unknown as NodeJS.ReadableStream,
      kill: killed,
    };

    // After listeners are wired, fire scripted output / exit on next tick.
    setImmediate(() => {
      for (const chunk of opts.stdoutChunks ?? []) {
        for (const l of stdoutDataListeners) l(chunk);
      }
      for (const chunk of opts.stderrChunks ?? []) {
        for (const l of stderrDataListeners) l(chunk);
      }
      if (opts.fireError) {
        for (const l of errorListeners) l(opts.fireError);
      } else {
        const code = opts.exitCode ?? 0;
        for (const l of exitListeners) l(code);
      }
    });

    return { child, killed };
  }

  it('emits auth.login.url with the device-code URL and auth.login.complete on exit 0', async () => {
    const { child } = makeCodexChild({
      stdoutChunks: [
        'Visit https://platform.openai.com/device-auth?code=ABC-123 to continue\n',
      ],
      exitCode: 0,
    });
    const spawnCodexLogin = jest.fn(() => child);
    const { formatterTrace, hooks } = buildHooks({
      spawnCodexLogin,
    });

    const exit = await execute(
      { subcommand: 'login', provider: 'codex' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(spawnCodexLogin).toHaveBeenCalledWith(
      'codex',
      ['login', '--device-auth'],
      expect.objectContaining({ env: expect.any(Object) }),
    );

    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'auth.login.start',
      'auth.login.url',
      'auth.login.complete',
    ]);

    const urlNotification = formatterTrace.notifications[1]?.params as Record<
      string,
      unknown
    >;
    expect(urlNotification?.['provider']).toBe('codex');
    expect(urlNotification?.['verification_uri']).toBe(
      'https://platform.openai.com/device-auth?code=ABC-123',
    );
  });

  it('emits task.error and returns AuthRequired on non-zero exit', async () => {
    const { child } = makeCodexChild({ exitCode: 7 });
    const spawnCodexLogin = jest.fn(() => child);
    const { formatterTrace, hooks } = buildHooks({ spawnCodexLogin });

    const exit = await execute(
      { subcommand: 'login', provider: 'codex' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.AuthRequired);

    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({
      provider: 'codex',
      ptah_code: 'auth_required',
    });
  });

  it('propagates SIGINT to the child', async () => {
    // Don't fire exit immediately; wait for SIGINT.
    const exitListeners: Array<(code: number | null) => void> = [];
    const killed = jest.fn(() => {
      // Simulate kill triggering exit.
      setImmediate(() => exitListeners.forEach((l) => l(130)));
      return true;
    });
    const child: import('./auth.js').CodexChildLike = {
      on: ((event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'exit' || event === 'close') {
          exitListeners.push(listener as (code: number | null) => void);
        }
        return child;
      }) as import('./auth.js').CodexChildLike['on'],
      stdout: null,
      stderr: null,
      kill: killed,
    };
    const spawnCodexLogin = jest.fn(() => child);

    // Use a custom EventEmitter as the SIGINT source so tests don't pollute
    // the real `process` event loop.
    const { EventEmitter } = await import('node:events');
    const sigintSource = new EventEmitter();

    const { hooks } = buildHooks({
      spawnCodexLogin,
      processRefForCodex: sigintSource,
    });

    // Fire SIGINT after a short delay so the spawn logic can attach its
    // listener before we trigger.
    setImmediate(() => sigintSource.emit('SIGINT'));

    const exit = await execute(
      { subcommand: 'login', provider: 'codex' },
      baseGlobals,
      hooks,
    );

    expect(killed).toHaveBeenCalledWith('SIGINT');
    expect(exit).toBe(ExitCode.AuthRequired);
  });

  it('emits task.error if spawn throws', async () => {
    const spawnCodexLogin = jest.fn(() => {
      throw new Error('ENOENT: codex not found');
    });
    const { formatterTrace, hooks } = buildHooks({ spawnCodexLogin });

    const exit = await execute(
      { subcommand: 'login', provider: 'codex' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.AuthRequired);
    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({
      provider: 'codex',
      ptah_code: 'auth_required',
    });
  });
});

describe('ptah auth login claude-cli', () => {
  function makeDetector(
    health: import('@ptah-extension/shared').ClaudeCliHealth,
  ): import('@ptah-extension/agent-sdk').ClaudeCliDetector {
    return {
      performHealthCheck: jest.fn(async () => health),
    } as unknown as import('@ptah-extension/agent-sdk').ClaudeCliDetector;
  }

  it('writes authMethod=claudeCli on success and emits auth.login.complete', async () => {
    const setConfiguration = jest.fn(async () => undefined);
    const detector = makeDetector({
      available: true,
      path: '/usr/local/bin/claude',
      version: '1.2.3',
      platform: 'linux',
      isWSL: false,
    });
    const { formatterTrace, hooks } = buildHooks({
      resolveClaudeCliDetector: () => detector,
      resolveWorkspaceProvider: () => ({ setConfiguration }),
    });

    const exit = await execute(
      { subcommand: 'login', provider: 'claude-cli' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'authMethod',
      'claudeCli',
    );

    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual(['auth.login.start', 'auth.login.complete']);
    const complete = formatterTrace.notifications.at(-1)?.params as Record<
      string,
      unknown
    >;
    expect(complete).toMatchObject({
      provider: 'claude-cli',
      success: true,
      authMethod: 'claudeCli',
      cliPath: '/usr/local/bin/claude',
      cliVersion: '1.2.3',
    });
  });

  it('aliases `claude` to claude-cli', async () => {
    const setConfiguration = jest.fn(async () => undefined);
    const detector = makeDetector({
      available: true,
      path: '/usr/local/bin/claude',
      platform: 'linux',
      isWSL: false,
    });
    const { hooks } = buildHooks({
      resolveClaudeCliDetector: () => detector,
      resolveWorkspaceProvider: () => ({ setConfiguration }),
    });

    const exit = await execute(
      { subcommand: 'login', provider: 'claude' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'authMethod',
      'claudeCli',
    );
  });

  it('emits task.error{ ptah_code: claude_cli_not_found } and returns UsageError when CLI is missing', async () => {
    const setConfiguration = jest.fn(async () => undefined);
    const detector = makeDetector({
      available: false,
      error: 'Claude CLI not found in system',
      platform: 'linux',
      isWSL: false,
    });
    const { formatterTrace, stderrTrace, hooks } = buildHooks({
      resolveClaudeCliDetector: () => detector,
      resolveWorkspaceProvider: () => ({ setConfiguration }),
    });

    const exit = await execute(
      { subcommand: 'login', provider: 'claude-cli' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(setConfiguration).not.toHaveBeenCalled();

    const last = formatterTrace.notifications.at(-1);
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({
      provider: 'claude-cli',
      ptah_code: 'claude_cli_not_found',
    });
    expect(stderrTrace.buffer).toContain('Claude CLI not found');
  });

  it('emits task.error{ ptah_code: claude_cli_not_found } when health check throws', async () => {
    const detector = {
      performHealthCheck: jest.fn(async () => {
        throw new Error('detector exploded');
      }),
    } as unknown as import('@ptah-extension/agent-sdk').ClaudeCliDetector;
    const setConfiguration = jest.fn(async () => undefined);
    const { formatterTrace, hooks } = buildHooks({
      resolveClaudeCliDetector: () => detector,
      resolveWorkspaceProvider: () => ({ setConfiguration }),
    });

    const exit = await execute(
      { subcommand: 'login', provider: 'claude-cli' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(setConfiguration).not.toHaveBeenCalled();
    const last = formatterTrace.notifications.at(-1);
    expect(last?.params).toMatchObject({
      ptah_code: 'claude_cli_not_found',
    });
  });
});

describe('ptah auth login anthropic', () => {
  it('prints "use provider set-key" instruction, exits 0', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'login', provider: 'anthropic' },
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(stderrTrace.buffer).toContain(
      'ptah provider set-key --provider anthropic',
    );
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
