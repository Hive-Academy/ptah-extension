import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentRoleDefinition } from '@ptah-extension/shared';
import type {
  ClaudeAccountAdmissionRequest,
  ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import {
  buildSafeEnv,
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
    createCallback: jest.fn(() => callback),
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
    await expect(context.mailbox.prompt.next()).resolves.toMatchObject({
      done: true,
    });
    expect(f.limits.end).toHaveBeenCalled();
  });
});
