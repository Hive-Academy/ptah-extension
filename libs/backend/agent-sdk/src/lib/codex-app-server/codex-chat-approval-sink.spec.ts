import type { CodexApprovalRequest } from '@ptah-extension/codex-runtime';
import {
  CODEX_CHAT_APPROVAL_CHOICES,
  CodexChatApprovalSink,
} from './codex-chat-approval-sink';

const request: CodexApprovalRequest = {
  contextId: 'context',
  processGeneration: 2,
  threadId: 'thread',
  turnId: 'turn',
  requestId: 7,
  kind: 'command',
  normalizedHome: '/home',
  workspaceId: 'workspace',
  providerId: 'provider',
  message: 'Run?',
  details: {},
};
const reply = {
  sessionId: 'session',
  contextId: 'context',
  processGeneration: 2,
  threadId: 'thread',
  turnId: 'turn',
  requestId: 7,
  decision: 'accept' as const,
};
function setup() {
  const presentation = {
    present: jest.fn(),
    dismiss: jest.fn(),
    cancelPrompt: jest.fn(),
  };
  const followUp = {
    validateReplacement: jest
      .fn<
        string | undefined,
        [CodexApprovalRequest, Readonly<Record<string, unknown>>]
      >()
      .mockReturnValue('edited'),
    isTurnActive: jest.fn().mockReturnValue(true),
    post: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn(),
  };
  return {
    presentation,
    followUp,
    sink: new CodexChatApprovalSink(
      'session',
      'context',
      presentation,
      followUp,
      100,
    ),
  };
}
describe('CodexChatApprovalSink', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it.each(['accept', 'acceptForSession', 'decline', 'cancel'] as const)(
    'returns the correlated %s decision once',
    async (decision) => {
      const { sink, presentation } = setup();
      const promise = sink.request(request, new AbortController().signal);
      expect(presentation.present).toHaveBeenCalledWith(
        'session',
        request,
        CODEX_CHAT_APPROVAL_CHOICES,
      );
      expect(sink.respond({ ...reply, decision })).toBe(true);
      expect(sink.respond(reply)).toBe(false);
      await expect(promise).resolves.toBe(decision);
      expect(presentation.dismiss).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
  it.each([
    'sessionId',
    'contextId',
    'processGeneration',
    'threadId',
    'turnId',
    'requestId',
  ] as const)(
    'ignores stale %s without settling the live prompt',
    async (field) => {
      const { sink } = setup();
      const promise = sink.request(request, new AbortController().signal);
      expect(
        sink.respond({
          ...reply,
          [field]: field === 'processGeneration' ? 1 : 'wrong',
        }),
      ).toBe(false);
      expect(sink.respond(reply)).toBe(true);
      await expect(promise).resolves.toBe('accept');
    },
  );
  it.each([true, false])(
    'declines edits and posts validated text with active=%s',
    async (active) => {
      const { sink, followUp } = setup();
      followUp.isTurnActive.mockReturnValue(active);
      const promise = sink.request(request, new AbortController().signal);
      sink.respond({ ...reply, modifiedInput: { command: 'safe' } });
      await expect(promise).resolves.toEqual({
        decision: 'decline',
        editNotSupported: true,
      });
      expect(followUp.validateReplacement).toHaveBeenCalledWith(request, {
        command: 'safe',
      });
      expect(followUp.post).toHaveBeenCalledWith(
        'edited',
        active ? 'steer' : 'newTurn',
        request,
      );
    },
  );
  it('does not post invalid replacement input', async () => {
    const { sink, followUp } = setup();
    followUp.validateReplacement.mockReturnValue(undefined);
    const promise = sink.request(request, new AbortController().signal);
    sink.respond({ ...reply, modifiedInput: { unknown: 'input' } });
    await promise;
    expect(followUp.post).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'abort', 'dispose'] as const)(
    'denies and removes the prompt on %s',
    async (mode) => {
      const { sink, presentation } = setup();
      const abort = new AbortController();
      const promise = sink.request(request, abort.signal);
      if (mode === 'timeout') jest.advanceTimersByTime(100);
      if (mode === 'abort') abort.abort();
      if (mode === 'dispose') sink.dispose();
      await expect(promise).resolves.toBe('decline');
      expect(presentation.cancelPrompt).toHaveBeenCalledWith({
        sessionId: 'session',
        requestId: '7',
        reason:
          mode === 'abort'
            ? 'turn-ended'
            : mode === 'dispose'
              ? 'disposed'
              : 'timeout',
      });
      expect(presentation.dismiss).toHaveBeenCalledTimes(1);
      expect(sink.respond(reply)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
  it('rejects foreign context, duplicate requests and pre-aborted requests', async () => {
    const { sink, presentation } = setup();
    const abort = new AbortController();
    abort.abort();
    await expect(sink.request(request, abort.signal)).resolves.toBe('decline');
    await expect(
      sink.request(
        { ...request, contextId: 'foreign' },
        new AbortController().signal,
      ),
    ).resolves.toBe('decline');
    expect(presentation.present).not.toHaveBeenCalled();
    const promise = sink.request(request, new AbortController().signal);
    await expect(
      sink.request(request, new AbortController().signal),
    ).resolves.toBe('decline');
    sink.dispose();
    await promise;
  });
  it('fails closed if presentation throws', async () => {
    const { sink, presentation } = setup();
    presentation.present.mockImplementation(() => {
      throw new Error('private');
    });
    await expect(
      sink.request(request, new AbortController().signal),
    ).resolves.toBe('decline');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports follow-up delivery failure without changing the declined outcome', async () => {
    const { sink, followUp } = setup();
    followUp.post.mockRejectedValue(new Error('private'));
    const promise = sink.request(request, new AbortController().signal);
    sink.respond({ ...reply, editedText: 'please use another command' });
    await expect(promise).resolves.toEqual({
      decision: 'decline',
      editNotSupported: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(followUp.failed).toHaveBeenCalledTimes(1);
    expect(sink.respond(reply)).toBe(false);
  });

  it('cleans up even when both cancellation and dismissal throw', async () => {
    const { sink, presentation } = setup();
    presentation.cancelPrompt.mockImplementation(() => {
      throw new Error('UI gone');
    });
    presentation.dismiss.mockImplementation(() => {
      throw new Error('UI gone');
    });
    const promise = sink.request(request, new AbortController().signal);
    sink.dispose();
    await expect(promise).resolves.toBe('decline');
    expect(jest.getTimerCount()).toBe(0);
  });
});
