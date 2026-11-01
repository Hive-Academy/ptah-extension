import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CodexEventTranslator } from './codex-event-translator';
import {
  CodexProtocolError,
  codexRequestSchemas,
  codexServerRequestSchemas,
  codexNotificationSchemas,
  validateCodexFrame,
  validateCodexParams,
  validateCodexResult,
} from './codex-protocol-validator';

const pinnedNotificationMethods = z
  .object({ methods: z.object({ serverNotifications: z.array(z.string()) }) })
  .parse(
    JSON.parse(
      readFileSync(
        join(__dirname, 'protocol/codex-app-server-protocol.manifest.json'),
        'utf8',
      ),
    ),
  ).methods.serverNotifications;

const ids = { threadId: 'thread', turnId: 'turn', itemId: 'item' };
const approval = { ...ids, startedAtMs: 1 };
const turn = { id: 'turn', items: [], status: 'inProgress' };
const usage = {
  cachedInputTokens: 0,
  inputTokens: 1,
  outputTokens: 2,
  reasoningOutputTokens: 0,
  totalTokens: 3,
};
const threadResult = {
  thread: {
    id: 'thread',
    cliVersion: '0.165.0',
    createdAt: 1,
    updatedAt: 1,
    cwd: '/work',
    ephemeral: true,
    modelProvider: 'openai',
    preview: '',
    projectId: null,
    sessionId: 'session',
    source: 'appServer',
    status: { type: 'idle' },
    turns: [],
  },
  approvalPolicy: 'never',
  approvalsReviewer: 'user',
  cwd: '/work',
  model: 'model',
  modelProvider: 'openai',
  sandbox: { type: 'readOnly' },
};
const historyThread = {
  ...threadResult.thread,
  historyMode: 'paginated',
  parentThreadId: null,
};
const historyTurn = {
  id: 'turn', status: 'completed', itemsView: 'summary',
  items: [{ type: 'agentMessage', id: 'item', text: 'summary' }],
};
const requests: [string, unknown, unknown][] = [
  [
    'initialize',
    {
      clientInfo: { name: 'ptah', version: '1' },
      capabilities: { experimentalApi: true },
    },
    {
      codexHome: '/home',
      platformFamily: 'unix',
      platformOs: 'linux',
      userAgent: 'codex',
    },
  ],
  ['thread/start', {}, threadResult],
  ['thread/resume', { threadId: 'thread' }, threadResult],
  ['thread/read', { threadId: 'thread', includeTurns: true }, { thread: historyThread }],
  ['thread/turns/list', { threadId: 'thread', itemsView: 'full', sortDirection: 'asc' }, { data: [historyTurn], nextCursor: 'next' }],
  ['thread/items/list', { threadId: 'thread', turnId: 'turn', cursor: { type: 'item', itemId: 'prior' } }, { data: [{ turnId: 'turn', item: historyTurn.items[0] }], nextCursor: null }],
  ['thread/list', { cursor: 'next', sourceKinds: ['subAgent'] }, { data: [historyThread], nextCursor: null }],
  [
    'turn/start',
    { threadId: 'thread', input: [{ type: 'text', text: 'Hello' }] },
    { turn },
  ],
  [
    'turn/steer',
    { threadId: 'thread', expectedTurnId: 'turn', input: [] },
    { turnId: 'turn' },
  ],
  ['turn/interrupt', { threadId: 'thread', turnId: 'turn' }, {}],
  ['thread/compact/start', { threadId: 'thread' }, {}],
  ['model/list', { limit: 100 }, { data: [], nextCursor: null }],
  [
    'account/rateLimits/read',
    undefined,
    {
      rateLimits: {
        primary: { usedPercent: 5, resetsAt: 1, windowDurationMins: 60 },
      },
    },
  ],
  [
    'item/commandExecution/requestApproval',
    { ...approval, command: 'echo test', cwd: '/work' },
    { decision: 'decline' },
  ],
  ['item/fileChange/requestApproval', approval, { decision: 'accept' }],
  [
    'item/permissions/requestApproval',
    { ...approval, cwd: '/work', permissions: { network: { enabled: true } } },
    { permissions: {}, scope: 'turn' },
  ],
  [
    'item/tool/requestUserInput',
    {
      ...ids,
      isBlocking: true,
      questions: [
        {
          id: 'q',
          header: 'Choice',
          question: 'Which?',
          options: [{ label: 'A', description: 'First' }],
        },
      ],
    },
    { answers: { q: { answers: ['A'] } } },
  ],
  [
    'mcpServer/elicitation/request',
    {
      threadId: 'thread',
      turnId: null,
      serverName: 'marker',
      mode: 'form',
      message: 'Allow?',
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean' } },
        required: ['confirm'],
      },
      _meta: { toolName: 'marker' },
    },
    { action: 'accept', content: { confirm: true }, _meta: {} },
  ],
];

describe('pinned history methods', () => {
  it('admits all four methods in the pinned manifest', () => {
    const manifest = z.object({ methods: z.object({ requests: z.array(z.string()) }) }).parse(
      JSON.parse(readFileSync(join(__dirname, 'protocol/codex-app-server-protocol.manifest.json'), 'utf8')),
    );
    for (const method of ['thread/read', 'thread/turns/list', 'thread/items/list', 'thread/list'])
      expect(manifest.methods.requests).toContain(method);
  });

  it('validates includeTurns and full versus summary views', () => {
    expect(validateCodexParams('thread/read', { threadId: 'thread', includeTurns: false })).toEqual({ threadId: 'thread', includeTurns: false });
    expect(validateCodexResult('thread/read', { thread: { ...historyThread, turns: [historyTurn] } })).toMatchObject({ thread: { historyMode: 'paginated', turns: [{ itemsView: 'summary' }] } });
    expect(validateCodexResult('thread/turns/list', { data: [{ ...historyTurn, itemsView: 'full' }] })).toMatchObject({ data: [{ itemsView: 'full' }] });
  });

  it('rejects unknown item types and malformed cursors', () => {
    expect(() => validateCodexResult('thread/items/list', { data: [{ turnId: 'turn', item: { type: 'futureType', id: 'x' } }] })).toThrow(expect.objectContaining({ code: 'invalidResult' }));
    expect(() => validateCodexResult('thread/turns/list', { data: [], nextCursor: 7 })).toThrow(expect.objectContaining({ code: 'invalidResult' }));
    expect(() => validateCodexParams('thread/items/list', { threadId: 'thread', cursor: { type: 'item' } })).toThrow(expect.objectContaining({ code: 'invalidParams' }));
  });
});
const notifications: [string, unknown][] = [
  ['account/rateLimits/updated', { rateLimits: {} }],
  ['mcpServer/startupStatus/updated', { name: 'mcp', status: 'starting' }],
  [
    'remoteControl/status/changed',
    { installationId: 'install', serverName: 'server', status: 'disabled' },
  ],
  ['serverRequest/resolved', { threadId: 'thread', requestId: 1 }],
  ['thread/started', { thread: threadResult.thread }],
  ['thread/status/changed', { threadId: 'thread', status: { type: 'idle' } }],
  ['turn/moderationMetadata', { ...ids, metadata: null }],
  ['initialized', undefined],
  [
    'item/started',
    {
      threadId: 'thread',
      turnId: 'turn',
      item: { type: 'agentMessage', id: 'item', text: '' },
      startedAtMs: 1,
    },
  ],
  [
    'item/completed',
    {
      threadId: 'thread',
      turnId: 'turn',
      item: { type: 'agentMessage', id: 'item', text: 'Hi' },
      completedAtMs: 2,
    },
  ],
  ['item/agentMessage/delta', { ...ids, delta: 'Hi' }],
  ['turn/started', { threadId: 'thread', turn }],
  [
    'turn/completed',
    { threadId: 'thread', turn: { ...turn, status: 'completed' } },
  ],
  [
    'thread/tokenUsage/updated',
    {
      threadId: 'thread',
      turnId: 'turn',
      tokenUsage: { last: usage, total: usage },
    },
  ],
  [
    'error',
    {
      threadId: 'thread',
      turnId: 'turn',
      error: { message: 'failed' },
      willRetry: false,
    },
  ],
  [
    'item/reasoning/summaryTextDelta',
    { ...ids, summaryIndex: 0, delta: 'thinking' },
  ],
  ['item/reasoning/textDelta', { ...ids, contentIndex: 0, delta: 'thinking' }],
];

describe('server extensions and strict client contracts', () => {
  const extendedThreadResult = {
    ...threadResult,
    thread: {
      ...threadResult.thread,
      environments: [],
      extra: {},
      canAcceptDirectInput: true,
      daybreakEnabled: false,
    },
    runtimeWorkspaceRoots: ['/work'],
    activePermissionProfile: null,
    multiAgentMode: 'disabled',
  };

  it('strips the seven additive fields from the real thread/start shape', () => {
    expect(validateCodexResult('thread/start', extendedThreadResult)).toEqual(
      threadResult,
    );
  });

  it.each(['id', 'model'])(
    'still requires %s in an extended thread/start result',
    (field) => {
      const missingThread: Record<string, unknown> = {
        ...extendedThreadResult.thread,
      };
      const missingResult: Record<string, unknown> = {
        ...extendedThreadResult,
        thread: missingThread,
      };
      delete (field === 'id' ? missingThread : missingResult)[field];
      expect(() => validateCodexResult('thread/start', missingResult)).toThrow(
        expect.objectContaining({ code: 'invalidResult' }),
      );
    },
  );

  it('still rejects wrong required field types', () => {
    expect(() =>
      validateCodexResult('thread/start', {
        ...extendedThreadResult,
        thread: { ...extendedThreadResult.thread, id: 42 },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalidResult' }));
  });

  it.each([
    ['thread/start', { futureField: true }],
    [
      'turn/start',
      {
        threadId: 'thread',
        input: [],
        sandboxPolicy: { type: 'readOnly', futureField: true },
      },
    ],
    [
      'turn/start',
      {
        threadId: 'thread',
        input: [{ type: 'text', text: 'hi', futureField: true }],
      },
    ],
    [
      'turn/start',
      {
        threadId: 'thread',
        input: [],
        toolOutput: {
          name: 'tool',
          output: [{ type: 'input_text', text: 'hi', futureField: true }],
        },
      },
    ],
    [
      'thread/start',
      {
        approvalPolicy: {
          granular: {
            mcp_elicitations: false,
            rules: false,
            sandbox_approval: false,
            futureField: true,
          },
        },
      },
    ],
    ['initialized', { futureField: true }],
  ])('keeps outgoing %s params strict', (method, params) => {
    expect(() => validateCodexParams(method, params)).toThrow(
      expect.objectContaining({ code: 'invalidParams' }),
    );
  });

  it('strips nested server policy extensions', () => {
    const granular = {
      mcp_elicitations: false,
      rules: false,
      sandbox_approval: false,
    };
    expect(
      validateCodexResult('thread/start', {
        ...threadResult,
        approvalPolicy: {
          granular: { ...granular, futureField: true },
          futureField: true,
        },
        sandbox: { type: 'readOnly', futureField: true },
      }),
    ).toEqual({ ...threadResult, approvalPolicy: { granular } });
  });

  it('accepts approval request extensions while rejecting reply extensions', () => {
    const method = 'item/commandExecution/requestApproval';
    expect(
      validateCodexParams(method, {
        ...approval,
        futureField: true,
        networkApprovalContext: {
          host: 'example.test',
          protocol: 'https',
          futureField: true,
        },
      }),
    ).toEqual({
      ...approval,
      networkApprovalContext: { host: 'example.test', protocol: 'https' },
    });
    expect(() =>
      validateCodexResult(method, {
        decision: 'accept',
        futureField: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalidResult' }));
    expect(() =>
      validateCodexParams(method, {
        ...approval,
        kind: 'futureKind',
        futureField: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalidParams' }));
  });

  it('keeps nested permission replies strict and server permissions tolerant', () => {
    const permissions = { network: { enabled: true, futureField: true } };
    expect(
      validateCodexParams('item/permissions/requestApproval', {
        ...approval,
        cwd: '/work',
        permissions,
      }),
    ).toEqual({
      ...approval,
      cwd: '/work',
      permissions: { network: { enabled: true } },
    });
    expect(() =>
      validateCodexResult('item/permissions/requestApproval', {
        permissions,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalidResult' }));
  });

  it.each([
    { type: 'agentMessage', id: 'item', text: 'hi' },
    {
      type: 'userMessage',
      id: 'item',
      content: [{ type: 'text', text: 'hi' }],
    },
    {
      type: 'functionCallOutput',
      id: 'item',
      name: 'tool',
      output: [{ type: 'input_text', text: 'hi' }],
    },
  ])('strips extensions inside $type notifications', (item) => {
    const params = { threadId: 'thread', turnId: 'turn', startedAtMs: 1, item };
    expect(
      validateCodexParams('item/started', {
        ...params,
        item: { ...item, futureField: true },
        futureField: true,
      }),
    ).toEqual(params);
  });

  it('strips deeply nested server inputs and function outputs', () => {
    const params = { threadId: 'thread', turnId: 'turn', startedAtMs: 1 };
    expect(
      validateCodexParams('item/started', {
        ...params,
        item: {
          type: 'userMessage',
          id: 'item',
          content: [
            {
              type: 'text',
              text: 'hi',
              futureField: true,
              text_elements: [
                {
                  byteRange: { start: 0, end: 2, futureField: true },
                  futureField: true,
                },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      ...params,
      item: {
        type: 'userMessage',
        id: 'item',
        content: [
          {
            type: 'text',
            text: 'hi',
            text_elements: [{ byteRange: { start: 0, end: 2 } }],
          },
        ],
      },
    });
    expect(
      validateCodexParams('item/started', {
        ...params,
        item: {
          type: 'functionCallOutput',
          id: 'item',
          name: 'tool',
          output: [
            {
              type: 'input_text',
              text: 'hi',
              futureField: true,
            },
          ],
        },
      }),
    ).toEqual({
      ...params,
      item: {
        type: 'functionCallOutput',
        id: 'item',
        name: 'tool',
        output: [
          {
            type: 'input_text',
            text: 'hi',
          },
        ],
      },
    });
  });

  it('strips envelope extensions without weakening outgoing param validation', () => {
    expect(
      validateCodexFrame(
        { id: 1, result: {}, futureField: true },
        'turn/interrupt',
      ),
    ).toEqual({ id: 1, result: {} });
    expect(() =>
      validateCodexFrame({
        id: 1,
        method: 'thread/start',
        params: { futureField: true },
        futureField: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalidParams' }));
    expect(() =>
      validateCodexFrame({
        method: 'future/notification',
        params: {},
        futureField: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'unknownMethod' }));
  });
});

describe('Codex protocol validation', () => {
  it('replays every inbound method from spike runs 6e through 6j', () => {
    const methods = new Set<string>();
    for (const suffix of ['e', 'f', 'g', 'h', 'i', 'j']) {
      const sequences = z
        .array(z.array(z.object({ method: z.string() })))
        .parse(
          JSON.parse(
            readFileSync(
              join(__dirname, '__fixtures__', `spike-run-6${suffix}.json`),
              'utf8',
            ),
          ),
        );
      for (const sequence of sequences) {
        for (const event of sequence) methods.add(event.method);
      }
    }
    expect(methods.size).toBe(16);
    for (const method of methods) {
      const request = requests.find(([name]) => name === method);
      const notification = notifications.find(([name]) => name === method);
      expect(request ?? notification).toBeDefined();
      const params = (request ?? notification)?.[1];
      const frame = validateCodexFrame({
        method,
        params,
        ...(request ? { id: 1 } : {}),
      });
      if (!('method' in frame)) throw new Error('Expected inbound method');
      const events = new CodexEventTranslator('replay', 1).translate(frame);
      if (!request)
        expect(events.some((event) => event.type === 'error')).toBe(false);
    }
  });

  it.each(
    pinnedNotificationMethods.filter(
      (method) => !Object.hasOwn(codexNotificationSchemas, method),
    ),
  )('accepts pinned unmodeled %s only as a notification', (method) => {
    const params = {
      threadId: 'thread',
      turnId: 'turn',
      opaque: { values: [null, 1] },
    };
    const frame = validateCodexFrame({ method, params });
    expect(frame).toEqual({ method, params, modeled: false });
    if (!('method' in frame)) throw new Error('Expected notification');
    expect(new CodexEventTranslator('context', 1).translate(frame)).toEqual([]);
    expect(() => validateCodexFrame({ id: 1, method, params })).toThrow(
      CodexProtocolError,
    );
    expect(() => validateCodexFrame({ id: 1, result: {} }, method)).toThrow(
      CodexProtocolError,
    );
    for (const invalid of [undefined, null, [], 1, 'text'])
      expect(() => validateCodexFrame({ method, params: invalid })).toThrow(
        CodexProtocolError,
      );
  });

  it('rejects a notification outside the pinned manifest', () => {
    expect(() =>
      validateCodexFrame({ method: 'future/notification', params: {} }),
    ).toThrow(expect.objectContaining({ code: 'unknownMethod' }));
  });

  it('models the reasoning delta notifications with required fields', () => {
    for (const [method, indexKey] of [
      ['item/reasoning/summaryTextDelta', 'summaryIndex'],
      ['item/reasoning/textDelta', 'contentIndex'],
    ] as const) {
      const params = { ...ids, [indexKey]: 0, delta: 'thinking' };
      const frame = validateCodexFrame({ method, params });
      expect(frame).toEqual({ method, params });
      expect(() =>
        validateCodexFrame({
          method,
          params: { ...params, futureField: true },
        }),
      ).not.toThrow();
      const missing = { ...params } as Record<string, unknown>;
      delete missing[indexKey];
      expect(() =>
        validateCodexFrame({ method, params: missing }),
      ).toThrow(CodexProtocolError);
      expect(() => validateCodexFrame({ id: 1, method, params })).toThrow(
        CodexProtocolError,
      );
    }
  });

  it.each(notifications.slice(0, 7))(
    'checks required fields and allows extensions for %s',
    (method, params) => {
      const data = z.record(z.string(), z.unknown()).parse(params);
      expect(() =>
        validateCodexFrame({ method, params: { ...data, futureField: true } }),
      ).not.toThrow();
      for (const key of Object.keys(data).filter((key) => key !== 'itemId')) {
        const missing = { ...data };
        delete missing[key];
        expect(() => validateCodexFrame({ method, params: missing })).toThrow(
          CodexProtocolError,
        );
      }
    },
  );

  it.each([
    [
      'account/rateLimits/updated',
      { rateLimits: { primary: { usedPercent: 'bad' } } },
    ],
    [
      'account/rateLimits/updated',
      { rateLimits: { credits: { hasCredits: true } } },
    ],
    ['account/rateLimits/updated', { rateLimits: { planType: 'invalid' } }],
    ['mcpServer/startupStatus/updated', { name: 'mcp', status: 'invalid' }],
    [
      'mcpServer/startupStatus/updated',
      { name: 'mcp', status: 'failed', failureReason: 'invalid' },
    ],
    [
      'remoteControl/status/changed',
      { installationId: 'i', serverName: 's', status: 'invalid' },
    ],
    ['serverRequest/resolved', { threadId: 't', requestId: 1.5 }],
    [
      'thread/started',
      { thread: { ...threadResult.thread, projectId: undefined } },
    ],
    ['thread/status/changed', { threadId: 't', status: { type: 'active' } }],
    [
      'thread/status/changed',
      { threadId: 't', status: { type: 'active', activeFlags: ['invalid'] } },
    ],
    ['turn/moderationMetadata', { threadId: 't', turnId: 1, metadata: null }],
  ])('rejects malformed new %s payload', (method, params) => {
    expect(() => validateCodexFrame({ method, params })).toThrow(
      CodexProtocolError,
    );
  });

  it('accepts optional fields, sparse limits, arbitrary metadata and nested extensions', () => {
    const samples = [
      [
        'account/rateLimits/updated',
        {
          rateLimits: {
            primary: { usedPercent: 1, resetsAt: null, extension: true },
            credits: {
              hasCredits: false,
              unlimited: false,
              balance: null,
              extension: 1,
            },
            individualLimit: {
              limit: '1',
              used: '0',
              remainingPercent: 100,
              resetsAt: 1,
              extension: true,
            },
            planType: 'pro',
            secondary: null,
            extension: true,
          },
        },
      ],
      [
        'mcpServer/startupStatus/updated',
        {
          name: 'mcp',
          status: 'failed',
          error: null,
          failureReason: 'reauthenticationRequired',
          threadId: null,
        },
      ],
      [
        'remoteControl/status/changed',
        {
          installationId: 'i',
          serverName: 's',
          status: 'connected',
          environmentId: null,
        },
      ],
      ['serverRequest/resolved', { threadId: 't', requestId: 'request' }],
      [
        'thread/started',
        {
          thread: {
            ...threadResult.thread,
            extension: true,
            status: { type: 'idle', extension: true },
          },
        },
      ],
      [
        'thread/status/changed',
        {
          threadId: 't',
          status: {
            type: 'active',
            activeFlags: ['waitingOnApproval', 'waitingOnUserInput'],
            extension: true,
          },
        },
      ],
      ...[null, true, 1, 'metadata', [], { arbitrary: [1] }].map(
        (metadata): [string, unknown] => [
          'turn/moderationMetadata',
          { ...ids, metadata },
        ],
      ),
    ] satisfies [string, unknown][];
    for (const [method, params] of samples)
      expect(() => validateCodexFrame({ method, params })).not.toThrow();
  });
  it.each(requests)(
    'validates %s request and its correlated result',
    (method, params, result) => {
      expect(
        validateCodexFrame({
          id: 1,
          method,
          ...(params === undefined ? {} : { params }),
        }),
      ).toBeDefined();
      expect(validateCodexFrame({ id: 1, result }, method)).toBeDefined();
    },
  );
  it.each(requests)('rejects malformed %s params and result', (method) => {
    expect(() => validateCodexParams(method, { misspelled: true })).toThrow(
      CodexProtocolError,
    );
    // Empty server results strip additive keys; non-object results remain invalid.
    if (method === 'turn/interrupt' || method === 'thread/compact/start') {
      expect(validateCodexResult(method, { misspelled: true })).toEqual({});
      expect(() => validateCodexResult(method, null)).toThrow(
        expect.objectContaining({ code: 'invalidResult' }),
      );
    } else {
      expect(() => validateCodexResult(method, { misspelled: true })).toThrow(
        CodexProtocolError,
      );
    }
  });
  it.each(notifications)('validates %s notification', (method, params) => {
    expect(
      validateCodexFrame({
        method,
        ...(params === undefined ? {} : { params }),
      }),
    ).toBeDefined();
    expect(() => validateCodexParams(method, { misspelled: true })).toThrow(
      CodexProtocolError,
    );
  });
  it('covers every modeled method in the fixtures', () => {
    expect(requests.map(([method]) => method).sort()).toEqual(
      [
        ...Object.keys(codexRequestSchemas),
        ...Object.keys(codexServerRequestSchemas),
      ].sort(),
    );
    expect(notifications.map(([method]) => method).sort()).toEqual(
      Object.keys(codexNotificationSchemas).sort(),
    );
  });
  it.each([
    'missing',
    'toString',
    '__proto__',
    'item/mcpToolCall/requestApproval',
  ])('rejects unknown method %s', (method) => {
    expect(() => validateCodexFrame({ id: 1, method, params: {} })).toThrow(
      expect.objectContaining({ code: 'unknownMethod' }),
    );
    expect(() => validateCodexResult(method, {})).toThrow(CodexProtocolError);
  });
  it.each([
    {},
    { id: null, result: {} },
    { id: 1, result: {}, error: { code: -1, message: 'error' } },
    { id: 1, method: 'initialized' },
    { method: 'thread/start', params: {} },
    { jsonrpc: '1.0', method: 'initialized' },
    { id: 1 },
    { id: 1.5, method: 'thread/start', params: {} },
  ])('rejects malformed envelope %j', (frame) => {
    expect(() => validateCodexFrame(frame, 'turn/interrupt')).toThrow(
      CodexProtocolError,
    );
  });
  it('requires a known response method before correlation', () => {
    expect(() => validateCodexFrame({ id: 1, result: {} })).toThrow(
      expect.objectContaining({ code: 'missingResponseMethod' }),
    );
    expect(() =>
      validateCodexFrame({ id: 1, result: {} }, 'initialize'),
    ).toThrow(expect.objectContaining({ code: 'invalidResult' }));
  });
  it('validates JSON-RPC errors without treating them as successful results', () => {
    expect(
      validateCodexFrame(
        { id: 'request', error: { code: -32000, message: 'remote error' } },
        'initialize',
      ),
    ).toBeDefined();
    expect(() =>
      validateCodexFrame(
        { id: 1, error: { code: 'wrong', message: 'error' } },
        'initialize',
      ),
    ).toThrow(CodexProtocolError);
  });
  it.each([undefined, {}, { experimentalApi: false }])(
    'requires experimentalApi=true for initialization %j',
    (capabilities) => {
      expect(() =>
        validateCodexParams('initialize', {
          clientInfo: { name: 'ptah', version: '1' },
          capabilities,
        }),
      ).toThrow(CodexProtocolError);
    },
  );
  it.each(['accept', 'acceptForSession', 'decline', 'cancel'])(
    'accepts only supported approval decision %s',
    (decision) => {
      for (const method of [
        'item/commandExecution/requestApproval',
        'item/fileChange/requestApproval',
      ])
        expect(validateCodexResult(method, { decision })).toEqual({ decision });
    },
  );
  it.each([
    { decision: 'allowWithInput' },
    { decision: 'accept', updatedInput: { command: 'edited' } },
    { decision: 'deny' },
    { decision: { acceptWithExecpolicyAmendment: {} } },
  ])('rejects edited or unsupported approval replies %j', (result) => {
    expect(() =>
      validateCodexResult('item/commandExecution/requestApproval', result),
    ).toThrow(CodexProtocolError);
    expect(() =>
      validateCodexResult('item/fileChange/requestApproval', result),
    ).toThrow(CodexProtocolError);
  });
  it('keeps elicitation and permissions responses distinct from decisions', () => {
    expect(() =>
      validateCodexResult('mcpServer/elicitation/request', {
        decision: 'accept',
      }),
    ).toThrow(CodexProtocolError);
    expect(() =>
      validateCodexResult('mcpServer/elicitation/request', {
        action: 'acceptForSession',
      }),
    ).toThrow(CodexProtocolError);
    expect(() =>
      validateCodexResult('item/permissions/requestApproval', {
        decision: 'accept',
      }),
    ).toThrow(CodexProtocolError);
  });
  it.each(['openai/form', 'openaiForm', 'url'])(
    'accepts pinned elicitation mode %s',
    (mode) => {
      const params = {
        threadId: 't',
        serverName: 'server',
        message: 'Input',
        mode,
        ...(mode === 'url'
          ? { elicitationId: 'e', url: 'https://example.test' }
          : { requestedSchema: {} }),
      };
      expect(
        validateCodexParams('mcpServer/elicitation/request', params),
      ).toEqual(params);
    },
  );
  it('rejects malformed nested usage, inputs and rate limits', () => {
    expect(() =>
      validateCodexParams('turn/start', {
        threadId: 't',
        input: [{ type: 'text', text: 1 }],
      }),
    ).toThrow(CodexProtocolError);
    expect(() =>
      validateCodexParams('thread/tokenUsage/updated', {
        threadId: 't',
        turnId: 'u',
        tokenUsage: { last: {}, total: usage },
      }),
    ).toThrow(CodexProtocolError);
    expect(() =>
      validateCodexResult('account/rateLimits/read', {
        rateLimits: { primary: { usedPercent: '5' } },
      }),
    ).toThrow(CodexProtocolError);
  });
  it('does not include payload secrets in errors', () => {
    try {
      validateCodexParams('turn/steer', { secret: 'private-token' });
    } catch (error) {
      expect(error).toBeInstanceOf(CodexProtocolError);
      expect(String(error)).not.toContain('private-token');
      expect(JSON.stringify(error)).not.toContain('private-token');
    }
  });
});

const record = z.record(z.string(), z.unknown());
const schema = record.parse(
  JSON.parse(
    readFileSync(
      join(__dirname, 'protocol/codex-app-server-protocol.schema.json'),
      'utf8',
    ),
  ),
);
function resolveRef(value: unknown): Record<string, unknown> {
  const node = record.parse(value);
  if (typeof node['$ref'] !== 'string') return node;
  let resolved: unknown = schema;
  for (const part of node['$ref'].slice(2).split('/'))
    resolved = record.parse(resolved)[part];
  return record.parse(resolved);
}
function fields(value: unknown): Record<string, unknown> {
  const node = resolveRef(value);
  const own =
    node['properties'] === undefined ? {} : record.parse(node['properties']);
  for (const variant of z.array(z.unknown()).parse(node['oneOf'] ?? []))
    Object.assign(own, fields(variant));
  return own;
}

describe('pinned schema contract', () => {
  const definitions = record.parse(schema['definitions']);
  it('has exactly the same server notification methods as the pinned manifest', () => {
    const variants = z
      .array(record)
      .parse(record.parse(definitions['ServerNotification'])['oneOf']);
    const methods = variants.flatMap((variant) =>
      z
        .array(z.string())
        .parse(
          record.parse(record.parse(variant['properties'])['method'])['enum'],
        ),
    );
    expect(methods.sort()).toEqual([...pinnedNotificationMethods].sort());
  });
  const groups = [
    ['ClientRequest', codexRequestSchemas],
    ['ServerRequest', codexServerRequestSchemas],
    [
      'ClientNotification',
      { initialized: { params: codexNotificationSchemas.initialized } },
    ],
    [
      'ServerNotification',
      Object.fromEntries(
        Object.entries(codexNotificationSchemas)
          .filter(([method]) => method !== 'initialized')
          .map(([method, params]) => [method, { params }]),
      ),
    ],
  ] as const;
  for (const [group, methods] of groups) {
    const variants = z
      .array(record)
      .parse(record.parse(definitions[group])['oneOf']);
    it.each(Object.entries(methods))(
      `models %s with pinned ${group} field names`,
      (method, modeled) => {
        const wire = variants.find((variant) =>
          z
            .array(z.string())
            .parse(
              record.parse(record.parse(variant['properties'])['method'])[
                'enum'
              ],
            )
            .includes(method),
        );
        expect(wire).toBeDefined();
        if (!wire) throw new Error('Missing pinned method');
        const wireParams = record.parse(wire['properties'])['params'];
        const modeledFields = fields(z.toJSONSchema(modeled.params));
        const pinnedFields = wireParams === undefined ? {} : fields(wireParams);
        for (const name of Object.keys(modeledFields))
          expect(Object.keys(pinnedFields)).toContain(name);
        if (wireParams !== undefined) {
          for (const name of z
            .array(z.string())
            .parse(resolveRef(wireParams)['required'] ?? []))
            expect(Object.keys(modeledFields)).toContain(name);
        }
      },
    );
  }
});

const itemFixtures = [
  { type: 'userMessage', id: 'i', content: [{ type: 'text', text: 'hi' }] },
  {
    type: 'hookPrompt',
    id: 'i',
    fragments: [{ hookRunId: 'h', text: 'prompt' }],
  },
  { type: 'agentMessage', id: 'i', text: 'hi', delivery: 'async' },
  { type: 'functionCallOutput', id: 'i', name: 'f', output: 'done' },
  { type: 'plan', id: 'i', text: 'plan' },
  { type: 'reasoning', id: 'i', summary: ['thinking'] },
  {
    type: 'commandExecution',
    id: 'i',
    command: 'echo test',
    cwd: '/work',
    commandActions: [{ type: 'unknown', command: 'echo test' }],
    status: 'inProgress',
  },
  {
    type: 'fileChange',
    id: 'i',
    changes: [{ path: '/work/file', diff: '+text', kind: { type: 'add' } }],
    status: 'completed',
  },
  {
    type: 'mcpToolCall',
    id: 'i',
    server: 'marker',
    tool: 'mark',
    arguments: {},
    status: 'completed',
    result: { content: [], _meta: {} },
  },
  {
    type: 'dynamicToolCall',
    id: 'i',
    arguments: {},
    tool: 'test',
    status: 'completed',
    contentItems: [{ type: 'inputText', text: 'result' }],
  },
  {
    type: 'collabAgentToolCall',
    id: 'i',
    senderThreadId: 't',
    receiverThreadIds: ['u'],
    status: 'completed',
    tool: 'wait',
    agentsStates: { u: { status: 'completed' } },
  },
  {
    type: 'subAgentActivity',
    id: 'i',
    agentPath: '/agent',
    agentThreadId: 'u',
    kind: 'completed',
  },
  { type: 'webSearch', id: 'i', query: 'test' },
  { type: 'imageView', id: 'i', path: '/image' },
  { type: 'sleep', id: 'i', durationMs: 100 },
  { type: 'imageGeneration', id: 'i', result: '', status: 'completed' },
  { type: 'enteredReviewMode', id: 'i', review: 'review' },
  { type: 'exitedReviewMode', id: 'i', review: 'review' },
  { type: 'contextCompaction', id: 'i' },
];
describe('pinned item variants', () => {
  it.each(itemFixtures)(
    'validates $type in notifications and turn results',
    (item) => {
      expect(
        validateCodexParams('item/started', {
          threadId: 't',
          turnId: 'u',
          startedAtMs: 1,
          item,
        }),
      ).toBeDefined();
      expect(
        validateCodexResult('turn/start', {
          turn: { ...turn, items: [item], itemsView: 'summary' },
        }),
      ).toBeDefined();
      expect(() =>
        validateCodexParams('item/completed', {
          threadId: 't',
          turnId: 'u',
          completedAtMs: 1,
          item: { ...item, id: 2 },
        }),
      ).toThrow(CodexProtocolError);
    },
  );
  it('covers each pinned ThreadItem discriminator', () => {
    const variants = z
      .array(record)
      .parse(resolveRef({ $ref: '#/definitions/v2/ThreadItem' })['oneOf']);
    const types = variants.map(
      (variant) =>
        z
          .array(z.string())
          .parse(
            record.parse(record.parse(variant['properties'])['type'])['enum'],
          )[0],
    );
    expect(itemFixtures.map((item) => item.type).sort()).toEqual(types.sort());
  });
});
