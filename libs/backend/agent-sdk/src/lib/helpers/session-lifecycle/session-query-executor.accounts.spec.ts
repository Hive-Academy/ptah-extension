import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type {
  ClaudeAccountNamedRoute, ClaudeAccountRunReservation, ClaudeCertifiedLaunchContext, ClaudeLaunchBoundary,
  ClaudeLaunchBoundaryOutcome, ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding } from '@ptah-extension/shared';
import type { AccountInfo, HookInput, Options, QueryFunction, SDKMessage, SDKUserMessage } from '../../types/sdk-types/claude-sdk.types';
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
const followUp: SDKUserMessage = { ...message, message: { role: 'user', content: 'later turn' } };
const toolContext = (signal: AbortSignal) => ({ signal, toolUseID: 'tool', requestId: 'request' });
const toolHookInput: HookInput = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {},
  tool_use_id: 'tool', session_id: 'sdk-session-a', transcript_path: '', cwd: '' };
const denyHook = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } };
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

function fixture(settings: { fail?: string; cancel?: string; unproved?: string; unknown?: boolean;
  mismatch?: boolean; pause?: string; held?: boolean; resumeUnknown?: boolean;
  finalIdentity?: AccountInfo; changedAtFinalRead?: number; noLaunch?: boolean;
  boundary?: { at: ClaudeLaunchBoundary; terminated: boolean }; identityPatch?: Partial<AccountInfo>;
  initPatch?: Record<string, unknown>; finalOptions?: Partial<Options>;
  /** The session's project directory; admission certifies it unless `certifiedCwd` overrides. */
  projectDir?: string; certifiedCwd?: string;
  /**
   * Models CLI 2.1.278 streaming input: the final child reads the first prompt
   * turn and asks for one tool before it emits `system/init`.
   */
  initAfterFirstTurn?: boolean;
  /** Per-step deadline and total admission budget passed to the flow. */
  deadlineMs?: number; budgetMs?: number;
  /** Absolute end of the calling RPC (D73), set at handler entry. */
  operationDeadline?: number } = {}) {
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
  const preInitTools: string[] = [];
  const reads: Promise<IteratorResult<SDKUserMessage>>[] = [];
  const iterators: AsyncIterator<SDKUserMessage>[] = [];
  const runner: Pick<SdkQueryRunner, 'invokeNamedQuery'> = {
    invokeNamedQuery: jest.fn((_fn, prompt, queryOptions, observe) => {
      const stage = options.length === 0 ? 'bootstrap' : 'final';
      events.push(stage);
      options.push(queryOptions);
      const terminated = deferred<void>();
      terminations.push(terminated);
      observe?.(terminated.promise);
      const iterator = prompt[Symbol.asyncIterator]();
      iterators.push(iterator);
      const read = iterator.next().then((result) => {
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
        next: jest.fn(async (): Promise<IteratorResult<SDKMessage, void>> => {
          if (settings.initAfterFirstTurn && stage === 'final' && !events.includes('turn-consumed')) {
            const turn = await read;
            if (turn.done) return { done: true, value: undefined };
            events.push('turn-consumed');
            const decision = await queryOptions.canUseTool?.('Read', {}, { signal: controller.signal,
              toolUseID: 'pre-init', requestId: 'pre-init' });
            preInitTools.push(decision?.behavior ?? 'none');
          }
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
  const flow = new NamedAccountQueryAdmission(runner, admission, persistence, registry, log, controller,
    settings.deadlineMs ?? 50, settings.budgetMs, settings.operationDeadline);
  const queryFn = jest.fn() as QueryFunction;
  const source = { async *[Symbol.asyncIterator]() {
    events.push('turn-1');
    yield message;
    events.push('turn-2');
    yield followUp;
  } };
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
    paused, entered, terminations, runner, iterators, preInitTools, yielded: () => yielded, saved: () => saved,
    epoch: () => epochListener };
}

/** Refusals after the identity proof release the first turn (D69); nothing else reaches the run. */
const AFTER_PROOF = new Set(['init', 'registry', 'commit', 'attach', 'metadata', 'current:3', 'final-identity:2']);

/** After a refusal: no later turn was pulled and a tool call is denied. */
async function expectNoAdmission(f: ReturnType<typeof fixture>): Promise<void> {
  expect(f.events).not.toContain('turn-2');
  const permission = f.options[1]?.canUseTool;
  if (permission) expect(await permission('Read', {}, toolContext(f.controller.signal))).toMatchObject({ behavior: 'deny' });
}

describe('named SDK bootstrap and final admission', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('closes bootstrap before final launch, then awaits both durable checkpoints before releasing later input', async () => {
    const f = fixture({ pause: 'metadata' });
    let resolved = false;
    const run = f.run().then((query) => { resolved = true; return query; });
    await f.entered.promise;
    // Only the first turn is released after the identity proof (D69); no output yet.
    expect(f.yielded()).toBe(1);
    expect(f.events).not.toContain('turn-2');
    expect(resolved).toBe(false);
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
    // After a verified init a tool call waits for admission instead of being denied.
    let decision: unknown;
    const held = permission?.('Read', {}, toolContext(f.controller.signal)).then((value) => { decision = value; });
    await flush();
    expect(decision).toBeUndefined();
    f.paused.resolve();
    const query = await run;
    await held;
    expect(decision).toMatchObject({ behavior: 'allow' });
    await flush();
    expect(f.yielded()).toBe(1);
    expect(f.saved()?.identity.kind).toBe('known');
    expect((await query.next()).value).toMatchObject({ subtype: 'init' });
    await f.flow.dispose();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('releases the first turn after the identity proof, then admits on init (D69, CLI 2.1.278 order)', async () => {
    const f = fixture({ initAfterFirstTurn: true, pause: 'commit' });
    let resolved = false;
    const run = f.run().then((query) => { resolved = true; return query; });
    await f.entered.promise;
    await flush();
    const at = (name: string) => f.events.indexOf(name);
    const proof = f.events.indexOf('final-identity');
    expect(proof).toBeGreaterThan(at('final'));
    expect(proof).toBeLessThan(at('turn-consumed'));
    expect(at('turn-consumed')).toBeLessThan(at('init'));
    expect(at('init')).toBeLessThan(at('commit'));
    // The pre-init tool call was denied; no later turn and no output before admission.
    expect(f.preInitTools).toEqual(['deny']);
    expect(f.yielded()).toBe(1);
    const later = f.iterators[1].next();
    await flush();
    expect(f.events).not.toContain('turn-2');
    expect(resolved).toBe(false);
    expect(f.saved()).toBeUndefined();
    f.paused.resolve();
    const query = await run;
    expect(at('commit')).toBeLessThan(at('metadata'));
    expect((await query.next()).value).toMatchObject({ subtype: 'init' });
    // The first turn travelled exactly once; the next pull is the later turn.
    expect(await later).toEqual({ done: false, value: followUp });
    expect(f.events.filter((event) => event === 'turn-1')).toHaveLength(1);
    expect(at('turn-2')).toBeGreaterThan(at('metadata'));
    expect(f.saved()?.identity.kind).toBe('known');
    await f.flow.dispose();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('consumes no prompt while the same-child identity proof is still pending', async () => {
    const f = fixture({ pause: 'final-identity:1' });
    const run = f.run();
    await f.entered.promise;
    await flush();
    expect(f.yielded()).toBe(0);
    expect(f.events).not.toContain('turn-1');
    f.paused.resolve();
    await run;
    expect(f.yielded()).toBe(1);
    await f.flow.dispose();
  });

  it('gates every tool with a PreToolUse hook under bypassPermissions, ahead of caller hooks (F1)', async () => {
    const callerHook = jest.fn(async () => ({}));
    const f = fixture({ pause: 'init', finalOptions: { permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [callerHook] }] } } });
    const run = f.run();
    await f.entered.promise;
    const matchers = f.options[1].hooks?.PreToolUse ?? [];
    expect(matchers).toHaveLength(2);
    expect(matchers[0].matcher).toBeUndefined();
    expect(matchers[1].hooks).toEqual([callerHook]);
    const hook = matchers[0].hooks[0];
    const signal = new AbortController().signal;
    // Before a verified init the hook denies, even though the mode auto-approves.
    expect(await hook(toolHookInput, 'tool', { signal })).toMatchObject(denyHook);
    f.paused.resolve();
    await run;
    // Admitted: no decision, so the caller's permission flow applies.
    expect(await hook(toolHookInput, 'tool', { signal })).toEqual({});
    await f.flow.dispose();
    expect(await hook(toolHookInput, 'tool', { signal })).toMatchObject(denyHook);
  });

  it('holds a PreToolUse call after init until the binding commits, then gives no decision (F1)', async () => {
    const f = fixture({ pause: 'metadata', finalOptions: { permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true } });
    const run = f.run();
    await f.entered.promise;
    const hook = f.options[1].hooks?.PreToolUse?.[0]?.hooks[0];
    let decision: unknown;
    const held = hook?.(toolHookInput, 'tool', { signal: new AbortController().signal })
      .then((value) => { decision = value; });
    await flush();
    expect(decision).toBeUndefined();
    f.paused.resolve();
    await run;
    await held;
    expect(decision).toEqual({});
    await f.flow.dispose();
  });

  it('denies a held PreToolUse call when the run is aborted before admission (F1)', async () => {
    const f = fixture({ pause: 'metadata', finalOptions: { permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true } });
    const run = f.run();
    await f.entered.promise;
    const hook = f.options[1].hooks?.PreToolUse?.[0]?.hooks[0];
    const held = hook?.(toolHookInput, 'tool', { signal: new AbortController().signal });
    f.controller.abort();
    expect(await held).toMatchObject(denyHook);
    f.paused.resolve();
    expect(await run.then(() => 'returned', () => 'refused')).toBe('refused');
    expect(f.events).not.toContain('turn-2');
  });

  it('makes dispose terminal: a held tool is denied and a late identity success admits nothing (F2)', async () => {
    const f = fixture({ pause: 'final-identity:2' });
    const run = f.run().then(() => 'returned', () => 'refused');
    await f.entered.promise;
    const permission = f.options[1].canUseTool;
    const hook = f.options[1].hooks?.PreToolUse?.[0]?.hooks[0];
    let decision: unknown;
    let hookDecision: unknown;
    const heldTool = permission?.('Read', {}, toolContext(new AbortController().signal))
      .then((value) => { decision = value; });
    const heldHook = hook?.(toolHookInput, 'tool', { signal: new AbortController().signal })
      .then((value) => { hookDecision = value; });
    await flush();
    expect(decision).toBeUndefined();
    expect(hookDecision).toBeUndefined();
    const disposing = f.flow.dispose();
    await heldTool;
    await heldHook;
    expect(decision).toMatchObject({ behavior: 'deny' });
    expect(hookDecision).toMatchObject(denyHook);
    expect(f.controller.signal.aborted).toBe(true);
    // The pending identity read now succeeds: nothing is admitted or returned.
    f.paused.resolve();
    expect(await run).toBe('refused');
    await flush();
    expect(f.events).not.toContain('turn-2');
    expect(await permission?.('Read', {}, toolContext(new AbortController().signal)))
      .toMatchObject({ behavior: 'deny' });
    await disposing;
  });

  it('refuses when no init arrives before the deadline, with the first turn only and no binding', async () => {
    const f = fixture({ initAfterFirstTurn: true, pause: 'init' });
    const rejected = expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    await f.entered.promise;
    await rejected;
    expect(f.controller.signal.aborted).toBe(true);
    expect(f.yielded()).toBe(1);
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(f.saved()).toBeUndefined();
    await expectNoAdmission(f);
    f.paused.resolve();
    await f.flow.dispose();
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

  it('retains when the boundary check itself fails, and maps the foreign error to identity-unproved', async () => {
    const f = fixture({ fail: 'boundary' });
    await expect(f.run()).rejects.toEqual({ code: 'identity-unproved',
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
    const f = fixture({ initPatch, initAfterFirstTurn: true });
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(f.yielded()).toBe(1);
    expect(f.saved()).toBeUndefined();
    await expectNoAdmission(f);
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
    const f = fixture({ fail, initAfterFirstTurn: true });
    // A refused registry bind is a real conflict; any other failure is unproved.
    await expect(f.run()).rejects.toMatchObject({ code: fail === 'registry' ? 'conflict' : 'identity-unproved' });
    expect(f.yielded()).toBe(AFTER_PROOF.has(fail) ? 1 : 0);
    await expectNoAdmission(f);
    expect(f.saved()).toBeUndefined();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(fail === 'admit' ? 0 : 1);
  });

  it.each(['lookup', 'admit', 'current', 'boundary', 'bootstrap-identity', 'bootstrap-close', 'final-identity', 'init', 'registry', 'commit', 'attach', 'metadata'])('cancels at %s with closed gates and a single settlement', async (cancel) => {
    const f = fixture({ cancel, initAfterFirstTurn: true });
    await expect(f.run(cancel === 'lookup' ? 'prior-session' : undefined)).rejects.toMatchObject({ code: 'identity-unproved' });
    await flush();
    await f.flow.dispose();
    expect(f.yielded()).toBe(AFTER_PROOF.has(cancel) ? 1 : 0);
    await expectNoAdmission(f);
    // A cancelled storage promise may finish, but can only persist bound metadata.
    if (f.saved()) expect(f.saved()).toEqual(binding);
    const settlements = jest.mocked(f.admission.releaseReservation).mock.calls.length +
      jest.mocked(f.admission.retainUnresolvedReservation).mock.calls.length;
    expect(settlements).toBeLessThanOrEqual(1);
  });

  // R4.9 timeout: the admission deadline expires on its own, with no caller abort.
  it.each([
    ['before any SDK child', 'current', undefined, true],
    ['with an unproved bootstrap child', 'bootstrap-identity', 'bootstrap', false],
  ] as const)('refuses when the bootstrap deadline expires %s, with no final query and one settlement',
    async (_name, pause, unproved, released) => {
      jest.useFakeTimers();
      const f = fixture({ pause, unproved });
      const rejected = expect(f.run()).rejects.toEqual({ code: 'identity-unproved',
        summary: 'Named account admission could not be completed.' });
      await f.entered.promise;
      expect(f.controller.signal.aborted).toBe(false);
      await jest.runAllTimersAsync();
      await rejected;
      // The deadline itself aborted the run; the caller never did.
      expect(f.controller.signal.aborted).toBe(true);
      f.paused.resolve();
      await flush();
      await f.flow.dispose();
      expect(f.options).toHaveLength(pause === 'current' ? 0 : 1);
      expect(f.yielded()).toBe(0);
      expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
      expect(f.saved()).toBeUndefined();
      expect(f.admission.releaseReservation).toHaveBeenCalledTimes(released ? 1 : 0);
      expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(released ? 0 : 1);
    });

  // D72: the whole admission is bounded, not only each step, so the renderer's
  // admission RPC timeout (derived from the same budget) always outlasts it.
  it('refuses when the total admission budget expires before any single step deadline', async () => {
    jest.useFakeTimers();
    const f = fixture({ pause: 'commit', deadlineMs: 60_000, budgetMs: 1_000 });
    let settled = false;
    const rejected = expect(f.run().finally(() => { settled = true; })).rejects.toMatchObject({
      code: 'identity-unproved' });
    await f.entered.promise;
    await jest.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect(f.controller.signal.aborted).toBe(true);
    f.paused.resolve();
    await flush();
    await f.flow.dispose();
    expect(f.saved()).toBeUndefined();
    expect(f.persistence.attachSdkSession).not.toHaveBeenCalled();
  });

  // D73 F1: the handler's preparation counts against one operation deadline.
  it('refuses with no reservation, child or tools when preparation used up the operation deadline', async () => {
    jest.useFakeTimers();
    const f = fixture({ operationDeadline: Date.now() });
    await expect(f.run()).rejects.toEqual({ code: 'identity-unproved',
      summary: 'Named account admission could not be completed.' });
    await flush();
    await f.flow.dispose();
    expect(f.controller.signal.aborted).toBe(true);
    expect(f.admission.admitClaudeRoute).not.toHaveBeenCalled();
    expect(f.options).toHaveLength(0);
    expect(f.yielded()).toBe(0);
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(f.saved()).toBeUndefined();
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).not.toHaveBeenCalled();
    await expectNoAdmission(f);
  });

  // M1: an expiry refusal must not abandon an already-started step unobserved.
  it('observes a step that rejects after an expired-deadline refusal, with no unhandled rejection', async () => {
    const f = fixture({ operationDeadline: Date.now() });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      let rejectStep!: (reason: Error) => void;
      const step = new Promise<never>((_resolve, reject) => { rejectStep = reject; });
      await expect(f.flow.wait(step)).rejects.toEqual({ code: 'identity-unproved',
        summary: 'Named account admission could not be completed.' });
      expect(f.controller.signal.aborted).toBe(true);
      rejectStep(new Error('sdk module load failed'));
      await new Promise<void>((done) => setImmediate(done));
      await new Promise<void>((done) => setImmediate(done));
      expect(unhandled).toEqual([]);
      expect(f.log.warn).toHaveBeenCalledWith('[SessionLifecycle] Abandoned admission step rejected after the deadline.');
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await f.flow.dispose();
    }
  });

  it('bounds the admission by the time left of the operation deadline, not the full budget', async () => {
    jest.useFakeTimers();
    const f = fixture({ pause: 'commit', deadlineMs: 60_000, operationDeadline: Date.now() + 500 });
    let settled = false;
    const rejected = expect(f.run().finally(() => { settled = true; })).rejects.toMatchObject({
      code: 'identity-unproved' });
    await f.entered.promise;
    await jest.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect(f.controller.signal.aborted).toBe(true);
    f.paused.resolve();
    await flush();
    await f.flow.dispose();
    expect(f.persistence.attachSdkSession).not.toHaveBeenCalled();
    expect(f.saved()).toBeUndefined();
    await expectNoAdmission(f);
  });

  // D73 F2: a step that settles after the end (no timer fired yet) never admits.
  it('refuses when the budget expired while a step was already resolving', async () => {
    jest.useFakeTimers();
    const f = fixture({ pause: 'commit', deadlineMs: 60_000, budgetMs: 1_000 });
    const rejected = expect(f.run()).rejects.toEqual({ code: 'identity-unproved',
      summary: 'Named account admission could not be completed.' });
    await f.entered.promise;
    // Move the clock past the end without running the budget timer, then settle the step.
    jest.setSystemTime(Date.now() + 1_000);
    f.paused.resolve();
    await rejected;
    expect(f.controller.signal.aborted).toBe(true);
    await flush();
    await f.flow.dispose();
    expect(f.persistence.commitRunBinding).toHaveBeenCalledTimes(1);
    expect(f.persistence.attachSdkSession).not.toHaveBeenCalled();
    expect(f.saved()).toBeUndefined();
    expect(f.yielded()).toBe(1);
    await expectNoAdmission(f);
  });

  it('retains the reservation when bootstrap termination cannot be proved', async () => {
    jest.useFakeTimers();
    const f = fixture({ unproved: 'bootstrap' });
    const result = expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
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
    const result = expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
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
    const result = expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    await f.entered.promise;
    f.controller.abort();
    await result;
    f.paused.resolve();
    await flush();
    expect(f.yielded()).toBe(1);
    await expectNoAdmission(f);
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
    'keeps later turns and output pending until %s completes', async pause => {
      const f = fixture({ pause });
      let resolved = false;
      const pending = f.run().then((query) => { resolved = true; return query; });
      await f.entered.promise;
      await flush();
      // The first turn was released after the identity proof (D69); nothing else.
      expect(f.yielded()).toBe(1);
      const later = f.iterators[1].next();
      await flush();
      expect(f.events).not.toContain('turn-2');
      expect(resolved).toBe(false);
      expect(f.admission.releaseReservation).not.toHaveBeenCalled();
      f.paused.resolve();
      await pending;
      await flush();
      expect(await f.reads[1]).toEqual({ done: false, value: message });
      expect(await later).toEqual({ done: false, value: followUp });
      expect(f.saved()).toEqual(binding);
      await f.flow.dispose();
    },
  );

  it.each(['lookup', 'admit', 'current', 'bootstrap-identity', 'final-identity',
    'init', 'commit', 'attach', 'metadata', 'current:3', 'final-identity:2'])(
    'ignores late %s completion after cancellation and settles once', async pause => {
      const f = fixture({ pause, initAfterFirstTurn: true });
      const rejected = expect(f.run(pause === 'lookup' ? 'sdk-session-a' : undefined))
        .rejects.toMatchObject({ code: 'identity-unproved' });
      await f.entered.promise;
      f.controller.abort();
      await rejected;
      f.paused.resolve();
      await flush();
      await f.flow.dispose();
      expect(f.yielded()).toBe(AFTER_PROOF.has(pause) ? 1 : 0);
      await expectNoAdmission(f);
      expect(f.admission.releaseReservation).toHaveBeenCalledTimes(pause === 'lookup' ? 0 : 1);
      expect(f.admission.retainUnresolvedReservation).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { ...account, email: 'other@example.test' }])(
    'refuses changed own-query identity after durable writes: %p', async finalIdentity => {
      const f = fixture({ changedAtFinalRead: 2, finalIdentity });
      await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
      expect(f.saved()).toEqual(binding);
      expect(f.yielded()).toBe(1);
      await expectNoAdmission(f);
      expect(f.events.filter(event => event === 'final-identity')).toHaveLength(2);
    },
  );

  it('waits for final child close proof before releasing the lease', async () => {
    const f = fixture({ unproved: 'final', pause: 'metadata' });
    const rejected = expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    await f.entered.promise;
    f.controller.abort();
    await flush();
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).not.toHaveBeenCalled();
    f.terminations[1].resolve();
    await rejected;
    f.paused.resolve();
    await f.flow.dispose();
    expect(f.yielded()).toBe(1);
    await expectNoAdmission(f);
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('retains an uncertain final child after cancellation without yielding', async () => {
    const f = fixture({ unproved: 'final', pause: 'metadata' });
    const rejected = expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    await f.entered.promise;
    f.controller.abort();
    await jest.runAllTimersAsync();
    await rejected;
    f.paused.resolve();
    await f.flow.dispose();
    expect(f.yielded()).toBe(1);
    await expectNoAdmission(f);
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
    expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(1);
  });

  it('retains when a boundary check is cancelled before it proves its children closed', async () => {
    const f = fixture({ pause: 'boundary:2' });
    const rejected = expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
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
