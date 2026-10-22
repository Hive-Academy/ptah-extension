import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { ClaudeAccountNamedRoute, ClaudeAccountRunReservation, ProviderAccountAdmissionPort } from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding } from '@ptah-extension/shared';
import type { AccountInfo, Options, QueryFunction, SDKMessage, SDKUserMessage } from '../../types/sdk-types/claude-sdk.types';
import { SdkQueryRunner } from '../sdk-query-runner.service';
import { NamedAccountQueryAdmission, type NamedAccountPersistencePort } from './session-query-executor.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const route = {
  kind: 'named', provider: 'claude', profileId: 'profile-a', canonicalConfigDir: '/isolated-account',
  routeFingerprint: 'a'.repeat(64), routeRevision: 0, authEpoch: 0, runId: 'run-a',
} as ClaudeAccountNamedRoute;
const reservation: ClaudeAccountRunReservation & { phase: 'reserved' } = {
  kind: 'run', phase: 'reserved', provider: 'claude', routeKind: 'named', reservationId: 'reservation-a',
  routeFingerprint: route.routeFingerprint, routeRevision: 0, authEpoch: 0, operationId: 'operation-a', runId: route.runId,
};
const account: AccountInfo = { email: 'person@example.test', organization: 'org' };
const binding: ProviderAccountBinding = {
  version: 1, provider: 'claude', profileId: route.profileId, routeRevision: 0,
  routeFingerprint: route.routeFingerprint, authEpoch: 0, runId: route.runId,
  identity: { kind: 'known', ownerKey: createHash('sha256').update('ptah-quota-owner\0person@example.test\0org').digest('hex') },
};
const metadata = { name: 'private title', workspaceId: '/workspace', createdAt: 1, lastActiveAt: 1,
  totalCost: 0, totalTokens: { input: 0, output: 0 } };
const message: SDKUserMessage = { type: 'user', session_id: '', parent_tool_use_id: null,
  message: { role: 'user', content: 'private conversation' } };
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

function fixture(settings: { fail?: string; cancel?: string; unproved?: string; unknown?: boolean;
  mismatch?: boolean; pause?: string; held?: boolean; resumeUnknown?: boolean } = {}) {
  const controller = new AbortController();
  const events: string[] = [];
  const paused = deferred<void>();
  const entered = deferred<void>();
  let yielded = 0;
  let saved: ProviderAccountBinding | undefined;
  let epochListener: ((changed: ClaudeAccountNamedRoute) => void) | undefined;
  const step = async (name: string) => {
    events.push(name);
    if (settings.cancel === name) controller.abort();
    if (settings.fail === name) throw new Error('sensitive provider detail');
    if (settings.pause === name) { entered.resolve(); await paused.promise; }
  };
  const admission: ProviderAccountAdmissionPort = {
    admitClaudeRoute: jest.fn(async (): ReturnType<ProviderAccountAdmissionPort['admitClaudeRoute']> => {
      await step('admit');
      return settings.held ? { code: 'release-held', summary: 'Held.' } : {
        code: 'ok', resources: { kind: 'named', route, accountDataDir: '/metadata',
          filesystemIdentity: { volumeId: 'v', fileId: 'f' } }, reservation,
      };
    }),
    releaseReservation: jest.fn(async (): ReturnType<ProviderAccountAdmissionPort['releaseReservation']> => {
      events.push('release');
      return { code: 'ok', reservation: { ...reservation, phase: 'released' } };
    }),
    retainUnresolvedReservation: jest.fn(async (): ReturnType<ProviderAccountAdmissionPort['retainUnresolvedReservation']> => {
      events.push('retain');
      return { code: 'ok', reservation: { ...reservation, phase: 'retained' } };
    }),
  };
  const persistence: NamedAccountPersistencePort = {
    resolveAccountBinding: jest.fn(async (): Promise<ProviderAccountBinding | null> => {
      await step('lookup');
      return settings.resumeUnknown ? { ...binding, identity: { kind: 'unknown' } } : binding;
    }),
    commitRunBinding: jest.fn(async (_route, _reservation, identity) => {
      await step('commit'); return { ...binding, identity };
    }),
    attachSdkSession: jest.fn(async () => { await step('attach'); return { status: 'attached' as const }; }),
    saveAccountBound: jest.fn(async (_metadata, evidence) => { await step('metadata'); saved = evidence; }),
    assertRouteCurrent: jest.fn(async () => { await step('current'); }),
    onAuthEpochChanged: jest.fn((listener) => { epochListener = listener; return () => { epochListener = undefined; }; }),
  };
  const registry = {
    bindAccountRoute: jest.fn(() => {
      events.push('registry');
      if (settings.cancel === 'registry') controller.abort();
      return settings.fail !== 'registry';
    }),
    invalidateAccountRoute: jest.fn(),
  };
  const options: Options[] = [];
  const reads: Promise<IteratorResult<SDKUserMessage>>[] = [];
  const runner: Pick<SdkQueryRunner, 'invokeNamedQuery'> = {
    invokeNamedQuery: jest.fn((_fn, prompt, queryOptions, observe) => {
      const stage = options.length === 0 ? 'bootstrap' : 'final';
      events.push(stage);
      options.push(queryOptions);
      const terminated = deferred<void>();
      observe?.(terminated.promise);
      const read = prompt[Symbol.asyncIterator]().next().then((result) => {
        if (!result.done) yielded++;
        return result;
      });
      reads.push(read);
      if (settings.fail === stage) throw new Error('launch failed after possible spawn');
      const query: Partial<ReturnType<QueryFunction>> = {
        accountInfo: jest.fn(async () => {
          await step(`${stage}-identity`);
          return settings.unknown ? {} : settings.mismatch && stage === 'final'
            ? { ...account, email: 'different@example.test' } : account;
        }),
        next: jest.fn(async () => {
          await step('init');
          return { done: false as const, value: { type: 'system', subtype: 'init', session_id: 'sdk-session-a' } as SDKMessage };
        }),
        close: jest.fn(() => {
          events.push(`${stage}-close`);
          if (settings.cancel === `${stage}-close`) controller.abort();
          if (settings.unproved !== stage) terminated.resolve();
        }),
      };
      return { sdkQuery: query as ReturnType<QueryFunction>, terminated: terminated.promise };
    }),
  };
  const log = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
  const flow = new NamedAccountQueryAdmission(runner, admission, persistence, registry, log, controller, 50);
  const queryFn = jest.fn() as QueryFunction;
  const source = { async *[Symbol.asyncIterator]() { yield message; } };
  const bootstrap = (resume?: string) => flow.bootstrap(queryFn, { kind: 'named', profileId: route.profileId }, resume);
  const launch = () => flow.launch(queryFn, source, { systemPrompt: 'private system role', resume: 'prior-session',
    title: 'private title', canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }) }, 'tab-a', metadata);
  const run = async (resume?: string) => { await bootstrap(resume); return launch(); };
  return { flow, events, reads, options, registry, persistence, admission, controller, log, bootstrap, launch, run,
    paused, entered, yielded: () => yielded, saved: () => saved, epoch: () => epochListener };
}

describe('named SDK bootstrap and final admission', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('closes bootstrap before final launch, then awaits both durable checkpoints before releasing input', async () => {
    const f = fixture({ pause: 'metadata' });
    const run = f.run();
    await f.entered.promise;
    expect(f.yielded()).toBe(0);
    expect(f.events.indexOf('bootstrap-close')).toBeLessThan(f.events.indexOf('final'));
    expect(f.events.indexOf('final-identity')).toBeLessThan(f.events.indexOf('registry'));
    expect(f.events.indexOf('registry')).toBeLessThan(f.events.indexOf('commit'));
    expect(f.events.indexOf('commit')).toBeLessThan(f.events.indexOf('attach'));
    expect(f.events.indexOf('attach')).toBeLessThan(f.events.indexOf('metadata'));
    expect(f.saved()).toBeUndefined();
    expect(f.options[0]).toMatchObject({ systemPrompt: '', persistSession: false, settingSources: [], tools: [], mcpServers: {} });
    for (const key of ['resume', 'forkSession', 'title', 'hooks', 'agents', 'plugins']) expect(f.options[0]).not.toHaveProperty(key);
    expect(JSON.stringify(f.options[0])).not.toContain('private');
    expect(await f.reads[0]).toEqual({ done: true, value: undefined });
    const permission = f.options[1].canUseTool;
    expect(permission).toBeDefined();
    if (permission) expect(await permission('Read', {}, { signal: f.controller.signal, toolUseID: 'tool', requestId: 'request' })).toMatchObject({ behavior: 'deny' });
    f.paused.resolve();
    const query = await run;
    await flush();
    expect(f.yielded()).toBe(1);
    expect(f.saved()?.identity.kind).toBe('known');
    expect((await query.next()).value).toMatchObject({ subtype: 'init' });
    await f.flow.dispose();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it.each(['admit', 'current', 'bootstrap-identity', 'final-identity', 'init', 'registry', 'commit', 'attach', 'metadata'])
  ('refuses %s failure without yielding or writing unbound metadata', async (fail) => {
    const f = fixture({ fail });
    await expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    expect(f.yielded()).toBe(0);
    expect(f.saved()).toBeUndefined();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(fail === 'admit' ? 0 : 1);
  });

  it.each(['lookup', 'admit', 'current', 'bootstrap-identity', 'bootstrap-close', 'final-identity', 'init', 'registry', 'commit', 'attach', 'metadata'])
  ('cancels at %s with closed gates and a single settlement', async (cancel) => {
    const f = fixture({ cancel });
    await expect(f.run(cancel === 'lookup' ? 'prior-session' : undefined)).rejects.toMatchObject({ code: 'release-held' });
    await flush();
    expect(f.yielded()).toBe(0);
    // A cancelled storage promise may finish, but can only persist bound metadata.
    if (f.saved()) expect(f.saved()).toEqual(binding);
    expect(jest.mocked(f.admission.releaseReservation).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('retains the reservation when bootstrap termination cannot be proved', async () => {
    jest.useFakeTimers();
    const f = fixture({ unproved: 'bootstrap' });
    const result = expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    await jest.runAllTimersAsync();
    await result;
    expect(f.yielded()).toBe(0);
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(1);
    expect(f.options).toHaveLength(1);
  });

  it.each(['bootstrap', 'final'])('retains after a %s launch throws with unproved process state', async (fail) => {
    jest.useFakeTimers();
    const f = fixture({ fail });
    const result = expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    await jest.runAllTimersAsync();
    await result;
    expect(f.yielded()).toBe(0);
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(1);
  });

  it('never downgrades a known final identity mismatch', async () => {
    const f = fixture({ mismatch: true });
    await expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    expect(f.yielded()).toBe(0);
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
  });

  it('refuses an unknown resume before bootstrap or final conversation options', async () => {
    const f = fixture({ resumeUnknown: true });
    await expect(f.run('prior-session')).rejects.toMatchObject({ code: 'release-held' });
    expect(f.options).toHaveLength(0);
    expect(f.admission.admitClaudeRoute).not.toHaveBeenCalled();
  });

  it('persists fresh unknown identity only after certified admission', async () => {
    const f = fixture({ unknown: true });
    await f.run();
    await flush();
    expect(f.saved()?.identity).toEqual({ kind: 'unknown' });
    expect(f.yielded()).toBe(1);
    await f.flow.dispose();
    const held = fixture({ unknown: true, held: true });
    await expect(held.run()).rejects.toMatchObject({ code: 'release-held' });
    expect(held.options).toHaveLength(0);
  });

  it('invalidates the registry on auth epoch change and stops dispatch', async () => {
    const f = fixture();
    await f.run();
    f.epoch()?.({ ...route, authEpoch: 1 });
    await f.flow.dispose();
    expect(f.registry.invalidateAccountRoute).toHaveBeenCalledWith({ ...route, authEpoch: 1 });
    expect(f.controller.signal.aborted).toBe(true);
  });


  it('reuses the durable binding and attachment for a known resume', async () => {
    const f = fixture();
    await f.run('sdk-session-a');
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(f.persistence.attachSdkSession).toHaveBeenCalledWith(expect.objectContaining({ runId: binding.runId, sdkSessionId: 'sdk-session-a' }));
    expect(f.saved()).toEqual(binding);
    await f.flow.dispose();
  });

  it('rejects a late metadata completion after cancellation without releasing a prompt', async () => {
    const f = fixture({ pause: 'metadata' });
    const result = expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    await f.entered.promise;
    f.controller.abort();
    await result;
    f.paused.resolve();
    await flush();
    expect(f.yielded()).toBe(0);
    expect(f.saved()).toEqual(binding);
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('leaves the ambient launch on the original prompt with no control call', () => {
    type Args = ConstructorParameters<typeof SdkQueryRunner>;
    const log: Partial<Args[0]> = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
    const runner = new SdkQueryRunner(log as Args[0], {} as Args[1], {} as Args[2], {} as Args[3],
      {} as Args[4], {}, {} as Args[6], {} as Args[7], {} as Args[8]);
    const partialQuery: Partial<ReturnType<QueryFunction>> = { accountInfo: jest.fn() };
    const query = partialQuery as ReturnType<QueryFunction>;
    const fn = jest.fn(() => query);
    const prompt = { async *[Symbol.asyncIterator]() { yield message; } };
    const options: Options = {};
    expect(runner.invokeWithLoadedQuery(fn, prompt, options).sdkQuery).toBe(query);
    expect(fn).toHaveBeenCalledWith({ prompt, options });
    expect(query.accountInfo).not.toHaveBeenCalled();
  });
});
