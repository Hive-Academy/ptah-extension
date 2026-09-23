/**
 * Pins for the draft probe failure classifier and the write-nothing contract
 * (TASK_2026_523 plan pins 10 and 11, batch E named gaps 1 and 4).
 *
 * Gap 1: `classifyDraftProbeFailure` is a pure, exported ten-rule table with
 * first-match-wins precedence. Batch A2 left it deliberately untested so a
 * follow-up spec could exercise the table directly; this is that spec.
 *
 * Pin 10: a failed `auth:verifyDraftConnection` writes nothing anywhere —
 * the settings store, the secrets service and `process.env` stay byte-identical
 * whether the probe is rejected pre-flight or cancelled mid-flight.
 */

import 'reflect-metadata';

import type { Logger, ConfigManager, IAuthSecretsService } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockConfigManager,
  createMockAuthSecretsService,
  type MockConfigManager,
  type MockAuthSecretsService,
} from '@ptah-extension/vscode-core/testing';
import {
  InternalQueryService,
  USER_ACTION_QUERY_LANE,
  classifyThrownNetworkFailure,
  type InternalQueryConfig,
  type InternalQueryHandle,
} from '@ptah-extension/agent-sdk';
import type { AuthVerifyDraftConnectionParams } from '@ptah-extension/shared';
import { getProviderBaseUrl } from '@ptah-extension/shared';
import type { CuratorProxyManager } from './curator-proxy-manager';
import type { ProviderModelsService } from '../provider-models.service';
import type { ICopilotAuthService } from '../providers/copilot/copilot-provider.types';
import type { ICodexAuthService } from '../providers/codex/codex-provider.types';
import type { IOpenRouterAuthService } from '../providers/openrouter/openrouter-provider.types';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../providers/copilot';
import { ProviderAuthResolver } from './provider-auth-resolver';
import { ProviderQuotaStore } from './provider-quota.store';
import {
  DraftVerificationService,
  classifyDraftProbeFailure,
  type DraftProbeFailureInput,
} from './draft-verification.service';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}
function asConfig(mock: MockConfigManager): ConfigManager {
  return mock as unknown as ConfigManager;
}

/** A full evidence bundle with the quietest possible defaults. */
function input(partial: Partial<DraftProbeFailureInput>): DraftProbeFailureInput {
  return {
    thrown: undefined,
    verdict: { kind: 'undetermined' },
    resultStatus: null,
    assistantError: undefined,
    cancelled: false,
    timedOut: false,
    model: null,
    ...partial,
  };
}

describe('classifyDraftProbeFailure — the ten-rule table', () => {
  it('rule 1: our own abort wins over every other piece of evidence', () => {
    const reason = classifyDraftProbeFailure(
      input({
        cancelled: true,
        thrown: Object.assign(new Error('Unauthorized'), { status: 401 }),
        verdict: { kind: 'network-failure', signal: 'http-5xx' },
        resultStatus: 500,
      }),
    );
    expect(reason).toBe('cancelled');
  });

  it('rule 2: a ProviderQuotaError names the cooldown, not its HTTP status', () => {
    const reason = classifyDraftProbeFailure(
      input({
        thrown: Object.assign(new Error('rate limited'), {
          name: 'ProviderQuotaError',
          retryAfterMs: 4000,
        }),
        resultStatus: 429,
      }),
    );
    expect(reason).toBe('quota-exhausted');
  });

  it('rule 3: a ProviderAuthError is the resolver refusing the draft pre-flight', () => {
    const reason = classifyDraftProbeFailure(
      input({
        thrown: Object.assign(new Error('no usable credential'), {
          name: 'ProviderAuthError',
        }),
        verdict: { kind: 'network-failure', signal: 'connection' },
      }),
    );
    expect(reason).toBe('credential-rejected');
  });

  it('rule 4: a 401 on the stream result is a credential verdict, never unclassified', () => {
    expect(
      classifyDraftProbeFailure(input({ resultStatus: 401 })),
    ).toBe('credential-rejected');
  });

  it('rule 4: a 401 carried on the thrown error, through its cause chain', () => {
    const reason = classifyDraftProbeFailure(
      input({
        thrown: Object.assign(new Error('Unauthorized'), {
          cause: Object.assign(new Error('upstream'), { status: 401 }),
        }),
      }),
    );
    expect(reason).toBe('credential-rejected');
  });

  it('rule 4: a 403 is a permission verdict, not a credential one', () => {
    expect(
      classifyDraftProbeFailure(
        input({
          thrown: Object.assign(new Error('Forbidden'), { statusCode: 403 }),
        }),
      ),
    ).toBe('permission-denied');
  });

  it('rule 4: the assistant message error carries the status too', () => {
    expect(
      classifyDraftProbeFailure(
        input({ assistantError: { status: 403, message: 'denied' } }),
      ),
    ).toBe('permission-denied');
  });

  it('rule 5: a 404 means the endpoint refused the MODEL', () => {
    expect(
      classifyDraftProbeFailure(input({ resultStatus: 404 })),
    ).toBe('model-unavailable');
  });

  it('rule 5: the provider message naming the model is a model verdict even with another status', () => {
    const reason = classifyDraftProbeFailure(
      input({
        thrown: Object.assign(new Error('model xyz-model was rate limited'), {
          status: 429,
        }),
        model: 'xyz-model',
      }),
    );
    expect(reason).toBe('model-unavailable');
  });

  it('rule 5: the assistant error message names the model', () => {
    expect(
      classifyDraftProbeFailure(
        input({
          assistantError: 'requested model not found: xyz-model',
          model: 'xyz-model',
        }),
      ),
    ).toBe('model-unavailable');
  });

  it('rule 5: a message match needs a requested model; none means no match', () => {
    expect(
      classifyDraftProbeFailure(
        input({ thrown: new Error('model xyz-model is gone') }),
      ),
    ).toBe('unclassified');
  });

  it('rule 6: the stream verdict http-429 is rate-limited', () => {
    expect(
      classifyDraftProbeFailure(
        input({ verdict: { kind: 'network-failure', signal: 'http-429' } }),
      ),
    ).toBe('rate-limited');
  });

  it('rule 6: a thrown 429 is rate-limited through the network classifier', () => {
    expect(
      classifyDraftProbeFailure(
        input({
          thrown: Object.assign(new Error('Too Many Requests'), { status: 429 }),
        }),
      ),
    ).toBe('rate-limited');
  });

  it('rule 7: our own deadline is a timeout even with no other evidence', () => {
    expect(classifyDraftProbeFailure(input({ timedOut: true }))).toBe('timeout');
  });

  it('rule 7: the classifier timeout signal and a thrown 408 agree', () => {
    expect(
      classifyDraftProbeFailure(
        input({ verdict: { kind: 'network-failure', signal: 'timeout' } }),
      ),
    ).toBe('timeout');
    expect(
      classifyDraftProbeFailure(
        input({
          thrown: Object.assign(new Error('Request Timeout'), { status: 408 }),
        }),
      ),
    ).toBe('timeout');
  });

  it('rule 8: connection and dns signals are unreachable', () => {
    expect(
      classifyDraftProbeFailure(
        input({ verdict: { kind: 'network-failure', signal: 'connection' } }),
      ),
    ).toBe('unreachable');
    expect(
      classifyDraftProbeFailure(
        input({ verdict: { kind: 'network-failure', signal: 'dns' } }),
      ),
    ).toBe('unreachable');
  });

  it('rule 8: a thrown ECONNREFUSED socket code is unreachable', () => {
    const reason = classifyDraftProbeFailure(
      input({
        thrown: Object.assign(
          new Error('connect ECONNREFUSED 127.0.0.1:443'),
          { code: 'ECONNREFUSED' },
        ),
      }),
    );
    expect(reason).toBe('unreachable');
  });

  it('rule 9: a 5xx is unclassified and never a credential verdict', () => {
    expect(
      classifyDraftProbeFailure(
        input({
          verdict: { kind: 'network-failure', signal: 'http-5xx' },
        }),
      ),
    ).toBe('unclassified');
    expect(
      classifyDraftProbeFailure(
        input({
          thrown: Object.assign(new Error('Internal Server Error'), {
            status: 503,
          }),
        }),
      ),
    ).toBe('unclassified');
  });

  it('rule 10: evidence that matches nothing is unclassified', () => {
    expect(classifyDraftProbeFailure(input({}))).toBe('unclassified');
    expect(
      classifyDraftProbeFailure(
        input({ thrown: new Error('something entirely different') }),
      ),
    ).toBe('unclassified');
  });

  it('the network classifier deliberately ignores 401 and 403 — the draft classifier reads them raw', () => {
    expect(
      classifyThrownNetworkFailure(
        Object.assign(new Error('Unauthorized'), { status: 401 }),
      ),
    ).toBeNull();
    expect(
      classifyThrownNetworkFailure(
        Object.assign(new Error('Forbidden'), { status: 403 }),
      ),
    ).toBeNull();
  });
});

describe('classifyDraftProbeFailure — first match wins', () => {
  it('a 429 outranks a later deadline', () => {
    const reason = classifyDraftProbeFailure(
      input({
        verdict: { kind: 'network-failure', signal: 'http-429' },
        timedOut: true,
      }),
    );
    expect(reason).toBe('rate-limited');
  });

  it('a 401 outranks a 5xx that followed it', () => {
    const reason = classifyDraftProbeFailure(
      input({
        resultStatus: 401,
        verdict: { kind: 'network-failure', signal: 'http-5xx' },
      }),
    );
    expect(reason).toBe('credential-rejected');
  });

  it('a 403 outranks a 429 that followed it', () => {
    const reason = classifyDraftProbeFailure(
      input({
        thrown: Object.assign(new Error('Forbidden'), { statusCode: 403 }),
        verdict: { kind: 'network-failure', signal: 'http-429' },
      }),
    );
    expect(reason).toBe('permission-denied');
  });

  it('a named model beats a 429 verdict', () => {
    const reason = classifyDraftProbeFailure(
      input({
        resultStatus: 429,
        verdict: { kind: 'network-failure', signal: 'http-429' },
        assistantError: 'model xyz-model not found',
        model: 'xyz-model',
      }),
    );
    expect(reason).toBe('model-unavailable');
  });

  it('a 404 outranks a 429 verdict', () => {
    const reason = classifyDraftProbeFailure(
      input({
        resultStatus: 404,
        verdict: { kind: 'network-failure', signal: 'http-429' },
      }),
    );
    expect(reason).toBe('model-unavailable');
  });

  it('a throw is the more specific network evidence than the stream verdict', () => {
    const reason = classifyDraftProbeFailure(
      input({
        resultStatus: 429,
        thrown: Object.assign(
          new Error('connect ECONNREFUSED 127.0.0.1:443'),
          { code: 'ECONNREFUSED' },
        ),
        verdict: { kind: 'network-failure', signal: 'http-429' },
      }),
    );
    expect(reason).toBe('unreachable');
  });

  it('the resolver names outrank everything below them', () => {
    expect(
      classifyDraftProbeFailure(
        input({
          thrown: Object.assign(new Error('cooling down'), {
            name: 'ProviderQuotaError',
          }),
          resultStatus: 429,
          verdict: { kind: 'network-failure', signal: 'http-5xx' },
        }),
      ),
    ).toBe('quota-exhausted');
    expect(
      classifyDraftProbeFailure(
        input({
          thrown: Object.assign(new Error('refused'), {
            name: 'ProviderAuthError',
          }),
          timedOut: true,
        }),
      ),
    ).toBe('credential-rejected');
  });
});

/** The mock `execute` always hands back a stream that only the abort ends. */
function streamAbortedBy(controller: AbortController): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<never>> =>
        new Promise<IteratorResult<never>>((_, reject) => {
          const onAbort = (): void => {
            reject(new Error('This operation was aborted'));
          };
          if (controller.signal.aborted) {
            onAbort();
            return;
          }
          controller.signal.addEventListener('abort', onAbort, { once: true });
        }),
    }),
  };
}

interface ServiceHarness {
  service: DraftVerificationService;
  authSecrets: MockAuthSecretsService;
  config: MockConfigManager;
  execute: jest.SpyInstance<
    Promise<InternalQueryHandle>,
    [InternalQueryConfig]
  >;
  getLiveDerivedTiers: jest.Mock;
}

function createServiceHarness(
  seed: { credentials?: { apiKey?: string }; providerKeys?: Record<string, string> } = {},
): ServiceHarness {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: {} });
  const authSecrets = createMockAuthSecretsService(seed);

  const getLiveDerivedTiers = jest.fn(() => ({}) as Record<string, never>);
  const providerModels = {
    getLiveDerivedTiers,
    // Third-party draft envs layer the provider's main-agent tiers (read-only).
    getModelTiers: jest.fn(() => ({ sonnet: null, opus: null, haiku: null })),
  } as unknown as ProviderModelsService;

  const proxyManager = {
    ensureProxy: jest.fn(async () => ({
      url: 'http://127.0.0.1:51234',
      token: COPILOT_PROXY_TOKEN_PLACEHOLDER,
    })),
    isProxyProvider: jest.fn(() => true),
  } as unknown as CuratorProxyManager;
  const copilotAuth = {
    isAuthenticated: jest.fn(async () => true),
    tryRestoreAuth: jest.fn(async () => false),
  } as unknown as ICopilotAuthService;
  const codexAuth = {
    isAuthenticated: jest.fn(async () => true),
    ensureTokensFresh: jest.fn(async () => true),
  } as unknown as ICodexAuthService;
  const openRouterAuth = {
    isAuthenticated: jest.fn(async () => true),
  } as unknown as IOpenRouterAuthService;

  const resolver = new ProviderAuthResolver(
    asLogger(logger),
    asConfig(config),
    authSecrets as unknown as IAuthSecretsService,
    providerModels,
    proxyManager,
    copilotAuth,
    codexAuth,
    openRouterAuth,
    new ProviderQuotaStore(),
  );

  // The probe only ever calls `execute` on the query service; the class
  // carries private state a structural mock cannot carry, so an inert
  // instance of the real prototype gets its `execute` spied.
  const internalQuery: InternalQueryService = Object.create(
    InternalQueryService.prototype,
  ) as InternalQueryService;
  const execute = jest
    .spyOn(internalQuery, 'execute')
    .mockImplementation((probeConfig: InternalQueryConfig) => {
      const controller = probeConfig.abortController;
      if (!controller) {
        return Promise.reject(
          new Error('the draft probe always passes an abort controller'),
        );
      }
      return Promise.resolve({
        stream: streamAbortedBy(controller),
        abort: () => undefined,
        close: () => undefined,
      });
    });

  return {
    service: new DraftVerificationService(
      asLogger(logger),
      providerModels,
      resolver,
      internalQuery,
      authSecrets as unknown as IAuthSecretsService,
    ),
    authSecrets,
    config,
    execute,
    getLiveDerivedTiers,
  };
}

/** The write surfaces a failed probe must leave untouched. */
function expectNothingWritten(harness: ServiceHarness): void {
  expect(harness.authSecrets.setCredential).not.toHaveBeenCalled();
  expect(harness.authSecrets.deleteCredential).not.toHaveBeenCalled();
  expect(harness.authSecrets.setProviderKey).not.toHaveBeenCalled();
  expect(harness.authSecrets.deleteProviderKey).not.toHaveBeenCalled();
  expect(harness.config.set).not.toHaveBeenCalled();
  expect(harness.config.setTyped).not.toHaveBeenCalled();
}

describe('DraftVerificationService.verify — a failed probe writes nothing (pin 10)', () => {
  it('answers a rejected credential pre-flight without starting the probe', async () => {
    const harness = createServiceHarness();
    const envBefore = { ...process.env };

    const params: AuthVerifyDraftConnectionParams = {
      probeId: 'probe-reject',
      providerId: 'moonshot',
      authMode: 'apiKey',
      // No credential: the draft cannot produce one, the resolver refuses.
    };
    const result = await harness.service.verify(params);

    expect(result).toEqual({
      probeId: 'probe-reject',
      outcome: 'failed',
      reason: 'credential-rejected',
      detail: 'The draft is missing a usable credential for this mode.',
      latencyMs: null,
      modelUsed: null,
      checkedAt: expect.any(String),
    });
    // The probe never started.
    expect(harness.execute).not.toHaveBeenCalled();
    expectNothingWritten(harness);
    expect(harness.authSecrets.__dumpCredentials().size).toBe(0);
    expect(harness.authSecrets.__dumpProviderKeys().size).toBe(0);
    expect(process.env).toEqual(envBefore);
  });

  it('answers a cancelled mid-flight probe without persisting the draft credential', async () => {
    const harness = createServiceHarness();
    const envBefore = { ...process.env };
    const configBefore = harness.config.__snapshot();

    const params: AuthVerifyDraftConnectionParams = {
      probeId: 'probe-cancel',
      providerId: 'anthropic',
      authMode: 'apiKey',
      credential: { kind: 'apiKey', value: 'sk-ant-draft-secret' },
    };
    const pending = harness.service.verify(params);
    for (let spins = 0; spins < 50 && harness.execute.mock.calls.length === 0; spins++) {
      await Promise.resolve();
    }
    expect(harness.execute).toHaveBeenCalledTimes(1);
    // The probe exercised the DRAFT credential, not a persisted route.
    const probeConfig = harness.execute.mock.calls[0][0];
    expect(probeConfig.lane).toBe(USER_ACTION_QUERY_LANE);
    expect(probeConfig.abortController).toBeDefined();

    const cancelOutcome = harness.service.cancel({ probeId: 'probe-cancel' });
    expect(cancelOutcome).toEqual({ cancelled: true });

    const result = await pending;
    expect(result).toMatchObject({
      probeId: 'probe-cancel',
      outcome: 'cancelled',
      reason: 'cancelled',
      detail: 'The probe was cancelled.',
    });
    expect(result.modelUsed).not.toBeNull();
    expect(result.detail).not.toContain('sk-ant-draft-secret');

    expectNothingWritten(harness);
    expect(harness.authSecrets.__dumpCredentials().size).toBe(0);
    expect(harness.authSecrets.__dumpProviderKeys().size).toBe(0);
    expect(harness.config.__snapshot()).toEqual(configBefore);
    expect(process.env).toEqual(envBefore);

    // The entry is gone: a second cancel answers false.
    expect(harness.service.cancel({ probeId: 'probe-cancel' })).toEqual({
      cancelled: false,
    });
  });

  it('rejects with explicit validation error when baseUrl is defined but not a string', async () => {
    const harness = createServiceHarness();
    const params = {
      probeId: 'probe-bad-baseurl',
      providerId: 'ollama',
      authMode: 'local-native',
      baseUrl: 12345 as unknown as string,
    } as unknown as AuthVerifyDraftConnectionParams;

    await expect(harness.service.verify(params)).rejects.toThrow(
      'auth:verifyDraftConnection: baseUrl must be a string',
    );
  });
});
// TASK_2026_534 B2-1: Manage / Edit verifies the key the host already holds.
describe('DraftVerificationService.verify — stored credential (B2-1)', () => {
  async function startAndCancel(
    harness: ServiceHarness,
    params: AuthVerifyDraftConnectionParams,
  ): Promise<{ result: Awaited<ReturnType<DraftVerificationService['verify']>>; probeAuth: unknown }> {
    const pending = harness.service.verify(params);
    for (let spins = 0; spins < 50 && harness.execute.mock.calls.length === 0; spins++) {
      await Promise.resolve();
    }
    const probeAuth = harness.execute.mock.calls[0]?.[0].auth;
    harness.service.cancel({ probeId: params.probeId });
    return { result: await pending, probeAuth };
  }

  it('probes a third-party provider with its stored key and writes nothing anywhere', async () => {
    const harness = createServiceHarness({ providerKeys: { moonshot: 'sk-stored-moonshot' } });
    const envBefore = { ...process.env };
    const configBefore = harness.config.__snapshot();
    const secretsBefore = [...harness.authSecrets.__dumpProviderKeys()];

    const { result, probeAuth } = await startAndCancel(harness, {
      probeId: 'probe-stored',
      providerId: 'moonshot',
      authMode: 'apiKey',
      credential: { kind: 'stored' },
    });

    // The stored key reached ONLY the per-call override handed to the runner.
    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(probeAuth)).toContain('sk-stored-moonshot');
    // It never comes back over the wire.
    expect(JSON.stringify(result)).not.toContain('sk-stored-moonshot');
    // Isolation: env, settings and secrets identical before/after.
    expect(process.env).toEqual(envBefore);
    expect(harness.config.__snapshot()).toEqual(configBefore);
    expect([...harness.authSecrets.__dumpProviderKeys()]).toEqual(secretsBefore);
    expectNothingWritten(harness);
  });

  it('reads the Anthropic apiKey credential for the direct Claude API', async () => {
    const harness = createServiceHarness({ credentials: { apiKey: 'sk-ant-stored' } });
    const { probeAuth } = await startAndCancel(harness, {
      probeId: 'probe-stored-anthropic',
      providerId: 'anthropic',
      authMode: 'apiKey',
      credential: { kind: 'stored' },
    });
    expect(JSON.stringify(probeAuth)).toContain('sk-ant-stored');
    expect(harness.authSecrets.getProviderKey).not.toHaveBeenCalled();
    expectNothingWritten(harness);
  });

  it('answers a typed no-stored-credential result instead of throwing', async () => {
    const harness = createServiceHarness();
    const result = await harness.service.verify({
      probeId: 'probe-none',
      providerId: 'moonshot',
      authMode: 'apiKey',
      credential: { kind: 'stored' },
    });
    expect(result).toEqual({
      probeId: 'probe-none',
      outcome: 'failed',
      reason: 'no-stored-credential',
      detail: 'No key is stored for this provider. Enter a key to verify.',
      latencyMs: null,
      modelUsed: null,
      checkedAt: expect.any(String),
    });
    expect(harness.execute).not.toHaveBeenCalled();
    expectNothingWritten(harness);
  });

  // Review round 2, N1: a stored key only travels to the endpoint it was saved for.
  it.each([
    ['a foreign base URL on a registry provider', {
      providerId: 'moonshot', authMode: 'apiKey', baseUrl: 'https://provider-b.invalid',
    }],
    ['custom mode on a registry provider', {
      providerId: 'moonshot', authMode: 'custom', baseUrl: 'https://provider-b.invalid',
    }],
    ['custom mode on the direct Claude API', {
      providerId: 'anthropic', authMode: 'custom', baseUrl: 'https://provider-b.invalid',
    }],
    ['any base URL on the direct Claude API', {
      providerId: 'anthropic', authMode: 'apiKey', baseUrl: 'https://api.anthropic.com',
    }],
  ] as const)('refuses %s before the stored key is read', async (_label, target) => {
    const harness = createServiceHarness({
      providerKeys: { moonshot: 'sk-stored-moonshot' },
      credentials: { apiKey: 'sk-ant-stored' },
    });
    const result = await harness.service.verify({
      probeId: 'probe-bound',
      ...target,
      credential: { kind: 'stored' },
    });
    expect(result).toMatchObject({ outcome: 'failed', reason: 'stored-credential-mismatch' });
    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.authSecrets.getProviderKey).not.toHaveBeenCalled();
    expect(harness.authSecrets.getCredential).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/sk-(stored|ant)/);
    expectNothingWritten(harness);
  });

  it('accepts the saved endpoint (trailing slash ignored) and probes only that endpoint', async () => {
    const harness = createServiceHarness({ providerKeys: { moonshot: 'sk-stored-moonshot' } });
    const { probeAuth } = await startAndCancel(harness, {
      probeId: 'probe-saved-url',
      providerId: 'moonshot',
      authMode: 'apiKey',
      baseUrl: 'https://api.moonshot.ai/anthropic',
      credential: { kind: 'stored' },
    });
    const serialized = JSON.stringify(probeAuth);
    expect(serialized).toContain('sk-stored-moonshot');
    expect(serialized).toContain('https://api.moonshot.ai/anthropic/');
    expect(serialized).not.toContain('provider-b.invalid');
  });

  // Round 3, N4: local modes only attach a key on the draft-URL branch, so the
  // binding must keep the SAVED URL or the stored key silently drops out.
  it.each(['local-native', 'local-proxy'] as const)(
    'keeps the stored key for %s by probing the saved endpoint',
    async (authMode) => {
      const saved = getProviderBaseUrl('ollama-cloud');
      const harness = createServiceHarness({ providerKeys: { 'ollama-cloud': 'sk-stored-ollama' } });
      const { probeAuth } = await startAndCancel(harness, {
        probeId: `probe-${authMode}`,
        providerId: 'ollama-cloud',
        authMode,
        credential: { kind: 'stored' },
      });
      const serialized = JSON.stringify(probeAuth);
      expect(serialized).toContain('sk-stored-ollama');
      expect(serialized).toContain(saved);
      expectNothingWritten(harness);
    },
  );

  it('rejects a stored credential for modes that carry no key', async () => {
    const harness = createServiceHarness({ providerKeys: { 'github-copilot': 'x' } });
    await expect(
      harness.service.verify({
        probeId: 'probe-oauth',
        providerId: 'github-copilot',
        authMode: 'oauth',
        credential: { kind: 'stored' },
      }),
    ).rejects.toThrow('key-carrying modes only');
  });
});
