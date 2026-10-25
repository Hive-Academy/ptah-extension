import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding } from '@ptah-extension/shared';
import type { ClaudeLaneAccountPersistence } from '../../claude/claude-sdk-lane-runner';
import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentRoleDefinition } from '@ptah-extension/shared';
import type {
  ClaudeAccountAdmissionRequest,
  ClaudeCertifiedLaunchContext,
  ClaudeLaunchBoundaryOutcome,
  ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import {
  buildSafeEnv,
  certifiedEnvDigest,
  claudeIdentityReference,
  unverifiedCapabilityPolicy,
  type SdkMessageTransformer,
  type SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import {
  ClaudeCliAdapter,
  type ClaudeCliAdapterDependencies,
} from './claude-cli.adapter';
import type { ClaudeCliCommandOptions } from './cli-adapter.interface';
import {
  ClaudeSdkLaneRunner,
  type ClaudeSdkLaneRunContext,
} from '../../claude/claude-sdk-lane-runner';
import { PtahCliStreamLoop } from '../../ptah-cli/helpers/ptah-cli-stream-loop.service';
import type { PtahSpawnAssembly } from '../../ptah-cli/helpers/ptah-cli-spawn-options.service';

jest.mock('../../ptah-cli/helpers/ptah-cli-stream-loop.service');

function fixture() {
  const logger = createMockLogger() as unknown as Logger;
  let finish: (code: number) => void = () => {
    throw new Error('uninitialized');
  };
  const streamDone = new Promise<number>((resolve) => {
    finish = resolve;
  });
  jest.mocked(PtahCliStreamLoop.prototype.run).mockReturnValue(streamDone);
  type QueryFn = ClaudeSdkLaneRunContext['queryFn'];
  const query = jest.fn<ReturnType<QueryFn>, Parameters<QueryFn>>();
  const loader = {
    getCliJsPath: jest.fn(async () => '/claude/cli.js' as string | null),
    getQueryFunction: jest.fn(async () => query),
  };
  const callback: ReturnType<
    SdkPermissionHandler['createCallback']
  > = async () => ({ behavior: 'deny', message: 'fixture' });
  const permissionHandler = {
    getPermissionLevel: jest.fn(() => 'ask' as const),
    createCallback: jest.fn<
      ReturnType<SdkPermissionHandler['createCallback']>,
      Parameters<SdkPermissionHandler['createCallback']>
    >(() => callback),
  };
  const assembly: PtahSpawnAssembly = {
    systemPromptMode: 'preset-append',
    systemPromptContent: 'Role: reviewer',
    mcpServers: { ptah: { type: 'http', url: 'http://localhost:7000/mcp' } },
    hooks: {},
    autoCompact: { autoCompactEnabled: false },
    outputStyleName: 'concise',
    capabilityFlags: {
      deniedMcpServers: [],
      approvedProjectMcpServers: [],
      deniedSkillNames: [],
    },
    capabilityIsolation: { strictMcpConfig: true, skills: [] },
  };
  const policy = unverifiedCapabilityPolicy('/workspace', 'fixture');
  const assembleSpawnOptions = jest.fn(async () => assembly);
  const models = jest.fn<
    ReturnType<ClaudeCliAdapterDependencies['models']['getNativeClaudeModels']>,
    []
  >(async () => [
    {
      value: 'native-model',
      displayName: 'Native model',
      description: 'fixture',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    },
  ]);
  const defaults = jest.fn<
    ReturnType<ClaudeCliAdapterDependencies['defaults']>,
    []
  >(() => ({ model: 'native-model', effort: 'high', chatEffort: 'low' }));
  const limits = {
    attach: jest.fn(),
    onSystemInit: jest.fn(),
    onSignal: jest.fn(),
    end: jest.fn(),
    settled: Promise.resolve(),
  };
  const runner = new ClaudeSdkLaneRunner(logger, {} as SdkMessageTransformer);
  const run = jest.spyOn(runner, 'run');
  const admission = jest.fn<ProviderAccountAdmissionPort | null, []>(
    () => null,
  );
  const deps: ClaudeCliAdapterDependencies = {
    loader,
    assembly: { assembleSpawnOptions },
    runner,
    permissionHandler,
    processSpawner: { spawn: jest.fn() },
    models: { getNativeClaudeModels: models },
    policy: jest.fn(async () => policy),
    syncHarness: jest.fn(async () => undefined),
    planLimits: () => limits,
    admission,
    defaults,
  };
  const adapter = new ClaudeCliAdapter(logger, deps);
  const input: ClaudeCliCommandOptions = {
    task: 'do work',
    workingDirectory: '/workspace',
  };
  return {
    logger,
    adapter,
    deps,
    loader,
    query,
    permissionHandler,
    assembly,
    policy,
    assembleSpawnOptions,
    models,
    defaults,
    limits,
    run,
    admission,
    input,
    finish,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('ClaudeCliAdapter constructibility', () => {
  it('detects the executable and SDK without status, model probes or inference', async () => {
    const f = fixture();
    await expect(f.adapter.detect()).resolves.toEqual({
      cli: 'claude',
      installed: true,
      path: '/claude/cli.js',
      messagingMode: 'queue',
    });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.models).not.toHaveBeenCalled();
    expect(f.adapter.parseOutput('\u001b[31mhello\u001b[0m')).toBe('hello');
  });
  it('isolates a missing executable', async () => {
    const f = fixture();
    f.loader.getCliJsPath.mockResolvedValue(null);
    await expect(f.adapter.detect()).resolves.toMatchObject({
      installed: false,
    });
    expect(f.loader.getQueryFunction).not.toHaveBeenCalled();
  });
  it('isolates a missing SDK and a failing executable loader', async () => {
    const f = fixture();
    f.loader.getQueryFunction.mockRejectedValue(new Error('missing SDK'));
    await expect(f.adapter.detect()).resolves.toMatchObject({
      installed: false,
    });
    f.loader.getCliJsPath.mockRejectedValue(new Error('missing executable'));
    await expect(f.adapter.detect()).resolves.toMatchObject({
      installed: false,
    });
    expect(f.query).not.toHaveBeenCalled();
  });
});

describe('ClaudeCliAdapter native SDK execution', () => {
  it('forwards empty native auth, real context and complete policy options to the extracted runner', async () => {
    const f = fixture();
    const parent = '11111111-2222-4333-8444-555555555555';
    const resume = '22222222-2222-4333-8444-555555555555';
    const role = {
      name: 'code-reviewer',
      body: 'Review code',
    } as AgentRoleDefinition;
    const handle = await f.adapter.runSdk({
      ...f.input,
      agentId: 'lane-id',
      parentSessionId: parent,
      resumeSessionId: resume,
      role,
    });
    expect(f.assembleSpawnOptions).toHaveBeenCalledWith(
      {},
      '/workspace',
      'native-model',
      { parentSessionId: parent, ownSessionId: resume },
      'lane-id',
      role,
      f.policy,
    );
    const context = f.run.mock.calls[0][0];
    expect(f.query).toHaveBeenCalledWith({
      prompt: context.mailbox.prompt,
      options: context.options,
    });
    expect(context.options).toMatchObject({
      model: 'native-model',
      effort: 'high',
      cwd: '/workspace',
      resume,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'Role: reviewer',
      },
      tools: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'default',
      canUseTool: expect.any(Function),
      strictMcpConfig: true,
      skills: [],
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      persistSession: true,
      pathToClaudeCodeExecutable: '/claude/cli.js',
      extraArgs: { 'replay-user-messages': null },
    });
    expect(context.options.env).toEqual(buildSafeEnv({}));
    expect(context.options.hooks).toBe(f.assembly.hooks);
    expect(context.options.mcpServers).toBe(f.assembly.mcpServers);
    expect(context.options.settings).toEqual(expect.any(String));
    const spawn = {
      command: 'fixture',
      args: [],
      cwd: '/workspace',
      env: {},
      signal: handle.abort.signal,
    };
    context.options.spawnClaudeCodeProcess?.(spawn);
    expect(f.deps.processSpawner.spawn).toHaveBeenCalledWith(spawn, {
      onStderr: context.options.stderr,
    });
    expect(f.permissionHandler.createCallback).toHaveBeenCalledWith(
      resume,
      expect.any(Function),
      undefined,
      undefined,
      resume,
    );
    expect((await context.mailbox.prompt.next()).value).toMatchObject({
      message: { content: 'do work' },
    });
    expect(f.adapter.supportsMcp).toBe(true);
    expect(f.adapter.roleChannel).toBe('system-prompt');
    expect(handle.supportsContinuation?.()).toBe(true);
    expect(handle.steer).toBeUndefined();
    expect(handle.interrupt).toBeUndefined();
    handle.setAgentId?.('tracked-id');
    expect(f.limits.attach).toHaveBeenCalledWith('tracked-id');
    const next = await handle.continue?.('follow up');
    f.finish(0);
    await expect(handle.done).resolves.toBe(0);
    await expect(next?.done).resolves.toBe(0);
  });

  it.each([
    ['max', 'high', 'low', 'max'],
    ['unsupported', 'high', 'low', 'high'],
    ['xhigh', 'inherit', 'low', 'low'],
    [undefined, '', 'low', 'medium'],
  ])(
    'resolves request %s, setting %s and inherited %s without coercion',
    async (request, setting, chat, expected) => {
      const f = fixture();
      f.defaults.mockReturnValue({ effort: setting, chatEffort: chat });
      await f.adapter.runSdk({
        ...f.input,
        model: 'native-model',
        reasoningEffort: request,
        role: { name: 'code-reviewer', body: '' } as AgentRoleDefinition,
      });
      expect(f.run.mock.calls[0][0].options.effort).toBe(expected);
      f.finish(0);
    },
  );

  it('forwards explicit models unchanged, ignores modelTier and does not invent a default', async () => {
    const f = fixture();
    const input = { ...f.input, model: 'future-model', modelTier: 'haiku' };
    await f.adapter.runSdk(input);
    expect(f.run.mock.calls[0][0].options.model).toBe('future-model');
    expect(f.run.mock.calls[0][0].options.effort).toBeUndefined();
    expect(f.run.mock.calls[0][0].options).not.toHaveProperty('modelTier');
    f.finish(0);
    const g = fixture();
    g.defaults.mockReturnValue({});
    await g.adapter.runSdk(g.input);
    expect(g.run.mock.calls[0][0].options).not.toHaveProperty('model');
    g.finish(0);
  });

  it('gives two fresh spawns different permission routing hints', async () => {
    const f = fixture();
    const first = await f.adapter.runSdk(f.input);
    const second = await f.adapter.runSdk(f.input);
    // Argument 0 is the routable session id; the routing hint is argument 4.
    const firstHint = f.permissionHandler.createCallback.mock.calls[0][4];
    const secondHint = f.permissionHandler.createCallback.mock.calls[1][4];
    expect(firstHint).toMatch(/^claude:/);
    expect(secondHint).toMatch(/^claude:/);
    expect(secondHint).not.toBe(firstHint);
    f.finish(0);
    await Promise.all([first.done, second.done]);
  });

  it.each(['low', 'medium', 'high', 'xhigh', 'max'])(
    'applies explicit effort %s with the SDK default model',
    async (reasoningEffort) => {
      const f = fixture();
      f.defaults.mockReturnValue({});
      const handle = await f.adapter.runSdk({ ...f.input, reasoningEffort });
      expect(f.run.mock.calls[0][0].options).not.toHaveProperty('model');
      expect(f.run.mock.calls[0][0].options.effort).toBe(reasoningEffort);
      expect(f.models).not.toHaveBeenCalled();
      f.finish(0);
      await handle.done;
    },
  );

  it('logs unsupported explicit effort without a model and preserves precedence', async () => {
    const f = fixture();
    f.defaults.mockReturnValue({ effort: 'high' });
    const handle = await f.adapter.runSdk({
      ...f.input,
      reasoningEffort: 'unsupported',
    });
    expect(f.run.mock.calls[0][0].options).not.toHaveProperty('model');
    expect(f.run.mock.calls[0][0].options.effort).toBe('high');
    expect(f.logger.info).toHaveBeenCalledWith(
      '[ClaudeCliAdapter] Not applied \u2014 configured precedence remains in effect',
    );
    f.finish(0);
    await handle.done;
  });

  it('replays every structured segment buffered before subscription in order', async () => {
    const f = fixture();
    const handle = await f.adapter.runSdk(f.input);
    const context = f.run.mock.calls[0][0];
    const segments = Array.from({ length: 5001 }, (_, index) => ({
      type: 'text' as const,
      content: `segment ${index}`,
    }));
    for (const segment of segments) context.emitSegment(segment);
    const subscriber = jest.fn();
    context.onSegment(subscriber);
    expect(subscriber.mock.calls.map(([segment]) => segment)).toEqual(segments);
    const live = { type: 'text' as const, content: 'live' };
    context.emitSegment(live);
    expect(subscriber).toHaveBeenLastCalledWith(live);
    const laterSubscriber = jest.fn();
    context.onSegment(laterSubscriber);
    expect(laterSubscriber).not.toHaveBeenCalled();
    f.finish(0);
    await handle.done;
  });

  it('treats unavailable model metadata as unknown and applies no effort', async () => {
    const f = fixture();
    f.models.mockRejectedValue(new Error('unavailable'));
    await expect(f.adapter.listModels()).resolves.toEqual([]);
    await f.adapter.runSdk({ ...f.input, reasoningEffort: 'high' });
    expect(f.run.mock.calls[0][0].options.effort).toBeUndefined();
    f.finish(0);
  });

  it('fails closed before named admission, SDK loading or prompt release even with a registered port', async () => {
    const f = fixture();
    const accountAdmission = {
      provider: 'claude',
      selection: { kind: 'named', profileId: 'profile' },
    } as ClaudeAccountAdmissionRequest;
    await expect(
      f.adapter.runSdk({ ...f.input, accountAdmission }),
    ).rejects.toThrow('admission is not available');
    const admitClaudeRoute = jest.fn();
    f.admission.mockReturnValue({
      admitClaudeRoute,
      releaseReservation: jest.fn(),
      retainUnresolvedReservation: jest.fn(),
    });
    await expect(
      f.adapter.runSdk({ ...f.input, accountAdmission }),
    ).rejects.toThrow('prompt gate is not available');
    expect(admitClaudeRoute).not.toHaveBeenCalled();
    expect(f.loader.getQueryFunction).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });

  it('closes the prompt and ends lifecycle tracking on synchronous SDK failure', async () => {
    const f = fixture();
    f.query.mockImplementation(() => {
      throw new Error('SDK launch failure');
    });
    await expect(f.adapter.runSdk(f.input)).rejects.toThrow(
      'SDK launch failure',
    );
    const context = f.run.mock.calls[0][0];
    expect(context.options.abortController.signal.aborted).toBe(true);
    // A closed mailbox ends after the initial task drains; nothing new queues.
    context.mailbox.push('late follow up');
    const drained: unknown[] = [];
    for await (const message of context.mailbox.prompt) drained.push(message);
    expect(drained).toHaveLength(1);
    expect(f.limits.end).toHaveBeenCalled();
  });
});

// A personal claude.ai login: passes the post-init tripwire.
const personalLogin = {
  tokenSource: 'claude.ai',
  subscriptionType: 'max',
  apiProvider: 'firstParty',
};

/** Certified launch matching the fixture route, executable and workspace. */
function certifiedLaunch(): ClaudeCertifiedLaunchContext {
  const env = {
    PATH: 'D:/bin',
    CLAUDE_CONFIG_DIR: 'D:/accounts/selected',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: 'D:/accounts/selected',
  };
  return {
    executable: {
      command: 'D:/cli/claude.exe',
      prefixArgs: [],
      sdkExecutablePath: '/claude/cli.js',
      version: '2.1.310',
      fingerprint: { size: 1, mtimeMs: 1 },
    },
    env,
    envDigest: certifiedEnvDigest(env),
    cwd: '/workspace',
    settingSources: ['user', 'project', 'local'],
    policy: {
      coverage: 'win32@2.1.310',
      managedFile: 'absent',
      managedDropIn: 'absent',
      registry: 'absent',
      remoteSignals: 'absent',
    },
    accountClass: 'personal',
    identityReference:
      claudeIdentityReference('owner@example.test', 'org') ?? '',
  };
}

function namedFixture() {
  const f = fixture();
  const launch = certifiedLaunch();
  const initVersion = { value: launch.executable.version };
  const route = {
    kind: 'named',
    provider: 'claude',
    profileId: 'profile',
    canonicalConfigDir: 'D:/accounts/selected',
    routeFingerprint: 'a'.repeat(64),
    routeRevision: 0,
    authEpoch: 0,
    runId: 'run',
  } as ClaudeAccountNamedRoute;
  const binding: ProviderAccountBinding = {
    version: 1,
    provider: 'claude',
    profileId: route.profileId,
    runId: route.runId,
    routeFingerprint: route.routeFingerprint,
    routeRevision: 0,
    authEpoch: 0,
    identity: {
      kind: 'known',
      ownerKey: createHash('sha256')
        .update('ptah-quota-owner\0owner@example.test\0org')
        .digest('hex'),
    },
  };
  const reservation = {
    kind: 'run' as const,
    phase: 'reserved' as const,
    provider: 'claude' as const,
    routeKind: 'named' as const,
    routeFingerprint: route.routeFingerprint,
    routeRevision: 0,
    authEpoch: 0,
    runId: 'run',
    operationId: 'operation',
    reservationId: 'reservation',
  };
  const admission = {
    admitClaudeRoute: jest.fn(async () => ({
      code: 'ok' as const,
      resources: {
        kind: 'named' as const,
        route,
        accountDataDir: 'D:/accounts/data',
        filesystemIdentity: { volumeId: 'volume', fileId: 'file' },
        launch: launch as ClaudeCertifiedLaunchContext | undefined,
      },
      reservation,
    })),
    releaseReservation: jest.fn(async () => ({
      code: 'ok' as const,
      reservation: { ...reservation, phase: 'released' as const },
    })),
    retainUnresolvedReservation: jest.fn(async () => ({
      code: 'ok' as const,
      reservation: { ...reservation, phase: 'retained' as const },
    })),
  };
  f.admission.mockReturnValue(admission);
  let epoch: ((route: ClaudeAccountNamedRoute) => void) | undefined;
  const unsubscribe = jest.fn();
  const persistence = {
    available: true,
    lookupBySdkSession: jest.fn<
      ReturnType<ClaudeLaneAccountPersistence['lookupBySdkSession']>,
      []
    >(async () => ({ status: 'bound', binding })),
    validateResume: jest.fn(async () => ({ code: 'ok' })),
    persistReference: jest.fn(async () => undefined),
    commitRunBinding: jest.fn(async () => binding),
    attachSdkSession: jest.fn<
      ReturnType<ClaudeLaneAccountPersistence['attachSdkSession']>,
      []
    >(async () => ({ status: 'attached' })),
    saveAccountBound: jest.fn(async () => undefined),
    assertRouteCurrent: jest.fn(async () => undefined),
    checkLaunchBoundary: jest.fn(
      async (): Promise<ClaudeLaunchBoundaryOutcome> => ({ ok: true }),
    ),
    onAuthEpochChanged: jest.fn(
      (listener: (route: ClaudeAccountNamedRoute) => void) => {
        epoch = listener;
        return unsubscribe;
      },
    ),
  };
  const callbacks = jest.fn(async () => undefined);
  const input: ClaudeCliCommandOptions = {
    ...f.input,
    onAccountBinding: callbacks,
    accountAdmission: {
      provider: 'claude',
      scope: 'lane',
      selection: { kind: 'named', profileId: 'profile' },
      runId: 'run',
      operationId: 'operation',
    },
  };
  const children: Array<{
    close: jest.Mock;
    accountInfo: jest.Mock;
    prompt: AsyncIterable<import('@ptah-extension/agent-sdk').SDKUserMessage>;
    process: EventEmitter;
  }> = [];
  const processes: EventEmitter[] = [];
  f.deps.processSpawner.spawn = jest.fn(() => {
    const process = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      killed: false,
      exitCode: null,
      kill: jest.fn(() => true),
    });
    processes.push(process);
    return process;
  });
  f.query.mockImplementation(({ prompt, options }) => {
    if (typeof prompt === 'string' || !options?.spawnClaudeCodeProcess)
      throw new Error('fixture requires gate');
    options.spawnClaudeCodeProcess({
      command: 'fixture',
      args: [],
      cwd: '/workspace',
      env: {},
      signal: new AbortController().signal,
    });
    const process = processes[processes.length - 1];
    const accountInfo = jest.fn(async (): Promise<Record<string, unknown>> => ({
      ...personalLogin,
      email: 'owner@example.test',
      organization: 'org',
    }));
    const close = jest.fn(() => process.emit('exit', 0, null));
    const stream = (async function* () {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-session',
        claude_code_version: initVersion.value,
      } as import('@ptah-extension/agent-sdk').SDKMessage;
    })();
    const query = Object.assign(stream, {
      close,
      accountInfo,
    }) as unknown as ReturnType<ClaudeSdkLaneRunContext['queryFn']>;
    children.push({ close, accountInfo, prompt, process });
    return query;
  });
  const adapter = new ClaudeCliAdapter(f.logger, {
    ...f.deps,
    accountPersistence: () => persistence,
  });
  return {
    ...f,
    adapter,
    input,
    route,
    binding,
    admission,
    persistence,
    callbacks,
    children,
    unsubscribe,
    epoch: () => epoch?.({ ...route, authEpoch: 1 }),
    launch,
    initVersion,
  };
}

describe('named Claude lane admission', () => {
  it('holds unavailable persistence before admission and SDK loading', async () => {
    const f = namedFixture();
    f.persistence.available = false;
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'release-held',
    });
    expect(f.admission.admitClaudeRoute).not.toHaveBeenCalled();
    expect(f.loader.getQueryFunction).not.toHaveBeenCalled();
  });

  it('bootstraps without task options and awaits both stores and the receipt callback on a fresh final gate', async () => {
    const f = namedFixture();
    let release!: () => void;
    let reached!: () => void;
    const checkpoint = new Promise<void>((resolve) => {
      reached = resolve;
    });
    f.callbacks.mockImplementation(async () => {
      reached();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const run = f.adapter.runSdk(f.input);
    await checkpoint;
    expect(f.query).toHaveBeenCalledTimes(2);
    const bootstrap = f.query.mock.calls[0][0];
    expect(bootstrap.options).toMatchObject({
      tools: [],
      mcpServers: {},
      systemPrompt: '',
      settingSources: [],
      persistSession: false,
    });
    expect(bootstrap.options).not.toHaveProperty('resume');
    expect(bootstrap.options).not.toHaveProperty('hooks');
    expect(f.assembleSpawnOptions.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.children[0].close.mock.invocationCallOrder[0],
    );
    expect(f.children[0].prompt).not.toBe(f.children[1].prompt);
    expect(
      await f.children[0].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
    expect(f.persistence.commitRunBinding).toHaveBeenCalledTimes(1);
    expect(f.persistence.attachSdkSession).toHaveBeenCalledTimes(1);
    expect(f.persistence.saveAccountBound).toHaveBeenCalledTimes(1);
    expect(f.persistence.persistReference).toHaveBeenCalledTimes(1);
    const yielded = jest.fn();
    const first = f.children[1].prompt[Symbol.asyncIterator]()
      .next()
      .then((value) => {
        yielded(value);
        return value;
      });
    await Promise.resolve();
    expect(yielded).not.toHaveBeenCalled();
    const permission = f.query.mock.calls[1][0].options?.canUseTool;
    expect(
      await permission?.(
        'fixture',
        {},
        {
          signal: new AbortController().signal,
          toolUseID: 'tool',
          requestId: 'request',
        },
      ),
    ).toMatchObject({ behavior: 'deny' });
    release();
    const handle = await run;
    expect((await first).value).toMatchObject({
      message: { content: f.input.task },
    });
    expect(handle.accountBinding).toEqual(f.binding);
    expect(handle.accountBindingId).toBe('run');
    expect(f.callbacks).toHaveBeenCalledWith(
      { accountBinding: f.binding, accountBindingId: 'run' },
      'sdk-session',
    );
    expect(f.adapter.accountBindings).toBe(f.persistence);
    f.finish(0);
    await handle.done;
    expect(f.children[1].close).toHaveBeenCalledTimes(1);
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it.each([
    'commitRunBinding',
    'attachSdkSession',
    'saveAccountBound',
    'persistReference',
  ] as const)('drops all conversation when %s fails', async (method) => {
    const f = namedFixture();
    f.persistence[method].mockRejectedValue(new Error('private failure'));
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'release-held',
    });
    expect(
      await f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
    expect(f.children[1].close).toHaveBeenCalledTimes(1);
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.run).not.toHaveBeenCalled();
  });

  it('drops conversation if the manager receipt checkpoint rejects', async () => {
    const f = namedFixture();
    f.callbacks.mockRejectedValue(new Error('private callback failure'));
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'release-held',
    });
    expect(
      await f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('checks the final query identity again after persistence', async () => {
    const f = namedFixture();
    f.callbacks.mockImplementation(async () => {
      f.children[1].accountInfo.mockResolvedValue({
        ...personalLogin,
        email: 'other@example.test',
      });
    });
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(
      await f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
  });

  it('drops queued input and settles once on an observed epoch change even if the stream never ends', async () => {
    const f = namedFixture();
    const handle = await f.adapter.runSdk(f.input);
    const next = await handle.continue?.('queued');
    f.epoch();
    expect(
      await f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
    await expect(handle.done).resolves.toBe(1);
    await expect(next?.done).resolves.toBe(1);
    await expect(handle.continue?.('late')).rejects.toMatchObject({
      code: 'release-held',
    });
    f.finish(0);
    await Promise.resolve();
    expect(f.children[1].close).toHaveBeenCalledTimes(1);
    expect(f.limits.end).toHaveBeenCalledTimes(1);
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('revalidates queued input at consumption and retains an uncertain child exit', async () => {
    const f = namedFixture();
    const handle = await f.adapter.runSdk(f.input);
    f.children[1].close.mockImplementation(() =>
      f.children[1].process.emit('exit', null, 'SIGKILL'),
    );
    await handle.continue?.('queued');
    f.children[1].accountInfo.mockResolvedValue({
      ...personalLogin,
        email: 'other@example.test',
    });
    await expect(
      f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'identity-unproved' });
    await expect(handle.done).resolves.toBe(1);
    expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(1);
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
  });

  it('keeps the running snapshot immutable and blocks later turns when metadata is deleted', async () => {
    const f = namedFixture();
    const handle = await f.adapter.runSdk(f.input);
    expect(Object.isFrozen(handle.accountBinding)).toBe(true);
    const prompt = f.children[1].prompt[Symbol.asyncIterator]();
    expect((await prompt.next()).value).toMatchObject({
      message: { content: f.input.task },
    });
    // A label rename is not part of the immutable route or receipt.
    expect(handle.accountBinding).not.toHaveProperty('label');
    f.persistence.validateResume.mockResolvedValue({ code: 'not-found' });
    expect(handle.abort.signal.aborted).toBe(false);
    await expect(handle.continue?.('deleted')).rejects.toMatchObject({
      code: 'release-held',
    });
    expect(await prompt.next()).toMatchObject({ done: true });
    await expect(handle.done).resolves.toBe(1);
  });

  it('rejects unknown resume evidence before loading SDK and preserves an authoritative bound run', async () => {
    const f = namedFixture();
    f.persistence.lookupBySdkSession.mockResolvedValueOnce({
      status: 'bound',
      binding: { ...f.binding, identity: { kind: 'unknown' } },
    });
    await expect(
      f.adapter.runSdk({ ...f.input, resumeSessionId: 'sdk-session' }),
    ).rejects.toMatchObject({ code: 'release-held' });
    expect(f.loader.getQueryFunction).not.toHaveBeenCalled();
    const handle = await f.adapter.runSdk({
      ...f.input,
      resumeSessionId: 'sdk-session',
    });
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(handle.accountBinding).toEqual(f.binding);
    f.finish(0);
    await handle.done;
  });
});

describe('named Claude failure and isolation regressions', () => {
  it('refuses a held admission port before loading the SDK', async () => {
    const f = namedFixture();
    f.admission.admitClaudeRoute.mockRejectedValue(
      Object.assign(new Error('held'), { code: 'release-held' }),
    );
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'release-held',
    });
    expect(f.loader.getQueryFunction).not.toHaveBeenCalled();
    expect(f.assembleSpawnOptions).not.toHaveBeenCalled();
  });

  it('never constructs task options if bootstrap identity cannot be read', async () => {
    const f = namedFixture();
    const invoke = f.query.getMockImplementation()!;
    f.query.mockImplementation((args) => {
      const query = invoke(args);
      f.children[0].accountInfo.mockRejectedValue(
        new Error('private bootstrap failure'),
      );
      return query;
    });
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'release-held',
    });
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.assembleSpawnOptions).not.toHaveBeenCalled();
    expect(f.models).not.toHaveBeenCalled();
    expect(f.children[0].close).toHaveBeenCalledTimes(1);
    expect(
      await f.children[0].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
  });

  it('never persists a final query whose own account differs from bootstrap', async () => {
    const f = namedFixture();
    const invoke = f.query.getMockImplementation()!;
    f.query.mockImplementation((args) => {
      const query = invoke(args);
      if (f.children.length === 2)
        f.children[1].accountInfo.mockResolvedValue({
          ...personalLogin,
        email: 'other@example.test',
        });
      return query;
    });
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(f.callbacks).not.toHaveBeenCalled();
  });

  it('retains the reservation when query throws after an uncertain spawn', async () => {
    const f = namedFixture();
    const invoke = f.query.getMockImplementation()!;
    f.query.mockImplementation((args) => {
      invoke(args);
      throw new Error('private SDK failure');
    });
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'release-held',
    });
    expect(f.admission.retainUnresolvedReservation).toHaveBeenCalledTimes(1);
    expect(f.admission.releaseReservation).not.toHaveBeenCalled();
  });

  it('does not release a late callback after epoch cancellation', async () => {
    const f = namedFixture();
    let finish!: () => void;
    f.callbacks.mockImplementation(async () => {
      f.epoch();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'release-held',
    });
    finish();
    expect(
      await f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.children[1].close).toHaveBeenCalledTimes(1);
  });

  it('does not reuse an earlier run gate or silently accept bound ambient input', async () => {
    const f = namedFixture();
    await expect(
      f.adapter.runSdk({
        ...f.input,
        accountAdmission: undefined,
        accountBinding: f.binding,
      }),
    ).rejects.toMatchObject({ code: 'release-held' });
    const first = await f.adapter.runSdk(f.input);
    first.abort.abort();
    await first.done;
    const second = await f.adapter.runSdk(f.input);
    expect(f.children[1].prompt).not.toBe(f.children[3].prompt);
    expect(
      await f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
    expect(
      (await f.children[3].prompt[Symbol.asyncIterator]().next()).value,
    ).toMatchObject({ message: { content: f.input.task } });
    second.abort.abort();
    await second.done;
  });
});

describe('named Claude lane certified launch boundaries', () => {
  function admitted(
    f: ReturnType<typeof namedFixture>,
    launch: ClaudeCertifiedLaunchContext | undefined,
  ) {
    return {
      code: 'ok' as const,
      resources: {
        kind: 'named' as const,
        route: f.route,
        accountDataDir: 'D:/accounts/data',
        filesystemIdentity: { volumeId: 'volume', fileId: 'file' },
        launch,
      },
      reservation: {
        kind: 'run' as const,
        phase: 'reserved' as const,
        provider: 'claude' as const,
        routeKind: 'named' as const,
        routeFingerprint: f.route.routeFingerprint,
        routeRevision: 0,
        authEpoch: 0,
        runId: 'run',
        operationId: 'operation',
        reservationId: 'reservation',
      },
    };
  }

  it('refuses a named lane without a certified launch before any SDK call', async () => {
    const f = namedFixture();
    f.admission.admitClaudeRoute.mockResolvedValueOnce(admitted(f, undefined));
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.persistence.checkLaunchBoundary).not.toHaveBeenCalled();
    expect(f.admission.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it('awaits both boundary checks, each before its own child opens', async () => {
    const f = namedFixture();
    const handle = await f.adapter.runSdk(f.input);
    const check = f.persistence.checkLaunchBoundary;
    expect(check.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      'bootstrap',
      'final',
    ]);
    expect(check.mock.invocationCallOrder[0]).toBeLessThan(
      f.query.mock.invocationCallOrder[0],
    );
    expect(check.mock.invocationCallOrder[1]).toBeGreaterThan(
      f.query.mock.invocationCallOrder[0],
    );
    expect(check.mock.invocationCallOrder[1]).toBeLessThan(
      f.query.mock.invocationCallOrder[1],
    );
    const final = f.query.mock.calls[1][0].options;
    expect(final?.cwd).toBe(f.launch.cwd);
    expect(final?.settingSources).toEqual(f.launch.settingSources);
    expect(final?.env).toEqual(f.launch.env);
    expect(final).not.toHaveProperty('managedSettings');
    expect(Object.keys(final?.extraArgs ?? {})).not.toContain(
      'managed-settings',
    );
    f.finish(0);
    await handle.done;
  });

  it.each([
    [true, 'releaseReservation', 'retainUnresolvedReservation'],
    [false, 'retainUnresolvedReservation', 'releaseReservation'],
  ] as const)(
    'refuses a bootstrap boundary refusal before any child (terminated %s)',
    async (terminated, settled, untouched) => {
      const f = namedFixture();
      f.persistence.checkLaunchBoundary.mockResolvedValueOnce({
        ok: false,
        code: 'unsupported-source',
        terminated,
      });
      await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
        code: 'unsupported-source',
      });
      expect(f.query).not.toHaveBeenCalled();
      expect(f.assembleSpawnOptions).not.toHaveBeenCalled();
      expect(f.admission[settled]).toHaveBeenCalledTimes(1);
      expect(f.admission[untouched]).not.toHaveBeenCalled();
    },
  );

  it.each([
    [true, 'releaseReservation', 'retainUnresolvedReservation'],
    [false, 'retainUnresolvedReservation', 'releaseReservation'],
  ] as const)(
    'refuses a source that appears between bootstrap and final with no task text (terminated %s)',
    async (terminated, settled, untouched) => {
      const f = namedFixture();
      f.persistence.checkLaunchBoundary
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: false,
          code: 'unsupported-source',
          terminated,
        });
      await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
        code: 'unsupported-source',
      });
      // Only the bootstrap child opened, and it closed with an exit proof.
      expect(f.query).toHaveBeenCalledTimes(1);
      expect(f.children[0].close).toHaveBeenCalledTimes(1);
      expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
      expect(f.callbacks).not.toHaveBeenCalled();
      expect(f.run).not.toHaveBeenCalled();
      expect(f.admission[settled]).toHaveBeenCalledTimes(1);
      expect(f.admission[untouched]).not.toHaveBeenCalled();
    },
  );

  it('refuses an executable that drifted from the certified one before any child', async () => {
    const f = namedFixture();
    f.loader.getCliJsPath.mockResolvedValue('/other/cli.js');
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'route-changed',
    });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.persistence.checkLaunchBoundary).not.toHaveBeenCalled();
  });

  it('refuses a final child of another CLI version before binding or task text', async () => {
    const f = namedFixture();
    f.initVersion.value = '2.1.311';
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(
      await f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
  });

  it.each<[string, Record<string, unknown>]>([
    ['a non-claude.ai token source', { tokenSource: 'console' }],
    ['an apiKeyHelper key source', { apiKeySource: 'apiKeyHelper' }],
    ['a team subscription', { subscriptionType: 'team' }],
  ])('trips on %s in the final child before the gate', async (_label, change) => {
    const f = namedFixture();
    const invoke = f.query.getMockImplementation()!;
    f.query.mockImplementation((args) => {
      const query = invoke(args);
      if (f.children.length === 2)
        f.children[1].accountInfo.mockResolvedValue({
          ...personalLogin,
          email: 'owner@example.test',
          organization: 'org',
          ...change,
        });
      return query;
    });
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(
      await f.children[1].prompt[Symbol.asyncIterator]().next(),
    ).toMatchObject({ done: true });
  });

  it('settles once when cancelled during commitRunBinding, even if the commit lands late', async () => {
    const f = namedFixture();
    let land!: () => void;
    f.persistence.commitRunBinding.mockImplementation(async () => {
      f.epoch();
      await new Promise<void>((resolve) => {
        land = resolve;
      });
      return f.binding;
    });
    await expect(f.adapter.runSdk(f.input)).rejects.toMatchObject({
      code: 'release-held',
    });
    land();
    await new Promise((resolve) => setImmediate(resolve));
    const settlements =
      f.admission.releaseReservation.mock.calls.length +
      f.admission.retainUnresolvedReservation.mock.calls.length;
    expect(settlements).toBe(1);
    expect(f.persistence.attachSdkSession).not.toHaveBeenCalled();
    expect(f.callbacks).not.toHaveBeenCalled();
  });

  it('resumes a bound lane on the stored run without a second binding', async () => {
    const f = namedFixture();
    const handle = await f.adapter.runSdk({
      ...f.input,
      resumeSessionId: 'sdk-session',
    });
    expect(f.admission.admitClaudeRoute).toHaveBeenCalledTimes(1);
    expect(f.admission.admitClaudeRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run',
        selection: { kind: 'named', profileId: 'profile' },
      }),
    );
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(handle.accountBinding).toEqual(f.binding);
    f.finish(0);
    await handle.done;
  });
});
