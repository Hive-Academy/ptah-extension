import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { resolve } from 'node:path';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IProcessSpawner, ProcessSpawnRequest, SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { CodexAccountUsageService } from './codex-account-usage.service';
import {
  CODEX_ACCOUNT_USAGE_DAILY_INT64_FIELDS,
  CODEX_ACCOUNT_USAGE_INT64_FIELDS,
  CODEX_ACCOUNT_USAGE_SUMMARY_INT64_FIELDS,
  codexTokenUsageResponseSchema,
} from './codex-account.schemas';
import { CodexHomeResolver } from './codex-home-resolver';
import type { ICodexAuthService } from './codex-provider.types';

interface Scenario {
  version?: string;
  methodMissing?: string;
  silent?: boolean;
  spawnThrows?: boolean;
  deferInitialize?: boolean;
  versionSilent?: boolean;
  deferVersionKillClose?: boolean;
  activityResultRaw?: string;
  initializedHome?: string;
}

function handle(
  stdout: PassThrough,
  stdin: Writable,
  deferKillClose = false,
): SpawnedProcessHandle & EventEmitter {
  const emitter = new EventEmitter() as SpawnedProcessHandle & EventEmitter;
  Object.assign(emitter, {
    stdin, stdout, stderr: new PassThrough(), whenSpawned: Promise.resolve(123), pid: 123,
    killed: false, exitCode: null,
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
      if (request.args.includes('--version')) {
        const child = handle(
          stdout,
          new Writable({ write: (_c, _e, done) => done() }),
          scenario.deferVersionKillClose,
        );
        handles.push(child);
        if (!scenario.versionSilent) queueMicrotask(() => {
          stdout.write(`codex-cli ${scenario.version ?? '0.147.0'}\n`);
          child.emit('close', 0, null);
        });
        return child;
      }
      let input = '';
      const child = handle(stdout, new Writable({ write(chunk, _encoding, done) {
        input += String(chunk);
        let newline: number;
        while ((newline = input.indexOf('\n')) >= 0) {
          const message = JSON.parse(input.slice(0, newline)) as Record<string, unknown>;
          input = input.slice(newline + 1);
          messages.push(message);
          if (scenario.silent || !('id' in message)) continue;
          const id = message['id'] as number;
          const method = message['method'] as string;
          if (scenario.methodMissing === method) {
            stdout.write(`${JSON.stringify({ id, error: { code: -32601, message: 'private raw error' } })}\n`);
          } else {
            if (method === 'account/usage/read' && scenario.activityResultRaw) {
              stdout.write(`{"id":${id},"result":${scenario.activityResultRaw}}\n`);
              continue;
            }
            const result = method === 'initialize'
              ? { userAgent: 'codex', codexHome: scenario.initializedHome ?? syntheticHome,
                platformFamily: 'windows', platformOs: 'windows' }
              : method === 'account/read'
                ? { account: { type: 'chatgpt', email: 'private@example.test', planType: 'plus' }, requiresOpenaiAuth: true }
                : method === 'account/rateLimits/read'
                  ? { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 99 } } }
                  : { summary: { lifetimeTokens: 1234 }, dailyUsageBuckets: [{ startDate: '2026-09-11', tokens: 55 }] };
            const respond = () => stdout.write(`${JSON.stringify({ id, result })}\n`);
            if (method === 'initialize' && scenario.deferInitialize) releaseInitialize = respond;
            else respond();
          }
        }
        done();
      } }));
      handles.push(child);
      return child;
    },
  };
  const auth = { getAccountUsageEligibility: jest.fn(async () => 'supported') } as unknown as ICodexAuthService;
  let authListener: ((event: { providerId: string }) => void) | undefined;
  const events = { onAuthFileChanged: (listener: typeof authListener) => { authListener = listener; return () => undefined; } };
  const logger = createMockLogger();
  const service = new CodexAccountUsageService(
    logger as unknown as Logger, auth, new CodexHomeResolver(syntheticHome), spawner, events as never,
  );
  return {
    service, requests, messages, handles, auth,
    releaseInitialize: () => releaseInitialize?.(),
    authChanged: () => authListener?.({ providerId: 'openai-codex' }),
    logger, syntheticHome,
  };
}

describe('CodexAccountUsageService', () => {
  it('initializes first, omits params on both reads, uses exact CODEX_HOME, validates and redacts', async () => {
    const h = harness();
    const result = await h.service.getAccountUsage();
    expect(result).toEqual({
      status: 'available', providerId: 'openai-codex', fetchedAt: expect.any(Number),
      account: { planType: 'plus' },
      quota: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 99 } },
      activity: { lifetimeTokens: '1234', dailyUsage: [{ startDate: '2026-09-11', tokens: '55' }] },
    });
    expect(h.requests).toHaveLength(2);
    expect(h.requests.every((request) => request.env['CODEX_HOME'] === h.syntheticHome)).toBe(true);
    expect(h.messages.map((message) => message['method'])).toEqual([
      'initialize', 'initialized', 'account/read', 'account/rateLimits/read', 'account/usage/read',
    ]);
    for (const method of ['account/rateLimits/read', 'account/usage/read']) {
      expect(h.messages.find((message) => message['method'] === method)).not.toHaveProperty('params');
    }
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    expect(JSON.stringify(h.logger)).not.toContain('private raw error');
  });

  it('uses cache, bypasses it on refresh, and invalidates it on auth mutation', async () => {
    const h = harness();
    await h.service.getAccountUsage();
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(2);
    await h.service.getAccountUsage({ refresh: true });
    expect(h.requests).toHaveLength(4);
    h.authChanged();
    await h.service.getAccountUsage();
    expect(h.requests).toHaveLength(6);
  });

  it('feature-gates incompatible versions and method-not-found without raw errors', async () => {
    await expect(harness({ version: '0.146.0' }).service.getAccountUsage()).resolves.toMatchObject({
      status: 'cli-version-unsupported',
    });
    const missing = harness({ methodMissing: 'account/usage/read' });
    await expect(missing.service.getAccountUsage()).resolves.toMatchObject({ status: 'cli-version-unsupported' });
    expect(JSON.stringify(missing.logger)).not.toContain('private raw error');
  });

  it('reports an unavailable packaged CLI without exposing the spawn failure', async () => {
    const h = harness({ spawnThrows: true });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({ status: 'cli-unavailable' });
    expect(JSON.stringify(h.logger)).not.toContain('private spawn failure');
  });

  it.each(['unsupported-auth', 'unsupported-config'] as const)('returns %s before spawning', async (status) => {
    const h = harness();
    (h.auth.getAccountUsageEligibility as jest.Mock).mockResolvedValue(status);
    await expect(h.service.getAccountUsage()).resolves.toEqual({ status, providerId: 'openai-codex' });
    expect(h.requests).toHaveLength(0);
  });

  it('aborts and closes a silent App Server', async () => {
    const h = harness({ silent: true });
    const controller = new AbortController();
    const pending = h.service.getAccountUsage({ signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: 'service-unavailable' });
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
    expect(h.requests).toHaveLength(2);
    h.releaseInitialize();
    const results = await Promise.all(calls);
    expect(results[0]).toMatchObject({ status: 'available' });
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    expect(h.requests.filter((request) => request.args.includes('app-server'))).toHaveLength(1);
    expect(h.handles[1].kill).toHaveBeenCalledTimes(1);
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
    expect(h.requests.filter((request) => request.args.includes('app-server'))).toHaveLength(1);
    expect(h.handles[1].kill).toHaveBeenCalledTimes(1);
  });

  it('close during a coalesced App Server read kills its owned child exactly once', async () => {
    const h = harness({ deferInitialize: true });
    const calls = [h.service.getAccountUsage(), h.service.getAccountUsage({ refresh: true })];
    await new Promise((resolve) => setImmediate(resolve));
    await h.service.close();
    const results = await Promise.all(calls);
    expect(results).toEqual([
      { status: 'service-unavailable', providerId: 'openai-codex' },
      { status: 'service-unavailable', providerId: 'openai-codex' },
    ]);
    expect(h.handles[1].kill).toHaveBeenCalledTimes(1);
  });

  it('tracks and closes the version child during an in-flight probe', async () => {
    const h = harness({ versionSilent: true });
    const pending = h.service.getAccountUsage();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.requests).toHaveLength(1);
    await h.service.close();
    await expect(pending).resolves.toMatchObject({ status: 'cli-version-unsupported' });
    expect(h.handles[0].kill).toHaveBeenCalledTimes(1);
  });

  it('retains a failed version child until close can finish its tracking', async () => {
    const h = harness({ versionSilent: true, deferVersionKillClose: true });
    const controller = new AbortController();
    const pending = h.service.getAccountUsage({ signal: controller.signal });
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: 'cli-unavailable' });
    const internals = h.service as unknown as {
      active: Set<SpawnedProcessHandle>; closing: Map<SpawnedProcessHandle, Promise<void>>;
    };
    expect(internals.active.size).toBe(1);
    await h.service.close();
    expect(h.handles[0].kill).toHaveBeenCalledTimes(1);
    expect(internals.active.size).toBe(0);
    expect(internals.closing.size).toBe(0);
  });

  it('preserves account int64 counters above Number.MAX_SAFE_INTEGER as decimal strings', async () => {
    const h = harness({ activityResultRaw: JSON.stringify({
      summary: { lifetimeTokens: '__LIFETIME__' },
      dailyUsageBuckets: [{ startDate: '2026-09-12', tokens: '__TOKENS__' }],
    }).replace('"__LIFETIME__"', '9007199254740993').replace('"__TOKENS__"', '9007199254740995') });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({ activity: {
      lifetimeTokens: '9007199254740993',
      dailyUsage: [{ startDate: '2026-09-12', tokens: '9007199254740995' }],
    } });
  });

  it('uses exactly the schema int64 fields for raw decimal preservation', () => {
    const summaryFields = Object.keys(codexTokenUsageResponseSchema.shape.summary.shape);
    const dailySchema = codexTokenUsageResponseSchema.shape.dailyUsageBuckets.unwrap().unwrap();
    const dailyFields = Object.keys(dailySchema.element.shape).filter((field) => field !== 'startDate');
    expect(summaryFields.sort()).toEqual([...CODEX_ACCOUNT_USAGE_SUMMARY_INT64_FIELDS].sort());
    expect(dailyFields.sort()).toEqual([...CODEX_ACCOUNT_USAGE_DAILY_INT64_FIELDS].sort());
    expect([...summaryFields, ...dailyFields].sort()).toEqual([...CODEX_ACCOUNT_USAGE_INT64_FIELDS].sort());
  });

  it('accepts Windows drive-letter case differences for the initialized Codex home', async () => {
    const h = harness({ initializedHome: resolve('synthetic-codex-home').replace(/^([A-Z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`) });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({ status: 'available' });
  });

  it('does not match genuinely different Windows Codex home paths', async () => {
    const h = harness({ initializedHome: resolve('different-synthetic-codex-home') });
    await expect(h.service.getAccountUsage()).resolves.toMatchObject({ status: 'service-unavailable' });
  });
});
