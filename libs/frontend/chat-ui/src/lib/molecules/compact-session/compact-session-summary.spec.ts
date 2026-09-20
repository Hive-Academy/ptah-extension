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

  it('keeps a null terminal reason in the idle state', () => {
    expect(
      summarizeFinalized([], context({ terminalReason: null })).status,
    ).toMatchObject({ text: 'Idle', icon: '\u25CB', tone: 'idle' });
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
