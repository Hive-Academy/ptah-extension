import 'reflect-metadata';
import { MESSAGE_TYPES, SessionId } from '@ptah-extension/shared';
import type {
  CodexApprovalRequest,
  CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import { createCodexChatEventCallbacks } from './codex-chat-event-callbacks';

const sessionId = SessionId.from('11111111-1111-4111-8111-111111111111');
const identity = {
  contextId: 'context',
  processGeneration: 1,
  threadId: sessionId,
  turnId: 'turn',
  sequence: 1,
};
const messageId = JSON.stringify([sessionId, 'turn']);
const request: CodexApprovalRequest = {
  ...identity,
  requestId: 7,
  kind: 'command',
  normalizedHome: '/home',
  workspaceId: '/work',
  providerId: 'openai-codex',
  message: 'Run command?',
  details: { command: 'pwd' },
};

const turn = {
  contextId: 'context',
  processGeneration: 1,
  threadId: sessionId,
  turnId: 'turn',
};

function harness(withTurn = true) {
  const delivery = {
    publish: jest.fn(),
    publishTerminal: jest.fn().mockResolvedValue(undefined),
  };
  const webviewManager = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { error: jest.fn() };
  const callbacks = createCodexChatEventCallbacks({
    sessionId,
    tabId: 'tab',
    turn: withTurn ? turn : undefined,
    delivery,
    webviewManager,
    logger,
    now: () => 123,
  });
  return { delivery, webviewManager, logger, callbacks };
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('Codex chat event callbacks', () => {
  it.each(['text', 'reasoning'] as const)(
    'replaces complete %s in the correct session, turn and block',
    (kind) => {
      const h = harness();
      h.callbacks.content({
        kind,
        itemId: 'item',
        text: 'final',
        blockIndex: 2,
      });
      expect(h.delivery.publish).toHaveBeenCalledWith(
        'tab',
        sessionId,
        expect.objectContaining({
          sessionId,
          messageId,
          source: 'complete',
          eventType: kind === 'text' ? 'text_delta' : 'thinking_delta',
          delta: 'final',
          blockIndex: 2,
        }),
        undefined,
      );
    },
  );
  it('publishes nothing for empty complete content (Claude drops empty deltas)', async () => {
    const h = harness();
    h.callbacks.content({ kind: 'reasoning', itemId: 'r', text: '', blockIndex: 0 });
    h.callbacks.content({ kind: 'text', itemId: 't', text: '', blockIndex: 1 });
    await settle();
    expect(h.delivery.publish).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });
  it.each(['', 'answer'])('does not republish result text %p already owned by the projection', async (text) => {
    const h = harness();
    await h.callbacks.result({ status: 'completed', text });
    expect(h.delivery.publish).not.toHaveBeenCalled();
    expect(h.delivery.publishTerminal).not.toHaveBeenCalled();
  });
  it('preserves final text block indexes instead of concatenating into block zero', async () => {
    const h = harness();
    h.callbacks.content({
      kind: 'text',
      itemId: 'a',
      text: 'first',
      blockIndex: 1,
    });
    h.callbacks.content({
      kind: 'text',
      itemId: 'b',
      text: 'second',
      blockIndex: 3,
    });
    h.delivery.publish.mockClear();
    h.callbacks.result({ status: 'completed', text: 'firstsecond' });
    await settle();
    expect(h.delivery.publish).not.toHaveBeenCalled();
  });
  it('leaves the single compaction start to the adapter callback', async () => {
    const h = harness();
    h.callbacks.compaction('started');
    await settle();
    expect(h.delivery.publish).not.toHaveBeenCalled();
    expect(h.delivery.publishTerminal).not.toHaveBeenCalled();
  });
  it.each(['completed'] as const)(
    'routes compaction %s',
    async (phase) => {
      const h = harness();
      h.callbacks.compaction(phase);
      await settle();
      expect(h.delivery.publish).toHaveBeenCalledWith(
        'tab',
        sessionId,
        expect.objectContaining({
          sessionId,
          messageId,
          eventType: 'compaction_complete',
          trigger: 'auto',
        }),
        undefined,
      );
      expect(h.delivery.publishTerminal).not.toHaveBeenCalled();
    },
  );
  it('clears failed compaction through CHAT_ERROR without a completion boundary', async () => {
    const h = harness();
    h.callbacks.compaction('failed');
    await settle();
    expect(h.delivery.publish).not.toHaveBeenCalled();
    expect(h.delivery.publishTerminal).toHaveBeenCalledTimes(1);
    expect(h.delivery.publishTerminal).toHaveBeenCalledWith(
      'tab',
      MESSAGE_TYPES.CHAT_ERROR,
      {
        tabId: 'tab',
        sessionId,
        error: 'Codex context compaction failed.',
      },
    );
  });
  it('routes file changes through a tool card and the existing file notification', async () => {
    const h = harness();
    h.callbacks.live({
      ...identity,
      type: 'file',
      itemId: 'file',
      path: '/work/a.ts',
      operation: 'update',
      diff: '+a',
    });
    await settle();
    expect(h.delivery.publish).toHaveBeenCalledWith(
      'tab',
      sessionId,
      expect.objectContaining({
        eventType: 'tool_result',
        sessionId,
        messageId,
        output: { file_path: '/work/a.ts', operation: 'update', diff: '+a' },
      }),
      undefined,
    );
    expect(h.webviewManager.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.FILE_CONTENT_CHANGED,
      { sessionId, tabId: 'tab', filePaths: ['/work/a.ts'], truncated: false },
    );
  });
  it('routes images as structured tool output', async () => {
    const h = harness();
    h.callbacks.live({
      ...identity,
      type: 'image',
      itemId: 'image',
      image: { type: 'image', data: 'AA==', mediaType: 'image/png' },
    });
    await settle();
    expect(h.delivery.publish).toHaveBeenCalledWith(
      'tab',
      sessionId,
      expect.objectContaining({
        eventType: 'tool_result',
        sessionId,
        messageId,
        output: [
          {
            type: 'image',
            source: { type: 'base64', data: 'AA==', media_type: 'image/png' },
          },
        ],
      }),
      undefined,
    );
  });
  it.each(['approvalRequested', 'approvalSettled'] as const)(
    'leaves %s to the approval presentation port (no double prompt)',
    async (type) => {
      const h = harness();
      const event: CodexRuntimeEvent =
        type === 'approvalRequested'
          ? { ...identity, type, request }
          : { ...identity, type, correlation: request, decision: 'accept' };
      h.callbacks.live(event);
      await settle();
      expect(h.webviewManager.broadcastMessage).not.toHaveBeenCalled();
      expect(h.delivery.publish).not.toHaveBeenCalled();
      expect(h.logger.error).not.toHaveBeenCalled();
    },
  );
  it('refuses turn content without a native turn but still routes session errors', async () => {
    const h = harness(false);
    h.callbacks.content({
      kind: 'text',
      itemId: 'item',
      text: 'final',
      blockIndex: 0,
    });
    h.callbacks.error('cleanup failed');
    await settle();
    expect(h.delivery.publish).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledWith(
      'Codex chat event presentation failed.',
      expect.any(Error),
    );
    expect(h.delivery.publishTerminal).toHaveBeenCalledWith(
      'tab',
      MESSAGE_TYPES.CHAT_ERROR,
      { tabId: 'tab', sessionId, error: 'cleanup failed' },
    );
  });
  it('routes error text through the existing terminal error path', () => {
    const h = harness();
    h.callbacks.error('safe runtime error');
    expect(h.delivery.publishTerminal).toHaveBeenCalledWith(
      'tab',
      MESSAGE_TYPES.CHAT_ERROR,
      { tabId: 'tab', sessionId, error: 'safe runtime error' },
    );
  });
  it('contains synchronous throws and asynchronous rejection and logs the real error', async () => {
    const h = harness();
    h.delivery.publish.mockImplementation(() => {
      throw new Error('sink');
    });
    h.delivery.publishTerminal.mockRejectedValue(new Error('sink'));
    h.webviewManager.broadcastMessage.mockRejectedValue(new Error('sink'));
    expect(() => {
      h.callbacks.content({
        kind: 'reasoning',
        itemId: 'r',
        text: 'reason',
        blockIndex: 0,
      });
      h.callbacks.result({ status: 'completed', text: 'answer' });
      h.callbacks.compaction('completed');
      h.callbacks.live({
        ...identity,
        type: 'file',
        itemId: 'file',
        path: '/work/a.ts',
        operation: 'update',
        diff: '+a',
      });
      h.callbacks.error('safe error');
    }).not.toThrow();
    await settle();
    // result is a no-op now: the projection reconciles final text itself.
    expect(h.logger.error).toHaveBeenCalledTimes(4);
    for (const call of h.logger.error.mock.calls)
      expect(call).toEqual([
        'Codex chat event presentation failed.',
        expect.objectContaining({ message: 'sink' }),
      ]);
  });
});
