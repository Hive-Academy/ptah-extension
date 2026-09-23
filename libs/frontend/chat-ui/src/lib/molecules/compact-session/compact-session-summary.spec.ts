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

function summarizeToolOutput(output: string): string {
  const state = createEmptyStreamingState();
  state.events.set('result', {
    id: 'result',
    eventType: 'tool_result',
    timestamp: 1,
    messageId: 'message',
    toolCallId: 'tool',
    output,
    isError: false,
  });

  return summarizeLive(state, context()).content.text;
}

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
      state.events.set(start.id, start);
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
    expect(summary.content.text).toBe('ok');
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

    expect(summary.content.text).toContain('Running');
    expect(summary.content.text).toContain('token.txt');
    expect(summary.content.text).not.toContain('Users');
    expect(summary.content.text).not.toContain('alice');
  });

  it('redacts Windows and POSIX absolute paths without changing plain text', () => {
    expect(
      summarizeToolOutput('Opened D:\\projects\\private\\report.txt'),
    ).toBe('Opened report.txt');
    expect(summarizeToolOutput('Opened /home/alice/private/report.txt')).toBe(
      'Opened report.txt',
    );
    expect(summarizeToolOutput('No absolute path here')).toBe(
      'No absolute path here',
    );
  });

  it('rejects a long non-matching Windows path candidate in under one second', () => {
    const subject = `C:\\${'\\'.repeat(200)}`;
    const startedAt = performance.now();

    expect(summarizeToolOutput(subject)).toBe(subject);
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
    state.events.set('tool', {
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
    expect(mark?.text).toBe('Exit code 1: 3 test suites failed');
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
