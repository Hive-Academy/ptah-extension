import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CodexProtocolError,
  codexRequestSchemas,
  codexServerRequestSchemas,
  codexNotificationSchemas,
  validateCodexFrame,
  validateCodexParams,
  validateCodexResult,
} from './codex-protocol-validator';

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
    cliVersion: '0.155.1',
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
const notifications: [string, unknown][] = [
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
];

describe('Codex protocol validation', () => {
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
    expect(() => validateCodexResult(method, { misspelled: true })).toThrow(
      CodexProtocolError,
    );
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
