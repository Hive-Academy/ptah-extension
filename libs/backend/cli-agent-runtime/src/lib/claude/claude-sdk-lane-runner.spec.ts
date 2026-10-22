import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import {
  buildFlagSettingsArg,
  buildSafeEnv,
  buildSessionName,
  deriveWorkspaceLabel,
  type SdkMessageTransformer,
  type SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import {
  buildClaudeSdkLaneOptions,
  resolveClaudeLanePermissionOptions,
  type ClaudeSdkLaneOptionsInput,
} from './claude-sdk-lane-options';
import {
  ClaudeSdkLaneRunner,
  type ClaudeSdkLaneRunContext,
} from './claude-sdk-lane-runner';
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
  it('pins secure storage, excludes ambient settings and redacts named child diagnostics', () => {
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
    const options = buildClaudeSdkLaneOptions(input);
    expect(options.settingSources).toEqual([]);
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
      code: 'release-held',
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
