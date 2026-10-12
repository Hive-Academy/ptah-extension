import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import type {
  AskUserQuestionRequest,
  ExecutionChatMessage,
  ExecutionNode,
  PermissionRequest,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import {
  summarizeFinalized,
  summarizeLive,
  type CompactSummaryContext,
} from './compact-session-summary';

const context = (
  overrides: Partial<CompactSummaryContext> = {},
): CompactSummaryContext => ({
  sessionIdentity: 'session-1',
  workspacePath: 'C:\\Users\\alice\\work\\ptah',
  workspaceLabel: 'ptah',
  sessionStatus: 'loaded',
  metrics: { model: 'sonnet', tokens: 42, cost: 0.01, agentCount: 0 },
  ...overrides,
});

function node(overrides: Partial<ExecutionNode>): ExecutionNode {
  return {
    id: 'node',
    type: 'text',
    status: 'complete',
    content: null,
    children: [],
    isCollapsed: false,
    ...overrides,
  };
}

function message(root: ExecutionNode): ExecutionChatMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    timestamp: 1,
    streamingState: root,
  };
}

function userMessage(): ExecutionChatMessage {
  return {
    id: 'latest-prompt',
    role: 'user',
    timestamp: 20,
    streamingState: null,
    rawContent: 'Continue with the next task.',
  };
}

/** The recap text for a live failed tool whose error text is `output`. */
function summarizeToolError(output: string): string {
  const state = createEmptyStreamingState();
  state.events.set('result', {
    id: 'result',
    eventType: 'tool_result',
    timestamp: 1,
    messageId: 'message',
    toolCallId: 'tool',
    output,
    isError: true,
  });

  return summarizeLive(state, context()).content.text;
}

/**
 * Stores a tool_start the way the accumulator does: `events` by event id,
 * and `toolCallMap` from the tool call id to its event ids.
 */
function addToolStart(
  state: ReturnType<typeof createEmptyStreamingState>,
  start: ToolStartEvent,
): void {
  state.events.set(start.id, start);
  state.toolCallMap.set(start.toolCallId, [start.id]);
}

function toolNode(overrides: Partial<ExecutionNode>): ExecutionNode {
  return node({ type: 'tool', toolName: 'Bash', ...overrides });
}

const POWERSHELL_ERROR = [
  "Method invocation failed because [System.Object[]] does not contain a method named 'op_Subtraction'.",
  'At line:1 char:1',
  '+ $a - $b',
  '+ ~~~~~~~',
  '    + CategoryInfo          : InvalidOperation: (op_Subtraction:String) [], RuntimeException',
  '    + FullyQualifiedErrorId : MethodNotFound',
  '-------------------------------------------',
  'line 8',
  'line 9 C:\\Users\\alice\\secret\\log.txt',
  'line 10',
].join('\n');

describe('compact-session-summary', () => {
  it('coalesces live semantic updates by stable identity and bounds marks at 24', () => {
    const state = createEmptyStreamingState();
    for (let index = 0; index < 50; index += 1) {
      const start: ToolStartEvent = {
        id: `start-${index}`,
        eventType: 'tool_start',
        timestamp: index,
        messageId: 'message',
        toolCallId: `tool-${index}`,
        toolName: 'Edit',
        toolInput: {
          file_path: `C:\\Users\\alice\\work\\ptah\\src\\${index}.ts`,
        },
        isTaskTool: false,
      };
      addToolStart(state, start);
      const result: ToolResultEvent = {
        id: `result-${index}`,
        eventType: 'tool_result',
        timestamp: index + 0.5,
        messageId: 'message',
        toolCallId: `tool-${index}`,
        output: 'ok',
        isError: false,
      };
      state.events.set(result.id, result);
    }

    const summary = summarizeLive(state, context());

    expect(summary.marks).toHaveLength(24);
    expect(new Set(summary.marks.map((mark) => mark.id)).size).toBe(24);
    // Tool output is never shown; the recap falls back to the newest target.
    expect(summary.content).toMatchObject({
      kind: 'result',
      text: '.../src/49.ts',
      format: 'plain',
    });
    expect(summary.marks.some((mark) => mark.text === 'ok')).toBe(false);
  });

  it('uses total tool fallbacks and redacts absolute home paths', () => {
    const state = createEmptyStreamingState();
    state.events.set('tool', {
      id: 'tool',
      eventType: 'tool_start',
      timestamp: 1,
      messageId: 'message',
      toolCallId: 'call',
      toolName: 'MysteryTool',
      toolInput: { path: 'C:\\Users\\alice\\secret\\token.txt' },
      isTaskTool: false,
    });

    const summary = summarizeLive(state, context());

    // An unknown input shape falls back to the tool name, with no verb.
    expect(summary.marks[0]).toMatchObject({
      label: 'MysteryTool started',
      text: 'MysteryTool',
      toolName: 'MysteryTool',
    });
    expect(summary.content).toMatchObject({
      kind: 'result',
      text: 'MysteryTool',
      format: 'plain',
    });
    expect(JSON.stringify(summary)).not.toContain('Users');
    expect(JSON.stringify(summary)).not.toContain('alice');
  });

  it('redacts Windows and POSIX absolute paths without changing plain text', () => {
    expect(summarizeToolError('Opened D:\\projects\\private\\report.txt')).toBe(
      'Opened report.txt',
    );
    expect(summarizeToolError('Opened /home/alice/private/report.txt')).toBe(
      'Opened report.txt',
    );
    expect(summarizeToolError('No absolute path here')).toBe(
      'No absolute path here',
    );
  });

  it('rejects a long non-matching Windows path candidate in under one second', () => {
    const subject = `C:\\${'\\'.repeat(200)}`;
    const startedAt = performance.now();

    expect(summarizeToolError(subject)).toBe(subject);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it('preserves Unicode and gives questions precedence over permissions and errors', () => {
    const question: AskUserQuestionRequest = {
      id: 'q',
      toolName: 'AskUserQuestion',
      questions: [
        {
          question:
            '\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0633\u0627\u0631 \u{1F680}',
          header: 'Path',
          options: [],
          multiSelect: false,
        },
      ],
      timestamp: 1,
      timeoutAt: 0,
    };
    const permission: PermissionRequest = {
      id: 'p',
      toolName: 'Bash',
      toolInput: {},
      timestamp: 2,
      description: 'Run command',
      timeoutAt: 0,
    };
    const summary = summarizeFinalized(
      [message(node({ status: 'error', error: 'boom', type: 'tool' }))],
      context({ questions: [question], permissions: [permission] }),
    );

    expect(summary.content.kind).toBe('question');
    expect(summary.content.text).toBe(
      '\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0633\u0627\u0631 \u{1F680}',
    );
    expect(summary.content.additionalPromptCount).toBe(1);
    expect(summary.status.text).toBe('Needs input');
  });

  it('does not duplicate an agent summary through its direct text child', () => {
    const summaryChild = node({ id: 'summary', content: 'One summary' });
    const agent = node({
      id: 'agent',
      type: 'agent',
      agentId: 'a1',
      agentType: 'Explore',
      summaryContent: 'One summary',
      children: [
        summaryChild,
        node({ id: 'nested-tool', type: 'tool', toolName: 'Read' }),
      ],
    });

    const summary = summarizeFinalized([message(agent)], context());

    expect(summary.marks.filter((mark) => mark.kind === 'agent')).toHaveLength(
      1,
    );
    expect(summary.marks.filter((mark) => mark.kind === 'prose')).toHaveLength(
      0,
    );
  });

  it.each([
    ['completed', 'Finished'],
    ['aborted_tools', 'Stopped'],
    ['max_turns', 'Limit reached'],
    ['model_error', 'Needs attention'],
  ] as const)('maps terminal reason %s to %s', (terminalReason, expected) => {
    expect(
      summarizeFinalized([], context({ terminalReason })).status.text,
    ).toBe(expected);
  });

  it.each([
    'prompt_too_long',
    'image_error',
    'model_error',
    'api_error',
    'malformed_tool_use_exhausted',
    'tool_deferred_unavailable',
    'structured_output_retry_exhausted',
    'turn_setup_failed',
  ] as const)(
    'tones only the latest turn prose as an error for %s',
    (terminalReason) => {
      const summary = summarizeFinalized(
        [
          message(node({ id: 'ok-turn', content: 'Plan agreed.' })),
          userMessage(),
          message(
            node({
              id: 'error-turn',
              content: 'API Error: 400 Invalid Messages request',
            }),
          ),
        ],
        context({ terminalReason }),
      );

      const errorMark = summary.marks.find(
        (mark) => mark.id === 'prose:error-turn',
      );
      expect(errorMark?.tone).toBe('error');
      expect(
        summary.marks.find((mark) => mark.id === 'prose:ok-turn')?.tone,
      ).toBe('success');
      // The ERR filter counts marks by this exact tone, so one error tone is
      // one ERR row.
      expect(
        summary.marks.filter((mark) => mark.tone === 'error'),
      ).toHaveLength(1);
      expect(summary.content.kind).toBe('error');
      expect(summary.content.text).toBe(
        'API Error: 400 Invalid Messages request',
      );
      expect(summary.status.tone).toBe('error');
    },
  );

  it.each([
    'completed',
    'aborted_streaming',
    'aborted_tools',
    'blocking_limit',
    'rapid_refill_breaker',
    'max_turns',
    'budget_exhausted',
    'stop_hook_prevented',
    'hook_stopped',
    'tool_deferred',
    'background_requested',
  ] as const)(
    'keeps normal final prose on the success tone for %s',
    (terminalReason) => {
      const summary = summarizeFinalized(
        [message(node({ id: 'done-turn', content: 'All tests passed.' }))],
        context({ terminalReason }),
      );

      expect(
        summary.marks.find((mark) => mark.id === 'prose:done-turn')?.tone,
      ).toBe('success');
      expect(
        summary.marks.filter((mark) => mark.tone === 'error'),
      ).toHaveLength(0);
      expect(summary.content.kind).toBe('prose');
    },
  );

  it.each([undefined, 30])(
    'adds one terminal error when the latest turn has no prose (endTime=%s)',
    (endTime) => {
      const messages = [
        message(
          node({ id: 'ok-turn', content: 'All tests passed.', endTime: 10 }),
        ),
        userMessage(),
        // A failed turn can have a finalized root but no assistant text.
        message(node({ type: 'message', status: 'error', endTime })),
      ];
      const summary = summarizeFinalized(
        messages,
        context({ terminalReason: 'api_error' }),
      );

      expect(
        summary.marks.find((mark) => mark.id === 'prose:ok-turn'),
      ).toMatchObject({ tone: 'success', text: 'All tests passed.' });
      expect(summary.marks.filter((mark) => mark.kind === 'terminal')).toEqual([
        expect.objectContaining({
          tone: 'error',
          label: summary.status.text,
          timestamp: endTime ?? 10,
        }),
      ]);
      expect(
        summary.marks.filter((mark) => mark.tone === 'error'),
      ).toHaveLength(1);
      expect(summary.content).toMatchObject({
        kind: 'error',
        text: 'Needs attention',
      });
      // Recomputing the pure summary neither mutates history nor accumulates rows.
      expect(
        summarizeFinalized(messages, context({ terminalReason: 'api_error' })),
      ).toEqual(summary);
    },
  );

  it('preserves the latest user boundary after bounded history drops older items', () => {
    const earlier = Array.from({ length: 60 }, (_, index) =>
      message(
        node({
          id: `old-${index}`,
          content: 'Earlier success',
          endTime: index,
        }),
      ),
    );
    const summary = summarizeFinalized(
      [...earlier, userMessage()],
      context({ terminalReason: 'api_error' }),
    );

    expect(
      summary.marks
        .filter((mark) => mark.kind === 'prose')
        .every((mark) => mark.tone === 'success'),
    ).toBe(true);
    expect(summary.marks.filter((mark) => mark.tone === 'error')).toHaveLength(
      1,
    );
    expect(
      summary.marks.find((mark) => mark.kind === 'terminal')?.timestamp,
    ).toBe(59);
    expect(summary.content).toMatchObject({
      kind: 'error',
      text: 'Needs attention',
    });
  });

  it('reuses a live terminal mark for a failure without prose', () => {
    const state = createEmptyStreamingState();
    state.events.set('complete', {
      id: 'complete',
      eventType: 'message_complete',
      timestamp: 42,
      messageId: 'message',
    });
    const summary = summarizeLive(
      state,
      context({ terminalReason: 'api_error' }),
    );

    expect(summary.marks).toEqual([
      expect.objectContaining({
        id: 'terminal:message',
        kind: 'terminal',
        tone: 'error',
        timestamp: 42,
        label: 'Needs attention',
      }),
    ]);
    expect(summary.content).toMatchObject({
      kind: 'error',
      text: 'Needs attention',
    });
  });

  it('represents a failure even when no stream or marks are available', () => {
    const summary = summarizeLive(
      null,
      context({ terminalReason: 'turn_setup_failed' }),
    );

    expect(summary.marks).toEqual([
      expect.objectContaining({
        kind: 'terminal',
        tone: 'error',
        timestamp: 0,
      }),
    ]);
    expect(summary.content).toMatchObject({
      kind: 'error',
      text: 'Needs attention',
    });
  });

  it('keeps a null terminal reason in the idle state', () => {
    expect(
      summarizeFinalized([], context({ terminalReason: null })).status,
    ).toMatchObject({ text: 'Idle', icon: '\u25CB', tone: 'idle' });
  });

  it('retains timestamp and text on marks, not just id/kind/tone/label', () => {
    const state = createEmptyStreamingState();
    addToolStart(state, {
      id: 'tool',
      eventType: 'tool_start',
      timestamp: 1234,
      messageId: 'message',
      toolCallId: 'call',
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      isTaskTool: false,
    });
    state.events.set('result', {
      id: 'result',
      eventType: 'tool_result',
      timestamp: 5678,
      messageId: 'message',
      toolCallId: 'call',
      output: 'Exit code 1: 3 test suites failed',
      isError: true,
    });

    const summary = summarizeLive(state, context());
    const mark = summary.marks.find((m) => m.id === 'tool:call');

    expect(mark?.timestamp).toBe(5678);
    expect(mark?.text).toBe('npm test');
    expect(mark?.toolName).toBe('Bash');
    expect(mark?.excerpt).toBe('Exit code 1: 3 test suites failed');
  });

  it('(a) shows prose that follows a failed PowerShell call, not the error', () => {
    const summary = summarizeFinalized(
      [
        message(
          node({
            id: 'root',
            type: 'message',
            children: [
              toolNode({
                id: 'bash',
                status: 'error',
                toolInput: { command: '$a - $b' },
                error: POWERSHELL_ERROR,
                endTime: 1,
              }),
              node({
                id: 'reply',
                content: '## Fixed\n\n- used `Compare-Object` instead',
                endTime: 2,
              }),
            ],
          }),
        ),
      ],
      context({ terminalReason: 'completed' }),
    );

    expect(summary.content).toMatchObject({
      kind: 'prose',
      format: 'markdown',
      text: '## Fixed\n\n- used `Compare-Object` instead',
    });
    expect(summary.status.text).toBe('Finished');
    expect(summary.status.tone).not.toBe('error');
  });

  it('(a) does not report Failed for a recovered error without a terminal reason', () => {
    const summary = summarizeFinalized(
      [
        message(
          node({
            id: 'root',
            type: 'message',
            children: [
              toolNode({ id: 'bash', status: 'error', error: 'boom' }),
              node({ id: 'reply', content: 'Recovered.' }),
            ],
          }),
        ),
      ],
      context(),
    );

    expect(summary.content.kind).toBe('prose');
    expect(summary.status.text).not.toBe('Failed');
    expect(summary.status.tone).not.toBe('error');
  });

  it('(b) shows an unanswered live tool failure as a bounded, redacted snippet', () => {
    const state = createEmptyStreamingState();
    const start: ToolStartEvent = {
      id: 'start',
      eventType: 'tool_start',
      timestamp: 1,
      messageId: 'message',
      toolCallId: 'call',
      toolName: 'Bash',
      toolInput: { command: '$a - $b' },
      isTaskTool: false,
    };
    const result: ToolResultEvent = {
      id: 'result',
      eventType: 'tool_result',
      timestamp: 2,
      messageId: 'message',
      toolCallId: 'call',
      output: POWERSHELL_ERROR,
      isError: true,
    };
    addToolStart(state, start);
    state.events.set(result.id, result);

    const summary = summarizeLive(state, context());

    expect(summary.content.kind).toBe('error');
    expect(summary.content.format).toBe('snippet');
    expect(summary.content.text.split('\n').length).toBeLessThanOrEqual(8);
    expect(summary.content.text.length).toBeLessThanOrEqual(600);
    expect(summary.content.text).toContain('op_Subtraction');
    expect(summary.content.text).not.toContain('line 9');
    expect(summary.content.text).not.toContain('alice');
  });

  it('(b) cuts a long single-line error at 600 characters', () => {
    expect(summarizeToolError('e'.repeat(5000))).toHaveLength(600);
  });

  it('(b) shows a finalized unanswered failure as a snippet and reports Failed', () => {
    const summary = summarizeFinalized(
      [message(toolNode({ id: 'bash', status: 'error', error: 'boom' }))],
      context(),
    );

    expect(summary.content).toMatchObject({
      kind: 'error',
      format: 'snippet',
      text: 'boom',
    });
    expect(summary.status.text).toBe('Failed');
  });

  it('(c) does not show an error once a later tool succeeded', () => {
    const summary = summarizeFinalized(
      [
        message(
          node({
            id: 'root',
            type: 'message',
            children: [
              toolNode({ id: 'bad', status: 'error', error: 'boom' }),
              toolNode({
                id: 'good',
                toolName: 'Read',
                toolInput: {
                  file_path: 'C:\\Users\\alice\\work\\ptah\\src\\a.ts',
                },
                toolOutput: 'file body',
              }),
            ],
          }),
        ),
      ],
      context(),
    );

    expect(summary.content.kind).not.toBe('error');
    expect(summary.content.text).not.toContain('boom');
    expect(summary.status.text).not.toBe('Failed');
  });

  it('(d) never puts a successful tool output in a mark', () => {
    const state = createEmptyStreamingState();
    const start: ToolStartEvent = {
      id: 'start',
      eventType: 'tool_start',
      timestamp: 1,
      messageId: 'message',
      toolCallId: 'call',
      toolName: 'Read',
      toolInput: {
        file_path: 'C:\\Users\\alice\\work\\ptah\\src\\app\\main.ts',
      },
      isTaskTool: false,
    };
    const result: ToolResultEvent = {
      id: 'result',
      eventType: 'tool_result',
      timestamp: 2,
      messageId: 'message',
      toolCallId: 'call',
      output: 'export const SECRET_FILE_BODY = 1;\n'.repeat(20),
      isError: false,
    };
    addToolStart(state, start);
    state.events.set(result.id, result);

    const summary = summarizeLive(state, context());

    expect(summary.marks).toEqual([
      expect.objectContaining({
        id: 'tool:call',
        label: 'Read completed',
        text: '.../app/main.ts',
        toolName: 'Read',
        excerpt: undefined,
      }),
    ]);
    expect(JSON.stringify(summary)).not.toContain('SECRET_FILE_BODY');
  });

  it('(e) sets toolName on tool marks only, keeping the raw name', () => {
    const summary = summarizeFinalized(
      [
        message(
          node({
            id: 'root',
            type: 'message',
            children: [
              toolNode({
                id: 'mcp',
                toolName: 'mcp__ptah__workspace_analyze',
                toolInput: {},
              }),
              node({ id: 'reply', content: 'Done.' }),
            ],
          }),
        ),
      ],
      context(),
    );

    expect(summary.marks.find((mark) => mark.kind === 'tool')?.toolName).toBe(
      'mcp__ptah__workspace_analyze',
    );
    expect(
      summary.marks.find((mark) => mark.kind === 'prose')?.toolName,
    ).toBeUndefined();
  });

  it('leaves text undefined on a mark with no detail beyond its label', () => {
    const summary = summarizeLive(
      (() => {
        const state = createEmptyStreamingState();
        state.events.set('complete', {
          id: 'complete',
          eventType: 'message_complete',
          timestamp: 42,
          messageId: 'message',
        });
        return state;
      })(),
      context(),
    );
    const mark = summary.marks.find((m) => m.id === 'terminal:message');

    expect(mark?.timestamp).toBe(42);
    expect(mark?.text).toBeUndefined();
  });

  it('does not show a completed agent child failure as the recap or as Failed', () => {
    const agent = node({
      id: 'agent',
      type: 'agent',
      agentId: 'a1',
      agentType: 'Explore',
      summaryContent: 'Found the logger.',
      endTime: 3,
      children: [
        toolNode({
          id: 'child-bash',
          status: 'error',
          error: 'boom',
          endTime: 2,
        }),
      ],
    });

    const summary = summarizeFinalized([message(agent)], context());

    expect(summary.content.kind).not.toBe('error');
    expect(summary.content.text).not.toContain('boom');
    expect(summary.content.text).toBe('Found the logger.');
    expect(summary.status.text).not.toBe('Failed');
  });

  it('shows a failed agent as a bounded plain snippet, not markdown', () => {
    const agent = node({
      id: 'agent',
      type: 'agent',
      agentId: 'a1',
      agentType: 'Explore',
      status: 'error',
      summaryContent: '## Failed\n\n' + 'x'.repeat(2000),
    });

    const summary = summarizeFinalized([message(agent)], context());

    expect(summary.content).toMatchObject({ kind: 'error', format: 'snippet' });
    expect(summary.content.text.startsWith('## Failed')).toBe(true);
    expect(summary.content.text.length).toBeLessThanOrEqual(600);
    expect(summary.status.text).toBe('Failed');
  });

  it('names a Bash row by its description, as the normal view does', () => {
    const summary = summarizeFinalized(
      [
        message(
          toolNode({
            id: 'bash',
            toolInput: {
              command: 'npm test -- --ci',
              description: 'Run tests',
            },
          }),
        ),
      ],
      context(),
    );

    expect(summary.marks.find((mark) => mark.kind === 'tool')?.text).toBe(
      'Run tests',
    );
  });

  it('reads a live tool target from the streamed input when the start has none', () => {
    const state = createEmptyStreamingState();
    addToolStart(state, {
      id: 'start',
      eventType: 'tool_start',
      timestamp: 1,
      messageId: 'message',
      toolCallId: 'call',
      toolName: 'Read',
      isTaskTool: false,
    });
    state.toolInputAccumulators.set(
      'call-input',
      JSON.stringify({
        file_path: 'C:\\Users\\alice\\work\\ptah\\src\\app\\a.ts',
      }),
    );

    expect(summarizeLive(state, context()).marks[0].text).toBe('.../app/a.ts');

    state.toolInputAccumulators.set('call-input', '{"file_pa');
    expect(summarizeLive(state, context()).marks[0].text).toBe('Read');
  });

  it('serializes only a bounded prefix of a large failed object output', () => {
    const state = createEmptyStreamingState();
    const rows = Array.from({ length: 100_000 }, (_, index) => ({ index }));
    const stringify = jest.spyOn(JSON, 'stringify');
    state.events.set('result', {
      id: 'result',
      eventType: 'tool_result',
      timestamp: 1,
      messageId: 'message',
      toolCallId: 'tool',
      output: { rows },
      isError: true,
    });

    const text = summarizeLive(state, context()).content.text;
    const calls = stringify.mock.calls.length;
    stringify.mockRestore();

    expect(text).toBe(JSON.stringify({ rows }).slice(0, 600));
    // Keys only: the output itself is never stringified whole.
    expect(calls).toBeLessThan(200);
  });

  it('uses exact status glyphs for compaction and completed turns', () => {
    expect(
      summarizeFinalized([], context({ compaction: { inFlight: true } })).status
        .icon,
    ).toBe('\u21BB');
    expect(
      summarizeFinalized([], context({ terminalReason: 'completed' })).status
        .icon,
    ).toBe('\u2713');
  });
});

describe('summarizeLive cost per publish', () => {
  type State = ReturnType<typeof createEmptyStreamingState>;

  /** Appends `count` deltas to a block and sets its accumulated text. */
  function streamBlock(
    state: State,
    messageId: string,
    blockIndex: number,
    text: string,
    timestamps: readonly number[],
  ): void {
    for (const timestamp of timestamps) {
      const id = `${messageId}-${blockIndex}-delta-${timestamp}`;
      state.events.set(id, {
        id,
        eventType: 'text_delta',
        timestamp,
        messageId,
        blockIndex,
        delta: 'x',
      });
    }
    state.textAccumulators.set(`${messageId}-block-${blockIndex}`, text);
  }

  function range(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  }

  let replaceAll: jest.SpyInstance;

  beforeEach(() => {
    replaceAll = jest.spyOn(String.prototype, 'replaceAll');
  });

  afterEach(() => {
    replaceAll.mockRestore();
  });

  it('builds one mark per block and tool, stamped with the last event', () => {
    const state = createEmptyStreamingState();
    streamBlock(
      state,
      'parity-msg',
      0,
      'Block zero mentions C:\\Users\\alice\\work\\ptah\\src\\a.ts done',
      range(1, 100),
    );
    addToolStart(state, {
      id: 'parity-start',
      eventType: 'tool_start',
      timestamp: 50,
      messageId: 'parity-msg',
      toolCallId: 'parity-call',
      toolName: 'Read',
      toolInput: { file_path: 'C:\\Users\\alice\\work\\ptah\\src\\app\\a.ts' },
      isTaskTool: false,
    });
    streamBlock(
      state,
      'parity-msg',
      1,
      'Block one at /home/bob/x/y.md',
      range(101, 150),
    );
    state.events.set('parity-result', {
      id: 'parity-result',
      eventType: 'tool_result',
      timestamp: 160,
      messageId: 'parity-msg',
      toolCallId: 'parity-call',
      output: 'file body',
      isError: false,
    });

    expect(summarizeLive(state, context()).marks).toEqual([
      {
        id: 'parity-msg:prose:0',
        kind: 'prose',
        tone: 'live',
        label: 'Assistant response',
        timestamp: 100,
        text: 'Block zero mentions ptah\\src\\a.ts done',
      },
      {
        id: 'parity-msg:prose:1',
        kind: 'prose',
        tone: 'live',
        label: 'Assistant response',
        timestamp: 150,
        text: 'Block one at y.md',
      },
      {
        id: 'tool:parity-call',
        kind: 'tool',
        tone: 'success',
        label: 'Read completed',
        timestamp: 160,
        text: '.../app/a.ts',
        toolName: 'Read',
      },
    ]);
  });

  it('redacts a block once per change, not once per delta', () => {
    const state = createEmptyStreamingState();
    streamBlock(
      state,
      'linear-msg',
      0,
      'Edited C:\\Users\\alice\\work\\ptah\\src\\a.ts',
      range(1, 200),
    );

    summarizeLive(state, context());
    // One redaction: two workspace replacements.
    expect(replaceAll).toHaveBeenCalledTimes(2);

    replaceAll.mockClear();
    summarizeLive(state, context());
    expect(replaceAll).not.toHaveBeenCalled();

    streamBlock(
      state,
      'linear-msg',
      0,
      'Edited C:\\Users\\alice\\work\\ptah\\src\\a.ts and more',
      [201],
    );
    const summary = summarizeLive(state, context());
    expect(replaceAll).toHaveBeenCalledTimes(2);
    expect(summary.marks[0].text).toBe('Edited ptah\\src\\a.ts and more');
  });

  it('redacts a path that was split across two deltas', () => {
    const state = createEmptyStreamingState();
    streamBlock(state, 'split-msg', 0, 'see C:\\Users\\a', [1]);
    summarizeLive(state, context());

    streamBlock(state, 'split-msg', 0, 'see C:\\Users\\abd\\x.ts', [2]);
    const text = summarizeLive(state, context()).marks[0].text ?? '';

    expect(text).toBe('see x.ts');
    expect(text).not.toContain('C:\\');
    expect(text).not.toContain('Users');
  });

  it('redacts a block again when the workspace changes', () => {
    const state = createEmptyStreamingState();
    streamBlock(
      state,
      'workspace-msg',
      0,
      'Open C:\\Users\\alice\\work\\ptah\\README.md',
      [1],
    );

    const first = summarizeLive(state, context()).marks[0].text;
    replaceAll.mockClear();
    const second = summarizeLive(
      state,
      context({ workspacePath: 'D:\\elsewhere\\repo' }),
    ).marks[0].text;

    expect(first).toBe('Open ptah\\README.md');
    expect(second).toBe('Open README.md');
    expect(replaceAll).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest 48 items in ascending (timestamp, id) order', () => {
    const state = createEmptyStreamingState();
    const ids: { id: string; timestamp: number }[] = [];
    // Inserted out of order, with two items per timestamp so the id breaks ties.
    for (let step = 0; step < 60; step += 1) {
      const index = (step * 37) % 60;
      const timestamp = Math.floor(index / 2);
      state.events.set(`agent-event-${index}`, {
        id: `agent-event-${index}`,
        eventType: 'agent_start',
        timestamp,
        messageId: 'topk-msg',
        toolCallId: `topk-call-${index}`,
        agentType: 'reviewer',
        agentId: `topk-${index}`,
      });
      ids.push({ id: `agent:topk-${index}`, timestamp });
    }
    const expected = ids
      .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
      .slice(-48);

    const summary = summarizeLive(state, context({ metrics: {} }));

    expect(summary.metrics.agentCount).toBe(48);
    expect(summary.marks.map((mark) => mark.id)).toEqual(
      expected.slice(-24).map((item) => item.id),
    );
  });

  it('redacts only the newest items, however many blocks the stream holds', () => {
    const state = createEmptyStreamingState();
    for (let block = 0; block < 100; block += 1) {
      streamBlock(state, 'many-msg', block, `Block ${block}`, [block]);
    }

    summarizeLive(state, context());

    // 48 kept blocks, two workspace replacements each.
    expect(replaceAll).toHaveBeenCalledTimes(96);
  });

  it('evicts old blocks and redacts them again when they come back', () => {
    for (let block = 0; block < 300; block += 1) {
      const state = createEmptyStreamingState();
      streamBlock(state, `lru-${block}`, 0, `Block ${block}`, [1]);
      summarizeLive(state, context());
    }
    const first = createEmptyStreamingState();
    streamBlock(first, 'lru-0', 0, 'Block 0', [1]);
    replaceAll.mockClear();

    expect(summarizeLive(first, context()).marks[0].text).toBe('Block 0');
    expect(replaceAll).toHaveBeenCalledTimes(2);
  });

  it('parses a streamed tool input once until it changes', () => {
    const state = createEmptyStreamingState();
    addToolStart(state, {
      id: 'parse-start',
      eventType: 'tool_start',
      timestamp: 1,
      messageId: 'parse-msg',
      toolCallId: 'parse-call',
      toolName: 'Read',
      isTaskTool: false,
    });
    state.toolInputAccumulators.set(
      'parse-call-input',
      JSON.stringify({ file_path: 'C:\\Users\\alice\\work\\ptah\\src\\a.ts' }),
    );
    const parse = jest.spyOn(JSON, 'parse');
    try {
      expect(summarizeLive(state, context()).marks[0].text).toBe(
        '.../src/a.ts',
      );
      expect(parse).toHaveBeenCalledTimes(1);

      summarizeLive(state, context());
      expect(parse).toHaveBeenCalledTimes(1);

      state.toolInputAccumulators.set(
        'parse-call-input',
        JSON.stringify({
          file_path: 'C:\\Users\\alice\\work\\ptah\\src\\b.ts',
        }),
      );
      expect(summarizeLive(state, context()).marks[0].text).toBe(
        '.../src/b.ts',
      );
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      parse.mockRestore();
    }
  });

  it('recovers the target once a malformed streamed input becomes valid', () => {
    const state = createEmptyStreamingState();
    addToolStart(state, {
      id: 'recover-start',
      eventType: 'tool_start',
      timestamp: 1,
      messageId: 'recover-msg',
      toolCallId: 'recover-call',
      toolName: 'Read',
      isTaskTool: false,
    });
    state.toolInputAccumulators.set('recover-call-input', '{"file_pa');
    expect(summarizeLive(state, context()).marks[0].text).toBe('Read');
    // The same partial input stays a fallback, not a cached success.
    expect(summarizeLive(state, context()).marks[0].text).toBe('Read');

    state.toolInputAccumulators.set(
      'recover-call-input',
      JSON.stringify({ file_path: 'C:\\Users\\alice\\work\\ptah\\src\\c.ts' }),
    );
    expect(summarizeLive(state, context()).marks[0].text).toBe('.../src/c.ts');
  });

  it.each([
    [48, 48],
    [49, 48],
  ])('keeps exactly 48 of %i live items', (count, kept) => {
    const state = createEmptyStreamingState();
    for (let index = 0; index < count; index += 1) {
      state.events.set(`exact-${count}-${index}`, {
        id: `exact-${count}-${index}`,
        eventType: 'agent_start',
        timestamp: index,
        messageId: `exact-${count}-msg`,
        toolCallId: `exact-${count}-call-${index}`,
        agentType: 'reviewer',
        agentId: `exact-${count}-${index}`,
      });
    }

    const summary = summarizeLive(state, context({ metrics: {} }));

    expect(summary.metrics.agentCount).toBe(kept);
    expect(summary.marks.map((mark) => mark.id)).toEqual(
      range(count - 24, count - 1).map(
        (index) => `agent:exact-${count}-${index}`,
      ),
    );
  });

  it('does not retain a block over the per-entry size cap', () => {
    const small = createEmptyStreamingState();
    streamBlock(small, 'cap-small', 0, 'Small block', [1]);
    summarizeLive(small, context());

    const large = createEmptyStreamingState();
    const text = `${'x'.repeat(40_000)} C:\\Users\\alice\\secret\\big.ts`;
    streamBlock(large, 'cap-large', 0, text, [1]);
    replaceAll.mockClear();

    const first = summarizeLive(large, context()).marks[0].text ?? '';
    const second = summarizeLive(large, context()).marks[0].text ?? '';

    // Not cached: both calls redact it.
    expect(replaceAll).toHaveBeenCalledTimes(4);
    expect(second).toBe(first);
    expect(first.endsWith(' big.ts')).toBe(true);
    expect(first).not.toContain('Users');

    // The skipped block did not push the small one out.
    replaceAll.mockClear();
    summarizeLive(small, context());
    expect(replaceAll).not.toHaveBeenCalled();
  });

  it('evicts the oldest blocks once the retained-size budget is exceeded', () => {
    // 20 blocks of about 30K characters keep about 60K each (raw plus
    // redacted), over the 1M budget, so the oldest ones are dropped.
    const states = range(0, 19).map((block) => {
      const state = createEmptyStreamingState();
      streamBlock(
        state,
        `budget-${block}`,
        0,
        `${'y'.repeat(30_000)} ${block}`,
        [1],
      );
      summarizeLive(state, context());
      return state;
    });

    replaceAll.mockClear();
    summarizeLive(states[19], context());
    expect(replaceAll).not.toHaveBeenCalled();

    summarizeLive(states[0], context());
    expect(replaceAll).toHaveBeenCalledTimes(2);
  });
});
