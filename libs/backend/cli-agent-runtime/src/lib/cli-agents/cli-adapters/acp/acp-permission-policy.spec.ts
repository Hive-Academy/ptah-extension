import type {
  PermissionOption,
  RequestPermissionRequest,
} from '@agentclientprotocol/sdk';
import {
  decideAcpPermission,
  type AcpPermissionDecision,
} from './acp-permission-policy';

/**
 * The three real `session/request_permission` requests Grok 1.0.46 sent in the
 * Batch 0 probe (`__fixtures__/grok-p2-permission-allow-once.ndjson`). Grok
 * lists its `allow_always` option first under a different optionId each time,
 * so answering `allow-once` proves selection by kind rather than by id or
 * position.
 */
const GROK_EXECUTE_REQUEST: RequestPermissionRequest = {
  sessionId: '00000000-0000-7000-8000-000000000013',
  toolCall: {
    toolCallId: 'call-00000000-0000-7000-8000-000000000015-0',
    kind: 'execute',
    title: 'Execute `echo b0 > shell.txt`',
    rawInput: {
      variant: 'Bash',
      command: 'echo b0 > shell.txt',
      description: 'Write b0 into shell.txt',
      is_background: false,
    },
  },
  options: [
    {
      optionId: 'always-allow',
      name: "Yes, and don't ask again for bash commands",
      kind: 'allow_always',
    },
    { optionId: 'allow-once', name: 'Yes, proceed', kind: 'allow_once' },
    {
      optionId: 'reject-once',
      name: 'No, and tell Grok what to do differently',
      kind: 'reject_once',
    },
    {
      optionId: 'reject-always',
      name: "No, and don't ask again for this command",
      kind: 'reject_always',
    },
  ],
};

const GROK_EDIT_REQUEST: RequestPermissionRequest = {
  sessionId: '00000000-0000-7000-8000-000000000013',
  toolCall: {
    toolCallId: 'call-00000000-0000-7000-8000-000000000015-1',
    kind: 'edit',
    title:
      'Write `C:\\Users\\<user>\\AppData\\Local\\Temp\\grok-b0\\p2\\edit.txt`',
    rawInput: {
      variant: 'Write',
      file_path:
        'C:\\Users\\<user>\\AppData\\Local\\Temp\\grok-b0\\p2\\edit.txt',
      content: 'hi',
    },
  },
  options: [
    {
      optionId: 'allow-edits-session',
      name: 'Yes, allow all edits during this session',
      kind: 'allow_always',
    },
    { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
    {
      optionId: 'reject-once',
      name: 'No, and tell Grok what to do differently',
      kind: 'reject_once',
    },
  ],
};

const GROK_MCP_USE_TOOL_REQUEST: RequestPermissionRequest = {
  sessionId: '00000000-0000-7000-8000-000000000013',
  toolCall: {
    toolCallId: 'call-00000000-0000-7000-8000-000000000015-2',
    kind: 'other',
    title: 'ptah__ptah_agent_list',
    rawInput: { variant: 'UseTool', tool_name: 'ptah__ptah_agent_list' },
  },
  options: [
    { optionId: 'always-allow', name: 'always allow', kind: 'allow_always' },
    { optionId: 'allow-once', name: 'allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'reject once', kind: 'reject_once' },
  ],
};

function titledToolCall(title: string): RequestPermissionRequest['toolCall'] {
  return { toolCallId: 'call-1', kind: 'read', title };
}

function permissionRequest(
  options: PermissionOption[],
  toolCall?: RequestPermissionRequest['toolCall'],
): RequestPermissionRequest {
  return {
    sessionId: 'session-1',
    toolCall: toolCall ?? { toolCallId: 'call-1', kind: 'read' },
    options,
  };
}

/** Calls the typed policy with a value that does not satisfy its signature. */
function decideUnchecked(
  request: unknown,
  options?: { autoApprove?: boolean },
): AcpPermissionDecision {
  return Reflect.apply(decideAcpPermission, undefined, [request, options]);
}

interface PermissionExpectation {
  readonly selectedOptionId?: string;
  readonly cancelled: boolean;
  readonly refused: boolean;
  readonly info?: string;
  readonly toolTitle?: string;
}

interface PermissionCase {
  readonly name: string;
  readonly request: RequestPermissionRequest;
  readonly options?: { autoApprove?: boolean };
  readonly expected: PermissionExpectation;
}

interface UncheckedPermissionCase {
  readonly name: string;
  readonly request: unknown;
  readonly options?: { autoApprove?: boolean };
  readonly expected: PermissionExpectation;
}

function assertDecision(
  decision: AcpPermissionDecision,
  expected: PermissionExpectation,
): void {
  expect(decision.response).toEqual(
    expected.cancelled
      ? { outcome: { outcome: 'cancelled' } }
      : {
          outcome: { outcome: 'selected', optionId: expected.selectedOptionId },
        },
  );
  expect(decision.refused).toBe(expected.refused);
  expect(decision.info).toBe(expected.info);
  expect(decision.toolTitle).toBe(expected.toolTitle);
}

const PERMISSION_CASES: PermissionCase[] = [
  {
    name: 'answers Grok execute request with allow-once though allow_always is listed first',
    request: GROK_EXECUTE_REQUEST,
    options: { autoApprove: undefined },
    expected: {
      selectedOptionId: 'allow-once',
      cancelled: false,
      refused: false,
      toolTitle: 'Execute `echo b0 > shell.txt`',
    },
  },
  {
    name: 'answers Grok execute request with allow-once when autoApprove is explicitly true',
    request: GROK_EXECUTE_REQUEST,
    options: { autoApprove: true },
    expected: {
      selectedOptionId: 'allow-once',
      cancelled: false,
      refused: false,
      toolTitle: 'Execute `echo b0 > shell.txt`',
    },
  },
  {
    name: 'answers Grok edit-write request with allow-once though its allow_always id differs',
    request: GROK_EDIT_REQUEST,
    expected: {
      selectedOptionId: 'allow-once',
      cancelled: false,
      refused: false,
      toolTitle:
        'Write `C:\\Users\\<user>\\AppData\\Local\\Temp\\grok-b0\\p2\\edit.txt`',
    },
  },
  {
    name: 'answers the MCP use_tool request (kind other) with allow-once',
    request: GROK_MCP_USE_TOOL_REQUEST,
    expected: {
      selectedOptionId: 'allow-once',
      cancelled: false,
      refused: false,
      toolTitle: 'ptah__ptah_agent_list',
    },
  },
  {
    name: 'selects the only allow_always option and notes the persistent grant',
    request: permissionRequest(
      [
        {
          optionId: 'always-allow',
          name: 'Yes, and never ask again',
          kind: 'allow_always',
        },
      ],
      titledToolCall('Edit config.json'),
    ),
    expected: {
      selectedOptionId: 'always-allow',
      cancelled: false,
      refused: false,
      info: 'Edit config.json: the only allow option offered was a persistent grant',
      toolTitle: 'Edit config.json',
    },
  },
  {
    name: 'selects reject_once when only reject options are offered',
    request: permissionRequest(
      [
        { optionId: 'reject-once', name: 'No', kind: 'reject_once' },
        {
          optionId: 'reject-always',
          name: 'No, and never ask again',
          kind: 'reject_always',
        },
      ],
      titledToolCall('Delete build/'),
    ),
    expected: {
      selectedOptionId: 'reject-once',
      cancelled: false,
      refused: true,
      info: 'Refused permission for Delete build/: no allow option was offered',
      toolTitle: 'Delete build/',
    },
  },
  {
    name: 'answers cancelled for an empty options array',
    request: permissionRequest([], titledToolCall('Run tests')),
    expected: {
      cancelled: true,
      refused: true,
      info: 'Refused permission for Run tests: no offered option could be selected',
      toolTitle: 'Run tests',
    },
  },
  {
    name: 'selects reject_once when auto-approve is off',
    request: GROK_EXECUTE_REQUEST,
    options: { autoApprove: false },
    expected: {
      selectedOptionId: 'reject-once',
      cancelled: false,
      refused: true,
      info: 'Refused permission for Execute `echo b0 > shell.txt`: auto-approve is off',
      toolTitle: 'Execute `echo b0 > shell.txt`',
    },
  },
  {
    name: 'answers cancelled when auto-approve is off and only allow_once is offered',
    request: permissionRequest(
      [{ optionId: 'allow-once', name: 'Yes, proceed', kind: 'allow_once' }],
      titledToolCall('Read settings.json'),
    ),
    options: { autoApprove: false },
    expected: {
      cancelled: true,
      refused: true,
      info: 'Refused permission for Read settings.json: auto-approve is off',
      toolTitle: 'Read settings.json',
    },
  },
  {
    name: 'answers cancelled rather than reject_always when auto-approve is off',
    request: permissionRequest(
      [
        {
          optionId: 'reject-always',
          name: 'No, and never ask again',
          kind: 'reject_always',
        },
      ],
      titledToolCall('Fetch the docs page'),
    ),
    options: { autoApprove: false },
    expected: {
      cancelled: true,
      refused: true,
      info: 'Refused permission for Fetch the docs page: auto-approve is off',
      toolTitle: 'Fetch the docs page',
    },
  },
  {
    name: 'selects allow_once for a request without a title and reports no tool title',
    request: permissionRequest([
      { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
    ]),
    expected: {
      selectedOptionId: 'allow-once',
      cancelled: false,
      refused: false,
    },
  },
  {
    name: 'falls back to a generic tool title when a refusal has no title',
    request: permissionRequest([
      { optionId: 'reject-once', name: 'No', kind: 'reject_once' },
    ]),
    expected: {
      selectedOptionId: 'reject-once',
      cancelled: false,
      refused: true,
      info: 'Refused permission for a tool call: no allow option was offered',
    },
  },
  {
    name: 'selects the first of two allow_once options',
    request: permissionRequest(
      [
        { optionId: 'approve-1', name: 'Allow', kind: 'allow_once' },
        { optionId: 'approve-2', name: 'Allow as well', kind: 'allow_once' },
      ],
      titledToolCall('Run shell command'),
    ),
    expected: {
      selectedOptionId: 'approve-1',
      cancelled: false,
      refused: false,
      toolTitle: 'Run shell command',
    },
  },
];

const UNCHECKED_PERMISSION_CASES: UncheckedPermissionCase[] = [
  {
    name: 'answers cancelled when the options array is missing',
    request: {
      sessionId: 'session-1',
      toolCall: { toolCallId: 'call-7', kind: 'read', title: 'Read notes.md' },
    },
    expected: {
      cancelled: true,
      refused: true,
      info: 'Refused permission for Read notes.md: no offered option could be selected',
      toolTitle: 'Read notes.md',
    },
  },
  {
    name: 'selects allow_once when the tool call is missing',
    request: {
      sessionId: 'session-1',
      options: [{ optionId: 'allow-once', name: 'Yes', kind: 'allow_once' }],
    },
    expected: {
      selectedOptionId: 'allow-once',
      cancelled: false,
      refused: false,
    },
  },
  {
    name: 'ignores an option of an unknown kind listed ahead of allow_once',
    request: {
      sessionId: 'session-1',
      toolCall: {
        toolCallId: 'call-3',
        kind: 'execute',
        title: 'Run pipeline',
      },
      options: [
        { optionId: 'mystery', name: 'Mystery', kind: 'maybe_ask' },
        { optionId: 'allow-once', name: 'Yes, proceed', kind: 'allow_once' },
      ],
    },
    expected: {
      selectedOptionId: 'allow-once',
      cancelled: false,
      refused: false,
      toolTitle: 'Run pipeline',
    },
  },
  {
    name: 'answers cancelled when only an unknown kind is offered',
    request: {
      sessionId: 'session-1',
      toolCall: { toolCallId: 'call-4', kind: 'execute', title: 'Run plan' },
      options: [{ optionId: 'mystery', name: 'Mystery', kind: 'maybe_ask' }],
    },
    expected: {
      cancelled: true,
      refused: true,
      info: 'Refused permission for Run plan: no offered option could be selected',
      toolTitle: 'Run plan',
    },
  },
  {
    name: 'answers cancelled without throwing when reading the request fails',
    request: {
      sessionId: 'session-1',
      options: [{ optionId: 'allow-once', name: 'Yes', kind: 'allow_once' }],
      toolCall: {
        toolCallId: 'call-9',
        get title(): string {
          throw new Error('unreadable title');
        },
      },
    },
    expected: { cancelled: true, refused: true },
  },
];

describe('decideAcpPermission', () => {
  it.each(PERMISSION_CASES)('$name', ({ request, options, expected }) => {
    assertDecision(decideAcpPermission(request, options ?? {}), expected);
  });

  it.each(UNCHECKED_PERMISSION_CASES)(
    '$name',
    ({ request, options, expected }) => {
      assertDecision(decideUnchecked(request, options), expected);
    },
  );

  it('treats a missing options argument as auto-approve on', () => {
    assertDecision(decideAcpPermission(GROK_EXECUTE_REQUEST), {
      selectedOptionId: 'allow-once',
      cancelled: false,
      refused: false,
      toolTitle: 'Execute `echo b0 > shell.txt`',
    });
  });
});
