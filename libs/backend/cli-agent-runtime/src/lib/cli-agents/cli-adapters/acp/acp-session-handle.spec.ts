import type { CliOutputSegment } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { MockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CliCommandOptions, SdkHandle } from '../cli-adapter.interface';
import {
  createFakeAcpAgent,
  createFakeAcpTransport,
  type FakeAcpAgent,
  type FakeAcpAgentOptions,
  type FakeAcpMessage,
  type FakeAcpTransport,
} from './__fixtures__/fake-acp-agent';
import type { AcpSpawnOptions } from './acp-process-transport';
import * as loader from './acp-sdk-loader';
import {
  ACP_CANCEL_GRACE_MS,
  ACP_HANDSHAKE_TIMEOUT_MS,
  createAcpSessionHandle,
} from './acp-session-handle';
import {
  readAcpErrorDetail,
  type AcpRequestFailure,
  type AcpVendorProfile,
} from './acp-vendor-profile';

const NAME = 'Test Agent';
const SESSION_ID = 'sess-1';
const MCP_SERVER = {
  type: 'http' as const,
  name: 'ptah',
  url: 'http://localhost:51820/agent/a-1/workspace/w',
  headers: [],
};
const GROK_OPTIONS = [
  { optionId: 'always-allow', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
  { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
];
const MODEL_OPTION = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'model-a',
  options: [
    { value: 'model-a', name: 'Model A' },
    { value: 'model-b', name: 'Model B' },
  ],
};

/** Test profile: maps the error rows the way a vendor profile would. */
function describeTestError(failure: AcpRequestFailure): string | undefined {
  const detail = readAcpErrorDetail(failure.data);
  if (failure.code === -32003) return `${NAME} is rate limited: ${detail}`;
  if (failure.code === -32000) return `${NAME} is not signed in`;
  if (failure.code === -32602 && failure.configId === 'model') {
    return `${NAME} rejected model '${String(failure.configValue)}' (from ${failure.options.modelSource ?? 'setting'}); available: ${failure.advertisedValues?.join(', ')}`;
  }
  return undefined;
}

function createProfile(
  overrides: Partial<AcpVendorProfile> = {},
): AcpVendorProfile {
  return {
    vendor: 'opencode',
    displayName: NAME,
    resumeStrategy: 'resume',
    buildSpawn: () => ({ args: ['agent', '--no-leader', 'stdio'] }),
    buildMcpServers: () => [MCP_SERVER],
    isExtensionNotification: (method) => /^_?x\.ai\//.test(method),
    describeError: describeTestError,
    ...overrides,
  };
}

interface Harness {
  readonly handle: SdkHandle;
  readonly agent: FakeAcpAgent;
  readonly transport: FakeAcpTransport;
  readonly segments: CliOutputSegment[];
  readonly output: () => string;
  readonly errors: () => string[];
  readonly infos: () => string[];
  readonly resolvedIds: string[];
  readonly spawn: () => AcpSpawnOptions | undefined;
  readonly logger: MockLogger;
}

const live: FakeAcpAgent[] = [];

function start(
  setup: {
    profile?: Partial<AcpVendorProfile>;
    options?: Partial<CliCommandOptions>;
    agent?: FakeAcpAgentOptions;
    script?: (agent: FakeAcpAgent) => void;
  } = {},
): Harness {
  const agent = createFakeAcpAgent({ sessionId: SESSION_ID, ...setup.agent });
  live.push(agent);
  setup.script?.(agent);
  const transport = createFakeAcpTransport(agent);
  const logger = createMockLogger();
  let spawn: AcpSpawnOptions | undefined;
  const handle = createAcpSessionHandle({
    profile: createProfile(setup.profile),
    options: {
      task: 'Summarise the repository',
      workingDirectory: process.cwd(),
      projectGuidance: 'PROJECT-GUIDANCE-MARKER',
      ...setup.options,
    },
    command: 'test-agent',
    transportFactory: (spawnOptions) => {
      spawn = spawnOptions;
      return transport;
    },
    logger: logger as unknown as Logger,
  });
  const segments: CliOutputSegment[] = [];
  const chunks: string[] = [];
  const resolvedIds: string[] = [];
  handle.onSegment?.((s) => segments.push(s));
  handle.onOutput((d) => chunks.push(d));
  handle.onSessionResolved?.((id) => resolvedIds.push(id));
  return {
    handle,
    agent,
    transport,
    segments,
    output: () => chunks.join(''),
    errors: () =>
      segments.filter((s) => s.type === 'error').map((s) => s.content),
    infos: () =>
      segments.filter((s) => s.type === 'info').map((s) => s.content),
    resolvedIds,
    spawn: () => spawn,
    logger,
  };
}

const byMethod =
  (method: string) =>
  (m: FakeAcpMessage): boolean =>
    m.method === method;

function sent(agent: FakeAcpAgent, method: string): FakeAcpMessage[] {
  return agent.received.filter(byMethod(method));
}

function paramsOf(message: FakeAcpMessage): Record<string, unknown> {
  return message.params as Record<string, unknown>;
}

function promptText(message: FakeAcpMessage): string {
  const prompt = paramsOf(message)['prompt'] as Array<{ text: string }>;
  return prompt.map((p) => p.text).join('');
}

/** Let in-flight stream reads and promise chains settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

afterEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  await Promise.all(live.splice(0).map((agent) => agent.close()));
});

describe('createAcpSessionHandle — first turn', () => {
  it('completes an end_turn prompt with 0 and resolves the session id', async () => {
    const h = start({
      script: (agent) =>
        agent.handle('session/prompt', async (params, a) => {
          await a.sessionUpdate(String(params['sessionId']), {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello from the agent' },
          });
          return { result: { stopReason: 'end_turn' } };
        }),
    });

    await expect(h.handle.done).resolves.toBe(0);

    expect(h.spawn()?.args).toEqual(['agent', '--no-leader', 'stdio']);
    expect(h.spawn()?.env).toBeUndefined();
    expect(h.resolvedIds).toEqual([SESSION_ID]);
    expect(h.handle.getSessionId?.()).toBe(SESSION_ID);
    expect(h.output()).toContain('Hello from the agent');
    expect(h.segments).toContainEqual({
      type: 'text',
      content: 'Hello from the agent',
    });
    expect(h.errors()).toEqual([]);

    const init = paramsOf(sent(h.agent, 'initialize')[0]);
    expect(init['protocolVersion']).toBe(1);
    expect(init['clientCapabilities']).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    });
    const created = paramsOf(sent(h.agent, 'session/new')[0]);
    expect(created['cwd']).toBe(process.cwd());
    expect(created['mcpServers']).toEqual([MCP_SERVER]);
    const prompt = sent(h.agent, 'session/prompt')[0];
    expect(paramsOf(prompt)['sessionId']).toBe(SESSION_ID);
    expect(promptText(prompt)).toContain('Summarise the repository');
    expect(promptText(prompt)).toContain('PROJECT-GUIDANCE-MARKER');
    expect(h.handle.supportsContinuation?.()).toBe(true);
  });

  it('passes the profile spawn env to the transport', async () => {
    const h = start({
      profile: {
        buildSpawn: () => ({
          args: ['acp'],
          env: { VENDOR_CONFIG: '{"lane":true}' },
        }),
      },
    });

    await expect(h.handle.done).resolves.toBe(0);
    expect(h.spawn()?.args).toEqual(['acp']);
    expect(h.spawn()?.env).toEqual({ VENDOR_CONFIG: '{"lane":true}' });
  });

  it('declares no steer, interrupt or supportsInterrupt', async () => {
    const h = start();
    await h.handle.done;

    expect(h.handle.steer).toBeUndefined();
    expect(h.handle.interrupt).toBeUndefined();
    expect(h.handle.supportsInterrupt).toBeUndefined();
  });

  it('drops updates for another session id', async () => {
    const h = start({
      script: (agent) =>
        agent.handle('session/prompt', async (_params, a) => {
          await a.sessionUpdate('someone-else', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'FOREIGN' },
          });
          return { result: { stopReason: 'end_turn' } };
        }),
    });

    await expect(h.handle.done).resolves.toBe(0);
    expect(h.output()).not.toContain('FOREIGN');
  });

  it('routes stderr lines to output and classified segments', async () => {
    const agent = createFakeAcpAgent({ sessionId: SESSION_ID });
    live.push(agent);
    const transport = createFakeAcpTransport(agent);
    let onStderrLine: ((line: string) => void) | undefined;
    const handle = createAcpSessionHandle({
      profile: createProfile(),
      options: { task: 't', workingDirectory: process.cwd() },
      command: 'test-agent',
      transportFactory: (spawn) => {
        onStderrLine = spawn.onStderrLine;
        return transport;
      },
    });
    const segments: CliOutputSegment[] = [];
    const chunks: string[] = [];
    handle.onSegment?.((s) => segments.push(s));
    handle.onOutput((d) => chunks.push(d));

    onStderrLine?.('  warming up  ');
    onStderrLine?.('fatal: cannot read config');
    onStderrLine?.('   ');
    await handle.done;

    expect(chunks.join('')).toContain('[stderr] warming up\n');
    expect(segments).toContainEqual({ type: 'info', content: 'warming up' });
    expect(segments).toContainEqual({
      type: 'error',
      content: 'fatal: cannot read config',
    });
  });
});

describe('createAcpSessionHandle — continuation', () => {
  it('runs a further session/prompt with its own done', async () => {
    const h = start();
    await expect(h.handle.done).resolves.toBe(0);

    h.agent.handle('session/prompt', () => ({
      result: { stopReason: 'max_tokens' },
    }));
    const next = await h.handle.continue?.('Follow-up message');

    await expect(next?.done).resolves.toBe(0);
    const prompts = sent(h.agent, 'session/prompt');
    expect(prompts).toHaveLength(2);
    expect(promptText(prompts[1])).toBe('Follow-up message');
    expect(h.infos()).toContain('Token limit reached.');
  });

  it('rejects continue before the session exists and while a prompt is in flight', async () => {
    const h = start({
      script: (agent) => agent.handle('session/prompt', () => ({ hold: true })),
    });

    await expect(h.handle.continue?.('too early')).rejects.toThrow(
      /no ACP session/,
    );
    await h.agent.next(byMethod('session/prompt'));
    await expect(h.handle.continue?.('too busy')).rejects.toThrow(
      /still running a turn/,
    );

    h.handle.abort.abort();
    await expect(h.handle.done).resolves.toBe(1);
  });
});

describe('createAcpSessionHandle — stop reasons', () => {
  it.each([
    ['end_turn', 0, undefined],
    ['max_tokens', 0, { type: 'info', content: 'Token limit reached.' }],
    [
      'max_turn_requests',
      0,
      { type: 'info', content: 'Turn request limit reached.' },
    ],
    ['refusal', 1, { type: 'error', content: `${NAME} refused the turn.` }],
    ['cancelled', 1, { type: 'error', content: 'turn cancelled by the agent' }],
    [
      'novel_reason',
      1,
      {
        type: 'error',
        content: `${NAME} stopped for unknown reason: novel_reason`,
      },
    ],
  ])('maps %s to %i', async (stopReason, code, expected) => {
    const h = start({
      script: (agent) =>
        agent.handle('session/prompt', () => ({ result: { stopReason } })),
    });

    await expect(h.handle.done).resolves.toBe(code);

    const notable = h.segments.filter(
      (s) => s.type === 'error' || s.type === 'info',
    );
    expect(notable).toEqual(expected ? [expected] : []);
  });
});

describe('createAcpSessionHandle — permissions', () => {
  it('answers a permission request with the allow_once option', async () => {
    let reply: FakeAcpMessage | undefined;
    const h = start({
      script: (agent) =>
        agent.handle('session/prompt', async (params, a) => {
          reply = await a.request('session/request_permission', {
            sessionId: params['sessionId'],
            toolCall: {
              toolCallId: 't-1',
              title: 'ptah__ptah_agent_report',
              kind: 'other',
            },
            options: GROK_OPTIONS,
          });
          return { result: { stopReason: 'end_turn' } };
        }),
    });

    await expect(h.handle.done).resolves.toBe(0);
    expect(reply?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    expect(h.errors()).toEqual([]);
  });

  it('fails the turn with a named error when the policy refused a permission (R5)', async () => {
    let reply: FakeAcpMessage | undefined;
    const h = start({
      options: { autoApprove: false },
      script: (agent) =>
        agent.handle('session/prompt', async (params, a) => {
          reply = await a.request('session/request_permission', {
            sessionId: params['sessionId'],
            toolCall: {
              toolCallId: 't-1',
              title: 'run shell',
              kind: 'execute',
            },
            options: GROK_OPTIONS,
          });
          return { result: { stopReason: 'cancelled' } };
        }),
    });

    await expect(h.handle.done).resolves.toBe(1);
    expect(reply?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'reject-once' },
    });
    expect(h.errors()).toEqual([
      `${NAME} stopped the turn: permission refused for run shell`,
    ]);
  });

  it('keeps a refusal local to its turn', async () => {
    const h = start({
      options: { autoApprove: false },
      script: (agent) =>
        agent.handle('session/prompt', async (params, a) => {
          await a.request('session/request_permission', {
            sessionId: params['sessionId'],
            toolCall: { toolCallId: 't-1', title: 'run shell' },
            options: GROK_OPTIONS,
          });
          return { result: { stopReason: 'end_turn' } };
        }),
    });
    await expect(h.handle.done).resolves.toBe(0);

    h.agent.handle('session/prompt', () => ({
      result: { stopReason: 'cancelled' },
    }));
    const next = await h.handle.continue?.('again');

    await expect(next?.done).resolves.toBe(1);
    expect(h.errors()).toEqual(['turn cancelled by the agent']);
  });
});

describe('createAcpSessionHandle — extension notifications', () => {
  it('ignores the vendor namespace and names an unknown method once', async () => {
    const h = start({
      script: (agent) =>
        agent.handle('session/prompt', async (params, a) => {
          await a.notify('_x.ai/session/setup', {
            phase: 'auth',
            sessionId: null,
          });
          await a.notify('_x.ai/session_notification', {
            sessionId: params['sessionId'],
            update: {
              sessionUpdate: 'retry_state',
              type: 'retrying',
              attempt: 1,
            },
          });
          await a.notify('_other.vendor/ping', {});
          await a.notify('_other.vendor/ping', {});
          return { result: { stopReason: 'end_turn' } };
        }),
    });

    await expect(h.handle.done).resolves.toBe(0);
    expect(h.errors()).toEqual([]);
    expect(h.infos()).toEqual([
      `${NAME} sent an unsupported notification: _other.vendor/ping`,
    ]);
  });

  it('reports every unknown method when the profile names no namespace', async () => {
    const h = start({
      profile: { isExtensionNotification: undefined },
      script: (agent) =>
        agent.handle('session/prompt', async () => {
          await agent.notify('_x.ai/session/setup', {});
          return { result: { stopReason: 'end_turn' } };
        }),
    });

    await expect(h.handle.done).resolves.toBe(0);
    expect(h.infos()).toEqual([
      `${NAME} sent an unsupported notification: _x.ai/session/setup`,
    ]);
  });
});

describe('createAcpSessionHandle — resume', () => {
  it('resumes with the same mcpServers and restores the context (R7)', async () => {
    const h = start({ options: { resumeSessionId: 'old-session' } });

    await expect(h.handle.done).resolves.toBe(0);

    const resume = sent(h.agent, 'session/resume');
    expect(resume).toHaveLength(1);
    expect(paramsOf(resume[0])).toEqual({
      sessionId: 'old-session',
      cwd: process.cwd(),
      mcpServers: [MCP_SERVER],
    });
    expect(sent(h.agent, 'session/new')).toHaveLength(0);
    expect(h.resolvedIds).toEqual(['old-session']);
    const prompt = promptText(sent(h.agent, 'session/prompt')[0]);
    expect(prompt).not.toContain('PROJECT-GUIDANCE-MARKER');
    expect(prompt).toContain('Summarise the repository');
  });

  it('falls back to session/new with an info when resume fails', async () => {
    const h = start({
      options: { resumeSessionId: 'old-session' },
      script: (agent) =>
        agent.handle('session/resume', () => ({
          error: {
            code: -32002,
            message: 'Resource not found',
            data: 'no such session',
          },
        })),
    });

    await expect(h.handle.done).resolves.toBe(0);

    expect(h.infos()).toEqual([
      'could not resume old-session: Resource not found (no such session); started a new session',
    ]);
    expect(h.handle.getSessionId?.()).toBe(SESSION_ID);
    expect(promptText(sent(h.agent, 'session/prompt')[0])).toContain(
      'PROJECT-GUIDANCE-MARKER',
    );
  });

  it('falls back to session/new when the agent cannot resume', async () => {
    const h = start({
      options: { resumeSessionId: 'old-session' },
      agent: { agentCapabilities: {} },
    });

    await expect(h.handle.done).resolves.toBe(0);
    expect(sent(h.agent, 'session/resume')).toHaveLength(0);
    expect(h.infos()).toEqual([
      `could not resume old-session: ${NAME} does not support resuming a session; started a new session`,
    ]);
  });

  it('drops _meta.isReplay updates on session/load and keeps live ones', async () => {
    const h = start({
      profile: { resumeStrategy: 'load' },
      options: { resumeSessionId: 'old-session' },
      agent: {
        agentCapabilities: { loadSession: true },
        replay: [
          {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'REPLAYED-USER' },
          },
          {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'REPLAYED-AGENT' },
          },
        ],
      },
      script: (agent) =>
        agent.handle('session/prompt', async (params, a) => {
          await a.sessionUpdate(String(params['sessionId']), {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'LIVE-AGENT' },
          });
          return { result: { stopReason: 'end_turn' } };
        }),
    });

    await expect(h.handle.done).resolves.toBe(0);

    const load = sent(h.agent, 'session/load');
    expect(load).toHaveLength(1);
    expect(paramsOf(load[0])['mcpServers']).toEqual([MCP_SERVER]);
    expect(h.output()).not.toContain('REPLAYED');
    expect(h.output()).toContain('LIVE-AGENT');
    expect(h.infos()).toEqual([]);
  });

  it('tries load after a failed resume with resume-then-load', async () => {
    const h = start({
      profile: { resumeStrategy: 'resume-then-load' },
      options: { resumeSessionId: 'old-session' },
      script: (agent) =>
        agent.handle('session/resume', () => ({
          error: { code: -32603, message: 'Internal error' },
        })),
    });

    await expect(h.handle.done).resolves.toBe(0);
    expect(sent(h.agent, 'session/load')).toHaveLength(1);
    expect(sent(h.agent, 'session/new')).toHaveLength(0);
    expect(h.infos()).toEqual([]);
  });
});

describe('createAcpSessionHandle — session config (R6)', () => {
  it('applies advertised config before the first prompt and skips the rest with an info', async () => {
    const h = start({
      agent: { configOptions: [MODEL_OPTION] },
      profile: {
        sessionConfig: () => [
          { configId: 'model', value: 'model-b' },
          { configId: 'reasoning_effort', value: 'high' },
        ],
      },
    });

    await expect(h.handle.done).resolves.toBe(0);

    const configCalls = sent(h.agent, 'session/set_config_option');
    expect(configCalls.map(paramsOf)).toEqual([
      { sessionId: SESSION_ID, configId: 'model', value: 'model-b' },
    ]);
    const order = h.agent.received.map((m) => m.method);
    expect(order.indexOf('session/set_config_option')).toBeLessThan(
      order.indexOf('session/prompt'),
    );
    expect(h.infos()).toEqual([
      `${NAME} does not offer the "reasoning_effort" setting, so high was not applied`,
    ]);
  });

  it('fails the first turn before any prompt when the agent rejects the model (-32602)', async () => {
    const describeError = jest.fn(describeTestError);
    const h = start({
      agent: { configOptions: [MODEL_OPTION] },
      options: { model: 'model-x', modelSource: 'setting' },
      profile: {
        sessionConfig: (options) => [
          { configId: 'model', value: options.model ?? '' },
        ],
        describeError,
      },
      script: (agent) =>
        agent.handle('session/set_config_option', () => ({
          error: {
            code: -32602,
            message: 'Invalid params',
            data: 'unknown model id',
          },
        })),
    });

    await expect(h.handle.done).resolves.toBe(1);

    expect(sent(h.agent, 'session/prompt')).toHaveLength(0);
    expect(h.errors()).toEqual([
      `${NAME} rejected model 'model-x' (from setting); available: model-a, model-b`,
    ]);
    expect(describeError).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'session/set_config_option',
        code: -32602,
        data: 'unknown model id',
        configId: 'model',
        configValue: 'model-x',
        advertisedValues: ['model-a', 'model-b'],
      }),
    );
    expect(h.transport.killCount).toBe(1);
    expect(h.handle.supportsContinuation?.()).toBe(false);
  });
});

describe('createAcpSessionHandle — error rows', () => {
  it.each([
    ['a string', 'API error (status 429 Too Many Requests): usage exhausted'],
    [
      'an object',
      {
        message: 'API error (status 429 Too Many Requests): usage exhausted',
        promptUsage: {},
      },
    ],
  ])(
    'fails a rate-limited prompt (-32003, data as %s)',
    async (_shape, data) => {
      const h = start({
        script: (agent) =>
          agent.handle('session/prompt', () => ({
            error: { code: -32003, message: 'Rate limited', data },
          })),
      });

      await expect(h.handle.done).resolves.toBe(1);
      expect(h.errors()).toEqual([
        `${NAME} is rate limited: API error (status 429 Too Many Requests): usage exhausted`,
      ]);
      // The session survives a failed prompt, so the lane can take the next message.
      expect(h.handle.supportsContinuation?.()).toBe(true);
    },
  );

  it('fails the turn when session/new needs sign-in (-32000)', async () => {
    const h = start({
      script: (agent) =>
        agent.handle('session/new', () => ({
          error: {
            code: -32000,
            message: 'Authentication required',
            data: 'no auth method id provided',
          },
        })),
    });

    await expect(h.handle.done).resolves.toBe(1);
    expect(h.errors()).toEqual([`${NAME} is not signed in`]);
    expect(sent(h.agent, 'session/prompt')).toHaveLength(0);
    // The segment is the profile's summary; the raw JSON-RPC answer goes to the log.
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[AcpSessionHandle] ACP request failed',
      expect.objectContaining({
        vendor: 'opencode',
        method: 'session/new',
        code: -32000,
        message: 'Authentication required',
        detail: 'no auth method id provided',
      }),
    );
  });

  it('uses a generic message when the profile has none', async () => {
    const h = start({
      profile: { describeError: undefined },
      script: (agent) =>
        agent.handle('session/prompt', () => ({
          error: {
            code: -32603,
            message: 'Internal error',
            data: { message: 'boom' },
          },
        })),
    });

    await expect(h.handle.done).resolves.toBe(1);
    expect(h.errors()).toEqual([
      `${NAME} session/prompt failed: Internal error (boom) [code -32603]`,
    ]);
  });

  it('fails the turn on an unsupported protocol version', async () => {
    const h = start({ agent: { protocolVersion: 2 } });

    await expect(h.handle.done).resolves.toBe(1);
    expect(h.errors()).toEqual([
      `${NAME} speaks unsupported ACP protocol version 2`,
    ]);
    expect(sent(h.agent, 'session/new')).toHaveLength(0);
    expect(h.transport.killCount).toBe(1);
  });

  it('maps AcpUnavailableError to a failed turn', async () => {
    jest
      .spyOn(loader, 'connectAcp')
      .mockRejectedValueOnce(
        new loader.AcpUnavailableError(new Error('Cannot find module')),
      );
    const h = start();

    await expect(h.handle.done).resolves.toBe(1);
    expect(h.errors()).toHaveLength(1);
    expect(h.errors()[0]).toContain(
      'The ACP client library could not be loaded: Cannot find module',
    );
    expect(h.transport.killCount).toBe(1);
  });
});

describe('createAcpSessionHandle — handshake timeout', () => {
  it('fails the turn and kills the agent after 30 s without a handshake', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
    const h = start({
      script: (agent) => agent.handle('initialize', () => ({ hold: true })),
    });
    await h.agent.next(byMethod('initialize'));

    await jest.advanceTimersByTimeAsync(ACP_HANDSHAKE_TIMEOUT_MS);

    await expect(h.handle.done).resolves.toBe(1);
    expect(h.errors()).toEqual([
      `${NAME} did not complete the ACP handshake in 30 s`,
    ]);
    expect(h.transport.killCount).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the handshake timer once setup completes', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
    const h = start();

    await expect(h.handle.done).resolves.toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('createAcpSessionHandle — process lifecycle', () => {
  it('fails the turn naming the exit code when the agent exits mid-turn', async () => {
    const h = start({
      script: (agent) => agent.handle('session/prompt', () => ({ hold: true })),
    });
    await h.agent.next(byMethod('session/prompt'));

    await h.transport.exit(3);

    await expect(h.handle.done).resolves.toBe(1);
    expect(h.errors()).toEqual([`${NAME} exited (code 3) during the turn`]);
    expect(h.handle.supportsContinuation?.()).toBe(false);
    expect(h.handle.getPid?.()).toBeUndefined();
  });

  it('abort sends session/cancel, then kills, and stays silent', async () => {
    const h = start({
      script: (agent) => agent.handle('session/prompt', () => ({ hold: true })),
    });
    await h.agent.next(byMethod('session/prompt'));

    h.handle.abort.abort();

    await expect(h.handle.done).resolves.toBe(1);
    const cancel = await h.agent.next(byMethod('session/cancel'));
    expect(cancel.id).toBeUndefined();
    expect(paramsOf(cancel)).toEqual({ sessionId: SESSION_ID });
    await settle();
    expect(h.transport.killCount).toBe(1);
    expect(h.errors()).toEqual([]);
    expect(sent(h.agent, 'session/close')).toHaveLength(0);
    expect(h.handle.supportsContinuation?.()).toBe(false);
  });

  it('waits up to the cancel grace for an agent that ignores the cancel, then kills', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
    const h = start({
      // A prompt that never answers, not even `cancelled`.
      script: (agent) =>
        agent.handle('session/prompt', () => new Promise(() => undefined)),
    });
    await h.agent.next(byMethod('session/prompt'));

    h.handle.abort.abort();
    await h.agent.next(byMethod('session/cancel'));
    await settle();

    await jest.advanceTimersByTimeAsync(ACP_CANCEL_GRACE_MS - 1);
    expect(h.transport.killCount).toBe(0);

    await jest.advanceTimersByTimeAsync(1);
    expect(h.transport.killCount).toBe(1);
    await expect(h.handle.done).resolves.toBe(1);
    expect(h.errors()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('skips the kill when the agent exits within the cancel grace', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
    const h = start({
      script: (agent) =>
        agent.handle('session/prompt', () => new Promise(() => undefined)),
    });
    await h.agent.next(byMethod('session/prompt'));

    h.handle.abort.abort();
    await h.agent.next(byMethod('session/cancel'));
    await h.transport.exit(0);

    await expect(h.handle.done).resolves.toBe(1);
    await settle();
    expect(h.transport.killCount).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('abort while idle kills without a cancel', async () => {
    const h = start();
    await expect(h.handle.done).resolves.toBe(0);

    h.handle.abort.abort();
    await settle();

    expect(sent(h.agent, 'session/cancel')).toHaveLength(0);
    expect(h.transport.killCount).toBe(1);
  });

  it('closes silently when the agent exits while idle, and never returns the exited pid', async () => {
    const h = start();
    await expect(h.handle.done).resolves.toBe(0);
    expect(h.handle.getPid?.()).toBe(4242);
    const before = h.segments.length;

    await h.transport.exit(0);
    await settle();

    expect(h.handle.getPid?.()).toBeUndefined();
    expect(h.handle.supportsContinuation?.()).toBe(false);
    expect(h.segments).toHaveLength(before);
    await expect(h.handle.continue?.('late')).rejects.toThrow(
      /no longer running/,
    );
    // Exited on its own: no kill, so a reused pid is never targeted.
    expect(h.transport.killCount).toBe(0);
  });
});
