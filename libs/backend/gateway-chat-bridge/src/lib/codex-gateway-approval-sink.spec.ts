import type { CodexApprovalRequest } from '@ptah-extension/codex-runtime';
import {
  CODEX_GATEWAY_APPROVAL_CHOICES,
  CodexGatewayApprovalSink,
  type CodexGatewayApprovalPresentation,
} from './codex-gateway-approval-sink';

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
  message: 'Run command?',
  details: {},
};

function setup() {
  const presentation = {
    sendNotice: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    present: jest
      .fn<
        Promise<unknown>,
        Parameters<NonNullable<CodexGatewayApprovalPresentation['present']>>
      >()
      .mockResolvedValue('decline'),
    dismiss: jest.fn<void, [CodexApprovalRequest]>(),
  };
  const logger = { warn: jest.fn() };
  return {
    presentation,
    logger,
    sink: new CodexGatewayApprovalSink(presentation, logger),
  };
}

describe('CodexGatewayApprovalSink', () => {
  it.each(CODEX_GATEWAY_APPROVAL_CHOICES)(
    'returns only the selected %s decision',
    async (decision) => {
      const { sink, presentation } = setup();
      presentation.present.mockResolvedValue(decision);
      const signal = new AbortController().signal;
      await expect(sink.request(request, signal)).resolves.toBe(decision);
      expect(presentation.present).toHaveBeenCalledWith(
        request,
        ['accept', 'acceptForSession', 'decline', 'cancel'],
        signal,
      );
      expect(presentation.dismiss).toHaveBeenCalledWith(request);
    },
  );

  it('declines an unroutable request even when its notice succeeds', async () => {
    const { presentation, logger } = setup();
    const sink = new CodexGatewayApprovalSink(
      { ...presentation, present: undefined },
      logger,
    );
    await expect(
      sink.request(request, new AbortController().signal),
    ).resolves.toBe('decline');
    expect(presentation.sendNotice).toHaveBeenCalled();
    expect(presentation.present).not.toHaveBeenCalled();
  });

  it('passes MCP elicitation through the same correlated decision surface', async () => {
    const { sink, presentation } = setup();
    const mcp = { ...request, kind: 'mcpElicitation' as const };
    await sink.request(mcp, new AbortController().signal);
    expect(presentation.present.mock.calls[0][0]).toEqual(mcp);
  });

  it.each(['updatedInput', 'modifiedInput', 'editedInput'])(
    'declines %s before a separate follow-up',
    async (key) => {
      const { sink, presentation } = setup();
      presentation.present.mockResolvedValue({
        decision: 'accept',
        [key]: 'replacement',
      });
      await expect(
        sink.request(request, new AbortController().signal),
      ).resolves.toEqual({ decision: 'decline', editNotSupported: true });
    },
  );

  it.each([undefined, null, 'alwaysAllow', { decision: 'accept' }])(
    'declines malformed replies: %p',
    async (reply) => {
      const { sink, presentation } = setup();
      presentation.present.mockResolvedValue(reply);
      await expect(
        sink.request(request, new AbortController().signal),
      ).resolves.toBe('decline');
    },
  );

  it('cancels an unanswered prompt on core timeout, dismisses it and ignores late acceptance', async () => {
    const { sink, presentation } = setup();
    let reply: (value: unknown) => void = () => undefined;
    presentation.present.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const result = sink.request(request, controller.signal);
    controller.abort();
    await expect(result).resolves.toBe('cancel');
    reply('accept');
    await expect(result).resolves.toBe('cancel');
    expect(presentation.dismiss).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not present after cancellation', async () => {
    const { sink, presentation } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(sink.request(request, controller.signal)).resolves.toBe(
      'cancel',
    );
    expect(presentation.present).not.toHaveBeenCalled();
  });

  it('fails closed on presentation errors without logging their contents', async () => {
    const { sink, presentation, logger } = setup();
    presentation.present.mockRejectedValue(new Error('secret'));
    presentation.dismiss.mockImplementation(() => {
      throw new Error('secret');
    });
    await expect(
      sink.request(request, new AbortController().signal),
    ).resolves.toBe('decline');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });

  it('a failed notice neither blocks nor authorizes the approval', async () => {
    const { sink, presentation } = setup();
    presentation.sendNotice.mockRejectedValue(new Error('secret'));
    await expect(
      sink.request(request, new AbortController().signal),
    ).resolves.toBe('decline');
  });

  it('declines user input that the four-decision surface cannot answer', async () => {
    const { sink, presentation } = setup();
    await expect(
      sink.request(
        { ...request, kind: 'userInput' },
        new AbortController().signal,
      ),
    ).resolves.toBe('decline');
    expect(presentation.present).not.toHaveBeenCalled();
  });
});
