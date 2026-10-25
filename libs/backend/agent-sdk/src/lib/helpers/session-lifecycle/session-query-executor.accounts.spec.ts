import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type {
  ClaudeAccountNamedRoute, ClaudeAccountRunReservation, ClaudeCertifiedLaunchContext, ClaudeLaunchBoundary,
  ClaudeLaunchBoundaryOutcome, ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding } from '@ptah-extension/shared';
import type { AccountInfo, Options, QueryFunction, SDKMessage, SDKUserMessage } from '../../types/sdk-types/claude-sdk.types';
import { SdkQueryRunner } from '../sdk-query-runner.service';
import { CLAUDE_CERTIFIED_ENV_KEYS, certifiedEnvDigest } from '../claude-certified-launch';
import { claudeIdentityReference } from '../claude-identity-reference';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NamedAccountQueryAdmission, SessionQueryExecutor, type NamedAccountPersistencePort,
} from './session-query-executor.service';

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
const account: AccountInfo = { email: 'person@example.test', organization: 'org', tokenSource: 'claude.ai',
  subscriptionType: 'max' };
const binding: ProviderAccountBinding = {
  version: 1, provider: 'claude', profileId: route.profileId, routeRevision: 0,
  routeFingerprint: route.routeFingerprint, authEpoch: 0, runId: route.runId,
  identity: { kind: 'known', ownerKey: createHash('sha256').update('ptah-quota-owner\0person@example.test\0org').digest('hex') },
};
const launchEnv: Record<string, string> = {
  [CLAUDE_CERTIFIED_ENV_KEYS[0]]: 'certified-value',
  CLAUDE_CONFIG_DIR: route.canonicalConfigDir,
  CLAUDE_SECURESTORAGE_CONFIG_DIR: route.canonicalConfigDir,
};
const launchContext: ClaudeCertifiedLaunchContext = {
  executable: { command: 'claude-fixture', prefixArgs: [], sdkExecutablePath: '/certified/claude',
    version: '2.1.310', fingerprint: { size: 1, mtimeMs: 1 } },
  env: launchEnv, envDigest: certifiedEnvDigest(launchEnv), cwd: '/certified-workspace',
  settingSources: ['user', 'project', 'local'],
  policy: { coverage: 'win32@2.1.310', managedFile: 'absent', managedDropIn: 'absent', registry: 'absent',
    remoteSignals: 'absent' },
  accountClass: 'personal',
  identityReference: claudeIdentityReference('person@example.test', 'org') ?? '',
};
const resources = { kind: 'named' as const, route, accountDataDir: '/metadata',
  filesystemIdentity: { volumeId: 'v', fileId: 'f' }, launch: launchContext };
const metadata = { name: 'private title', workspaceId: '/workspace', createdAt: 1, lastActiveAt: 1,
  totalCost: 0, totalTokens: { input: 0, output: 0 } };
const message: SDKUserMessage = { type: 'user', session_id: '', parent_tool_use_id: null,
  message: { role: 'user', content: 'private conversation' } };
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

function fixture(settings: { fail?: string; cancel?: string; unproved?: string; unknown?: boolean;
  mismatch?: boolean; pause?: string; held?: boolean; resumeUnknown?: boolean;
  finalIdentity?: AccountInfo; changedAtFinalRead?: number; noLaunch?: boolean;
  boundary?: { at: ClaudeLaunchBoundary; terminated: boolean }; identityPatch?: Partial<AccountInfo>;
  initPatch?: Record<string, unknown>; finalOptions?: Partial<Options>;
  /** The session's project directory; admission certifies it unless `certifiedCwd` overrides. */
  projectDir?: string; certifiedCwd?: string } = {}) {
  const projectDir = settings.projectDir ?? launchContext.cwd;
  const certifiedLaunch = settings.projectDir === undefined && settings.certifiedCwd === undefined
    ? launchContext : { ...launchContext, cwd: settings.certifiedCwd ?? projectDir };
  const certifiedResources = { ...resources, launch: certifiedLaunch };
  const controller = new AbortController();
  const events: string[] = [];
  const paused = deferred<void>();
  const entered = deferred<void>();
  let yielded = 0;
  const occurrences = new Map<string, number>();
  const terminations: Array<ReturnType<typeof deferred<void>>> = [];
  let saved: ProviderAccountBinding | undefined;
  let epochListener: ((changed: ClaudeAccountNamedRoute) => void) | undefined;
  const step = async (name: string) => {
    events.push(name);
    const occurrence = (occurrences.get(name) ?? 0) + 1;
    occurrences.set(name, occurrence);
    if (settings.cancel === name) controller.abort();
    if (settings.fail === name) throw new Error('sensitive provider detail');
    if (settings.pause === name || settings.pause === `${name}:${occurrence}`) { entered.resolve(); await paused.promise; }
  };
  const admission: ProviderAccountAdmissionPort = {
    admitClaudeRoute: jest.fn(async (): ReturnType<ProviderAccountAdmissionPort['admitClaudeRoute']> => {
      await step('admit');
      if (settings.held) return { code: 'release-held', summary: 'Held.' };
      if (settings.noLaunch) {
        const { launch: _omitted, ...withoutLaunch } = resources;
        return { code: 'ok', resources: withoutLaunch, reservation };
      }
      return { code: 'ok', resources: certifiedResources, reservation };
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
    checkLaunchBoundary: jest.fn(async (_route, _launch, boundary): Promise<ClaudeLaunchBoundaryOutcome> => {
      await step('boundary');
      return settings.boundary?.at === boundary
        ? { ok: false, code: 'unsupported-source', terminated: settings.boundary.terminated } : { ok: true };
    }),
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
      terminations.push(terminated);
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
          if (stage === 'final' && settings.changedAtFinalRead === occurrences.get('final-identity'))
            return settings.finalIdentity ?? {};
          if (settings.unknown) return {};
          const info = settings.mismatch && stage === 'final' ? { ...account, email: 'different@example.test' } : account;
          return { ...info, ...settings.identityPatch };
        }),
        next: jest.fn(async () => {
          await step('init');
          return { done: false as const, value: { type: 'system', subtype: 'init', session_id: 'sdk-session-a',
            claude_code_version: '2.1.310', apiKeySource: 'none', ...settings.initPatch } as SDKMessage };
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
  const bootstrap = (resume?: string) =>
    flow.bootstrap(queryFn, { kind: 'named', profileId: route.profileId }, projectDir, resume);
  // The builder's named final options: certified executable, env, cwd and sources.
  const launch = () => flow.launch(queryFn, source, { systemPrompt: 'private system role', resume: 'prior-session',
    title: 'private title', canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
    pathToClaudeCodeExecutable: launchContext.executable.sdkExecutablePath, env: { ...launchEnv },
    cwd: certifiedLaunch.cwd, settingSources: [...launchContext.settingSources], ...settings.finalOptions },
  'tab-a', metadata);
  const run = async (resume?: string) => { await bootstrap(resume); return launch(); };
  return { flow, events, reads, options, registry, persistence, admission, controller, log, bootstrap, launch, run,
    paused, entered, terminations, runner, yielded: () => yielded, saved: () => saved, epoch: () => epochListener };
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

  it('bootstraps with the certified env and executable, and no managed settings', async () => {
    const f = fixture();
    await f.run();
    expect(f.options[0].env).toEqual(launchEnv);
    expect(f.options[0].pathToClaudeCodeExecutable).toBe(launchContext.executable.sdkExecutablePath);
    for (const options of f.options) {
      expect(options).not.toHaveProperty('managedSettings');
      expect(Object.keys(options.extraArgs ?? {}).join(' ')).not.toContain('managed-settings');
    }
    await f.flow.dispose();
  });

  it('refuses a named route without a certified launch before any child or boundary check', async () => {
    const f = fixture({ noLaunch: true });
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.runner.invokeNamedQuery).not.toHaveBeenCalled();
    expect(f.persistence.checkLaunchBoundary).not.toHaveBeenCalled();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
    expect(f.admission.retainUnresolvedReservation).not.toHaveBeenCalled();
  });

  it('awaits each boundary check after route revalidation and before its own child', async () => {
    const f = fixture();
    await f.run();
    const at = (name: string, from = 0) => f.events.indexOf(name, from);
    expect(at('current')).toBeLessThan(at('boundary'));
    expect(at('boundary')).toBeLessThan(at('bootstrap'));
    const second = at('boundary', at('bootstrap'));
    expect(second).toBeGreaterThan(at('bootstrap-close'));
    expect(second).toBeLessThan(at('final'));
    expect(f.persistence.checkLaunchBoundary).toHaveBeenNthCalledWith(1, route, launchContext, 'bootstrap',
      f.controller.signal);
    expect(f.persistence.checkLaunchBoundary).toHaveBeenNthCalledWith(2, route, launchContext, 'final',
      f.controller.signal);
    await f.flow.dispose();
  });

  it('holds the bootstrap child until its boundary check resolves', async () => {
    const f = fixture({ pause: 'boundary:1' });
    const pending = f.run();
    await f.entered.promise;
    await flush();
    expect(f.runner.invokeNamedQuery).not.toHaveBeenCalled();
    f.paused.resolve();
    await pending;
    await f.flow.dispose();
  });

  it.each([
    ['bootstrap', true, 0], ['bootstrap', false, 0], ['final', true, 1], ['final', false, 1],
  ] as const)('refuses a %s boundary (terminated %p) with no query for that child and one settlement',
    async (at, terminated, children) => {
      const f = fixture({ boundary: { at, terminated } });
      await expect(f.run()).rejects.toMatchObject({ code: 'unsupported-source' });
      await f.flow.dispose();
      expect(f.options).toHaveLength(children);
      expect(f.yielded()).toBe(0);
      expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
      expect(f.admission.releaseReservation).toHaveBeenCalledTimes(terminated ? 1 : 0);
      expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(terminated ? 0 : 1);
    });

  it('retains when the boundary check itself fails, and maps the foreign error to release-held', async () => {
    const f = fixture({ fail: 'boundary' });
    await expect(f.run()).rejects.toEqual({ code: 'release-held',
      summary: 'Named account admission could not be completed.' });
    expect(f.runner.invokeNamedQuery).not.toHaveBeenCalled();
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Partial<AccountInfo>]>([
    ['console token', { tokenSource: 'none' }],
    ['api key helper', { apiKeySource: 'apiKeyHelper' }],
    ['team subscription', { subscriptionType: 'team' }],
    ['unknown subscription word', { subscriptionType: 'ultra' }],
    ['no subscription', { subscriptionType: undefined }],
    ['bedrock provider', { apiProvider: 'bedrock' }],
  ])('tripwire refuses %s before the gate opens', async (_name, identityPatch) => {
    const f = fixture({ identityPatch });
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.options).toHaveLength(1);
    expect(await f.reads[0]).toEqual({ done: true, value: undefined });
    expect(f.yielded()).toBe(0);
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
  });

  it('accepts an explicit apiKeySource of none', async () => {
    const f = fixture({ identityPatch: { apiKeySource: 'none' } });
    await f.run();
    await f.flow.dispose();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Record<string, unknown>]>([
    ['another CLI version', { claude_code_version: '9.9.9' }],
    ['an API key source', { apiKeySource: 'ANTHROPIC_API_KEY' }],
  ])('refuses an init message with %s before any binding', async (_name, initPatch) => {
    const f = fixture({ initPatch });
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(f.yielded()).toBe(0);
  });

  it('accepts an oauth init key source', async () => {
    const f = fixture({ initPatch: { apiKeySource: 'oauth' } });
    await f.run();
    await flush();
    expect(f.yielded()).toBe(1);
    await f.flow.dispose();
  });

  it.each<[string, Partial<Options>, string]>([
    ['a flag-tier credential override', { settings: { apiKeyHelper: 'helper' } }, 'identity-unproved'],
    ['a flag-tier override as JSON', { settings: JSON.stringify({ forceLoginOrgUUID: 'x' }) }, 'identity-unproved'],
    ['managed settings', { managedSettings: {} }, 'identity-unproved'],
    ['a managed-settings extra arg', { extraArgs: { 'managed-settings': 'x' } }, 'identity-unproved'],
    ['a drifted env', { env: { ...launchEnv, EXTRA_SELECTOR: 'x' } }, 'route-changed'],
    ['another cwd', { cwd: '/elsewhere' }, 'route-changed'],
  ])('refuses %s in the final options before invoke', async (_name, finalOptions, code) => {
    const f = fixture({ finalOptions });
    await expect(f.run()).rejects.toMatchObject({ code });
    expect(f.options).toHaveLength(1);
    expect(f.persistence.checkLaunchBoundary).toHaveBeenCalledTimes(1);
    await f.flow.dispose();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it.each(['admit', 'current', 'bootstrap-identity', 'final-identity', 'init', 'registry', 'commit', 'attach', 'metadata'])('refuses %s failure without yielding or writing unbound metadata', async (fail) => {
    const f = fixture({ fail });
    await expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    expect(f.yielded()).toBe(0);
    expect(f.saved()).toBeUndefined();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(fail === 'admit' ? 0 : 1);
  });

  it.each(['lookup', 'admit', 'current', 'boundary', 'bootstrap-identity', 'bootstrap-close', 'final-identity', 'init', 'registry', 'commit', 'attach', 'metadata'])('cancels at %s with closed gates and a single settlement', async (cancel) => {
    const f = fixture({ cancel });
    await expect(f.run(cancel === 'lookup' ? 'prior-session' : undefined)).rejects.toMatchObject({ code: 'release-held' });
    await flush();
    await f.flow.dispose();
    expect(f.yielded()).toBe(0);
    // A cancelled storage promise may finish, but can only persist bound metadata.
    if (f.saved()) expect(f.saved()).toEqual(binding);
    const settlements = jest.mocked(f.admission.releaseReservation).mock.calls.length +
      jest.mocked(f.admission.retainUnresolvedReservation).mock.calls.length;
    expect(settlements).toBeLessThanOrEqual(1);
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
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.yielded()).toBe(0);
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
  });

  it('refuses an unknown resume before bootstrap or final conversation options', async () => {
    const f = fixture({ resumeUnknown: true });
    await expect(f.run('prior-session')).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.options).toHaveLength(0);
    expect(f.admission.admitClaudeRoute).not.toHaveBeenCalled();
  });

  it('refuses a fresh unknown identity before the final child; a held admission keeps its code', async () => {
    const f = fixture({ unknown: true });
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.options).toHaveLength(1);
    expect(f.saved()).toBeUndefined();
    expect(f.yielded()).toBe(0);
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
    expect(f.admission.admitClaudeRoute).toHaveBeenCalledTimes(1);
    expect(f.admission.admitClaudeRoute).toHaveBeenCalledWith(expect.objectContaining({ runId: binding.runId }));
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


// A2 mocked evidence only: no installed SDK or live compatibility certification.
describe('A2 mocked-evidence main admission adversarial matrix', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each(['commit', 'attach', 'metadata', 'final-identity:2'])(
    'keeps the prompt pending until %s completes', async pause => {
      const f = fixture({ pause });
      const pending = f.run();
      await f.entered.promise;
      await flush();
      expect(f.yielded()).toBe(0);
      expect(f.admission.releaseReservation).not.toHaveBeenCalled();
      f.paused.resolve();
      await pending;
      await flush();
      expect(await f.reads[1]).toEqual({ done: false, value: message });
      expect(f.saved()).toEqual(binding);
      await f.flow.dispose();
    },
  );

  it.each(['lookup', 'admit', 'current', 'bootstrap-identity', 'final-identity',
    'init', 'commit', 'attach', 'metadata', 'current:3', 'final-identity:2'])(
    'ignores late %s completion after cancellation and settles once', async pause => {
      const f = fixture({ pause });
      const rejected = expect(f.run(pause === 'lookup' ? 'sdk-session-a' : undefined))
        .rejects.toMatchObject({ code: 'release-held' });
      await f.entered.promise;
      f.controller.abort();
      await rejected;
      f.paused.resolve();
      await flush();
      await f.flow.dispose();
      expect(f.yielded()).toBe(0);
      expect(f.admission.releaseReservation).toHaveBeenCalledTimes(pause === 'lookup' ? 0 : 1);
      expect(f.admission.retainUnresolvedReservation).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { ...account, email: 'other@example.test' }])(
    'refuses changed own-query identity after durable writes: %p', async finalIdentity => {
      const f = fixture({ changedAtFinalRead: 2, finalIdentity });
      await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
      expect(f.saved()).toEqual(binding);
      expect(f.yielded()).toBe(0);
      expect(f.events.filter(event => event === 'final-identity')).toHaveLength(2);
    },
  );

  it('waits for final child close proof before releasing the lease', async () => {
    const f = fixture({ unproved: 'final', pause: 'metadata' });
    const rejected = expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    await f.entered.promise;
    f.controller.abort();
    await flush();
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).not.toHaveBeenCalled();
    f.terminations[1].resolve();
    await rejected;
    f.paused.resolve();
    await f.flow.dispose();
    expect(f.yielded()).toBe(0);
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('retains an uncertain final child after cancellation without yielding', async () => {
    const f = fixture({ unproved: 'final', pause: 'metadata' });
    const rejected = expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    await f.entered.promise;
    f.controller.abort();
    await jest.runAllTimersAsync();
    await rejected;
    f.paused.resolve();
    await f.flow.dispose();
    expect(f.yielded()).toBe(0);
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(1);
  });

  it('retains when a boundary check is cancelled before it proves its children closed', async () => {
    const f = fixture({ pause: 'boundary:2' });
    const rejected = expect(f.run()).rejects.toMatchObject({ code: 'release-held' });
    await f.entered.promise;
    f.controller.abort();
    await rejected;
    f.paused.resolve();
    await flush();
    await f.flow.dispose();
    expect(f.options).toHaveLength(1);
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(1);
  });

  it('never promotes an old unknown binding using a newly known query', async () => {
    const f = fixture({ resumeUnknown: true });
    await expect(f.run('sdk-session-a')).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.options).toEqual([]);
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(f.persistence.attachSdkSession).not.toHaveBeenCalled();
    expect(f.persistence.saveAccountBound).not.toHaveBeenCalled();
    expect(f.yielded()).toBe(0);
  });

  it('resumes after same-identity re-auth without rewriting the old binding epoch', async () => {
    const f = fixture();
    jest.mocked(f.admission.admitClaudeRoute).mockResolvedValue({
      code: 'ok', resources: { ...resources, route: { ...route, authEpoch: 1 } },
      reservation: { ...reservation, authEpoch: 1 },
    });
    await f.run('sdk-session-a');
    await flush();
    expect(f.yielded()).toBe(1);
    expect(f.saved()).toEqual(binding);
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    await f.flow.dispose();
  });

  it('refuses a previously known resume when the current query identity is unknown', async () => {
    const f = fixture({ unknown: true });
    await expect(f.run('sdk-session-a')).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.options).toHaveLength(1);
    expect(f.yielded()).toBe(0);
    expect(f.persistence.attachSdkSession).not.toHaveBeenCalled();
    expect(f.persistence.saveAccountBound).not.toHaveBeenCalled();
  });

});

// P3 finding 4: admission certifies the project directory, not the account directory.
describe('named main chat certifies and runs in the session project directory', () => {
  const projectDir = join(tmpdir(), 'ptah-named-project');
  const accountDir = join(tmpdir(), 'ptah-named-account');

  it('passes the project directory to admission; the certified launch and final query use it', async () => {
    const f = fixture({ projectDir });
    expect(projectDir).not.toBe(accountDir);
    await f.run();
    expect(f.admission.admitClaudeRoute).toHaveBeenCalledWith(expect.objectContaining({ workingDirectory: projectDir }));
    expect(f.flow.certifiedLaunch?.cwd).toBe(projectDir);
    // The certified policy scan (both boundary checks) ran against the project-directory launch.
    for (const call of jest.mocked(f.persistence.checkLaunchBoundary).mock.calls) expect(call[1].cwd).toBe(projectDir);
    expect(f.options).toHaveLength(2);
    expect(f.options[1].cwd).toBe(projectDir);
    await f.flow.dispose();
  });

  it('refuses a launch certified for another directory before any child or boundary check', async () => {
    const f = fixture({ projectDir, certifiedCwd: accountDir });
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.admission.admitClaudeRoute).toHaveBeenCalledWith(expect.objectContaining({ workingDirectory: projectDir }));
    expect(f.runner.invokeNamedQuery).not.toHaveBeenCalled();
    expect(f.persistence.checkLaunchBoundary).not.toHaveBeenCalled();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });
});

// P3 finding 6 (executor side): a failed admission logs no provider text.
describe('named admission failure logs only fixed text', () => {
  const adversarial = ['C:\\Users\\person\\.claude-account', 'person@example.test', 'org-0123456789abcdef',
    'sk-ant-oat01-secretsecretsecret', 'sensitive provider detail'];

  it.each(['admit', 'bootstrap-identity', 'final-identity', 'attach'])('fails at %s without logging provider text', async (at) => {
    const f = fixture({ fail: at });
    const refusal = await f.run().then(() => undefined, (error: unknown) => error);
    expect(refusal).toMatchObject({ summary: 'Named account admission could not be completed.' });
    await f.flow.dispose();
    const logged = JSON.stringify([f.log.warn.mock.calls, f.log.info.mock.calls, f.log.debug.mock.calls,
      f.log.error.mock.calls, refusal]);
    for (const value of adversarial) expect(logged).not.toContain(value);
  });
});

// P3 finding 7: a host without admission or persistence refuses `unavailable-storage`.
describe('SessionQueryExecutor named run without account ports', () => {
  function executorWith(ports: { admission: boolean; persistence: boolean }, projectPath?: string) {
    const admitClaudeRoute = jest.fn();
    const queryRunner = {
      accountAdmission: ports.admission ? { admitClaudeRoute, releaseReservation: jest.fn(),
        retainUnresolvedReservation: jest.fn() } : undefined,
      accountPersistence: ports.persistence ? { resolveAccountBinding: jest.fn() } : undefined,
      invokeNamedQuery: jest.fn(),
      invokeWithLoadedQuery: jest.fn(),
    };
    const moduleLoader = { getQueryFunction: jest.fn() };
    const builder = { build: jest.fn() };
    const registry = { register: jest.fn(() => ({ messageQueue: [] })), remove: jest.fn() };
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
    const Ctor = SessionQueryExecutor as unknown as new (...args: unknown[]) => SessionQueryExecutor;
    const executor = new Ctor(logger, registry, {}, {}, moduleLoader, builder, { createUserMessage: jest.fn() }, {},
      queryRunner);
    const execute = () => executor.executeQuery({ sessionId: 'tab-a', sessionConfig: {
      model: 'claude-sonnet-4-5', tabId: 'tab-a', projectPath,
      accountSelection: { kind: 'named', profileId: route.profileId },
    } } as unknown as Parameters<SessionQueryExecutor['executeQuery']>[0]);
    return { execute, admitClaudeRoute, queryRunner, moduleLoader, builder, registry };
  }

  it.each([
    ['admission', { admission: false, persistence: true }],
    ['persistence', { admission: true, persistence: false }],
    ['both', { admission: false, persistence: false }],
  ])('refuses unavailable-storage when %s is missing, before admission or any query', async (_label, ports) => {
    const h = executorWith(ports, join(tmpdir(), 'ptah-named-project'));
    await expect(h.execute()).rejects.toMatchObject({ code: 'unavailable-storage' });
    expect(h.admitClaudeRoute).not.toHaveBeenCalled();
    expect(h.moduleLoader.getQueryFunction).not.toHaveBeenCalled();
    expect(h.builder.build).not.toHaveBeenCalled();
    expect(h.queryRunner.invokeNamedQuery).not.toHaveBeenCalled();
    expect(h.queryRunner.invokeWithLoadedQuery).not.toHaveBeenCalled();
    expect(h.registry.remove).toHaveBeenCalledTimes(1);
  });

  it('refuses a named run with no project directory before admission', async () => {
    const h = executorWith({ admission: true, persistence: true });
    await expect(h.execute()).rejects.toMatchObject({ code: 'conflict' });
    expect(h.admitClaudeRoute).not.toHaveBeenCalled();
    expect(h.queryRunner.invokeNamedQuery).not.toHaveBeenCalled();
  });
});
