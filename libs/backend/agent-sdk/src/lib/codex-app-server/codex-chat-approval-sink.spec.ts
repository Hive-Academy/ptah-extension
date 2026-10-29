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

function setup(
  permissionLevel: () => string | undefined = () => undefined,
  resolvePath: (value: string) => Promise<string> = async (value) => value,
  threadCwd: string | undefined = 'C:\\repo',
) {
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
      permissionLevel,
      'win32',
      threadCwd,
      resolvePath,
    ),
  };
}

function nextPresentation(presentation: ReturnType<typeof setup>['presentation']): Promise<void> {
  return new Promise<void>((resolve) => {
    presentation.present.mockImplementationOnce(() => resolve());
  });
}

describe('CodexChatApprovalSink', () => {
  it('accepts one Manual read request without presentation and logs names only', async () => {
    const { sink, presentation, logger } = setup(() => 'ask');
    const read = {
      ...request,
      details: { command: 'Get-Content secret.txt | rg password', cwd: 'C:\\repo' },
    };
    await expect(sink.request(read, new AbortController().signal)).resolves.toBe('accept');
    expect(presentation.present).not.toHaveBeenCalled();
    expect(presentation.dismiss).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[CodexChatApprovalSink] accepted read-only command.',
      { commands: ['Get-Content', 'rg'] },
    );
    expect(JSON.stringify(jest.mocked(logger.info).mock.calls)).not.toContain('secret.txt');
    expect(JSON.stringify(jest.mocked(logger.info).mock.calls)).not.toContain('password');
    expect(sink.respond(reply)).toBe(false);
  });

  it.each(['auto-edit', 'plan', 'yolo'])(
    'keeps the approval card for %s read requests', (level) => {
      const { sink, presentation } = setup(() => level);
      const read = { ...request, details: { command: 'rg TODO .', cwd: 'C:\\repo' } };
      const pending = sink.request(read, new AbortController().signal);
      expect(presentation.present).toHaveBeenCalledTimes(1);
      sink.dispose();
      return expect(pending).resolves.toBe('decline');
    },
  );

  it.each([
    ['write command', { command: 'Set-Content file.txt x', cwd: 'C:\\repo' }, 'command'],
    ['file change', { command: 'Get-Content file.txt', cwd: 'C:\\repo' }, 'fileChange'],
    ['permissions', { command: 'Get-Content file.txt', cwd: 'C:\\repo' }, 'permissions'],
    ['MCP elicitation', { command: 'Get-Content file.txt', cwd: 'C:\\repo' }, 'mcpElicitation'],
    ['user input', { command: 'Get-Content file.txt', cwd: 'C:\\repo' }, 'userInput'],
    ['network approval', { command: 'rg TODO .', cwd: 'C:\\repo', networkApprovalContext: {} }, 'command'],
    ['stdin approval', { command: 'rg TODO .', cwd: 'C:\\repo', kind: 'writeStdin' }, 'command'],
  ] as const)('shows the card for %s', (_case, details, kind) => {
    const { sink, presentation } = setup(() => 'ask');
    const pending = sink.request({ ...request, kind, details }, new AbortController().signal);
    expect(presentation.present).toHaveBeenCalledTimes(1);
    sink.dispose();
    return expect(pending).resolves.toBe('decline');
  });

  it('reads the current permission level for each request', async () => {
    let level = 'ask';
    const { sink, presentation } = setup(() => level);
    const read = { ...request, details: { command: 'rg TODO .', cwd: 'C:\\repo' } };
    await expect(sink.request(read, new AbortController().signal)).resolves.toBe('accept');
    level = 'plan';
    const pending = sink.request({ ...read, requestId: 8 }, new AbortController().signal);
    expect(presentation.present).toHaveBeenCalledTimes(1);
    sink.dispose();
    await expect(pending).resolves.toBe('decline');
  });

  it('accepts a command cwd below the profile cwd after realpath containment', async () => {
    const { sink, presentation } = setup(() => 'ask');
    const read = { ...request, details: { command: 'Get-Content note.txt', cwd: 'C:\\repo\\sub' } };
    await expect(sink.request(read, new AbortController().signal)).resolves.toBe('accept');
    expect(presentation.present).not.toHaveBeenCalled();
  });

  it.each([
    ['outside thread cwd', { command: 'cat secret.txt', cwd: 'C:\\private' }],
    ['missing command cwd', { command: 'rg TODO .' }],
  ])('shows the card for %s', async (_case, details) => {
    const { sink, presentation } = setup(() => 'ask');
    const pending = sink.request({ ...request, details }, new AbortController().signal);
    expect(presentation.present).toHaveBeenCalledTimes(1);
    sink.dispose();
    await expect(pending).resolves.toBe('decline');
  });

  it('shows the card when the profile cwd is unavailable', async () => {
    const { sink, presentation } = setup(() => 'ask', async (value) => value, '');
    const presented = nextPresentation(presentation);
    const pending = sink.request({ ...request, details: { command: 'rg TODO .', cwd: 'C:\\repo' } }, new AbortController().signal);
    await presented;
    expect(presentation.present).toHaveBeenCalledTimes(1);
    sink.dispose();
    await expect(pending).resolves.toBe('decline');
  });

  it.each([
    ['file symlink', 'cat link\\secret.txt', 'C:\\repo\\link\\secret.txt'],
    ['cwd junction', 'rg TODO .', 'C:\\repo\\link'],
  ])('shows the card for %s escaping the profile cwd', async (_case, command, escaped) => {
    const resolvePath = jest.fn(async (value: string) =>
      value.toLowerCase() === escaped.toLowerCase() ? 'C:\\private\\secret.txt' : value);
    const { sink, presentation, logger } = setup(() => 'ask', resolvePath);
    const details = { command, cwd: command === 'rg TODO .' ? 'C:\\repo\\link' : 'C:\\repo' };
    const presented = nextPresentation(presentation);
    const pending = sink.request({ ...request, details }, new AbortController().signal);
    await presented;
    expect(presentation.present).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    sink.dispose();
    await expect(pending).resolves.toBe('decline');
  });

  it('shows the card when realpath cannot resolve an argument', async () => {
    const resolvePath = jest.fn(async (value: string) => {
      if (value.endsWith('missing.txt')) throw new Error('ENOENT');
      return value;
    });
    const { sink, presentation } = setup(() => 'ask', resolvePath);
    const presented = nextPresentation(presentation);
    const pending = sink.request({ ...request, details: { command: 'cat missing.txt', cwd: 'C:\\repo' } }, new AbortController().signal);
    await presented;
    expect(presentation.present).toHaveBeenCalledTimes(1);
    sink.dispose();
    await expect(pending).resolves.toBe('decline');
  });
  it('ends only approvals matching both thread and turn, exactly once', async () => {
    const { sink, presentation } = setup();
    const signal = new AbortController().signal;
    const otherTurn = { ...request, turnId: 'other-turn', requestId: 8 };
    const otherThread = { ...request, threadId: 'other-thread', requestId: 9 };
    const first = sink.request(request, signal);
    const second = sink.request({ ...request, requestId: 10 }, signal);
    const remainingTurn = sink.request(otherTurn, signal);
    const remainingThread = sink.request(otherThread, signal);

    sink.endTurn(request.threadId, request.turnId);
    sink.endTurn(request.threadId, request.turnId);

    await expect(first).resolves.toBe('cancel');
    await expect(second).resolves.toBe('cancel');
    expect(presentation.cancelPrompt).toHaveBeenCalledTimes(2);
    expect(presentation.cancelPrompt).toHaveBeenCalledWith({
      sessionId: reply.sessionId,
      requestId: '7',
      reason: 'turn-ended',
    });
    expect(presentation.dismiss).toHaveBeenCalledTimes(2);
    expect(presentation.dismiss).not.toHaveBeenCalledWith(reply.sessionId, otherTurn);
    expect(presentation.dismiss).not.toHaveBeenCalledWith(reply.sessionId, otherThread);
    expect(sink.respond({
      ...reply,
      turnId: otherTurn.turnId,
      requestId: otherTurn.requestId,
    })).toBe(true);
    expect(sink.respond({
      ...reply,
      threadId: otherThread.threadId,
      requestId: otherThread.requestId,
    })).toBe(true);
    await expect(remainingTurn).resolves.toBe('accept');
    await expect(remainingThread).resolves.toBe('accept');
    sink.dispose();
  });

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

  it('carries a trimmed deny reason and drops blank, allow, and plain-deny reasons', async () => {
    const { sink, followUp } = setup();
    const denied = sink.request(request, new AbortController().signal);
    expect(
      sink.respond({ ...reply, decision: 'decline', reason: '  too risky  ' }),
    ).toBe(true);
    await expect(denied).resolves.toEqual({
      decision: 'decline',
      denialReason: 'too risky',
    });
    expect(followUp.post).not.toHaveBeenCalled();

    const blank = sink.request(
      { ...request, requestId: 8 },
      new AbortController().signal,
    );
    sink.respond({
      ...reply,
      requestId: 8,
      decision: 'decline',
      reason: ' \n\t ',
    });
    await expect(blank).resolves.toBe('decline');

    const allowed = sink.request(
      { ...request, requestId: 9 },
      new AbortController().signal,
    );
    sink.respond({
      ...reply,
      requestId: 9,
      decision: 'accept',
      reason: 'too risky',
    });
    await expect(allowed).resolves.toBe('accept');

    const cancelled = sink.request(
      { ...request, requestId: 10 },
      new AbortController().signal,
    );
    sink.respond({
      ...reply,
      requestId: 10,
      decision: 'cancel',
      reason: 'too risky',
    });
    await expect(cancelled).resolves.toBe('cancel');
    expect(followUp.post).not.toHaveBeenCalled();
  });

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
