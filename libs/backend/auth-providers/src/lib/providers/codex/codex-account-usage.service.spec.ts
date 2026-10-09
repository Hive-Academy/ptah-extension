import 'reflect-metadata';

const SYNTHETIC_CODEX_BINARY =
  '/synthetic/vendor/aarch64-apple-darwin/bin/codex';
const mockResolveCodexNativeBinaryPath = jest.fn<string | undefined, []>(
  () => SYNTHETIC_CODEX_BINARY,
);
jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual('@ptah-extension/agent-sdk'),
  resolveCodexNativeBinaryPath: () => mockResolveCodexNativeBinaryPath(),
}));
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { resolve } from 'node:path';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IProcessSpawner,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import { CodexAccountUsageService } from './codex-account-usage.service';
import {
  CODEX_ACCOUNT_USAGE_DAILY_INT64_FIELDS,
  CODEX_ACCOUNT_USAGE_INT64_FIELDS,
  CODEX_ACCOUNT_USAGE_SUMMARY_INT64_FIELDS,
  codexTokenUsageResponseSchema,
} from './codex-account.schemas';
import { CodexHomeResolver } from './codex-home-resolver';
import { accountOwnerKey } from '../../quota/provider-owner.resolver';
import type { ICodexAuthService } from './codex-provider.types';

interface Scenario {
  methodMissing?: string;
  silent?: boolean;
  spawnThrows?: boolean;
  deferInitialize?: boolean;
  activityResultRaw?: string;
  initializedHome?: string;
  /** `account/read` answer; `null` is a signed-out home. Defaults to a ChatGPT account. */
  account?: Record<string, unknown> | null;
  rateLimitReachedType?: string;
}

function handle(
  stdout: PassThrough,
  stdin: Writable,
  deferKillClose = false,
): SpawnedProcessHandle & EventEmitter {
  const emitter = new EventEmitter() as SpawnedProcessHandle & EventEmitter;
  Object.assign(emitter, {
    stdin,
    stdout,
    stderr: new PassThrough(),
    whenSpawned: Promise.resolve(123),
    pid: 123,
    killed: false,
    exitCode: null,
    kill: jest.fn(() => {
      (emitter as { killed: boolean }).killed = true;
      if (!deferKillClose) queueMicrotask(() => emitter.emit('close', 0, null));
      return true;
    }),
  });
  return emitter;
}

function harness(scenario: Scenario = {}) {
  const requests: ProcessSpawnRequest[] = [];
  const messages: Array<Record<string, unknown>> = [];
  const handles: Array<SpawnedProcessHandle & EventEmitter> = [];
  let releaseInitialize: (() => void) | undefined;
  const syntheticHome = resolve('synthetic-codex-home');
  const spawner: IProcessSpawner = {
    spawnProcess: (request) => {
      requests.push(request);
      if (scenario.spawnThrows) throw new Error('private spawn failure');
      const stdout = new PassThrough();
      let input = '';
      const child = handle(
        stdout,
        new Writable({
          write(chunk, _encoding, done) {
            input += String(chunk);
            let newline: number;
            while ((newline = input.indexOf('\n')) >= 0) {
              const message = JSON.parse(input.slice(0, newline)) as Record<
                string,
                unknown
              >;
              input = input.slice(newline + 1);
              messages.push(message);
              if (scenario.silent || !('id' in message)) continue;
              const id = message['id'] as number;
              const method = message['method'] as string;
              if (scenario.methodMissing === method) {
                stdout.write(
                  `${JSON.stringify({ id, error: { code: -32601, message: 'private raw error' } })}\n`,
                );
              } else {
                if (
                  method === 'account/usage/read' &&
                  scenario.activityResultRaw
                ) {
                  stdout.write(
                    `{"id":${id},"result":${scenario.activityResultRaw}}\n`,
                  );
                  continue;
                }
                const result =
                  method === 'initialize'
                    ? {
                        userAgent: 'codex',
                        codexHome: scenario.initializedHome ?? syntheticHome,
                        platformFamily: 'windows',
                        platformOs: 'windows',
                      }
                    : method === 'account/read'
                      ? {
                          account:
                            scenario.account === undefined
                              ? {
                                  type: 'chatgpt',
                                  email: 'private@example.test',
                                  planType: 'plus',
                                }
                              : scenario.account,
                          requiresOpenaiAuth: true,
                        }
                      : method === 'account/rateLimits/read'
                        ? {
                            rateLimits: {
                              primary: {
                                usedPercent: 25,
                                windowDurationMins: 300,
                                resetsAt: 99,
                              },
                              ...(scenario.rateLimitReachedType
                                ? {
                                    rateLimitReachedType:
                                      scenario.rateLimitReachedType,
                                  }
                                : {}),
                            },
                          }
                        : {
                            summary: { lifetimeTokens: 1234 },
                            dailyUsageBuckets: [
                              { startDate: '2026-09-11', tokens: 55 },
                            ],
                          };
                const respond = () =>
                  stdout.write(`${JSON.stringify({ id, result })}\n`);
                if (method === 'initialize' && scenario.deferInitialize)
                  releaseInitialize = respond;
                else respond();
              }
            }
            done();
          },
        }),
      );
      handles.push(child);
      return child;
    },
  };
  const auth = {
    getAccountUsageEligibility: jest.fn(async () => 'supported'),
  } as unknown as ICodexAuthService;
  let authListener: ((event: { providerId: string }) => void) | undefined;
  const events = {
    onAuthFileChanged: (listener: typeof authListener) => {
      authListener = listener;
      return () => undefined;
    },
  };
  const logger = createMockLogger();
  const service = new CodexAccountUsageService(
    logger as unknown as Logger,
    auth,
    new CodexHomeResolver(syntheticHome),
    spawner,
    events as never,
  );
  return {
    service,
    requests,
    messages,
    handles,
    auth,
    releaseInitialize: () => releaseInitialize?.(),
    authChanged: () => authListener?.({ providerId: 'openai-codex' }),
    logger,
    syntheticHome,
    scenario,
  };
}

describe('CodexAccountUsageService', () => {
  afterEach(() => {
    mockResolveCodexNativeBinaryPath.mockImplementation(
      () => SYNTHETIC_CODEX_BINARY,
    );
    jest.restoreAllMocks();
  });

  it('spawns the native Codex binary, never the host executable', async () => {
    const h = harness();
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].command).toBe(SYNTHETIC_CODEX_BINARY);
    expect(h.requests[0].command).not.toBe(process.execPath);
    expect(h.requests[0].args).toEqual(['app-server']);
  });

  it('reports cli-unavailable without spawning when no native binary is found', async () => {
    mockResolveCodexNativeBinaryPath.mockImplementation(() => undefined);
    const h = harness();
    await expect(h.service.getAccountUsage()).resolves.toEqual({
      status: 'cli-unavailable',
      providerId: 'openai-codex',
    });
    expect(h.requests).toHaveLength(0);
  });

  it('answers a failed read from memory during the backoff; refresh and auth changes still read', async () => {
    const h = harness({ spawnThrows: true });
    await h.service.getAccountUsage();
    await h.service.getAccountUsage();
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(1);
    await h.service.getAccountUsage({ refresh: true });
    expect(h.requests).toHaveLength(2);
    h.authChanged();
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(3);
  });

  it('reads again once the backoff has passed', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const h = harness({ spawnThrows: true });
    await h.service.getAccountUsage();
    now.mockReturnValue(1_000_000 + 29_999);
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(1);
    now.mockReturnValue(1_000_000 + 30_000);
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(2);
  });

  it('does not re-read a signed-out home on every call', async () => {
    const h = harness({ account: null });
    await h.service.getAccountUsage();
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(1);
  });

  it('initializes first, omits params on both reads, uses exact CODEX_HOME, validates and redacts', async () => {
    const h = harness();
    const result = await h.service.getAccountUsage();
    expect(result).toEqual({
      status: 'available',
      providerId: 'openai-codex',
      fetchedAt: expect.any(Number),
      account: { planType: 'plus' },
      quota: {
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 99 },
      },
      activity: {
        lifetimeTokens: '1234',
        dailyUsage: [{ startDate: '2026-09-11', tokens: '55' }],
      },
    });
    expect(h.requests).toHaveLength(1);
    expect(
      h.requests.every(
        (request) => request.env['CODEX_HOME'] === h.syntheticHome,
      ),
    ).toBe(true);
    expect(h.messages.map((message) => message['method'])).toEqual([
      'initialize',
      'initialized',
      'account/read',
      'account/rateLimits/read',
      'account/usage/read',
    ]);
    for (const method of ['account/rateLimits/read', 'account/usage/read']) {
      expect(
        h.messages.find((message) => message['method'] === method),
      ).not.toHaveProperty('params');
    }
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    expect(JSON.stringify(h.logger)).not.toContain('private raw error');
  });

  it('uses cache, bypasses it on refresh, and invalidates it on auth mutation', async () => {
    const h = harness();
    await h.service.getAccountUsage();
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(1);
    await h.service.getAccountUsage({ refresh: true });
    expect(h.requests).toHaveLength(2);
    h.authChanged();
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(3);
  });

  it('uses the app-server capability instead of probing a Codex CLI version', async () => {
    await expect(harness().service.getAccountUsage()).resolves.toMatchObject({
      status: 'available',
    });
    const missing = harness({ methodMissing: 'account/usage/read' });
    await expect(missing.service.getAccountUsage()).resolves.toMatchObject({
      status: 'cli-version-unsupported',
    });
    expect(JSON.stringify(missing.logger)).not.toContain('private raw error');
  });

  it('reports an unavailable packaged CLI without exposing the spawn failure', async () => {
    const h = harness({ spawnThrows: true });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({
      status: 'cli-unavailable',
    });
    expect(JSON.stringify(h.logger)).not.toContain('private spawn failure');
  });

  it.each(['unsupported-auth', 'unsupported-config'] as const)(
    'returns %s before spawning',
    async (status) => {
      const h = harness();
      (h.auth.getAccountUsageEligibility as jest.Mock).mockResolvedValue(
        status,
      );
      await expect(h.service.getAccountUsage()).resolves.toEqual({
        status,
        providerId: 'openai-codex',
      });
      expect(h.requests).toHaveLength(0);
    },
  );

  it('aborts and closes a silent App Server', async () => {
    const h = harness({ silent: true });
    const controller = new AbortController();
    const pending = h.service.getAccountUsage({ signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      status: 'service-unavailable',
    });
    await expect(h.service.close()).resolves.toBeUndefined();
  });

  it('coalesces two and three overlapping reads, including refresh, into one App Server', async () => {
    const h = harness({ deferInitialize: true });
    const calls = [
      h.service.getAccountUsage(),
      h.service.getAccountUsage({ refresh: true }),
      h.service.getAccountUsage(),
    ];
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.requests).toHaveLength(1);
    h.releaseInitialize();
    const results = await Promise.all(calls);
    expect(results[0]).toMatchObject({ status: 'available' });
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    expect(
      h.requests.filter((request) => request.args.includes('app-server')),
    ).toHaveLength(1);
    expect(h.handles[0].kill).toHaveBeenCalledTimes(1);
  });

  it('lets a joined caller abort locally without cancelling the shared App Server read', async () => {
    const h = harness({ deferInitialize: true });
    const owner = h.service.getAccountUsage();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const joined = h.service.getAccountUsage({ signal: controller.signal });
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    controller.abort();
    await expect(joined).rejects.toMatchObject({ name: 'AbortError' });
    expect(removeListener).toHaveBeenCalledTimes(1);
    h.releaseInitialize();
    await expect(owner).resolves.toMatchObject({ status: 'available' });
    expect(
      h.requests.filter((request) => request.args.includes('app-server')),
    ).toHaveLength(1);
    expect(h.handles[0].kill).toHaveBeenCalledTimes(1);
  });

  it('close during a coalesced App Server read kills its owned child exactly once', async () => {
    const h = harness({ deferInitialize: true });
    const calls = [
      h.service.getAccountUsage(),
      h.service.getAccountUsage({ refresh: true }),
    ];
    await new Promise((resolve) => setImmediate(resolve));
    await h.service.close();
    const results = await Promise.all(calls);
    expect(results).toEqual([
      { status: 'service-unavailable', providerId: 'openai-codex' },
      { status: 'service-unavailable', providerId: 'openai-codex' },
    ]);
    expect(h.handles[0].kill).toHaveBeenCalledTimes(1);
  });

  it('preserves account int64 counters above Number.MAX_SAFE_INTEGER as decimal strings', async () => {
    const h = harness({
      activityResultRaw: JSON.stringify({
        summary: { lifetimeTokens: '__LIFETIME__' },
        dailyUsageBuckets: [{ startDate: '2026-09-12', tokens: '__TOKENS__' }],
      })
        .replace('"__LIFETIME__"', '9007199254740993')
        .replace('"__TOKENS__"', '9007199254740995'),
    });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({
      activity: {
        lifetimeTokens: '9007199254740993',
        dailyUsage: [{ startDate: '2026-09-12', tokens: '9007199254740995' }],
      },
    });
  });

  it('uses exactly the schema int64 fields for raw decimal preservation', () => {
    const summaryFields = Object.keys(
      codexTokenUsageResponseSchema.shape.summary.shape,
    );
    const dailySchema = codexTokenUsageResponseSchema.shape.dailyUsageBuckets
      .unwrap()
      .unwrap();
    const dailyFields = Object.keys(dailySchema.element.shape).filter(
      (field) => field !== 'startDate',
    );
    expect(summaryFields.sort()).toEqual(
      [...CODEX_ACCOUNT_USAGE_SUMMARY_INT64_FIELDS].sort(),
    );
    expect(dailyFields.sort()).toEqual(
      [...CODEX_ACCOUNT_USAGE_DAILY_INT64_FIELDS].sort(),
    );
    expect([...summaryFields, ...dailyFields].sort()).toEqual(
      [...CODEX_ACCOUNT_USAGE_INT64_FIELDS].sort(),
    );
  });

  it('accepts Windows drive-letter case differences for the initialized Codex home', async () => {
    const h = harness({
      initializedHome: resolve('synthetic-codex-home').replace(
        /^([A-Z]):/,
        (_m, drive: string) => `${drive.toLowerCase()}:`,
      ),
    });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({
      status: 'available',
    });
  });

  it('does not match genuinely different Windows Codex home paths', async () => {
    const h = harness({
      initializedHome: resolve('different-synthetic-codex-home'),
    });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({
      status: 'service-unavailable',
    });
  });

  it('passes rateLimitReachedType through as window evidence', async () => {
    const h = harness({ rateLimitReachedType: 'rate_limit_reached' });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({
      quota: { rateLimitReachedType: 'rate_limit_reached' },
    });
  });

  describe('owner key (F30)', () => {
    const ownerOf = (home: string, email: string) =>
      accountOwnerKey('openai-codex', `${home}\0${email}`);

    it('is null before the first read, the hashed home+email after it, and null after clearCache', async () => {
      const h = harness();
      expect(h.service.currentOwnerKey()).toBeNull();
      const result = await h.service.getAccountUsage();
      const key = h.service.currentOwnerKey();
      expect(key).toBe(ownerOf(h.syntheticHome, 'private@example.test'));
      expect(key).toMatch(/^openai-codex#account:[0-9a-f]{16}$/);
      expect(result).not.toHaveProperty('ownerKey');
      expect(JSON.stringify(h.logger)).not.toContain('private@example.test');
      h.authChanged();
      expect(h.service.currentOwnerKey()).toBeNull();
    });

    it('account A then B: the auth change drops A, and the next read is B, not stale A', async () => {
      const h = harness();
      await h.service.getAccountUsage();
      const keyA = h.service.currentOwnerKey();
      h.scenario.account = {
        type: 'chatgpt',
        email: 'other@example.test',
        planType: 'pro',
      };
      h.authChanged();
      await expect(h.service.getAccountUsage()).resolves.toMatchObject({
        status: 'available',
        account: { planType: 'pro' },
      });
      expect(h.service.currentOwnerKey()).toBe(
        ownerOf(h.syntheticHome, 'other@example.test'),
      );
      expect(h.service.currentOwnerKey()).not.toBe(keyA);
    });

    it('account A then sign-out: no owner and no stale A data', async () => {
      const h = harness();
      await h.service.getAccountUsage();
      h.scenario.account = null;
      h.authChanged();
      await expect(h.service.getAccountUsage()).resolves.toEqual({
        status: 'service-unavailable',
        providerId: 'openai-codex',
      });
      expect(h.service.currentOwnerKey()).toBeNull();
    });

    it('same-account transient failure serves stale data and keeps the owner', async () => {
      const h = harness();
      await h.service.getAccountUsage();
      const keyA = h.service.currentOwnerKey();
      h.scenario.spawnThrows = true;
      await expect(
        h.service.getAccountUsage({ refresh: true }),
      ).resolves.toMatchObject({
        status: 'stale',
        staleSince: expect.any(Number),
        quota: { primary: { usedPercent: 25 } },
      });
      expect(h.service.currentOwnerKey()).toBe(keyA);
    });

    it('a transient failure with no cache has no owner and no data', async () => {
      const h = harness({ spawnThrows: true });
      await expect(h.service.getAccountUsage()).resolves.toEqual({
        status: 'cli-unavailable',
        providerId: 'openai-codex',
      });
      expect(h.service.currentOwnerKey()).toBeNull();
    });

    it('an API-key home has no account owner', async () => {
      const h = harness({ account: { type: 'apiKey' } });
      await expect(h.service.getAccountUsage()).resolves.toMatchObject({
        status: 'unsupported-auth',
      });
      expect(h.service.currentOwnerKey()).toBeNull();
    });

    it('a ChatGPT account without an email has no owner key', async () => {
      const h = harness({
        account: { type: 'chatgpt', email: null, planType: 'plus' },
      });
      await expect(h.service.getAccountUsage()).resolves.toMatchObject({
        status: 'available',
      });
      expect(h.service.currentOwnerKey()).toBeNull();
    });

    it('a read in flight across an auth change answers its caller but is not cached', async () => {
      const h = harness({ deferInitialize: true });
      const pending = h.service.getAccountUsage();
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
      h.authChanged();
      h.releaseInitialize();
      await expect(pending).resolves.toMatchObject({ status: 'available' });
      expect(h.service.currentOwnerKey()).toBeNull();
      const before = h.requests.length;
      h.scenario.deferInitialize = false;
      await h.service.getAccountUsage();
      expect(h.requests.length).toBe(before + 1);
      expect(h.service.currentOwnerKey()).toBe(
        ownerOf(h.syntheticHome, 'private@example.test'),
      );
    });
  });
});
