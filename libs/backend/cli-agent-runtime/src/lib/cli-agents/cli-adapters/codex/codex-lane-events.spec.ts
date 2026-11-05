import { CODEX_DENIED_TOOL_RESULT_TEXT, presentCodexTool } from '@ptah-extension/codex-runtime';
import type { CodexRuntimeEvent } from '@ptah-extension/codex-runtime';
import { CodexLaneEvents } from './codex-lane-events';

const identity = {
  contextId: 'lane',
  processGeneration: 1,
  threadId: 'thread',
  turnId: 'turn',
};
type Payload = CodexRuntimeEvent extends infer E
  ? E extends CodexRuntimeEvent
    ? Omit<E, keyof typeof identity | 'sequence'>
    : never
  : never;

function mapper() {
  const events = new CodexLaneEvents(identity);
  let sequence = 0;
  return (payload: Payload) =>
    events.map({ ...identity, sequence: ++sequence, ...payload });
}

describe('CodexLaneEvents', () => {
  it('renders async questions as ordinary text for lane users', () => {
    const map = mapper();
    expect(map({ type: 'userInputAsync', itemId: 'question', text: 'Choose one',
      questions: [{ title: 'Which?', options: ['A'] }],
    }).segments).toEqual([{ type: 'text', content: 'Choose one', messageId: 'question' }]);
  });
  it('preserves ordered partial text and emits only a missing final suffix', () => {
    const map = mapper();
    expect(
      map({ type: 'textDelta', itemId: 'a', delta: 'Hello' }).segments,
    ).toEqual([{ type: 'text', content: 'Hello', messageId: 'a' }]);
    expect(
      map({ type: 'textDelta', itemId: 'b', delta: 'Other' }).segments[0]
        ?.content,
    ).toBe('Other');
    expect(
      map({ type: 'textFinal', itemId: 'a', text: 'Hello world' }).segments[0]
        ?.content,
    ).toBe(' world');
    expect(
      map({ type: 'textFinal', itemId: 'a', text: 'Hello world' }).segments,
    ).toEqual([]);
    expect(
      map({ type: 'textFinal', itemId: 'c', text: 'Final only' }).segments[0]
        ?.content,
    ).toBe('Final only');
  });

  it('maps reasoning separately and retains a final that differs from partial content', () => {
    const map = mapper();
    expect(
      map({ type: 'reasoning', itemId: 'a', text: 'Think', phase: 'delta' })
        .segments,
    ).toEqual([{ type: 'thinking', content: 'Think', messageId: 'a' }]);
    expect(
      map({ type: 'reasoning', itemId: 'a', text: 'Think', phase: 'final' })
        .segments,
    ).toEqual([]);
    expect(
      map({ type: 'textDelta', itemId: 'a', delta: 'draft' }).segments[0]?.type,
    ).toBe('text');
    expect(
      map({ type: 'textFinal', itemId: 'a', text: 'replacement' }).segments[0]
        ?.content,
    ).toBe('replacement');
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'links %s tool results by stable id',
    (status) => {
      const map = mapper();
      expect(
        map({
          type: 'toolStarted',
          toolId: 'tool-1',
          toolName: 'read',
          input: { path: '/file' },
        }).segments[0],
      ).toMatchObject({
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'read',
        toolInput: { path: '/file' },
      });
      expect(
        map({
          type: 'toolCompleted',
          toolId: 'tool-1',
          status,
          output: 'result',
        }).segments[0],
      ).toEqual({
        type: status === 'failed' ? 'tool-result-error' : 'tool-result',
        content: status === 'cancelled' ? CODEX_DENIED_TOOL_RESULT_TEXT : 'result',
        toolCallId: 'tool-1',
        toolName: 'read',
      });
    },
  );

  it('does not invent a tool name for a completion without a start', () => {
    const map = mapper();
    expect(
      map({
        type: 'toolCompleted',
        toolId: 'unknown',
        status: 'completed',
        output: { ok: true },
      }).segments[0],
    ).not.toHaveProperty('toolName');
    expect(
      map({ type: 'toolStarted', toolId: 'x', toolName: 'tool', input: null })
        .segments[0],
    ).not.toHaveProperty('toolInput');
  });

  it('shows an MCP failure message when the result is absent', () => {
    const map = mapper();
    map({
      type: 'toolStarted',
      toolId: 'mcp-1',
      toolName: 'ptah/ptah_agent_report',
      input: {},
    });
    expect(map({
      type: 'toolCompleted',
      toolId: 'mcp-1',
      status: 'failed',
      output: null,
      errorText: 'MCP tool call requires approval, but approval policy is never',
    }).segments).toEqual([{
      type: 'tool-result-error',
      content: 'MCP tool call requires approval, but approval policy is never',
      toolCallId: 'mcp-1',
      toolName: 'mcp__ptah__ptah_agent_report',
    }]);
  });

  it('uses a fixed failure message when an MCP result and error text are absent', () => {
    const map = mapper();
    map({
      type: 'toolStarted',
      toolId: 'mcp-2',
      toolName: 'ptah/ptah_agent_message',
      input: {},
    });
    expect(map({
      type: 'toolCompleted',
      toolId: 'mcp-2',
      status: 'failed',
      output: null,
    }).segments).toEqual([{
      type: 'tool-result-error',
      content: 'Tool call failed',
      toolCallId: 'mcp-2',
      toolName: 'mcp__ptah__ptah_agent_message',
    }]);
  });

  it('presents command failures by exit code and file additions as Write', () => {
    const map = mapper();
    const started = map({ type: 'toolStarted', toolId: 'command', toolName: 'commandExecution', input: { command: 'cmd.exe /c rg -n test' } }).segments[0];
    expect(started).toMatchObject({ toolName: 'Bash', toolInput: { command: 'rg -n test' } });
    expect(started?.toolInput).not.toHaveProperty('raw_command');
    // The raw wrapped command stays in toolArgs for the trace.
    expect(started?.toolArgs).toBe(JSON.stringify({ command: 'cmd.exe /c rg -n test' }));
    expect(map({ type: 'toolCompleted', toolId: 'command', status: 'completed', output: 'oops', exitCode: 2 }).segments[0]).toMatchObject({ type: 'tool-result-error', content: 'oops\nCommand failed with exit code 2' });
    expect(map({ type: 'toolStarted', toolId: 'file', toolName: 'fileChange', input: { changes: [{ path: '/new', kind: { type: 'add' } }] } }).segments[0]).toMatchObject({ toolName: 'Write' });
    expect(map({ type: 'toolCompleted', toolId: 'file', status: 'completed', output: null }).segments[0]).toMatchObject({ toolName: 'Write' });
    expect(map({ type: 'file', itemId: 'file', path: '/new', operation: 'add' }).segments[0]).toMatchObject({ type: 'file-change', toolCallId: 'file' });
  });

  it('keeps separate message identities for adjacent items', () => {
    const map = mapper();
    expect(map({ type: 'textDelta', itemId: 'first', delta: 'A' }).segments[0]?.messageId).toBe('first');
    expect(map({ type: 'textFinal', itemId: 'first', text: 'AB' }).segments[0]?.messageId).toBe('first');
    expect(map({ type: 'textDelta', itemId: 'second', delta: 'C' }).segments[0]?.messageId).toBe('second');
    expect(map({ type: 'reasoning', itemId: 'thought', text: 'think', phase: 'delta' }).segments[0]?.messageId).toBe('thought');
  });

  it('emits only the latest reported usage once at terminal', () => {
    const map = mapper();
    expect(map({ type: 'usage', usage: { inputTokens: 5 } }).segments).toEqual(
      [],
    );
    expect(
      map({
        type: 'usage',
        usage: {
          inputTokens: 10,
          cachedInputTokens: 4,
          outputTokens: 2,
          totalTokens: 12,
        },
      }).segments,
    ).toEqual([]);
    expect(map({ type: 'terminal', status: 'completed' }).segments).toEqual([
      {
        type: 'info',
        content: 'Codex turn usage.',
        usage: {
          inputTokens: 10,
          cacheReadTokens: 4,
          outputTokens: 2,
          totalTokens: 12,
        },
      },
    ]);
  });

  it('carries reported cache-write tokens so an estimate can split input', () => {
    const map = mapper();
    expect(
      map({
        type: 'terminal',
        status: 'completed',
        usage: {
          inputTokens: 10,
          cachedInputTokens: 4,
          cacheWriteInputTokens: 3,
          outputTokens: 2,
        },
      }).segments[0]?.usage,
    ).toEqual({
      inputTokens: 10,
      cacheReadTokens: 4,
      cacheWriteTokens: 3,
      outputTokens: 2,
    });
  });

  it('prefers terminal usage and preserves missing counters and reported zero cost', () => {
    const map = mapper();
    map({ type: 'usage', usage: { inputTokens: 10 } });
    expect(
      map({
        type: 'terminal',
        status: 'completed',
        usage: { outputTokens: 0, costUsd: 0, reasoningOutputTokens: 4 },
      }).segments[0]?.usage,
    ).toEqual({ outputTokens: 0, costUsd: 0 });
  });

  it.each(['completed', 'failed', 'interrupted'] as const)(
    'settles %s immediately, exactly once, without process exit',
    (status) => {
      const map = mapper();
      const result = map({ type: 'terminal', status });
      expect(result.terminal).toBe(status);
      expect(
        result.segments.every((segment) => segment.usage === undefined),
      ).toBe(true);
      expect(map({ type: 'terminal', status })).toEqual({ segments: [] });
      expect(map({ type: 'textDelta', itemId: 'late', delta: 'late' })).toEqual(
        { segments: [] },
      );
    },
  );

  it('never forwards error payloads and deduplicates terminal errors', () => {
    const map = mapper();
    const error = {
      code: 'secret-code',
      message: 'Bearer secret\nraw subprocess output',
      retryable: false,
    };
    expect(map({ type: 'error', error }).segments).toEqual([
      { type: 'error', content: 'Codex reported a runtime error.' },
    ]);
    expect(map({ type: 'terminal', status: 'failed', error })).toEqual({
      segments: [],
      terminal: 'failed',
    });
    expect(
      mapper()({ type: 'terminal', status: 'failed', error }).segments,
    ).toEqual([{ type: 'error', content: 'Codex reported a runtime error.' }]);
  });

  it.each([
    { contextId: 'other' },
    { processGeneration: 2 },
    { threadId: 'other' },
    { turnId: 'other' },
  ])('rejects foreign events %j without consuming the sequence', (foreign) => {
    const events = new CodexLaneEvents(identity);
    expect(
      events.map({
        ...identity,
        ...foreign,
        sequence: 100,
        type: 'terminal',
        status: 'completed',
      }),
    ).toEqual({ segments: [] });
    expect(
      events.map({
        ...identity,
        sequence: 1,
        type: 'terminal',
        status: 'completed',
      }).terminal,
    ).toBe('completed');
  });

  it('rejects replayed sequences', () => {
    const events = new CodexLaneEvents(identity);
    const event = {
      ...identity,
      sequence: 1,
      type: 'textDelta' as const,
      itemId: 'a',
      delta: 'one',
    };
    expect(events.map(event).segments).toHaveLength(1);
    expect(events.map(event).segments).toEqual([]);
  });

  it.each([
    ['add', 'added'],
    ['update', 'modified'],
    ['delete', 'deleted'],
  ] as const)('maps file %s', (operation, changeKind) => {
    expect(
      mapper()({
        type: 'file',
        itemId: 'file',
        path: '/file',
        operation,
        diff: 'diff',
      }).segments,
    ).toEqual([{ type: 'file-change', content: '/file', changeKind, toolCallId: 'file' }]);
  });

  it('represents unsupported image rendering and compaction honestly', () => {
    const map = mapper();
    expect(
      map({
        type: 'image',
        itemId: 'img',
        image: {
          type: 'image',
          data: 'sensitive-image-data',
          mediaType: 'image/png',
        },
      }).segments[0]?.content,
    ).toContain('does not render images');
    expect(map({ type: 'compaction', phase: 'completed' }).segments).toEqual([
      { type: 'info', content: 'Codex compaction completed.' },
    ]);
  });

  it('maps approval lifecycle without disclosing request details', () => {
    const map = mapper();
    const correlation = { ...identity, requestId: 1 };
    const requested = map({
      type: 'approvalRequested',
      request: {
        ...correlation,
        kind: 'command',
        normalizedHome: '/codex',
        workspaceId: 'workspace',
        providerId: 'codex',
        message: 'private request',
        details: { secret: 'private detail' },
      },
    });
    expect(requested.segments).toEqual([
      { type: 'info', content: 'Codex is waiting for approval.' },
    ]);
    expect(
      map({ type: 'approvalSettled', correlation, decision: 'decline' })
        .segments,
    ).toEqual([{ type: 'info', content: 'Codex approval: decline.' }]);
  });
});
