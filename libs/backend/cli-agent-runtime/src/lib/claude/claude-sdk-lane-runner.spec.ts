import 'reflect-metadata';
import { EventEmitter } from 'events';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ClaudeAccountNamedRoute,
  ClaudeAccountRunReservation,
  ClaudeCertifiedLaunchContext,
  ClaudeLaunchBoundaryOutcome,
  ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding } from '@ptah-extension/shared';
import {
  ClaudeCertifiedLaunchRefusal,
  assertCertifiedLaunch,
  buildFlagSettingsArg,
  buildSafeEnv,
  buildSessionName,
  certifiedEnvDigest,
  claudeIdentityReference,
  deriveWorkspaceLabel,
  type HookInput,
  type Options,
  type SdkMessageTransformer,
  type SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import {
  buildClaudeLaneBootstrapOptions,
  buildClaudeSdkLaneOptions,
  claudeActualLaunch,
  resolveClaudeLanePermissionOptions,
  type ClaudeSdkLaneOptionsInput,
} from './claude-sdk-lane-options';
import {
  ClaudeNamedLaneAdmission,
  ClaudeSdkLaneRunner,
  claudeLaneRefusal,
  claudeLaneRefusalCode,
  claudeLaneForeignErrorClass,
  type ClaudeLaneAccountPersistence,
  type ClaudeSdkLaneRunContext,
} from './claude-sdk-lane-runner';

/** Certified launch fixture for one canonical directory; values are fixtures only. */
function certifiedLaunch(
  dir = 'D:/accounts/selected',
  overrides: Partial<ClaudeCertifiedLaunchContext> = {},
): ClaudeCertifiedLaunchContext {
  const env = {
    PATH: 'D:/bin',
    CLAUDE_CONFIG_DIR: dir,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: dir,
  };
  return {
    executable: {
      command: 'D:/cli/claude.exe',
      prefixArgs: [],
      sdkExecutablePath: 'D:/cli/cli.js',
      version: '2.1.310',
      fingerprint: { size: 1, mtimeMs: 1 },
    },
    env,
    envDigest: certifiedEnvDigest(env),
    cwd: 'D:/workspace',
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
    ...overrides,
  };
}
import { PtahCliStreamLoop } from '../ptah-cli/helpers/ptah-cli-stream-loop.service';
import { createPromptMailbox } from '../ptah-cli/helpers/ptah-cli-prompt-mailbox';

jest.mock('../ptah-cli/helpers/ptah-cli-stream-loop.service');

const logger = createMockLogger() as unknown as Logger;
type PermissionLevel = ReturnType<SdkPermissionHandler['getPermissionLevel']>;
function permissionHandler(level: PermissionLevel = 'ask') {
  const callback: ReturnType<
    SdkPermissionHandler['createCallback']
  > = async () => ({
    behavior: 'deny',
    message: 'fixture',
  });
  return {
    getPermissionLevel: jest.fn(() => level),
    createCallback: jest.fn(() => callback),
  };
}
function optionsInput(): ClaudeSdkLaneOptionsInput {
  return {
    assembly: {
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
    },
    authEnv: {},
    abortController: new AbortController(),
    model: 'sonnet',
    effort: 'high',
    cwd: 'D:/workspace',
    agentName: 'Reviewer',
    agentId: 'abcdef-run',
    routingId: 'ptah-cli:fixture',
    resumeSessionId: '11111111-2222-4333-8444-555555555555',
    permissionHandler: permissionHandler(),
    logger,
    processSpawner: { spawn: jest.fn() },
    executable: 'D:/cli/cli.js',
  };
}

beforeEach(() => jest.clearAllMocks());

describe('Claude native lane options', () => {
  it('preserves complete native options without a PtahCliConfig', () => {
    const input = optionsInput();
    const options = buildClaudeSdkLaneOptions(input);
    expect(options).toMatchObject({
      abortController: input.abortController,
      model: 'sonnet',
      effort: 'high',
      cwd: input.cwd,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'Role: reviewer',
      },
      tools: { type: 'preset', preset: 'claude_code' },
      strictMcpConfig: true,
      skills: [],
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      persistSession: true,
      resume: input.resumeSessionId,
      pathToClaudeCodeExecutable: input.executable,
      extraArgs: {
        'replay-user-messages': null,
        name: buildSessionName({
          role: input.agentName,
          workspaceLabel: deriveWorkspaceLabel(input.cwd),
          uniqueSuffix: 'abcdef',
        }),
      },
    });
    expect(options.mcpServers).toBe(input.assembly.mcpServers);
    expect(options.hooks).toBe(input.assembly.hooks);
    expect(options.settings).toBe(
      buildFlagSettingsArg(
        { outputStyleName: 'concise' },
        'accept',
        logger,
        input.assembly.autoCompact,
        input.assembly.capabilityFlags,
      ),
    );
    expect(options.env).toEqual(buildSafeEnv(input.authEnv));
    const spawn = {
      command: 'fixture',
      args: [],
      cwd: input.cwd,
      env: {},
      signal: input.abortController.signal,
    };
    options.spawnClaudeCodeProcess?.(spawn);
    expect(input.processSpawner.spawn).toHaveBeenCalledWith(spawn, {
      onStderr: options.stderr,
    });
    options.stderr?.('ordinary diagnostic');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('ordinary diagnostic'),
    );
  });

  it('preserves standalone role content, missing resume, and omitted output-style', () => {
    const input = optionsInput();
    input.assembly = {
      ...input.assembly,
      systemPromptMode: 'standalone',
      outputStyleName: undefined,
    };
    delete input.resumeSessionId;
    const options = buildClaudeSdkLaneOptions(input);
    expect(options.systemPrompt).toBe('Role: reviewer');
    expect(options).not.toHaveProperty('resume');
    expect(JSON.parse(String(options.settings))).not.toHaveProperty(
      'outputStyle',
    );
  });

  it('applies named routing after safe env and never overwrites it', () => {
    const input = optionsInput();
    input.authEnv = {
      ANTHROPIC_API_KEY: 'foreign',
      ANTHROPIC_BASE_URL: 'https://foreign.invalid',
    };
    // Admission fixture, as in agent-sdk's route-env specs; no production brand fabrication.
    input.accountRoute = {
      kind: 'named',
      provider: 'claude',
      profileId: 'fixture',
      canonicalConfigDir: 'D:/accounts/selected',
      routeFingerprint: 'fixture',
      routeRevision: 1,
      authEpoch: 1,
      runId: 'fixture-run',
    } as ClaudeAccountNamedRoute;
    input.launch = certifiedLaunch();
    const options = buildClaudeSdkLaneOptions(input);
    expect(options.env?.['CLAUDE_CONFIG_DIR']).toBe('D:/accounts/selected');
    expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(options.env).not.toHaveProperty('ANTHROPIC_BASE_URL');
    expect(options.env).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL');
    expect(input.authEnv.ANTHROPIC_API_KEY).toBe('foreign');
    expect(options.permissionMode).toBe('default');
    expect(options.canUseTool).toBeDefined();
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
  });

  it.each([
    ['yolo', 'bypassPermissions'],
    ['auto-edit', 'acceptEdits'],
    ['ask', 'default'],
    ['plan', 'plan'],
  ] as const)(
    'maps %s explicitly to %s, bridging every non-YOLO level',
    (level, mode) => {
      const handler = permissionHandler(level);
      let agentId: string | undefined;
      const resolver = () => agentId;
      const options = resolveClaudeLanePermissionOptions(
        handler,
        logger,
        'ptah-cli:fixture',
        resolver,
      );
      expect(options.permissionMode).toBe(mode);
      if (level === 'yolo') {
        expect(options.allowDangerouslySkipPermissions).toBe(true);
        expect(handler.createCallback).not.toHaveBeenCalled();
        expect(options.canUseTool).toBeUndefined();
      } else {
        expect(options.allowDangerouslySkipPermissions).toBeUndefined();
        expect(options.canUseTool).toBeDefined();
        expect(handler.createCallback).toHaveBeenCalledWith(
          undefined,
          resolver,
          undefined,
          undefined,
          'ptah-cli:fixture',
        );
        agentId = 'assigned';
        expect(resolver()).toBe('assigned');
      }
    },
  );

  it('routes permissions through the safe-parsed resume session ahead of parent', () => {
    const input = optionsInput();
    input.parentSessionId = '22222222-2222-4333-8444-555555555555';
    buildClaudeSdkLaneOptions(input);
    expect(input.permissionHandler.createCallback).toHaveBeenCalledWith(
      input.resumeSessionId,
      undefined,
      undefined,
      undefined,
      input.resumeSessionId,
    );
  });
});

function runnerFixture(
  ownerSettled: Promise<void> = Promise.resolve(),
  named?: ClaudeSdkLaneRunContext['named'],
) {
  let finish: (code: number) => void = () => {
    throw new Error('not initialized');
  };
  let fail: (error: Error) => void = () => {
    throw new Error('not initialized');
  };
  const streamDone = new Promise<number>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  jest.mocked(PtahCliStreamLoop.prototype.run).mockReturnValue(streamDone);
  const mailbox = createPromptMailbox('seeded task');
  const close = jest.spyOn(mailbox, 'close');
  const abortController = new AbortController();
  const remove = jest.spyOn(abortController.signal, 'removeEventListener');
  type QueryFn = ClaudeSdkLaneRunContext['queryFn'];
  const queryFn = jest.fn<ReturnType<QueryFn>, Parameters<QueryFn>>();
  const context: ClaudeSdkLaneRunContext = {
    queryFn,
    named,
    options: { ...buildClaudeSdkLaneOptions(optionsInput()), abortController },
    mailbox,
    providerId: 'claude-cli',
    agentName: 'Reviewer',
    agentIdHolder: {},
    lanePlanLimits: {
      attach: jest.fn(),
      onSystemInit: jest.fn(),
      onSignal: jest.fn(),
      end: jest.fn(),
      settled: ownerSettled,
    },
    outputCallbacks: [],
    onSegment: jest.fn(),
    onStreamEvent: jest.fn(),
    emitOutput: jest.fn(),
    emitSegment: jest.fn(),
    emitStreamEvent: jest.fn(),
    disposeCallbacks: jest.fn(),
    stopProxy: jest.fn(async () => undefined),
  };
  // The mocked stream loop owns transformer interaction in these lifecycle tests.
  const runner = new ClaudeSdkLaneRunner(logger, {} as SdkMessageTransformer);
  const result = runner.run(context);
  const config = jest.mocked(PtahCliStreamLoop).mock.calls[0][0];
  return { ...result, config, context, finish, fail, close, remove, runner };
}

describe('Claude native lane lifecycle', () => {
  it('forwards effective options and seeded mailbox with continuation only and Ptah MCP', async () => {
    const f = runnerFixture();
    expect(f.context.queryFn).toHaveBeenCalledWith({
      prompt: f.context.mailbox.prompt,
      options: f.context.options,
    });
    expect((await f.context.mailbox.prompt.next()).value).toMatchObject({
      message: { content: 'seeded task' },
    });
    expect(f.context.options.mcpServers).toHaveProperty('ptah');
    expect(f.handle.supportsContinuation?.()).toBe(true);
    expect(f.handle.steer).toBeUndefined();
    expect(f.handle.interrupt).toBeUndefined();
    expect(f.handle.supportsInterrupt?.() ?? false).toBe(false);
    f.finish(0);
    await expect(f.handle.done).resolves.toBe(0);
  });

  it('settles each queued turn once and waits for quota ownership', async () => {
    let release: () => void = () => {
      throw new Error('not initialized');
    };
    const ownerSettled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = runnerFixture(ownerSettled);
    const limits = f.config;
    const followup = await f.handle.continue?.('next');
    const first = jest.fn();
    const second = jest.fn();
    void f.handle.done.then(first);
    void followup?.done.then(second);
    limits.onTurnComplete?.(0);
    await Promise.resolve();
    expect(first).not.toHaveBeenCalled();
    release();
    await f.handle.done;
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    limits.onTurnComplete?.(1);
    f.finish(0);
    await followup?.done;
    await Promise.resolve();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(1);
  });

  it('replays the resolved session, forwards stream callbacks and attaches lazy agent identity', async () => {
    const f = runnerFixture();
    const replay = jest.fn();
    f.config.onSessionResolved?.('session');
    f.handle.onSessionResolved?.(replay);
    expect(replay).toHaveBeenCalledWith('session');
    expect(f.context.lanePlanLimits.onSystemInit).toHaveBeenCalledTimes(1);
    f.setAgentId('assigned');
    expect(f.context.agentIdHolder.value).toBe('assigned');
    expect(f.context.lanePlanLimits.attach).toHaveBeenCalledWith('assigned');
    expect(f.handle.setAgentId).toBe(f.setAgentId);
    const output = jest.fn();
    f.handle.onOutput(output);
    expect(f.context.outputCallbacks).toContain(output);
    expect(f.config.emitOutput).toBe(f.context.emitOutput);
    expect(f.config.emitSegment).toBe(f.context.emitSegment);
    expect(f.config.emitStreamEvent).toBe(f.context.emitStreamEvent);
    expect(f.handle.onSegment).toBe(f.context.onSegment);
    expect(f.handle.onStreamEvent).toBe(f.context.onStreamEvent);
    const next = await f.handle.continue?.('follow-up');
    await f.context.mailbox.prompt.next();
    expect((await f.context.mailbox.prompt.next()).value).toMatchObject({
      session_id: 'session',
      message: { content: 'follow-up' },
    });
    f.finish(0);
    await f.handle.done;
    await next?.done;
  });

  it('closes on abort and settles pending turns with cleanup when the stream ends', async () => {
    const f = runnerFixture();
    const next = await f.handle.continue?.('queued');
    f.handle.abort.abort();
    expect(f.close).toHaveBeenCalled();
    f.finish(1);
    await expect(f.handle.done).resolves.toBe(1);
    await expect(next?.done).resolves.toBe(1);
    expect(f.context.disposeCallbacks).toHaveBeenCalledTimes(1);
    expect(f.context.stopProxy).toHaveBeenCalledTimes(1);
    expect(f.context.lanePlanLimits.end).toHaveBeenCalledTimes(1);
    expect(f.remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('settles pending turns on unexpected stream rejection', async () => {
    const f = runnerFixture();
    const next = await f.handle.continue?.('queued');
    f.fail(new Error('fixture failure'));
    await expect(f.handle.done).resolves.toBe(1);
    await expect(next?.done).resolves.toBe(1);
    expect(f.context.stopProxy).toHaveBeenCalledTimes(1);
  });
});

describe('named lane option and lifecycle boundaries', () => {
  it('pins secure storage, uses the certified sources and redacts named child diagnostics', () => {
    const input = optionsInput();
    input.accountRoute = {
      kind: 'named',
      provider: 'claude',
      profileId: 'profile',
      canonicalConfigDir: 'D:/accounts/selected',
      routeFingerprint: 'fingerprint',
      routeRevision: 0,
      authEpoch: 0,
      runId: 'run',
    } as ClaudeAccountNamedRoute;
    const launch = certifiedLaunch(undefined, { settingSources: ['project'] });
    input.launch = launch;
    const options = buildClaudeSdkLaneOptions(input);
    expect(options.settingSources).toEqual(['project']);
    expect(options.env?.['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(
      'D:/accounts/selected',
    );
    options.stderr?.('private token and account directory');
    expect(logger.debug).toHaveBeenLastCalledWith(
      '[ClaudeLane] Child diagnostic received.',
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('private token'),
    );
  });

  it('does not settle or close twice when abort precedes stream completion', async () => {
    const f = runnerFixture();
    const queued = await f.handle.continue?.('queued');
    f.handle.abort.abort();
    f.finish(1);
    await f.handle.done;
    await queued?.done;
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.context.disposeCallbacks).toHaveBeenCalledTimes(1);
    expect(f.context.lanePlanLimits.end).toHaveBeenCalledTimes(1);
    expect(f.context.stopProxy).toHaveBeenCalledTimes(1);
  });
});

describe('named runner handoff', () => {
  function namedRunnerFixture() {
    const named = {
      query: {} as ReturnType<ClaudeSdkLaneRunContext['queryFn']>,
      reference: {
        accountBindingId: 'run',
        accountBinding: {
          version: 1 as const,
          provider: 'claude' as const,
          profileId: 'profile',
          runId: 'run',
          routeFingerprint: 'a'.repeat(64),
          routeRevision: 0,
          authEpoch: 0,
          identity: { kind: 'unknown' as const },
        },
      },
      enqueue: jest.fn(async () => undefined),
      dispose: jest.fn(async () => undefined),
    };
    const f = runnerFixture(
      Promise.resolve(),
      named as unknown as NonNullable<ClaudeSdkLaneRunContext['named']>,
    );
    return { ...f, named };
  }

  it('uses the admitted query and receipt without launching a third query or draining the ambient mailbox', async () => {
    const f = namedRunnerFixture();
    expect(f.context.queryFn).not.toHaveBeenCalled();
    expect(PtahCliStreamLoop.prototype.run).toHaveBeenCalledWith(f.named.query);
    expect(f.handle.accountBinding).toBe(f.named.reference.accountBinding);
    expect(f.handle.accountBindingId).toBe('run');
    const queued = await f.handle.continue?.('next');
    expect(f.named.enqueue).toHaveBeenCalledWith('next', undefined);
    expect(f.handle.steer).toBeUndefined();
    expect(f.handle.interrupt).toBeUndefined();
    f.finish(0);
    await f.handle.done;
    await queued?.done;
    expect(f.named.dispose).toHaveBeenCalledTimes(1);
  });

  it('settles turns and cleans listeners once on named abort even when the stream stays pending', async () => {
    const f = namedRunnerFixture();
    const queued = await f.handle.continue?.('queued');
    f.handle.abort.abort();
    await expect(f.handle.done).resolves.toBe(1);
    await expect(queued?.done).resolves.toBe(1);
    await expect(f.handle.continue?.('late')).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    f.finish(0);
    await Promise.resolve();
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.named.dispose).toHaveBeenCalledTimes(1);
    expect(f.context.disposeCallbacks).toHaveBeenCalledTimes(1);
    expect(f.context.stopProxy).toHaveBeenCalledTimes(1);
    expect(f.context.lanePlanLimits.end).toHaveBeenCalledTimes(1);
    expect(f.remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('named lane identity proof', () => {
  type QueryFn = ClaudeSdkLaneRunContext['queryFn'];
  const notReached = async (): Promise<never> => {
    throw new Error('Not reached during bootstrap');
  };

  // A personal claude.ai login with no email: passes the tripwire, proves no identity.
  const personalNoEmail = {
    tokenSource: 'claude.ai',
    subscriptionType: 'max',
    apiProvider: 'firstParty',
  };

  function bootstrapFixture(
    setup: {
      stored?: ProviderAccountBinding;
      launch?: ClaudeCertifiedLaunchContext | null;
      info?: Record<string, unknown>;
      boundary?: () => Promise<ClaudeLaunchBoundaryOutcome>;
      accountInfo?: () => Promise<Record<string, unknown>>;
      deadlineMs?: number;
    } = {},
  ) {
    const route = {
      kind: 'named', provider: 'claude', profileId: 'profile', runId: 'run',
      canonicalConfigDir: 'D:/accounts/selected',
      routeFingerprint: 'a'.repeat(64), routeRevision: 0, authEpoch: 0,
    } as ClaudeAccountNamedRoute;
    const launch = setup.launch === null ? undefined : (setup.launch ?? certifiedLaunch());
    const commitRunBinding = jest.fn(notReached);
    const assertRouteCurrent = jest.fn(async () => undefined);
    const checkLaunchBoundary = jest.fn(
      setup.boundary ?? (async (): Promise<ClaudeLaunchBoundaryOutcome> => ({ ok: true })),
    );
    const persistence: ClaudeLaneAccountPersistence = {
      available: true,
      lookupBySdkSession: notReached,
      validateResume: notReached,
      persistReference: notReached,
      commitRunBinding,
      attachSdkSession: notReached,
      saveAccountBound: notReached,
      assertRouteCurrent,
      checkLaunchBoundary,
      onAuthEpochChanged: () => () => undefined,
    };
    // Settlement outcomes are not read beyond a warning; only the calls count.
    const releaseReservation = jest.fn(notReached);
    const retainUnresolvedReservation = jest.fn(notReached);
    const admissionPort: ProviderAccountAdmissionPort = {
      admitClaudeRoute: notReached,
      releaseReservation,
      retainUnresolvedReservation,
    };
    const close = jest.fn();
    const query = {
      accountInfo: setup.accountInfo ?? (async () => setup.info ?? personalNoEmail),
      close: (): void => close(),
    };
    const queryMock = jest.fn(() => query as ReturnType<QueryFn>);
    const queryFn: QueryFn = queryMock;
    const options: Options = launch
      ? buildClaudeLaneBootstrapOptions(
          route, launch, new AbortController(), { spawn: jest.fn() },
        )
      : { spawnClaudeCodeProcess: () => { throw new Error('never spawned'); } };
    const abort = new AbortController();
    // A long deadline: a refusal must come from the checks, not a timeout.
    const admission = new ClaudeNamedLaneAdmission(
      route, launch, {} as ClaudeAccountRunReservation, admissionPort, persistence,
      abort, { warn: jest.fn() }, setup.stored, setup.deadlineMs ?? 60_000,
    );
    return {
      admission, route, launch, queryFn, queryMock, options, abort, close,
      commitRunBinding, assertRouteCurrent, checkLaunchBoundary,
      releaseReservation, retainUnresolvedReservation,
    };
  }

  it.each<[string, ProviderAccountBinding | undefined]>([
    ['no stored binding', undefined],
    ['a stored unknown identity', {
      version: 1, provider: 'claude', profileId: 'profile', runId: 'run',
      routeFingerprint: 'a'.repeat(64), routeRevision: 0, authEpoch: 0,
      identity: { kind: 'unknown' },
    } satisfies ProviderAccountBinding],
  ])('refuses an unproved identity before any binding with %s', async (_label, stored) => {
    const f = bootstrapFixture({ stored });
    await expect(f.admission.bootstrap(f.queryFn, f.options)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.queryMock).toHaveBeenCalledTimes(1);
    expect(f.assertRouteCurrent).toHaveBeenCalledTimes(1);
    expect(f.commitRunBinding).not.toHaveBeenCalled();
    // Refused at the identity check: the bootstrap child was never released
    // as proved, and no deadline fired.
    expect(f.close).not.toHaveBeenCalled();
    expect(f.abort.signal.aborted).toBe(false);
  });

  it('refuses a named route without a certified launch before any SDK call', async () => {
    const route = bootstrapFixture().route;
    const input = optionsInput();
    input.accountRoute = route;
    expect(() => buildClaudeSdkLaneOptions(input)).toThrow(
      expect.objectContaining({ code: 'identity-unproved' }),
    );
    expect(() =>
      buildClaudeLaneBootstrapOptions(route, undefined, new AbortController(), { spawn: jest.fn() }),
    ).toThrow(expect.objectContaining({ code: 'identity-unproved' }));
    const f = bootstrapFixture({ launch: null });
    await expect(f.admission.bootstrap(f.queryFn, f.options)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.queryMock).not.toHaveBeenCalled();
    expect(f.checkLaunchBoundary).not.toHaveBeenCalled();
  });

  it('awaits the bootstrap boundary check before the child opens', async () => {
    let finish!: (outcome: ClaudeLaunchBoundaryOutcome) => void;
    const f = bootstrapFixture({
      boundary: () => new Promise((resolve) => { finish = resolve; }),
    });
    const bootstrap = f.admission.bootstrap(f.queryFn, f.options);
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.checkLaunchBoundary).toHaveBeenCalledWith(
      f.route, f.launch, 'bootstrap', f.abort.signal,
    );
    expect(f.queryMock).not.toHaveBeenCalled();
    finish({ ok: true });
    await expect(bootstrap).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.queryMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [true, 'releaseReservation', 'retainUnresolvedReservation'],
    [false, 'retainUnresolvedReservation', 'releaseReservation'],
  ] as const)(
    'refuses a bootstrap boundary refusal with its code and no query (terminated %s)',
    async (terminated, settled, untouched) => {
      const f = bootstrapFixture({
        boundary: async () => ({ ok: false, code: 'unsupported-source', terminated }),
      });
      await expect(f.admission.bootstrap(f.queryFn, f.options)).rejects.toMatchObject({
        code: 'unsupported-source',
      });
      expect(f.queryMock).not.toHaveBeenCalled();
      await f.admission.dispose();
      await f.admission.dispose();
      expect(f[settled]).toHaveBeenCalledTimes(1);
      expect(f[untouched]).not.toHaveBeenCalled();
    },
  );

  it.each<[string, (options: Options) => Options, string]>([
    ['cwd', (o) => ({ ...o, cwd: 'D:/elsewhere' }), 'route-changed'],
    ['executable', (o) => ({ ...o, pathToClaudeCodeExecutable: 'D:/other/cli.js' }), 'route-changed'],
    ['setting sources', (o) => ({ ...o, settingSources: ['user'] }), 'route-changed'],
    ['env entry', (o) => ({ ...o, env: { ...o.env, ANTHROPIC_API_KEY: 'x' } }), 'route-changed'],
    ['managed settings', (o) => ({ ...o, managedSettings: {} }), 'identity-unproved'],
    ['managed-settings arg', (o) => ({ ...o, extraArgs: { '--managed-settings=x': null } }), 'identity-unproved'],
  ])('refuses %s drift at bootstrap before the boundary check and the child', async (_label, drift, code) => {
    const f = bootstrapFixture();
    await expect(f.admission.bootstrap(f.queryFn, drift(f.options))).rejects.toMatchObject({ code });
    expect(f.checkLaunchBoundary).not.toHaveBeenCalled();
    expect(f.queryMock).not.toHaveBeenCalled();
  });

  const allPassed = {
    tokenSource: true, apiKeySource: true, apiProvider: true, subscription: 'max', personalSubscription: true,
  } as const;

  // The bundled CLI 2.1.278 accountInfo shape for a claude.ai subscriber: no
  // tokenSource, no apiKeySource, a display subscription name.
  const bundledCliPersonal = { subscriptionType: 'Claude Max', apiProvider: 'firstParty' };

  it.each<[string, Record<string, unknown>]>([
    ['the bundled CLI Claude Max shape', bundledCliPersonal],
    ['the bundled CLI Claude Pro shape', { subscriptionType: 'Claude Pro' }],
    ['the bundled CLI shape with apiKeySource none', { ...bundledCliPersonal, apiKeySource: 'none' }],
    ['the claude.ai token source shape', personalNoEmail],
  ])('passes the personal-login tripwire for %s', async (_label, info) => {
    // A different account: the run gets past the tripwire and refuses at the compare.
    const f = bootstrapFixture({
      info: { ...info, email: 'other@example.test', organization: 'org' },
    });
    await expect(f.admission.bootstrap(f.queryFn, f.options)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.admission.launchDiagnostic).toEqual({ phase: 'bootstrap', step: 'identity-compare' });
  });

  const refusedSubscription = { personalSubscription: false } as const;

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ['a console token source', { ...personalNoEmail, tokenSource: 'console' }, { tokenSource: false }],
    ['an env OAuth token source', { ...bundledCliPersonal, tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN' }, { tokenSource: false }],
    [
      'a file-descriptor OAuth token source',
      { ...bundledCliPersonal, tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR' },
      { tokenSource: false },
    ],
    ['an apiKeyHelper key source', { ...personalNoEmail, apiKeySource: 'apiKeyHelper' }, { apiKeySource: false }],
    ['an env API key source', { ...bundledCliPersonal, apiKeySource: 'ANTHROPIC_API_KEY' }, { apiKeySource: false }],
    ['a team subscription', { ...personalNoEmail, subscriptionType: 'team' }, { subscription: 'team', ...refusedSubscription }],
    ['a Claude Team subscription', { ...bundledCliPersonal, subscriptionType: 'Claude Team' }, { subscription: 'team', ...refusedSubscription }],
    [
      'a Claude Enterprise subscription',
      { ...bundledCliPersonal, subscriptionType: 'Claude Enterprise' },
      { subscription: 'enterprise', ...refusedSubscription },
    ],
    ['a Claude API subscription', { ...bundledCliPersonal, subscriptionType: 'Claude API' }, { subscription: 'api', ...refusedSubscription }],
    ['an unknown subscription word', { ...personalNoEmail, subscriptionType: 'future' }, { subscription: 'other', ...refusedSubscription }],
    ['no subscription', { tokenSource: 'claude.ai' }, { subscription: 'absent', ...refusedSubscription }],
    ['no subscription and no token source', { apiProvider: 'firstParty' }, { subscription: 'absent', ...refusedSubscription }],
    ['a third-party provider', { ...personalNoEmail, apiProvider: 'bedrock' }, { apiProvider: false }],
    ['a vertex provider on the bundled CLI shape', { ...bundledCliPersonal, apiProvider: 'vertex' }, { apiProvider: false }],
  ])('trips on %s before any binding or prompt', async (_label, info, failed) => {
    const f = bootstrapFixture({
      info: { ...info, email: 'owner@example.test', organization: 'org' },
    });
    await expect(f.admission.bootstrap(f.queryFn, f.options)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.commitRunBinding).not.toHaveBeenCalled();
    // The diagnostic names the failed check with fixed words, never a value.
    const diagnostic = f.admission.launchDiagnostic;
    expect(diagnostic).toEqual({
      phase: 'bootstrap', step: 'personal-login',
      personalLogin: { ...allPassed, ...failed },
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /owner|example|console|apiKeyHelper|bedrock|vertex|future|Claude|CLAUDE_CODE|ANTHROPIC/,
    );
  });

  it('refuses a child signed in to an account other than the certified one', async () => {
    const f = bootstrapFixture({
      info: { ...personalNoEmail, email: 'other@example.test', organization: 'org' },
    });
    await expect(f.admission.bootstrap(f.queryFn, f.options)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.commitRunBinding).not.toHaveBeenCalled();
    expect(f.admission.launchDiagnostic).toEqual({ phase: 'bootstrap', step: 'identity-compare' });
  });

  it('names the identity-absent step for a personal login with no email', async () => {
    const f = bootstrapFixture();
    await expect(f.admission.bootstrap(f.queryFn, f.options)).rejects.toMatchObject({
      code: 'identity-unproved',
    });
    expect(f.admission.launchDiagnostic).toEqual({ phase: 'bootstrap', step: 'identity-absent' });
  });

  it('names the account-info step and the foreign error class when the child query rejects', async () => {
    class SdkTransportError extends Error {
      override name = 'SdkTransportError';
    }
    const f = bootstrapFixture({
      accountInfo: async () => { throw new SdkTransportError('owner@example.test D:/x'); },
    });
    const error: unknown = await f.admission.bootstrap(f.queryFn, f.options).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(f.admission.launchDiagnostic).toEqual({ phase: 'bootstrap', step: 'account-info' });
    expect(claudeLaneForeignErrorClass(error)).toBe('other');
    expect(claudeLaneRefusalCode(error)).toBe('identity-unproved');
  });

  it('records a deadline interrupt when a wait times out', async () => {
    const f = bootstrapFixture({
      accountInfo: () => new Promise<never>(() => undefined),
      deadlineMs: 5,
    });
    await expect(f.admission.bootstrap(f.queryFn, f.options)).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.admission.launchDiagnostic).toEqual({
      phase: 'bootstrap', step: 'account-info', interrupt: 'deadline',
    });
  });

  it('reports no foreign class for refusals and a fixed word for odd names', () => {
    expect(claudeLaneForeignErrorClass(claudeLaneRefusal('busy'))).toBeUndefined();
    expect(claudeLaneForeignErrorClass('text')).toBe('non-error');
    expect(claudeLaneForeignErrorClass(Object.assign(new Error('m'), { name: 'a b/c' }))).toBe('other');
    expect(claudeLaneForeignErrorClass(Object.assign(new Error('m'), { name: 'ownerExampleTest' }))).toBe('other');
    let reads = 0;
    const switching = new Error('m');
    Object.defineProperty(switching, 'name', {
      get: () => (reads++ === 0 ? 'TypeError' : 'owner@example.test'),
    });
    expect(claudeLaneForeignErrorClass(switching)).toBe('TypeError');
    expect(reads).toBe(1);
    const throwing = new Error('m');
    Object.defineProperty(throwing, 'name', {
      get: () => {
        throw new Error('owner@example.test');
      },
    });
    expect(claudeLaneForeignErrorClass(throwing)).toBe('other');
    expect(claudeLaneForeignErrorClass(new TypeError('m'))).toBe('TypeError');
  });
});

describe('named lane certified final options and refusal codes', () => {
  const route = {
    kind: 'named', provider: 'claude', profileId: 'profile', runId: 'run',
    canonicalConfigDir: 'D:/accounts/selected',
    routeFingerprint: 'a'.repeat(64), routeRevision: 0, authEpoch: 0,
  } as ClaudeAccountNamedRoute;

  it('uses the certified cwd and sources and carries no managed settings channel', () => {
    const launch = certifiedLaunch(undefined, { cwd: 'D:/certified-workspace' });
    const input = optionsInput();
    input.accountRoute = route;
    input.launch = launch;
    const options = buildClaudeSdkLaneOptions(input);
    expect(options.cwd).toBe('D:/certified-workspace');
    expect(options.settingSources).toEqual(launch.settingSources);
    expect(options.env).toEqual(launch.env);
    expect(options).not.toHaveProperty('managedSettings');
    expect(
      Object.keys(options.extraArgs ?? {}).some((key) => key.includes('managed-settings')),
    ).toBe(false);
    expect(() => assertCertifiedLaunch(launch, claudeActualLaunch(options), 'final')).not.toThrow();
  });

  it('builds a bootstrap that passes the bootstrap check and nothing else', () => {
    const launch = certifiedLaunch();
    const options = buildClaudeLaneBootstrapOptions(
      route, launch, new AbortController(), { spawn: jest.fn() },
    );
    expect(options.settingSources).toEqual([]);
    expect(options).not.toHaveProperty('managedSettings');
    expect(options.pathToClaudeCodeExecutable).toBe(launch.executable.sdkExecutablePath);
    expect(() => assertCertifiedLaunch(launch, claudeActualLaunch(options), 'final')).toThrow();
  });

  // Without direct execution the certified executable is the installation
  // path, not the loader's CLI JS path; both named builders must follow it.
  it('uses the certified executable when it differs from the loader path', () => {
    const base = certifiedLaunch();
    const launch: ClaudeCertifiedLaunchContext = {
      ...base,
      executable: { ...base.executable, sdkExecutablePath: 'D:/install/claude.exe' },
    };
    const bootstrap = buildClaudeLaneBootstrapOptions(
      route, launch, new AbortController(), { spawn: jest.fn() },
    );
    expect(bootstrap.pathToClaudeCodeExecutable).toBe('D:/install/claude.exe');
    expect(() =>
      assertCertifiedLaunch(launch, claudeActualLaunch(bootstrap), 'bootstrap'),
    ).not.toThrow();
    const input = optionsInput();
    expect(input.executable).toBe('D:/cli/cli.js');
    input.accountRoute = route;
    input.launch = launch;
    const final = buildClaudeSdkLaneOptions(input);
    expect(final.pathToClaudeCodeExecutable).toBe('D:/install/claude.exe');
    expect(() => assertCertifiedLaunch(launch, claudeActualLaunch(final), 'final')).not.toThrow();
    // The ambient lane keeps the loader path.
    const ambient = buildClaudeSdkLaneOptions(optionsInput());
    expect(ambient.pathToClaudeCodeExecutable).toBe('D:/cli/cli.js');
  });

  it('keeps the real refusal code and maps foreign errors to identity-unproved', () => {
    expect(claudeLaneRefusal('unsupported-source').code).toBe('unsupported-source');
    expect(claudeLaneRefusal().code).toBe('identity-unproved');
    expect(claudeLaneRefusalCode(claudeLaneRefusal('route-changed'))).toBe('route-changed');
    expect(claudeLaneRefusalCode(new ClaudeCertifiedLaunchRefusal('identity-unproved'))).toBe(
      'identity-unproved',
    );
    expect(claudeLaneRefusalCode(Object.assign(new Error('x'), { code: 'busy' }))).toBe(
      'identity-unproved',
    );
  });
});

// A2 mocked evidence only; no live SDK compatibility claim.
describe('A2 mocked-evidence lane route and policy matrix', () => {
  afterEach(() => jest.restoreAllMocks());

  it('pins the lane route after hostile ambient and auth env without changing prompt or MCP policy', async () => {
    jest.replaceProperty(process, 'env', {
      PATH: 'D:/bin', CLAUDE_CONFIG_DIR: 'D:/ambient',
      CLAUDE_SECURESTORAGE_CONFIG_DIR: 'D:/ambient-storage',
      ANTHROPIC_API_KEY: 'ambient-secret',
    });
    const input = optionsInput();
    input.authEnv = { ANTHROPIC_API_KEY: 'auth-env-secret' };
    const baseline = buildClaudeSdkLaneOptions(input);
    const route = {
      kind: 'named', provider: 'claude', profileId: 'private-account-id',
      runId: 'private-run-id', canonicalConfigDir: 'D:/private-account-path',
      routeFingerprint: 'a'.repeat(64), routeRevision: 0, authEpoch: 0,
    } as ClaudeAccountNamedRoute;
    input.accountRoute = route;
    input.launch = certifiedLaunch(route.canonicalConfigDir);
    const named = buildClaudeSdkLaneOptions(input);
    expect(named.env?.['CLAUDE_CONFIG_DIR']).toBe(route.canonicalConfigDir);
    expect(named.env?.['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(route.canonicalConfigDir);
    expect(named.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(named.systemPrompt).toEqual(baseline.systemPrompt);
    expect(named.mcpServers).toBe(baseline.mcpServers);
    expect(named.tools).toEqual(baseline.tools);
    expect(named.permissionMode).toBe(baseline.permissionMode);
    expect(named.allowDangerouslySkipPermissions).toBe(baseline.allowDangerouslySkipPermissions);
    expect(named.strictMcpConfig).toBe(baseline.strictMcpConfig);
    const permissionContext = { signal: input.abortController.signal, toolUseID: 'tool', requestId: 'request' };
    expect(await named.canUseTool?.('Read', {}, permissionContext))
      .toEqual(await baseline.canUseTool?.('Read', {}, permissionContext));
    for (const secret of [route.profileId, route.runId, route.canonicalConfigDir]) {
      expect(JSON.stringify(named.systemPrompt)).not.toContain(secret);
    }
    const other = buildClaudeSdkLaneOptions({ ...input, accountRoute: {
      ...route, profileId: 'other', runId: 'other-run', canonicalConfigDir: 'D:/other-account',
    } as ClaudeAccountNamedRoute, launch: certifiedLaunch('D:/other-account') });
    expect(other.env?.['CLAUDE_CONFIG_DIR']).toBe('D:/other-account');
    expect(named.env?.['CLAUDE_CONFIG_DIR']).toBe(route.canonicalConfigDir);
  });
});

describe('named lane final child init after the first turn (D68)', () => {
  type QueryFn = ClaudeSdkLaneRunContext['queryFn'];
  type Message = Record<string, unknown>;
  const owner = {
    tokenSource: 'claude.ai', subscriptionType: 'max', apiProvider: 'firstParty',
    email: 'owner@example.test', organization: 'org',
  };
  const route = {
    kind: 'named', provider: 'claude', profileId: 'profile', runId: 'run',
    canonicalConfigDir: 'D:/accounts/selected',
    routeFingerprint: 'a'.repeat(64), routeRevision: 0, authEpoch: 0,
  } as ClaudeAccountNamedRoute;
  const sessionId = '99999999-2222-4333-8444-555555555555';
  const init = (overrides: Message = {}): Message => ({
    type: 'system', subtype: 'init', session_id: sessionId,
    claude_code_version: '2.1.310', apiKeySource: 'none', ...overrides,
  });
  const spawnInput = {
    command: 'claude', args: [], env: {}, signal: new AbortController().signal,
  };

  /**
   * Models CLI 2.1.278 in streaming-input mode: the final child emits
   * `system/init` only after it consumed the first user message.
   */
  function fixture(
    setup: {
      init?: Message | null;
      deadlineMs?: number;
      yolo?: boolean;
      /** Holds the binding commit, or the final child's identity proof read. */
      hold?: 'commit' | 'proof';
    } = {},
  ) {
    const launch = certifiedLaunch();
    const events: string[] = [];
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    let identityReads = 0;
    const controller = new AbortController();
    const callerHook = jest.fn(async () => ({}));
    const binding: ProviderAccountBinding = {
      version: 1, provider: 'claude', profileId: 'profile', runId: 'run',
      routeFingerprint: 'a'.repeat(64), routeRevision: 0, authEpoch: 0,
      identity: { kind: 'known', ownerKey: launch.identityReference },
    };
    const commitRunBinding = jest.fn(async () => {
      if (setup.hold === 'commit') {
        enter();
        await released;
      }
      events.push('commit');
      return binding;
    });
    const attachSdkSession = jest.fn(async () => {
      events.push('attach');
      return { status: 'attached' as const };
    });
    const persistence: ClaudeLaneAccountPersistence = {
      available: true,
      lookupBySdkSession: jest.fn(),
      validateResume: async () => ({ code: 'ok' }),
      persistReference: async () => undefined,
      commitRunBinding,
      attachSdkSession,
      saveAccountBound: async () => undefined,
      assertRouteCurrent: async () => undefined,
      checkLaunchBoundary: async (): Promise<ClaudeLaunchBoundaryOutcome> => ({ ok: true }),
      onAuthEpochChanged: () => () => undefined,
    };
    const admissionPort: ProviderAccountAdmissionPort = {
      admitClaudeRoute: jest.fn(),
      releaseReservation: jest.fn(),
      retainUnresolvedReservation: jest.fn(),
    };
    const processes: EventEmitter[] = [];
    const spawner = {
      spawn: jest.fn().mockImplementation(() => {
        const child = new EventEmitter();
        processes.push(child);
        return child;
      }),
    };
    const prompts: unknown[] = [];
    const finalArgs: Parameters<QueryFn>[0][] = [];
    const queryFn: QueryFn = jest.fn((args: Parameters<QueryFn>[0]) => {
      const index = finalArgs.push(args) - 1;
      args.options?.spawnClaudeCodeProcess?.(spawnInput);
      const child = processes[processes.length - 1];
      const final = index === 1;
      const stream: Message[] = [];
      let consumed = false;
      const query = {
        accountInfo: async () => {
          // Read 1 is the bootstrap child; read 2 is the final child's proof.
          if (setup.hold === 'proof' && ++identityReads === 2) {
            enter();
            await released;
          } else if (setup.hold !== 'proof') identityReads++;
          return owner;
        },
        close: (): void => {
          child.emit('exit', 0);
        },
        next: async (): Promise<IteratorResult<Message>> => {
          if (final && !consumed && typeof args.prompt !== 'string') {
            consumed = true;
            const first = await args.prompt[Symbol.asyncIterator]().next();
            if (first.done) return { done: true, value: undefined };
            prompts.push(first.value);
            events.push('prompt');
            if (setup.init !== null) stream.push(setup.init ?? init());
            stream.push({ type: 'assistant', text: 'early output' });
          }
          const value = stream.shift();
          if (value) return { done: false, value };
          return new Promise<never>(() => undefined);
        },
      };
      return query as ReturnType<QueryFn>;
    });
    const input = optionsInput();
    input.accountRoute = route;
    input.launch = launch;
    input.resumeSessionId = undefined;
    input.processSpawner = spawner;
    if (setup.yolo) {
      input.permissionHandler = permissionHandler('yolo');
      input.assembly = {
        ...input.assembly,
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [callerHook] }] },
      };
    }
    const finalOptions = buildClaudeSdkLaneOptions(input);
    const bootstrapOptions = buildClaudeLaneBootstrapOptions(
      route, launch, new AbortController(), spawner,
    );
    const admission = new ClaudeNamedLaneAdmission(
      route, launch, {} as ClaudeAccountRunReservation, admissionPort, persistence,
      controller, { warn: jest.fn() }, undefined, setup.deadlineMs ?? 60_000,
    );
    const metadata = {
      name: 'Reviewer', workspaceId: 'D:/workspace', workingDirectory: 'D:/workspace',
      createdAt: 0, lastActiveAt: 0, totalCost: 0,
      totalTokens: { input: 0, output: 0 }, isChildSession: true,
    };
    const run = async () => {
      await admission.bootstrap(queryFn, bootstrapOptions);
      return admission.launch(queryFn, finalOptions, metadata, { message: 'task' });
    };
    return {
      admission, run, events, prompts, finalArgs, commitRunBinding, attachSdkSession,
      entered, release, controller, callerHook,
    };
  }

  const toolHookInput: HookInput = {
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {},
    tool_use_id: 'tool-1', session_id: sessionId, transcript_path: '', cwd: '',
  };
  const denyHook = {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
  };
  const hookOf = (f: ReturnType<typeof fixture>) =>
    f.finalArgs[1]?.options?.hooks?.PreToolUse?.[0]?.hooks[0];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('consumes no prompt while the same-child identity proof is pending', async () => {
    const f = fixture({ hold: 'proof' });
    const running = f.run();
    await f.entered;
    await settle();
    expect(f.prompts).toHaveLength(0);
    expect(f.events).not.toContain('prompt');
    f.release();
    await expect(running).resolves.toBeUndefined();
    expect(f.prompts).toHaveLength(1);
  });

  it('denies a YOLO PreToolUse call before init is verified, ahead of caller hooks (F1)', async () => {
    const f = fixture({ init: null, deadlineMs: 200, yolo: true });
    const running = f.run();
    await settle();
    const options = f.finalArgs[1]?.options;
    expect(options?.permissionMode).toBe('bypassPermissions');
    const matchers = options?.hooks?.PreToolUse ?? [];
    expect(matchers).toHaveLength(2);
    expect(matchers[0].matcher).toBeUndefined();
    expect(matchers[1].hooks).toEqual([f.callerHook]);
    const signal = new AbortController().signal;
    expect(await hookOf(f)?.(toolHookInput, 'tool-1', { signal })).toMatchObject(denyHook);
    await expect(running).rejects.toMatchObject({ code: 'identity-unproved' });
  });

  it('holds a YOLO PreToolUse call after init until the binding commits (F1)', async () => {
    const f = fixture({ hold: 'commit', yolo: true });
    const running = f.run();
    await f.entered;
    let decision: unknown;
    const held = hookOf(f)?.(toolHookInput, 'tool-1', {
      signal: new AbortController().signal,
    }).then((value) => (decision = value));
    await settle();
    expect(decision).toBeUndefined();
    f.release();
    await expect(running).resolves.toBeUndefined();
    await held;
    // Admitted: no decision, so the caller's permission flow applies.
    expect(decision).toEqual({});
    await f.admission.dispose();
    expect(
      await hookOf(f)?.(toolHookInput, 'tool-1', { signal: new AbortController().signal }),
    ).toMatchObject(denyHook);
  });

  it('denies a held YOLO PreToolUse call when the run is aborted before admission (F1)', async () => {
    const f = fixture({ hold: 'commit', yolo: true });
    const running = f.run();
    await f.entered;
    const held = hookOf(f)?.(toolHookInput, 'tool-1', {
      signal: new AbortController().signal,
    });
    f.controller.abort();
    expect(await held).toMatchObject(denyHook);
    f.release();
    await expect(running).rejects.toBeDefined();
    expect(f.attachSdkSession).not.toHaveBeenCalled();
  });

  it('releases the first turn after the identity proof and passes on init', async () => {
    const f = fixture();
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.prompts).toEqual([
      expect.objectContaining({ type: 'user', message: { role: 'user', content: 'task' } }),
    ]);
    // The binding is committed only after the init that followed the prompt.
    expect(f.events).toEqual(['prompt', 'commit', 'attach']);
    // Buffered messages replay to the caller in order, init first.
    const query = f.admission.query;
    expect(await query?.next()).toEqual({ done: false, value: init() });
    expect(await query?.next()).toEqual({
      done: false, value: { type: 'assistant', text: 'early output' },
    });
  });

  it.each<[string, Message]>([
    ['a different CLI version', init({ claude_code_version: '2.1.278' })],
    ['a non-personal key source', init({ apiKeySource: 'user' })],
  ])('refuses %s and forwards nothing', async (_label, message) => {
    const f = fixture({ init: message });
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.commitRunBinding).not.toHaveBeenCalled();
    expect(f.attachSdkSession).not.toHaveBeenCalled();
    expect(f.admission.query).toBeUndefined();
  });

  it('refuses when no init arrives before the deadline', async () => {
    const f = fixture({ init: null, deadlineMs: 50 });
    await expect(f.run()).rejects.toMatchObject({ code: 'identity-unproved' });
    expect(f.admission.launchDiagnostic).toMatchObject({
      phase: 'final', step: 'init-wait', interrupt: 'deadline',
    });
    expect(f.prompts).toHaveLength(1);
    expect(f.commitRunBinding).not.toHaveBeenCalled();
    expect(f.admission.query).toBeUndefined();
  });

  it('denies a tool call before init is verified', async () => {
    const f = fixture({ init: null, deadlineMs: 200 });
    const running = f.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const canUseTool = f.finalArgs[1]?.options?.canUseTool;
    expect(canUseTool).toBeDefined();
    const context = {
      signal: new AbortController().signal, toolUseID: 'tool-1', requestId: 'request',
    };
    await expect(canUseTool?.('Read', {}, context)).resolves.toEqual({
      behavior: 'deny', message: 'Account admission pending.',
    });
    await expect(running).rejects.toMatchObject({ code: 'identity-unproved' });
  });
});
