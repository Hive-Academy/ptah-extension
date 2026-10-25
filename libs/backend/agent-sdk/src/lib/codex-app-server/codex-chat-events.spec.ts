import type { CodexRuntimeEvent } from '@ptah-extension/codex-runtime';
import { CodexChatEvents } from './codex-chat-events';

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
  it('keeps final text as replacement content without fabricated deltas', () => {
    const { projection, callbacks } = setup();
    expect(
      projection.map({
        ...identity,
        sequence: 1,
        type: 'textFinal',
        itemId: 'a',
        text: 'final only',
      }),
    ).toEqual([]);
    expect(callbacks.content).toHaveBeenCalledWith({
      itemId: 'a',
      text: 'final only',
      kind: 'text',
      blockIndex: 0,
    });
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
      })[0],
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
        toolName: 'shell',
        input: { command: 'pwd' },
      })[0],
    ).toMatchObject({ toolCallId: 'stable', toolInput: { command: 'pwd' } });
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
