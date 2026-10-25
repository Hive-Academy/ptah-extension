import { CodexApprovalBridge } from './codex-approval-bridge';
import type { CodexApprovalBridgeOptions } from './codex-approval-bridge';
import { CodexPermissionRuleStore } from './codex-permission-rule-store';
import type { ApprovalSink, Clock } from './codex-runtime-ports';
import type {
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexPermissionLevel,
} from './codex-runtime.types';

const identity = {
  contextId: 'context',
  processGeneration: 1,
  threadId: 'thread',
  normalizedHome: '/home',
  workspaceId: 'workspace',
  providerId: 'provider',
  profileFingerprint: 'profile',
};
const command = 'item/commandExecution/requestApproval';
const file = 'item/fileChange/requestApproval';
const mcp = 'mcpServer/elicitation/request';
const permissions = 'item/permissions/requestApproval';
const userInput = 'item/tool/requestUserInput';
const signal = () => new AbortController().signal;
function frame(
  method = command,
  id: string | number = 1,
  extra: Record<string, unknown> = {},
) {
  const base =
    method === mcp
      ? {
          threadId: 'thread',
          turnId: null,
          mode: 'form',
          serverName: 'server',
          message: 'Approve',
          requestedSchema: {
            type: 'object',
            properties: { approve: { type: 'boolean' } },
            required: ['approve'],
          },
        }
      : {
          threadId: 'thread',
          turnId: 'turn',
          itemId: 'item',
          ...(method === userInput ? {} : { startedAtMs: 1 }),
        };
  return {
    id,
    method,
    params: {
      ...base,
      ...(method === command
        ? { command: 'echo safe', cwd: '/workspace' }
        : {}),
      ...(method === permissions
        ? { cwd: '/workspace', permissions: { network: { enabled: true } } }
        : {}),
      ...(method === userInput
        ? {
            isBlocking: true,
            questions: [{ id: 'q', header: 'Question', question: 'Which?' }],
          }
        : {}),
      ...extra,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Partial<CodexApprovalBridgeOptions> = {}) {
  const request = jest
    .fn<
      ReturnType<ApprovalSink['request']>,
      Parameters<ApprovalSink['request']>
    >()
    .mockResolvedValue('accept');
  const clock: Clock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return { dispose: () => clearTimeout(timer) };
    },
  };
  const isCurrent = jest.fn(() => true);
  const isWritable = jest.fn(() => true);
  const options = {
    identity,
    sink: { request },
    clock,
    rules: new CodexPermissionRuleStore(),
    permissionLevel: (): CodexPermissionLevel => 'ask',
    isCurrent,
    isWritable,
    close: jest.fn(),
    timeoutMs: 100,
    ...overrides,
  };
  return {
    bridge: new CodexApprovalBridge(options),
    request,
    options,
    isCurrent,
    isWritable,
  };
}

describe('CodexApprovalBridge', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('auto-accepts a plain auto-edit file change without prompting', async () => {
    const { bridge, request } = setup({ permissionLevel: () => 'auto-edit' });
    expect(await bridge.handle(frame(file), 'turn', signal())).toEqual({
      response: { decision: 'accept' },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('prompts for an auto-edit file change carrying grantRoot', async () => {
    const { bridge, request } = setup({ permissionLevel: () => 'auto-edit' });
    request.mockResolvedValue('decline');
    expect(
      await bridge.handle(
        frame(file, 1, { grantRoot: '/outside' }),
        'turn',
        signal(),
      ),
    ).toEqual({
      response: { decision: 'decline' },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].details).toMatchObject({
      grantRoot: '/outside',
    });
  });

  it.each([undefined, '/outside'])(
    'keeps ask file changes interactive with grantRoot %s',
    async (grantRoot) => {
      const { bridge, request } = setup();
      request.mockResolvedValue('decline');
      expect(
        await bridge.handle(
          frame(file, 1, grantRoot === undefined ? {} : { grantRoot }),
          'turn',
          signal(),
        ),
      ).toEqual({
        response: { decision: 'decline' },
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each<CodexApprovalDecision>([
    'accept',
    'acceptForSession',
    'decline',
    'cancel',
  ])(
    'maps %s to the exact command and file wire decision',
    async (decision) => {
      const { bridge, request } = setup();
      request.mockResolvedValue(decision);
      for (const [index, method] of [command, file].entries()) {
        expect(
          await bridge.handle(frame(method, index), 'turn', signal()),
        ).toEqual({ response: { decision } });
      }
    },
  );

  it('presents full correlation and preserves typed request ids', async () => {
    const { bridge, request } = setup();
    await bridge.handle(frame(), 'turn', signal());
    await bridge.handle(frame(command, '1'), 'turn', signal());
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toMatchObject({
      ...identity,
      turnId: 'turn',
      requestId: 1,
      kind: 'command',
    });
  });

  it('rejects duplicates both pending and completed without a second presentation', async () => {
    const { bridge, request } = setup();
    const pending = bridge.handle(frame(), 'turn', signal());
    await expect(bridge.handle(frame(), 'turn', signal())).rejects.toThrow(
      'Duplicate approval request',
    );
    await pending;
    await expect(bridge.handle(frame(), 'turn', signal())).rejects.toThrow(
      'Duplicate approval request',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([{ threadId: 'other' }, { turnId: 'other' }])(
    'refuses mismatched wire identity %j',
    async (extra) => {
      const { bridge, request } = setup();
      expect(
        await bridge.handle(frame(command, 1, extra), 'turn', signal()),
      ).toEqual({ response: { decision: 'cancel' } });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('ignores a late grant from a stale generation and records no rule', async () => {
    const pending = deferred<CodexApprovalDecision>();
    const { bridge, request, options, isCurrent } = setup();
    request.mockReturnValue(pending.promise);
    const result = bridge.handle(frame(), 'turn', signal());
    await Promise.resolve();
    isCurrent.mockReturnValue(false);
    pending.resolve('acceptForSession');
    expect(await result).toEqual({ response: { decision: 'cancel' } });
    expect(
      options.rules.matches(identity, {
        kind: 'command',
        command: 'echo safe',
        cwd: '/workspace',
      }),
    ).toBe(false);
  });

  it('times out, aborts presentation, and ignores its eventual grant', async () => {
    const late = deferred<CodexApprovalDecision>();
    const { bridge, request, options } = setup();
    request.mockReturnValue(late.promise);
    const result = bridge.handle(frame(), 'turn', signal());
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    expect(await result).toEqual({ response: { decision: 'decline' } });
    expect(request.mock.calls[0][1].aborted).toBe(true);
    late.resolve('acceptForSession');
    await Promise.resolve();
    expect(
      options.rules.matches(identity, {
        kind: 'command',
        command: 'echo safe',
        cwd: '/workspace',
      }),
    ).toBe(false);
  });

  it.each(['abort', 'dispose', 'close'] as const)(
    'settles safely on %s and releases presentation',
    async (event) => {
      const { bridge, request, options, isWritable } = setup();
      request.mockReturnValue(new Promise(() => undefined));
      const controller = new AbortController();
      const result = bridge.handle(frame(), 'turn', controller.signal);
      await Promise.resolve();
      if (event === 'dispose') bridge.dispose();
      else {
        if (event === 'close') isWritable.mockReturnValue(false);
        controller.abort();
      }
      if (event === 'close') {
        await expect(result).rejects.toThrow('Approval transport unavailable');
        expect(options.close).toHaveBeenCalledTimes(1);
      } else
        expect(await result).toEqual({
          response: { decision: event === 'dispose' ? 'decline' : 'cancel' },
        });
      expect(request.mock.calls[0][1].aborted).toBe(true);
    },
  );

  it('does not present an already aborted request', async () => {
    const { bridge, request } = setup();
    const controller = new AbortController();
    controller.abort();
    expect(await bridge.handle(frame(), 'turn', controller.signal)).toEqual({
      response: { decision: 'cancel' },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('declines sink failure without exposing its error', async () => {
    const { bridge, request } = setup();
    request.mockRejectedValue(new Error('secret'));
    expect(await bridge.handle(frame(), 'turn', signal())).toEqual({
      response: { decision: 'decline' },
    });
  });

  it('declines an edited reply and returns its text only as a follow-up', async () => {
    const reply = {
      decision: 'decline' as const,
      editNotSupported: true as const,
      editedInput: 'echo replacement',
    };
    const { bridge, request, options } = setup();
    request.mockResolvedValue(reply);
    expect(await bridge.handle(frame(), 'turn', signal())).toEqual({
      response: { decision: 'decline' },
      editNotSupported: true,
      followUpMessage: 'echo replacement',
    });
    expect(
      options.rules.matches(identity, {
        kind: 'command',
        command: 'echo safe',
        cwd: '/workspace',
      }),
    ).toBe(false);
  });

  it('preserves the committed text-free edit marker', async () => {
    const { bridge, request } = setup();
    request.mockResolvedValue({ decision: 'decline', editNotSupported: true });
    expect(await bridge.handle(frame(), 'turn', signal())).toEqual({
      response: { decision: 'decline' },
      editNotSupported: true,
    });
  });

  it('reuses only an exact command grant across process generations', async () => {
    const { bridge, request, options } = setup();
    request.mockResolvedValue('acceptForSession');
    await bridge.handle(frame(), 'turn', signal());
    bridge.dispose();
    const next = setup({
      rules: options.rules,
      identity: { ...identity, processGeneration: 2 },
    });
    expect(await next.bridge.handle(frame(), 'turn', signal())).toEqual({
      response: { decision: 'acceptForSession' },
    });
    expect(next.request).not.toHaveBeenCalled();
    await next.bridge.handle(
      frame(command, 2, { command: 'echo different' }),
      'turn',
      signal(),
    );
    await next.bridge.handle(
      frame(command, 3, { cwd: '/other' }),
      'turn',
      signal(),
    );
    expect(next.request).toHaveBeenCalledTimes(2);
    const other = setup({
      rules: options.rules,
      identity: { ...identity, providerId: 'other' },
    });
    await other.bridge.handle(frame(), 'turn', signal());
    expect(other.request).toHaveBeenCalledTimes(1);
  });

  it('does not remember accept once or allow a rule to bypass plan mode', async () => {
    const { bridge, request, options } = setup();
    await bridge.handle(frame(), 'turn', signal());
    await bridge.handle(frame(command, 2), 'turn', signal());
    expect(request).toHaveBeenCalledTimes(2);
    options.rules.record(
      identity,
      { kind: 'command', command: 'echo safe', cwd: '/workspace' },
      'acceptForSession',
    );
    const plan = setup({ rules: options.rules, permissionLevel: () => 'plan' });
    expect(await plan.bridge.handle(frame(), 'turn', signal())).toEqual({
      response: { decision: 'decline' },
    });
    expect(plan.request).not.toHaveBeenCalled();
  });

  it.each<CodexApprovalDecision>([
    'accept',
    'acceptForSession',
    'decline',
    'cancel',
  ])(
    'maps permissions %s without remembering a command rule',
    async (decision) => {
      const { bridge, request } = setup();
      request.mockResolvedValue(decision);
      const accepted = decision === 'accept' || decision === 'acceptForSession';
      expect(await bridge.handle(frame(permissions), 'turn', signal())).toEqual(
        {
          response: {
            permissions: accepted ? { network: { enabled: true } } : {},
            scope: decision === 'acceptForSession' ? 'session' : 'turn',
          },
        },
      );
      await bridge.handle(frame(permissions, 2), 'turn', signal());
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it.each<CodexApprovalDecision>(['decline', 'cancel'])(
    'maps MCP %s to action',
    async (decision) => {
      const { bridge, request } = setup();
      request.mockResolvedValue(decision);
      expect(await bridge.handle(frame(mcp), 'turn', signal())).toEqual({
        response: { action: decision },
      });
    },
  );

  it('accepts evidenced required boolean, enums and defaults without persistence metadata', async () => {
    const { bridge } = setup();
    expect(
      await bridge.handle(
        frame(mcp, 1, {
          requestedSchema: {
            type: 'object',
            properties: {
              approve: { type: 'boolean' },
              mode: { type: 'string', enum: ['deny', 'once'] },
              count: { type: 'integer', default: 2 },
            },
            required: ['approve', 'mode', 'count'],
          },
        }),
        'turn',
        signal(),
      ),
    ).toEqual({
      response: {
        action: 'accept',
        content: { approve: true, mode: 'once', count: 2 },
      },
    });
  });

  it.each([
    {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    { type: 'object', properties: {}, required: ['missing'] },
    {
      type: 'object',
      properties: { count: { type: 'integer', default: 2, minimum: 3 } },
      required: ['count'],
    },
    {
      type: 'object',
      properties: { mode: { type: 'string', default: 'bad', enum: ['good'] } },
      required: ['mode'],
    },
  ])('declines an unfillable MCP form %j', async (requestedSchema) => {
    const { bridge, request } = setup();
    request.mockResolvedValue('acceptForSession');
    expect(
      await bridge.handle(frame(mcp, 1, { requestedSchema }), 'turn', signal()),
    ).toEqual({ response: { action: 'decline' } });
  });

  it('declines URL elicitation', async () => {
    const { bridge } = setup();
    expect(
      await bridge.handle(
        {
          id: 1,
          method: mcp,
          params: {
            threadId: 'thread',
            turnId: null,
            mode: 'url',
            serverName: 'server',
            message: 'Approve',
            url: 'https://example.test',
            elicitationId: 'e',
          },
        },
        'turn',
        signal(),
      ),
    ).toEqual({ response: { action: 'decline' } });
  });

  it('requires explicit MCP attribution and never infers a tool from prose', async () => {
    const { bridge, request, options } = setup();
    request.mockResolvedValue('acceptForSession');
    await bridge.handle(frame(mcp), 'turn', signal());
    await bridge.handle(frame(mcp, 2), 'turn', signal());
    expect(request).toHaveBeenCalledTimes(2);
    const attributed = setup({
      rules: options.rules,
      resolveTarget: () => ({
        kind: 'mcpElicitation',
        server: 'server',
        tool: 'tool',
      }),
    });
    attributed.request.mockResolvedValue('acceptForSession');
    await attributed.bridge.handle(frame(mcp), 'turn', signal());
    expect(
      await attributed.bridge.handle(frame(mcp, 2), 'turn', signal()),
    ).toEqual({ response: { action: 'accept', content: { approve: true } } });
    expect(attributed.request).toHaveBeenCalledTimes(1);
  });

  it('requires attributed file paths, never grantRoot, for file rule reuse', async () => {
    const { bridge, request } = setup();
    request.mockResolvedValue('acceptForSession');
    await bridge.handle(
      frame(file, 1, { grantRoot: '/workspace' }),
      'turn',
      signal(),
    );
    await bridge.handle(
      frame(file, 2, { grantRoot: '/workspace' }),
      'turn',
      signal(),
    );
    expect(request).toHaveBeenCalledTimes(2);
    const attributed = setup({
      resolveTarget: () => ({ kind: 'fileChange', paths: ['/workspace/file'] }),
    });
    attributed.request.mockResolvedValue('acceptForSession');
    await attributed.bridge.handle(frame(file), 'turn', signal());
    await attributed.bridge.handle(frame(file, 2), 'turn', signal());
    expect(attributed.request).toHaveBeenCalledTimes(1);
  });

  it('routes questions independently and filters unknown answer ids', async () => {
    const input = jest.fn(
      async (_request: CodexApprovalRequest, _signal: AbortSignal) => ({
        q: { answers: ['chosen'] },
        unknown: { answers: ['discard'] },
      }),
    );
    const { bridge, request } = setup({
      requestUserInput: input,
      permissionLevel: () => 'yolo',
    });
    expect(await bridge.handle(frame(userInput), 'turn', signal())).toEqual({
      response: { answers: { q: { answers: ['chosen'] } } },
    });
    expect(input).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('returns no invented answer when the question interaction is unavailable', async () => {
    const { bridge, request } = setup();
    expect(await bridge.handle(frame(userInput), 'turn', signal())).toEqual({
      response: { answers: {} },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not grant or remember a reply after switching to plan mode', async () => {
    let level: CodexPermissionLevel = 'ask';
    const pending = deferred<CodexApprovalDecision>();
    const { bridge, request, options } = setup({
      permissionLevel: () => level,
    });
    request.mockReturnValue(pending.promise);
    const result = bridge.handle(frame(), 'turn', signal());
    await Promise.resolve();
    level = 'plan';
    pending.resolve('acceptForSession');
    expect(await result).toEqual({ response: { decision: 'decline' } });
    expect(
      options.rules.matches(identity, {
        kind: 'command',
        command: 'echo safe',
        cwd: '/workspace',
      }),
    ).toBe(false);
  });

  it('does not reuse command grants for stdin or network approvals', async () => {
    const { bridge, request } = setup();
    request.mockResolvedValue('acceptForSession');
    await bridge.handle(frame(), 'turn', signal());
    await bridge.handle(
      frame(command, 2, { kind: 'writeStdin' }),
      'turn',
      signal(),
    );
    await bridge.handle(
      frame(command, 3, {
        networkApprovalContext: { host: 'example.test', protocol: 'https' },
      }),
      'turn',
      signal(),
    );
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not remember an MCP grant when its form cannot be satisfied', async () => {
    const { bridge, request, options } = setup({
      resolveTarget: () => ({
        kind: 'mcpElicitation',
        server: 'server',
        tool: 'tool',
      }),
    });
    request.mockResolvedValue('acceptForSession');
    await bridge.handle(
      frame(mcp, 1, {
        requestedSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      }),
      'turn',
      signal(),
    );
    expect(
      options.rules.matches(identity, {
        kind: 'mcpElicitation',
        server: 'server',
        tool: 'tool',
      }),
    ).toBe(false);
    await bridge.handle(frame(mcp, 2), 'turn', signal());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending question without inventing an answer', async () => {
    const pending = deferred<{ q: { answers: string[] } }>();
    const { bridge } = setup({ requestUserInput: () => pending.promise });
    const controller = new AbortController();
    const result = bridge.handle(frame(userInput), 'turn', controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await result).toEqual({ response: { answers: {} } });
    pending.resolve({ q: { answers: ['late'] } });
  });

  it('rejects malformed input before presentation', async () => {
    const { bridge, request } = setup();
    await expect(
      bridge.handle(frame(command, 1, { command: 42 }), 'turn', signal()),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
