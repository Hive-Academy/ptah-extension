import type { CodexRuntimeEvent } from '@ptah-extension/codex-runtime';
import { CodexChatEvents, tokenUsage } from './codex-chat-events';
import { CODEX_DENIED_TOOL_RESULT_TEXT } from './codex-tool-presentation';

const identity = {
  contextId: 'context',
  processGeneration: 2,
  threadId: 'thread',
  turnId: 'turn',
};
function setup() {
  const callbacks = {
    result: jest.fn(),
    content: jest.fn(),
    live: jest.fn(),
    compaction: jest.fn(),
    error: jest.fn(),
  };
  return {
    callbacks,
    projection: new CodexChatEvents('session', identity, callbacks, () => 10),
  };
}
describe('CodexChatEvents', () => {
  it('keeps delta-only text at block one after reasoning and does not republish it at terminal', async () => {
    const { projection, callbacks } = setup();
    projection.map({ ...identity, sequence: 1, type: 'reasoning', phase: 'delta', itemId: 'r', text: 'thinking' });
    expect(projection.map({ ...identity, sequence: 2, type: 'textDelta', itemId: 'a', delta: 'answer' }))
      .toEqual([expect.objectContaining({ eventType: 'text_delta', blockIndex: 1, delta: 'answer' })]);
    expect(projection.map({ ...identity, sequence: 3, type: 'terminal', status: 'completed' }))
      .toEqual([expect.objectContaining({ eventType: 'message_complete' })]);
    await projection.settled();
    expect(callbacks.content).not.toHaveBeenCalled();
    expect(callbacks.result).toHaveBeenCalledWith({ status: 'completed', text: 'answer' });
  });
  it('awaits a corrected final text at the original text block after reasoning', async () => {
    const { projection, callbacks } = setup();
    let release: (() => void) | undefined;
    callbacks.content.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    projection.map({ ...identity, sequence: 1, type: 'reasoning', phase: 'delta', itemId: 'r', text: 'thinking' });
    projection.map({ ...identity, sequence: 2, type: 'textDelta', itemId: 'a', delta: 'old' });
    expect(projection.map({ ...identity, sequence: 3, type: 'textFinal', itemId: 'a', text: 'corrected' })).toEqual([]);
    expect(callbacks.content).toHaveBeenCalledWith({ itemId: 'a', kind: 'text', blockIndex: 1, text: 'corrected' });
    let settled = false;
    const wait = projection.settled().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release?.();
    await wait;
    expect(settled).toBe(true);
  });
  it('does not create an empty text block at terminal', () => {
    const { projection, callbacks } = setup();
    expect(projection.map({ ...identity, sequence: 1, type: 'terminal', status: 'completed' }).map(event => event.eventType))
      .toEqual(['message_start', 'message_complete']);
    expect(callbacks.content).not.toHaveBeenCalled();
  });

  it('streams final-only text after message_start', () => {
    const { projection, callbacks } = setup();
    expect(
      projection.map({
        ...identity,
        sequence: 1,
        type: 'textFinal',
        itemId: 'a',
        text: 'final only',
      }),
    ).toEqual([
      expect.objectContaining({
        eventType: 'message_start',
        role: 'assistant',
      }),
      expect.objectContaining({ eventType: 'text_delta', delta: 'final only' }),
    ]);
    expect(callbacks.content).not.toHaveBeenCalled();
    projection.map({
      ...identity,
      sequence: 2,
      type: 'terminal',
      status: 'completed',
    });
    expect(callbacks.result).toHaveBeenCalledWith({
      status: 'completed',
      text: 'final only',
    });
  });
  it('reconciles streamed text and keeps distinct block indexes', () => {
    const { projection, callbacks } = setup();
    expect(
      projection.map({
        ...identity,
        sequence: 1,
        type: 'textDelta',
        itemId: 'a',
        delta: 'old',
      })[1],
    ).toMatchObject({
      eventType: 'text_delta',
      delta: 'old',
      blockIndex: 0,
      sessionId: 'session',
    });
    expect(
      projection.map({
        ...identity,
        sequence: 2,
        type: 'reasoning',
        phase: 'delta',
        itemId: 'a',
        text: 'think',
      })[0],
    ).toMatchObject({ eventType: 'thinking_delta', blockIndex: 1 });
    projection.map({
      ...identity,
      sequence: 3,
      type: 'textFinal',
      itemId: 'a',
      text: 'corrected',
    });
    projection.map({
      ...identity,
      sequence: 4,
      type: 'terminal',
      status: 'completed',
    });
    expect(callbacks.result).toHaveBeenCalledWith({
      status: 'completed',
      text: 'corrected',
    });
  });
  it('preserves stable tool IDs and failed results', () => {
    const { projection } = setup();
    expect(
      projection.map({
        ...identity,
        sequence: 1,
        type: 'toolStarted',
        toolId: 'stable',
        toolName: 'commandExecution',
        input: { command: 'pwd' },
      })[1],
    ).toMatchObject({ toolCallId: 'stable', toolName: 'Bash', toolInput: { command: 'pwd' } });
    expect(
      projection.map({
        ...identity,
        sequence: 2,
        type: 'toolCompleted',
        toolId: 'stable',
        output: 'failed',
        status: 'failed',
      })[0],
    ).toMatchObject({ toolCallId: 'stable', isError: true });
  });
  it('replaces streamed reasoning with the final text and never duplicates it', async () => {
    const { projection, callbacks } = setup();
    expect(
      projection.map({ ...identity, sequence: 1, type: 'reasoning', phase: 'delta', itemId: 'r', text: 'par' })[1],
    ).toMatchObject({ eventType: 'thinking_delta', delta: 'par', blockIndex: 0 });
    expect(
      projection.map({ ...identity, sequence: 2, type: 'reasoning', phase: 'final', itemId: 'r', text: 'partial thought' }),
    ).toEqual([]);
    await projection.settled();
    expect(callbacks.content).toHaveBeenCalledTimes(1);
    expect(callbacks.content).toHaveBeenCalledWith({ itemId: 'r', kind: 'reasoning', text: 'partial thought', blockIndex: 0 });
  });
  it('publishes final reasoning that streamed no deltas', async () => {
    const { projection, callbacks } = setup();
    expect(
      projection.map({ ...identity, sequence: 1, type: 'reasoning', phase: 'final', itemId: 'r', text: 'full thought' }),
    ).toEqual([expect.objectContaining({ eventType: 'message_start' })]);
    await projection.settled();
    expect(callbacks.content).toHaveBeenCalledWith({ itemId: 'r', kind: 'reasoning', text: 'full thought', blockIndex: 0 });
  });
  it('opens no thinking block for an empty reasoning item', async () => {
    const { projection, callbacks } = setup();
    expect(
      projection.map({ ...identity, sequence: 1, type: 'reasoning', phase: 'final', itemId: 'r', text: '' }),
    ).toEqual([expect.objectContaining({ eventType: 'message_start' })]);
    await projection.settled();
    expect(callbacks.content).not.toHaveBeenCalled();
  });
  it('projects a failed command like Claude failed Bash: real output plus exit code', () => {
    const { projection } = setup();
    projection.map({ ...identity, sequence: 1, type: 'toolStarted', toolId: 'c1', toolName: 'commandExecution', input: { command: 'npm test' } });
    expect(
      projection.map({ ...identity, sequence: 2, type: 'toolCompleted', toolId: 'c1', status: 'failed', output: 'boom\n', exitCode: 1 })[0],
    ).toMatchObject({ eventType: 'tool_result', toolCallId: 'c1', output: 'boom\nCommand failed with exit code 1', isError: true });
  });
  it('projects a failed command with no output to the exit-code line only', () => {
    const { projection } = setup();
    projection.map({ ...identity, sequence: 1, type: 'toolStarted', toolId: 'c2', toolName: 'commandExecution', input: { command: 'npm test' } });
    expect(
      projection.map({ ...identity, sequence: 2, type: 'toolCompleted', toolId: 'c2', status: 'failed', output: null, exitCode: 2 })[0],
    ).toMatchObject({ output: 'Command failed with exit code 2', isError: true });
  });
  it('keeps the successful command shape, exit code 0 included', () => {
    const { projection } = setup();
    projection.map({ ...identity, sequence: 1, type: 'toolStarted', toolId: 'c3', toolName: 'commandExecution', input: { command: 'pwd' } });
    expect(
      projection.map({ ...identity, sequence: 2, type: 'toolCompleted', toolId: 'c3', status: 'completed', output: 'ok', exitCode: 0 })[0],
    ).toMatchObject({ output: 'ok', isError: false });
  });
  it('projects a declined command as the Claude denial result', () => {
    const { projection } = setup();
    projection.map({ ...identity, sequence: 1, type: 'toolStarted', toolId: 'c4', toolName: 'commandExecution', input: { command: 'rm -rf build' } });
    expect(
      projection.map({ ...identity, sequence: 2, type: 'toolCompleted', toolId: 'c4', status: 'cancelled', output: null })[0],
    ).toMatchObject({ output: CODEX_DENIED_TOOL_RESULT_TEXT, isError: true });
  });
  it('projects a failed MCP call with the server error text', () => {
    const { projection } = setup();
    projection.map({ ...identity, sequence: 1, type: 'toolStarted', toolId: 'm1', toolName: 'orchestrator/ListAgents', input: {} });
    expect(
      projection.map({ ...identity, sequence: 2, type: 'toolCompleted', toolId: 'm1', status: 'failed', output: { content: [] }, errorText: 'server unreachable' })[0],
    ).toMatchObject({ output: 'server unreachable', isError: true });
  });
  it('reports usage once, ignores foreign and duplicate frames, and settles once', () => {
    const { projection, callbacks } = setup();
    const terminal: CodexRuntimeEvent = {
      ...identity,
      sequence: 4,
      type: 'terminal',
      status: 'interrupted',
      usage: { inputTokens: 4 },
    };
    expect(projection.map({ ...terminal, threadId: 'child' })).toEqual([]);
    projection.map({
      ...identity,
      sequence: 1,
      type: 'usage',
      usage: { inputTokens: 2 },
    });
    projection.map({
      ...identity,
      sequence: 2,
      type: 'usage',
      usage: { inputTokens: 3 },
    });
    expect(projection.map(terminal)[0]).toMatchObject({
      eventType: 'message_complete',
      stopReason: 'interrupted',
    });
    expect(projection.map(terminal)).toEqual([]);
    expect(callbacks.result).toHaveBeenCalledTimes(1);
    expect(callbacks.result).toHaveBeenCalledWith({
      status: 'interrupted',
      text: '',
      usage: { inputTokens: 4 },
    });
  });
  it('does not terminate on errors and never forwards raw diagnostic text', () => {
    const { projection, callbacks } = setup();
    projection.map({
      ...identity,
      sequence: 1,
      type: 'error',
      error: { code: 'secret', message: 'secret', retryable: true },
    });
    expect(callbacks.result).not.toHaveBeenCalled();
    projection.map({
      ...identity,
      sequence: 2,
      type: 'terminal',
      status: 'failed',
    });
    expect(callbacks.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(callbacks.result.mock.calls)).not.toContain('secret');
  });
  it('passes normalized live and compaction events through callbacks', () => {
    const { projection, callbacks } = setup();
    const file: CodexRuntimeEvent = {
      ...identity,
      sequence: 1,
      type: 'file',
      itemId: 'f',
      path: 'a.ts',
      operation: 'update',
    };
    projection.map(file);
    projection.map({
      ...identity,
      sequence: 2,
      type: 'compaction',
      phase: 'completed',
    });
    expect(callbacks.live).toHaveBeenCalledWith(file);
    expect(callbacks.compaction).toHaveBeenCalledWith('completed');
  });
});

it('matches accumulator event order and stable message identity with live usage', () => {
  const { projection } = setup();
  const events = [
    ...projection.map({
      ...identity,
      sequence: 1,
      type: 'textDelta',
      itemId: 'a',
      delta: 'hel',
    }),
    ...projection.map({
      ...identity,
      sequence: 2,
      type: 'textFinal',
      itemId: 'a',
      text: 'hello',
    }),
    ...projection.map({
      ...identity,
      sequence: 3,
      type: 'usage',
      usage: { inputTokens: 4, outputTokens: 2 },
    }),
    ...projection.map({
      ...identity,
      sequence: 4,
      type: 'terminal',
      status: 'completed',
    }),
  ];
  expect(events.map((event) => event.eventType)).toEqual([
    'message_start',
    'text_delta',
    'text_delta',
    'message_delta',
    'message_complete',
  ]);
  expect(new Set(events.map((event) => event.messageId)).size).toBe(1);
  expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  expect(events.at(-1)).toMatchObject({ tokenUsage: { input: 4, output: 2 } });
});

it('projects whole-turn snapshots without summing or double-counting cached and reasoning tokens', () => {
  const { projection } = setup();
  const usage = {
    inputTokens: 12,
    outputTokens: 5,
    cachedInputTokens: 3,
    cacheWriteInputTokens: 2,
    reasoningOutputTokens: 4,
  };
  const expected = { input: 9, output: 5, cacheRead: 3, cacheCreation: 2 };
  for (const sequence of [1, 2]) {
    const events = projection.map({
      ...identity,
      sequence,
      type: 'usage',
      usage,
    });
    expect(events.at(-1)).toMatchObject({
      eventType: 'message_delta',
      tokenUsage: expected,
    });
  }
  expect(
    projection
      .map({ ...identity, sequence: 3, type: 'terminal', status: 'completed' })
      .at(-1),
  ).toMatchObject({ eventType: 'message_complete', tokenUsage: expected });
  expect(
    tokenUsage({ inputTokens: 1, cachedInputTokens: 3, outputTokens: 2 }).input,
  ).toBe(0);
});
