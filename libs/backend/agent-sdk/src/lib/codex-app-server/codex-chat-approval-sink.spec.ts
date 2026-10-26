import 'reflect-metadata';
import { SessionId } from '@ptah-extension/shared';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
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
  sessionId: SessionId.from('11111111-1111-4111-8111-111111111111'),
  contextId: 'context',
  processGeneration: 2,
  threadId: 'thread',
  turnId: 'turn',
  requestId: 7,
  decision: 'accept' as const,
};
function mockLogger(): Logger {
  return Object.assign(Object.create(Logger.prototype), createMockLogger());
}

function setup() {
  const logger = mockLogger();
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
    logger,
    presentation,
    followUp,
    sink: new CodexChatApprovalSink(
      reply.sessionId,
      'context',
      presentation,
      followUp,
      logger,
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
        reply.sessionId,
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
  it.each(['abort', 'dispose'] as const)(
    'denies and removes the prompt on %s',
    async (mode) => {
      const { sink, presentation } = setup();
      const abort = new AbortController();
      const promise = sink.request(request, abort.signal);
      if (mode === 'abort') abort.abort();
      if (mode === 'dispose') sink.dispose();
      await expect(promise).resolves.toBe('decline');
      expect(presentation.cancelPrompt).toHaveBeenCalledWith({
        sessionId: SessionId.from('11111111-1111-4111-8111-111111111111'),
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
  it('presents cancellation exactly once per settle path', async () => {
    for (const mode of ['abort', 'dispose', 'router cancel'] as const) {
      const { sink, presentation } = setup();
      const controller = new AbortController();
      const promise = sink.request(request, controller.signal);

      if (mode === 'abort') {
        controller.abort();
        controller.abort();
      } else if (mode === 'dispose') {
        sink.dispose();
        sink.dispose();
      } else {
        expect(sink.cancel(request.threadId, String(request.requestId))).toBe(
          true,
        );
      }

      await expect(promise).resolves.toBe(
        mode === 'router cancel' ? 'cancel' : 'decline',
      );
      if (mode === 'router cancel') {
        expect(presentation.cancelPrompt).not.toHaveBeenCalled();
      } else {
        expect(presentation.cancelPrompt).toHaveBeenCalledTimes(1);
        expect(presentation.cancelPrompt).toHaveBeenCalledWith({
          sessionId: reply.sessionId,
          requestId: String(request.requestId),
          reason: mode === 'abort' ? 'turn-ended' : 'disposed',
        });
      }
      expect(presentation.dismiss).toHaveBeenCalledTimes(1);

      controller.abort();
      sink.dispose();
      expect(presentation.cancelPrompt).toHaveBeenCalledTimes(
        mode === 'router cancel' ? 0 : 1,
      );
      expect(presentation.dismiss).toHaveBeenCalledTimes(1);
    }
  });
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
    const { sink, presentation, logger } = setup();
    const error = new Error('private');
    presentation.present.mockImplementation(() => {
      throw error;
    });
    await expect(
      sink.request(request, new AbortController().signal),
    ).resolves.toBe('decline');
    expect(logger.error).toHaveBeenCalledWith(
      '[CodexChatApprovalSink] runtime-failed: presentation.',
      error,
    );
    expect(jest.mocked(logger.error).mock.calls[0]?.[1]).toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports follow-up delivery failure without changing the declined outcome', async () => {
    const { sink, followUp, logger } = setup();
    const error = new Error('private');
    const reportingError = new Error('reporting failed');
    followUp.post.mockRejectedValue(error);
    followUp.failed.mockImplementation(() => {
      throw reportingError;
    });
    const promise = sink.request(request, new AbortController().signal);
    sink.respond({ ...reply, editedText: 'please use another command' });
    await expect(promise).resolves.toEqual({
      decision: 'decline',
      editNotSupported: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(followUp.failed).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[CodexChatApprovalSink] runtime-failed: follow-up.',
      error,
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[CodexChatApprovalSink] runtime-failed: follow-up reporting.',
      reportingError,
    );
    expect(sink.respond(reply)).toBe(false);
  });

  it('cleans up even when both cancellation and dismissal throw', async () => {
    const { sink, presentation, logger } = setup();
    const cancelError = new Error('cancellation UI gone');
    const dismissError = new Error('dismissal UI gone');
    presentation.cancelPrompt.mockImplementation(() => {
      throw cancelError;
    });
    presentation.dismiss.mockImplementation(() => {
      throw dismissError;
    });
    const promise = sink.request(request, new AbortController().signal);
    sink.dispose();
    await expect(promise).resolves.toBe('decline');
    expect(logger.error).toHaveBeenCalledWith(
      '[CodexChatApprovalSink] runtime-failed: cancellation presentation.',
      cancelError,
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[CodexChatApprovalSink] runtime-failed: dismissal.',
      dismissError,
    );
    expect(jest.getTimerCount()).toBe(0);
  });
  it('logs the original replacement validation error and declines the edit', async () => {
    const { sink, followUp, logger } = setup();
    const error = new Error('invalid replacement');
    followUp.validateReplacement.mockImplementation(() => {
      throw error;
    });
    const pending = sink.request(request, new AbortController().signal);
    expect(
      sink.respond({ ...reply, modifiedInput: { command: 'private' } }),
    ).toBe(true);
    await expect(pending).resolves.toEqual({
      decision: 'decline',
      editNotSupported: true,
    });
    expect(followUp.post).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[CodexChatApprovalSink] runtime-failed: replacement validation.',
      error,
    );
    expect(jest.mocked(logger.error).mock.calls[0]?.[1]).toBe(error);
  });
});

it('waits without a timer, cancels exactly the addressed request, and dismisses once', async () => {
  jest.useFakeTimers();
  try {
    const { sink, presentation } = setup();
    const pending = sink.request(request, new AbortController().signal);
    jest.advanceTimersByTime(120_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(presentation.dismiss).not.toHaveBeenCalled();
    expect(sink.cancel('wrong', '7')).toBe(false);
    expect(sink.cancel('thread', '7')).toBe(true);
    expect(sink.cancel('thread', '7')).toBe(false);
    await expect(pending).resolves.toBe('cancel');
    expect(presentation.dismiss).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('router cancellation settles and dismisses without duplicating its cancel notification', async () => {
  const { sink, presentation } = setup();
  const pending = sink.request(request, new AbortController().signal);
  expect(sink.cancel(request.threadId, String(request.requestId))).toBe(true);
  await expect(pending).resolves.toBe('cancel');
  expect(presentation.dismiss).toHaveBeenCalledTimes(1);
  expect(presentation.cancelPrompt).not.toHaveBeenCalled();
  sink.dispose();
  expect(presentation.dismiss).toHaveBeenCalledTimes(1);
});
