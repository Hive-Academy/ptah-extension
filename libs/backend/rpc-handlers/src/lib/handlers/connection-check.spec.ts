/**
 * ConnectionChecker — explicit check of a saved connection (TASK_2026_555 Batch 28c, Task 28c.2).
 */

import 'reflect-metadata';

import type { IAuthSecretsService, Logger } from '@ptah-extension/vscode-core';
import { createMockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  clearCustomProviderEntries,
  setCustomProviderEntries,
} from '@ptah-extension/shared';
import type {
  AuthVerifyDraftConnectionParams,
  AuthVerifyDraftConnectionResult,
} from '@ptah-extension/shared';
import { DraftVerificationService } from '@ptah-extension/auth-providers';
import type { KimiCodeAuthStatus } from '@ptah-extension/auth-providers';
import type { InternalQueryService } from '@ptah-extension/agent-sdk';

import { createFakeKimiCodeAuth } from '../../test-utils/kimi-code-fakes';
import { ConnectionCheckRecorder } from '../utils/connection-check-recorder';
import {
  probeCustomProvider,
  type CustomProviderProbeResult,
} from '../utils/custom-provider-probe';
import {
  ConnectionChecker,
  connectionCheckKind,
  customProbeCheckRecord,
} from './connection-check';

jest.mock('../utils/custom-provider-probe', () => ({
  ...jest.requireActual('../utils/custom-provider-probe'),
  probeCustomProvider: jest.fn(),
}));
const probeMock = probeCustomProvider as jest.MockedFunction<
  typeof probeCustomProvider
>;

const GATEWAY = {
  id: 'my-gateway',
  name: 'My Gateway',
  baseUrl: 'https://gateway.example.com',
  lane: 'anthropic',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  keyPrefix: '',
  helpUrl: '',
  createdAt: '2026-08-12T00:00:00.000Z',
};

const KEY = 'Mk7Nb3Vc9Xz1Lq5Wp8Er2Ty6'; // never expected anywhere in output

function draftResult(
  fields: Partial<AuthVerifyDraftConnectionResult>,
): AuthVerifyDraftConnectionResult {
  return {
    probeId: 'p',
    outcome: 'verified',
    reason: null,
    detail: null,
    latencyMs: 92,
    modelUsed: 'kimi-k2',
    checkedAt: '2026-10-01T00:00:00.000Z',
    ...fields,
  };
}

function makeChecker(
  overrides: {
    verify?: jest.Mock;
    copilot?: boolean;
    codex?: { authenticated: boolean; stale: boolean };
    cli?: boolean;
    kimi?: Partial<KimiCodeAuthStatus>;
  } = {},
) {
  const recorder = new ConnectionCheckRecorder();
  const logger = createMockLogger();
  const verify = overrides.verify ?? jest.fn(async () => draftResult({}));
  const copilotAuth = {
    isAuthenticated: jest.fn(async () => overrides.copilot ?? true),
  };
  const codexAuth = {
    getTokenStatus: jest.fn(
      async () => overrides.codex ?? { authenticated: true, stale: false },
    ),
    clearCache: jest.fn(),
  };
  const cliDetector = {
    performHealthCheck: jest.fn(async () => ({
      available: overrides.cli ?? true,
      lastCheck: 0,
    })),
  };
  const readProviderKey = jest.fn(async () => KEY);
  const kimiCodeAuth = createFakeKimiCodeAuth(overrides.kimi);
  const checker = new ConnectionChecker({
    recorder,
    draftVerification: { verify } as never,
    copilotAuth: copilotAuth as never,
    codexAuth: codexAuth as never,
    cliDetector: cliDetector as never,
    kimiCodeAuth,
    readProviderKey,
    logger: logger as unknown as Logger,
  });
  return {
    checker,
    recorder,
    readProviderKey,
    logger,
    verify,
    copilotAuth,
    codexAuth,
    cliDetector,
    kimiCodeAuth,
  };
}

afterEach(() => clearCustomProviderEntries());

describe('connectionCheckKind', () => {
  it.each([
    ['anthropic', 'apiKey'],
    ['kimi-code', 'kimi-code'],
    ['z-ai', 'apiKey'],
    ['openrouter', 'apiKey'],
    ['github-copilot', 'copilot'],
    ['openai-codex', 'codex'],
    ['claude-cli', 'claude-cli'],
    ['ollama', null],
    ['lm-studio', null],
    ['ollama-cloud', null],
    ['no-such-provider', undefined],
  ])('%s → %s', (id, kind) => {
    expect(connectionCheckKind(id)).toBe(kind);
  });

  it('a saved custom entry is checked as custom', () => {
    setCustomProviderEntries([
      {
        id: 'my-gateway',
        name: 'My Gateway',
        baseUrl: 'https://gateway.example.com',
        lane: 'anthropic',
        authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
        keyPrefix: '',
        helpUrl: '',
        createdAt: '2026-08-12T00:00:00.000Z',
      },
    ] as never);
    expect(connectionCheckKind('my-gateway')).toBe('custom');
  });
});

describe('ConnectionChecker — key-carrying connections', () => {
  it('runs the stored-key probe against the saved endpoint and records status, latency and time', async () => {
    const { checker, recorder, verify } = makeChecker();

    const result = await checker.check('kimi-code', 'apiKey');

    const params = verify.mock.calls[0][0] as AuthVerifyDraftConnectionParams;
    expect(params).toEqual({
      probeId: expect.stringMatching(/^connection-check:kimi-code:\d+$/),
      providerId: 'kimi-code',
      authMode: 'apiKey',
      credential: { kind: 'stored' },
    });
    // No base URL and no model: bound to the saved endpoint, default (smallest existing) probe.
    expect(params).not.toHaveProperty('baseUrl');
    expect(params).not.toHaveProperty('model');
    expect(result).toEqual({
      status: 'verified',
      reason: null,
      latencyMs: 92,
      checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(recorder.get('kimi-code')).toBe(result);
  });

  it('custom entries run the same probe as provider:testCustomEntry, never the draft probe (M-1)', async () => {
    setCustomProviderEntries([GATEWAY] as never);
    probeMock.mockResolvedValueOnce({
      ok: true,
      message: 'ok',
      latencyMs: 91.6,
    });
    const { checker, verify, readProviderKey, recorder } = makeChecker();

    const result = await checker.check('my-gateway', 'custom');

    expect(verify).not.toHaveBeenCalled();
    expect(readProviderKey).toHaveBeenCalledWith('my-gateway');
    expect(probeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'my-gateway' }),
      KEY,
    );
    expect(result).toMatchObject({
      status: 'verified',
      reason: null,
      latencyMs: 92,
    });
    expect(recorder.get('my-gateway')).toBe(result);
  });

  it('a gateway without tool support fails auth:checkConnection the same way it fails provider:testCustomEntry (M-1)', async () => {
    setCustomProviderEntries([GATEWAY] as never);
    const toolless: CustomProviderProbeResult = {
      ok: false,
      message: 'no tools',
      failure: 'no-tool-support',
      latencyMs: 300,
    };
    probeMock.mockResolvedValueOnce(toolless);
    const { checker } = makeChecker();

    const viaCheck = await checker.check('my-gateway', 'custom');

    const { checkedAt: _a, ...check } = viaCheck;
    const { checkedAt: _b, ...test } = customProbeCheckRecord(toolless);
    expect(check).toEqual(test);
    expect(check).toEqual({
      status: 'failed',
      reason: 'unclassified',
      latencyMs: null,
    });
  });

  it('a custom-entry probe that throws records failed/unclassified', async () => {
    setCustomProviderEntries([GATEWAY] as never);
    probeMock.mockRejectedValueOnce(new Error('socket hang up ' + KEY));
    const { checker } = makeChecker();
    expect(await checker.check('my-gateway', 'custom')).toMatchObject({
      status: 'failed',
      reason: 'unclassified',
      latencyMs: null,
    });
  });
  it('a failed probe records its reason with latencyMs: null and drops the probe detail', async () => {
    const verify = jest.fn(async () =>
      draftResult({
        outcome: 'failed',
        reason: 'credential-rejected',
        detail: `HTTP 401 for key ${KEY}`,
        latencyMs: 812,
      }),
    );
    const { checker } = makeChecker({ verify });

    const result = await checker.check('kimi-code', 'apiKey');

    expect(result).toEqual({
      status: 'failed',
      reason: 'credential-rejected',
      latencyMs: null,
      checkedAt: expect.any(String),
    });
    // checkedAt is a live ISO timestamp whose digits can contain "401".
    const persisted = JSON.stringify({ ...result, checkedAt: undefined });
    expect(persisted).not.toContain('401');
    expect(persisted).not.toContain(KEY.slice(0, 5));
  });

  it('a timed-out or cancelled probe records failed with latencyMs: null', async () => {
    const timeout = makeChecker({
      verify: jest.fn(async () =>
        draftResult({ outcome: 'failed', reason: 'timeout', latencyMs: 15000 }),
      ),
    });
    expect(await timeout.checker.check('kimi-code', 'apiKey')).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      latencyMs: null,
    });
    const cancelled = makeChecker({
      verify: jest.fn(async () =>
        draftResult({
          outcome: 'cancelled',
          reason: 'cancelled',
          latencyMs: null,
        }),
      ),
    });
    expect(await cancelled.checker.check('kimi-code', 'apiKey')).toMatchObject({
      status: 'failed',
      reason: 'cancelled',
      latencyMs: null,
    });
  });

  it('a probe that throws records failed/unclassified, never rejects, and logs no error text', async () => {
    const verify = jest.fn(async () => {
      throw new Error(`SDK exploded with ${KEY}`);
    });
    const { checker, recorder, logger } = makeChecker({ verify });

    await expect(checker.check('kimi-code', 'apiKey')).resolves.toEqual({
      status: 'failed',
      reason: 'unclassified',
      latencyMs: null,
      checkedAt: expect.any(String),
    });
    expect(recorder.get('kimi-code')?.reason).toBe('unclassified');
    const logs = JSON.stringify([
      logger.warn.mock.calls,
      logger.info.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logs).not.toContain('exploded');
    expect(logs).not.toContain(KEY.slice(0, 5));
  });

  it('concurrent checks of one connection JOIN the one in flight: one provider request, one result', async () => {
    let release!: () => void;
    const verify = jest.fn(
      () =>
        new Promise<AuthVerifyDraftConnectionResult>((resolve) => {
          release = () => resolve(draftResult({ latencyMs: 120 }));
        }),
    );
    const { checker } = makeChecker({ verify });

    const first = checker.check('kimi-code', 'apiKey');
    const second = checker.check('kimi-code', 'apiKey');
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);

    // Once settled, the next check is a new request.
    const third = checker.check('kimi-code', 'apiKey');
    release();
    await third;
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('a check started after the key was replaced does not join the old check and records its own result (final review M-1)', async () => {
    const releases: Array<() => void> = [];
    const verify = jest.fn(
      () =>
        new Promise<AuthVerifyDraftConnectionResult>((resolve) => {
          const latencyMs = 100 + releases.length;
          releases.push(() => resolve(draftResult({ latencyMs })));
        }),
    );
    const { checker, recorder } = makeChecker({ verify });

    const oldKeyCheck = checker.check('kimi-code', 'apiKey');
    recorder.clear('kimi-code'); // the key was replaced while the check ran
    const newKeyCheck = checker.check('kimi-code', 'apiKey');

    expect(verify).toHaveBeenCalledTimes(2);
    expect(newKeyCheck).not.toBe(oldKeyCheck);

    releases[1]();
    const fresh = await newKeyCheck;
    releases[0]();
    await oldKeyCheck;

    expect(fresh.latencyMs).toBe(101);
    // The old-key result finished last but is not recorded.
    expect(recorder.get('kimi-code')).toBe(fresh);

    // A caller that arrives while the new check runs still joins it.
    const joined = [checker.check('kimi-code', 'apiKey')];
    joined.push(checker.check('kimi-code', 'apiKey'));
    expect(joined[0]).toBe(joined[1]);
    releases[2]();
    await Promise.all(joined);
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it('a check started after the key was deleted records a fresh result, not the pre-delete verdict', async () => {
    let releaseOld!: () => void;
    const verify = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<AuthVerifyDraftConnectionResult>((resolve) => {
            releaseOld = () => resolve(draftResult({}));
          }),
      )
      .mockImplementationOnce(async () =>
        draftResult({
          outcome: 'failed',
          reason: 'no-stored-credential',
          latencyMs: null,
        }),
      );
    const { checker, recorder } = makeChecker({ verify });

    const before = checker.check('kimi-code', 'apiKey');
    recorder.clear('kimi-code');
    const after = await checker.check('kimi-code', 'apiKey');
    releaseOld();
    await before;

    expect(after).toMatchObject({
      status: 'failed',
      reason: 'no-stored-credential',
    });
    expect(recorder.get('kimi-code')).toBe(after);
  });

  it('different connections are checked independently', async () => {
    const { checker, verify } = makeChecker();
    await Promise.all([
      checker.check('kimi-code', 'apiKey'),
      checker.check('z-ai', 'apiKey'),
    ]);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});

describe('ConnectionChecker — no stored key (real DraftVerificationService)', () => {
  it('answers no-stored-credential without making a provider request', async () => {
    const execute = jest.fn();
    const buildDraftOverride = jest.fn();
    const draftVerification = new DraftVerificationService(
      createMockLogger() as unknown as Logger,
      { getLiveDerivedTiers: jest.fn(() => ({})) } as never,
      {
        getSavedBaseUrl: jest.fn(() => 'https://api.kimi.ai/coding/'),
        buildDraftOverride,
      } as never,
      { execute } as unknown as InternalQueryService,
      createMockAuthSecretsService() as unknown as IAuthSecretsService,
    );
    const recorder = new ConnectionCheckRecorder();
    const checker = new ConnectionChecker({
      recorder,
      draftVerification,
      copilotAuth: { isAuthenticated: jest.fn() } as never,
      codexAuth: { getTokenStatus: jest.fn(), clearCache: jest.fn() } as never,
      cliDetector: { performHealthCheck: jest.fn() } as never,
      kimiCodeAuth: createFakeKimiCodeAuth(),
      readProviderKey: jest.fn(),
      logger: createMockLogger() as unknown as Logger,
    });

    const result = await checker.check('kimi-code', 'apiKey');

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'no-stored-credential',
      latencyMs: null,
    });
    expect(buildDraftOverride).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('ConnectionChecker — sign-in and CLI connections (no request, latencyMs: null)', () => {
  it('Copilot: signed in → verified; signed out → signed-out', async () => {
    expect(
      await makeChecker({ copilot: true }).checker.check(
        'github-copilot',
        'copilot',
      ),
    ).toMatchObject({
      status: 'verified',
      reason: null,
      latencyMs: null,
    });
    expect(
      await makeChecker({ copilot: false }).checker.check(
        'github-copilot',
        'copilot',
      ),
    ).toMatchObject({
      status: 'failed',
      reason: 'signed-out',
      latencyMs: null,
    });
  });

  it('Codex: re-reads the token file; a stale token is signed-out', async () => {
    const ok = makeChecker();
    expect(await ok.checker.check('openai-codex', 'codex')).toMatchObject({
      status: 'verified',
      latencyMs: null,
    });
    expect(ok.codexAuth.clearCache).toHaveBeenCalledTimes(1);
    expect(
      await makeChecker({
        codex: { authenticated: true, stale: true },
      }).checker.check('openai-codex', 'codex'),
    ).toMatchObject({
      status: 'failed',
      reason: 'signed-out',
      latencyMs: null,
    });
  });

  it('Claude CLI: detected → verified; missing → not-installed', async () => {
    expect(
      await makeChecker({ cli: true }).checker.check(
        'claude-cli',
        'claude-cli',
      ),
    ).toMatchObject({
      status: 'verified',
      latencyMs: null,
    });
    expect(
      await makeChecker({ cli: false }).checker.check(
        'claude-cli',
        'claude-cli',
      ),
    ).toMatchObject({
      status: 'failed',
      reason: 'not-installed',
      latencyMs: null,
    });
  });

  it('never calls the provider probe for these connections', async () => {
    const { checker, verify } = makeChecker();
    await checker.check('github-copilot', 'copilot');
    await checker.check('openai-codex', 'codex');
    await checker.check('claude-cli', 'claude-cli');
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('ConnectionChecker — Kimi Code (CLI sign-in, stored key fallback)', () => {
  it('a CLI sign-in is verified by its refresh, with no request', async () => {
    const { checker, verify, kimiCodeAuth } = makeChecker({
      kimi: { cliDetected: true, loggedIn: true, credentialSource: 'cli-login' },
    });

    const result = await checker.check('kimi-code', 'kimi-code');

    expect(kimiCodeAuth.clearCache).toHaveBeenCalled();
    expect(kimiCodeAuth.ensureFresh).toHaveBeenCalledTimes(1);
    expect(verify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'verified', latencyMs: null });
  });

  it('the stored-key fallback gets the stored-key probe', async () => {
    const { checker, verify } = makeChecker({
      kimi: { hasApiKey: true, credentialSource: 'api-key' },
    });

    const result = await checker.check('kimi-code', 'kimi-code');

    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'kimi-code',
        authMode: 'apiKey',
        credential: { kind: 'stored' },
      }),
    );
    expect(result).toMatchObject({ status: 'verified', latencyMs: 92 });
  });

  it('a sign-in that cannot refresh falls back to the key when one is stored', async () => {
    const { checker, verify, kimiCodeAuth } = makeChecker({
      kimi: { loggedIn: true, credentialSource: 'cli-login' },
    });
    kimiCodeAuth.ensureFresh.mockResolvedValue(false);
    kimiCodeAuth.getStatus
      .mockResolvedValueOnce({
        cliDetected: true,
        loggedIn: true,
        stale: false,
        hasApiKey: true,
        credentialSource: 'cli-login',
      })
      .mockResolvedValueOnce({
        cliDetected: true,
        loggedIn: false,
        stale: true,
        hasApiKey: true,
        credentialSource: 'api-key',
      });

    const result = await checker.check('kimi-code', 'kimi-code');

    expect(verify).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('verified');
  });

  it('an expired sign-in with a transient refresh failure verifies a valid stored key', async () => {
    // A transient failure does not make the login stale, so the status still
    // reports `cli-login` after the refresh; the stored key decides.
    const cliStatus: KimiCodeAuthStatus = {
      cliDetected: true,
      loggedIn: true,
      stale: false,
      hasApiKey: true,
      credentialSource: 'cli-login',
    };
    const { checker, verify, kimiCodeAuth } = makeChecker({ kimi: cliStatus });
    kimiCodeAuth.ensureFresh.mockResolvedValue(false);
    kimiCodeAuth.getStatus.mockResolvedValue(cliStatus);

    const result = await checker.check('kimi-code', 'kimi-code');

    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'kimi-code',
        authMode: 'apiKey',
        credential: { kind: 'stored' },
      }),
    );
    expect(result).toMatchObject({ status: 'verified', latencyMs: 92 });
  });

  it('a sign-in that cannot refresh without a stored key records signed-out without a request', async () => {
    const cliStatus: KimiCodeAuthStatus = {
      cliDetected: true,
      loggedIn: true,
      stale: false,
      hasApiKey: false,
      credentialSource: 'cli-login',
    };
    const { checker, verify, kimiCodeAuth } = makeChecker({ kimi: cliStatus });
    kimiCodeAuth.ensureFresh.mockResolvedValue(false);
    kimiCodeAuth.getStatus.mockResolvedValue(cliStatus);

    const result = await checker.check('kimi-code', 'kimi-code');

    expect(verify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed', reason: 'signed-out' });
  });

  it('neither a sign-in nor a key records signed-out without a request', async () => {
    const { checker, verify } = makeChecker();

    const result = await checker.check('kimi-code', 'kimi-code');

    expect(verify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed', reason: 'signed-out' });
  });
});

describe('customProbeCheckRecord', () => {
  it('a successful round trip keeps its whole-ms latency', () => {
    expect(
      customProbeCheckRecord({ ok: true, message: 'ok', latencyMs: 91.6 }),
    ).toMatchObject({
      status: 'verified',
      reason: null,
      latencyMs: 92,
    });
  });

  it.each<[CustomProviderProbeResult['failure'], string]>([
    ['timeout', 'timeout'],
    ['dns', 'unreachable'],
    ['unreachable', 'unreachable'],
    ['tls', 'unreachable'],
    ['unauthorized', 'credential-rejected'],
    ['not-found', 'model-unavailable'],
    ['no-model', 'model-unavailable'],
    ['server-error', 'unclassified'],
    ['no-tool-support', 'unclassified'],
    ['unknown', 'unclassified'],
  ])('failure %s → %s with latencyMs: null', (failure, reason) => {
    expect(
      customProbeCheckRecord({
        ok: false,
        message: 'x',
        failure,
        latencyMs: 40,
      }),
    ).toMatchObject({ status: 'failed', reason, latencyMs: null });
  });
});
