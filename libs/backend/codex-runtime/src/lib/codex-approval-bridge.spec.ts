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
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const options = {
    identity,
    sink: { request },
    clock,
    logger,
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
    logger,
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

  it('stamps the native item id and the auto-decline deadline', async () => {
    const { bridge, request } = setup();
    const before = Date.now();
    await bridge.handle(frame(), 'turn', signal());
    expect(request.mock.calls[0][0].toolId).toBe('item');
    expect(request.mock.calls[0][0].expiresAt).toBe(before + 100);
  });

  it('omits the tool id when the request carries no native item id', async () => {
    const { bridge, request } = setup();
    await bridge.handle(frame(mcp), 'turn', signal());
    expect(request.mock.calls[0][0].toolId).toBeUndefined();
  });

  it('uses the default auto-decline delay when no timeout is configured', async () => {
    const { bridge, request } = setup({ timeoutMs: undefined });
    const before = Date.now();
    await bridge.handle(frame(), 'turn', signal());
    expect(request.mock.calls[0][0].expiresAt).toBe(before + 240_000);
  });

  it('times approvals out at 240s and leaves questions for the host auto-pick', async () => {
    const { bridge, request } = setup({ timeoutMs: undefined });
    request.mockReturnValue(new Promise(() => undefined));
    const approval = bridge.handle(frame(), 'turn', signal());
    await Promise.resolve();
    jest.advanceTimersByTime(240_000);
    expect(await approval).toEqual({ response: { decision: 'decline' } });
    expect(request.mock.calls[0][1].aborted).toBe(true);

    let answer: (value: { q: { answers: string[] } }) => void = () => undefined;
    const input = jest.fn(
      (_request: CodexApprovalRequest, _signal: AbortSignal) =>
        new Promise<{ q: { answers: string[] } }>((resolve) => {
          answer = resolve;
        }),
    );
    const questions = setup({ timeoutMs: undefined, requestUserInput: input });
    const before = Date.now();
    const pending = questions.bridge.handle(frame(userInput), 'turn', signal());
    await Promise.resolve();
    expect(input.mock.calls[0]?.[0].expiresAt).toBe(before + 330_000);
    jest.advanceTimersByTime(300_000);
    expect(input.mock.calls[0]?.[1].aborted).toBe(false);
    answer({ q: { answers: ['recommended'] } });
    expect(await pending).toEqual({
      response: { answers: { q: { answers: ['recommended'] } } },
    });
  });

  it('does not let a short approval timeout decline a question', async () => {
    const input = jest.fn(
      (_request: CodexApprovalRequest, _signal: AbortSignal) =>
        new Promise<Record<string, { answers: string[] }>>(() => undefined),
    );
    const { bridge } = setup({ requestUserInput: input });
    const before = Date.now();
    const pending = bridge.handle(frame(userInput), 'turn', signal());
    await Promise.resolve();
    expect(input.mock.calls[0]?.[0].expiresAt).toBe(before + 330_000);
    jest.advanceTimersByTime(100);
    expect(input.mock.calls[0]?.[1].aborted).toBe(false);
    bridge.dispose();
    await pending;
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

  it.each([
    [
      'command',
      command,
      'say "no"',
      'The user denied this command request with the message: "say \\"no\\"". Respect this decision, do not retry the same call, and adjust your approach.',
      { decision: 'decline' },
    ],
    [
      'file change',
      file,
      'not this diff',
      'The user denied this file change request with the message: "not this diff". Respect this decision, do not retry the same call, and adjust your approach.',
      { decision: 'decline' },
    ],
    [
      'permissions',
      permissions,
      'no network',
      'The user denied this permissions request with the message: "no network". Respect this decision, do not retry the same call, and adjust your approach.',
      { permissions: {}, scope: 'turn' },
    ],
    [
      'MCP elicitation',
      mcp,
      'no form',
      'The user denied this MCP elicitation request with the message: "no form". Respect this decision, do not retry the same call, and adjust your approach.',
      { action: 'decline' },
    ],
  ] as const)(
    'keeps the native decline and carries a typed %s reason for steer',
    async (_label, method, reason, feedback, response) => {
      const reply = {
        decision: 'decline' as const,
        denialReason: reason,
      };
      const { bridge, request } = setup();
      request.mockResolvedValue(reply);
      expect(await bridge.handle(frame(method), 'turn', signal())).toEqual({
        response,
        denialFeedback: feedback,
      });
    },
  );

  it('sends no steer text when the deny reason is blank', async () => {
    const reply = {
      decision: 'decline' as const,
      denialReason: ' \n\t ',
    };
    const { bridge, request } = setup();
    request.mockResolvedValue(reply);
    expect(await bridge.handle(frame(), 'turn', signal())).toEqual({
      response: { decision: 'decline' },
    });
  });

  it.each(['accept', 'cancel'] as const)(
    'adds no steer text for %s',
    async (decision) => {
      const { bridge, request } = setup();
      request.mockResolvedValue(decision);
      expect(await bridge.handle(frame(), 'turn', signal())).toEqual({
        response: { decision },
      });
    },
  );

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

  it('presents one card for a tool-approval elicitation and sends only the grant', async () => {
    const { bridge, request, logger } = setup();
    request.mockResolvedValueOnce('accept').mockResolvedValueOnce('decline');
    expect(await bridge.handle(frame(mcp), 'turn', signal())).toEqual({
      response: { action: 'accept', content: { approve: true } },
    });
    expect(await bridge.handle(frame(mcp, 2), 'turn', signal())).toEqual({
      response: { action: 'decline' },
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('presents a defaults-and-consts form and sends only those values', async () => {
    const { bridge, request } = setup();
    request.mockResolvedValue('accept');
    expect(
      await bridge.handle(
        frame(mcp, 1, {
          requestedSchema: {
            type: 'object',
            properties: {
              note: { type: 'string', const: 'kept' },
              count: { type: 'integer', default: 2 },
            },
            required: ['note', 'count'],
          },
        }),
        'turn',
        signal(),
      ),
    ).toEqual({
      response: { action: 'accept', content: { note: 'kept', count: 2 } },
    });
    expect(request).toHaveBeenCalledTimes(1);
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
  ])('declines an unfillable MCP form %j without a card', async (requestedSchema) => {
    const { bridge, request, logger } = setup();
    request.mockResolvedValue('acceptForSession');
    expect(
      await bridge.handle(frame(mcp, 1, { requestedSchema }), 'turn', signal()),
    ).toEqual({ response: { action: 'decline' } });
    expect(request).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Codex elicitation cannot be answered without user input.',
      {
        code: 'codex-elicitation-unanswerable',
        mode: 'form',
        serverName: 'server',
      },
    );
  });

  it('declines a form that needs typed input without a card', async () => {
    const { bridge, request, logger } = setup();
    expect(
      await bridge.handle(
        frame(mcp, 1, {
          requestedSchema: {
            type: 'object',
            properties: { note: { type: 'string', title: 'Why' } },
            required: ['note'],
          },
        }),
        'turn',
        signal(),
      ),
    ).toEqual({ response: { action: 'decline' } });
    expect(request).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Codex elicitation cannot be answered without user input.',
      {
        code: 'codex-elicitation-unanswerable',
        mode: 'form',
        serverName: 'server',
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('Why');
  });

  it('declines URL elicitation immediately without a card', async () => {
    const { bridge, request, logger } = setup();
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
    expect(request).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Codex elicitation cannot be answered without user input.',
      {
        code: 'codex-elicitation-unanswerable',
        mode: 'url',
        serverName: 'server',
      },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'https://example.test',
    );
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
    // A form that needs typed values is declined before any card (8m-9).
    expect(
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
      ),
    ).toEqual({ response: { action: 'decline' } });
    expect(request).not.toHaveBeenCalled();
    expect(
      options.rules.matches(identity, {
        kind: 'mcpElicitation',
        server: 'server',
        tool: 'tool',
      }),
    ).toBe(false);
    await bridge.handle(frame(mcp, 2), 'turn', signal());
    expect(request).toHaveBeenCalledTimes(1);
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
