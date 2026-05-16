/**
 * Unit tests for `ptah doctor`.
 *
 * Exercises:
 *   - The full happy-path snapshot (license + auth + providers + effective)
 *   - Provider probe routing (apiKey / oauth / local-native / cli)
 *   - The pure `resolveEffectiveAuthRoute` decision table
 *   - Defensive expiry forwarding into `report.license.expiryWarning`
 */

import { execute, resolveEffectiveAuthRoute } from './doctor.js';
import type { DoctorExecuteHooks, DoctorProviderEntry } from './doctor.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';

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

interface ScriptedRpc {
  method: string;
  response:
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string };
}

interface MockEngine {
  withEngine: DoctorExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedRpc['response']>;
  resolved: Map<symbol | string, unknown>;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const resolved: MockEngine['resolved'] = new Map();

  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const r = scripted.get(method);
      if (r) return r;
      return { success: true, data: null };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn((token: symbol | string) => {
      const entry = resolved.get(token);
      if (entry === undefined) {
        throw new Error(`unscripted DI token: ${String(token)}`);
      }
      return entry;
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
  }) as unknown as DoctorExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted, resolved };
}

describe('ptah doctor', () => {
  it('emits a doctor.report with license, auth, providers, and effective fields', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();

    engine.scripted.set('license:getStatus', {
      success: true,
      data: {
        tier: 'pro',
        valid: true,
        daysRemaining: 8,
        expiryWarning: 'near_expiry',
      },
    });
    engine.scripted.set('auth:getAuthStatus', {
      success: true,
      data: {
        authMethod: 'apiKey',
        anthropicProviderId: null,
      },
    });
    engine.scripted.set('llm:getDefaultProvider', {
      success: true,
      data: { provider: 'anthropic' },
    });
    engine.scripted.set('llm:getProviderStatus', {
      success: true,
      data: {
        providers: [
          {
            name: 'anthropic',
            authType: 'apiKey',
            hasApiKey: true,
            isLocal: false,
            requiresProxy: false,
            baseUrl: null,
          },
          {
            name: 'github-copilot',
            authType: 'oauth',
            hasApiKey: false,
            isLocal: false,
            requiresProxy: true,
            baseUrl: null,
          },
          {
            name: 'ollama',
            authType: 'none',
            hasApiKey: false,
            isLocal: true,
            requiresProxy: false,
            baseUrl: 'http://localhost:11434',
          },
        ],
      },
    });
    engine.scripted.set('auth:getHealth', {
      success: true,
      data: { copilotAuthenticated: false, codexAuthenticated: false },
    });

    // ClaudeCliDetector stub registered against the canonical SDK token so
    // the doctor's `container.resolve(SDK_TOKENS.SDK_CLI_DETECTOR)` finds it.
    const detectorStub = {
      performHealthCheck: jest.fn(async () => ({
        available: true,
        path: '/usr/local/bin/claude',
        version: '1.0.0',
        platform: 'linux',
        isWSL: false,
      })),
    };
    engine.resolved.set(SDK_TOKENS.SDK_CLI_DETECTOR, detectorStub);

    const probeLocal = jest.fn(async () => 'reachable' as const);

    const exit = await execute({}, baseGlobals, {
      formatter: formatterTrace.formatter,
      withEngine: engine.withEngine,
      probeLocal,
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    });

    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications).toHaveLength(1);
    const note = formatterTrace.notifications[0];
    expect(note.method).toBe('doctor.report');

    const report = note.params as {
      license: Record<string, unknown>;
      auth: Record<string, unknown>;
      providers: DoctorProviderEntry[];
      effective: { route: string; ready: boolean; blockers: string[] };
      timestamp: string;
    };
    expect(report.license).toMatchObject({
      tier: 'pro',
      valid: true,
      daysRemaining: 8,
      expiryWarning: 'near_expiry',
    });
    expect(report.auth).toMatchObject({
      authMethod: 'apiKey',
      defaultProvider: 'anthropic',
      anthropicProviderId: null,
    });
    expect(report.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'anthropic',
          type: 'apiKey',
          status: 'connected',
        }),
        expect.objectContaining({
          id: 'github-copilot',
          type: 'oauth',
          status: 'unauthenticated',
        }),
        expect.objectContaining({
          id: 'ollama',
          type: 'local-native',
          status: 'reachable',
        }),
        expect.objectContaining({
          id: 'claude-cli',
          type: 'cli',
          status: 'connected',
        }),
      ]),
    );
    expect(report.effective.route).toBe('api-key');
    expect(report.effective.ready).toBe(true);
    expect(report.effective.blockers).toEqual([]);
    expect(report.timestamp).toBe('2026-05-04T00:00:00.000Z');
    expect(probeLocal).toHaveBeenCalledWith('http://localhost:11434');
  });
});

describe('ptah doctor — local provider probe verdicts', () => {
  it('maps ECONNREFUSED → status="not-installed" for local providers', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();

    engine.scripted.set('license:getStatus', {
      success: true,
      data: { tier: 'free', valid: true, daysRemaining: null },
    });
    engine.scripted.set('auth:getAuthStatus', {
      success: true,
      data: { authMethod: 'apiKey', anthropicProviderId: null },
    });
    engine.scripted.set('llm:getDefaultProvider', {
      success: true,
      data: { provider: 'anthropic' },
    });
    engine.scripted.set('llm:getProviderStatus', {
      success: true,
      data: {
        providers: [
          {
            name: 'ollama',
            authType: 'none',
            hasApiKey: false,
            isLocal: true,
            requiresProxy: false,
            baseUrl: 'http://localhost:11434',
          },
        ],
      },
    });
    engine.scripted.set('auth:getHealth', {
      success: true,
      data: { copilotAuthenticated: false, codexAuthenticated: false },
    });

    const detectorStub = {
      performHealthCheck: jest.fn(async () => ({
        available: false,
        path: '',
        version: '',
        platform: 'linux',
        isWSL: false,
      })),
    };
    engine.resolved.set(SDK_TOKENS.SDK_CLI_DETECTOR, detectorStub);

    // probeLocal stub that simulates the production path — fetch rejects with
    // an Error whose .cause = { code: 'ECONNREFUSED' }. The doctor's default
    // probe maps this directly to 'not-installed'.
    const probeLocal = jest.fn(async () => 'not-installed' as const);

    const exit = await execute({}, baseGlobals, {
      formatter: formatterTrace.formatter,
      withEngine: engine.withEngine,
      probeLocal,
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    });

    expect(exit).toBe(ExitCode.Success);
    const note = formatterTrace.notifications[0];
    const report = note.params as { providers: DoctorProviderEntry[] };
    expect(report.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ollama',
          type: 'local-native',
          status: 'not-installed',
        }),
      ]),
    );
  });

  it('maps generic network failure → status="unknown"', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();

    engine.scripted.set('license:getStatus', {
      success: true,
      data: { tier: 'free', valid: true, daysRemaining: null },
    });
    engine.scripted.set('auth:getAuthStatus', {
      success: true,
      data: { authMethod: 'apiKey', anthropicProviderId: null },
    });
    engine.scripted.set('llm:getDefaultProvider', {
      success: true,
      data: { provider: 'anthropic' },
    });
    engine.scripted.set('llm:getProviderStatus', {
      success: true,
      data: {
        providers: [
          {
            name: 'ollama',
            authType: 'none',
            hasApiKey: false,
            isLocal: true,
            requiresProxy: false,
            baseUrl: 'http://localhost:11434',
          },
        ],
      },
    });
    engine.scripted.set('auth:getHealth', {
      success: true,
      data: { copilotAuthenticated: false, codexAuthenticated: false },
    });

    const detectorStub = {
      performHealthCheck: jest.fn(async () => ({
        available: false,
        path: '',
        version: '',
        platform: 'linux',
        isWSL: false,
      })),
    };
    engine.resolved.set(SDK_TOKENS.SDK_CLI_DETECTOR, detectorStub);

    // Timeout / DNS / generic failures bucket into 'unknown'.
    const probeLocal = jest.fn(async () => 'unknown' as const);

    const exit = await execute({}, baseGlobals, {
      formatter: formatterTrace.formatter,
      withEngine: engine.withEngine,
      probeLocal,
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    });

    expect(exit).toBe(ExitCode.Success);
    const note = formatterTrace.notifications[0];
    const report = note.params as { providers: DoctorProviderEntry[] };
    expect(report.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ollama',
          type: 'local-native',
          status: 'unknown',
        }),
      ]),
    );
  });
});

describe('resolveEffectiveAuthRoute', () => {
  const apiKeyProvider: DoctorProviderEntry = {
    id: 'anthropic',
    type: 'apiKey',
    status: 'connected',
  };
  const apiKeyMissing: DoctorProviderEntry = {
    id: 'anthropic',
    type: 'apiKey',
    status: 'needs-key',
  };
  const oauthCopilot: DoctorProviderEntry = {
    id: 'github-copilot',
    type: 'oauth',
    status: 'connected',
  };
  const oauthCopilotUnauth: DoctorProviderEntry = {
    id: 'github-copilot',
    type: 'oauth',
    status: 'unauthenticated',
  };
  const cliConnected: DoctorProviderEntry = {
    id: 'claude-cli',
    type: 'cli',
    status: 'connected',
  };
  const cliMissing: DoctorProviderEntry = {
    id: 'claude-cli',
    type: 'cli',
    status: 'missing',
  };

  it('routes apiKey to api-key strategy when key is present', () => {
    const r = resolveEffectiveAuthRoute(
      {
        authMethod: 'apiKey',
        defaultProvider: 'anthropic',
        anthropicProviderId: null,
      },
      [apiKeyProvider],
    );
    expect(r.route).toBe('api-key');
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('flags missing API key as a blocker', () => {
    const r = resolveEffectiveAuthRoute(
      {
        authMethod: 'apiKey',
        defaultProvider: 'anthropic',
        anthropicProviderId: null,
      },
      [apiKeyMissing],
    );
    expect(r.ready).toBe(false);
    expect(r.blockers[0]).toMatch(/no API key/);
  });

  it('routes oauth thirdParty to oauth-proxy strategy', () => {
    const r = resolveEffectiveAuthRoute(
      {
        authMethod: 'oauth',
        defaultProvider: 'anthropic',
        anthropicProviderId: 'github-copilot',
      },
      [oauthCopilot],
    );
    expect(r.route).toBe('oauth-proxy');
    expect(r.ready).toBe(true);
  });

  it('flags oauth unauthenticated as a blocker', () => {
    const r = resolveEffectiveAuthRoute(
      {
        authMethod: 'oauth',
        defaultProvider: 'anthropic',
        anthropicProviderId: 'github-copilot',
      },
      [oauthCopilotUnauth],
    );
    expect(r.ready).toBe(false);
    expect(r.blockers.some((b) => b.includes('not authenticated'))).toBe(true);
  });

  it('routes claude-cli (kebab) and claudeCli (legacy) to cli strategy', () => {
    for (const method of ['claude-cli', 'claudeCli']) {
      const r = resolveEffectiveAuthRoute(
        {
          authMethod: method,
          defaultProvider: 'anthropic',
          anthropicProviderId: null,
        },
        [cliConnected],
      );
      expect(r.route).toBe('cli');
      expect(r.ready).toBe(true);
    }
  });

  it('flags missing claude-cli as a blocker', () => {
    const r = resolveEffectiveAuthRoute(
      {
        authMethod: 'claude-cli',
        defaultProvider: 'anthropic',
        anthropicProviderId: null,
      },
      [cliMissing],
    );
    expect(r.ready).toBe(false);
    expect(r.blockers.some((b) => b.includes('Claude CLI'))).toBe(true);
  });

  it('returns unresolved when authMethod is unset', () => {
    const r = resolveEffectiveAuthRoute(
      {
        authMethod: null,
        defaultProvider: null,
        anthropicProviderId: null,
      },
      [],
    );
    expect(r.route).toBe('unresolved');
    expect(r.ready).toBe(false);
  });
});
