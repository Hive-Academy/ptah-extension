import 'reflect-metadata';
import {
  buildSystemAbortPermissionMessage,
  type PermissionPromptLifecycleEvent,
  type SessionApprovalRouter,
} from '@ptah-extension/agent-sdk';
import type { CodexApprovalRequest } from '@ptah-extension/codex-runtime';
import { MESSAGE_TYPES, SessionId } from '@ptah-extension/shared';
import {
  createCodexChatApprovalPresentation,
  type CodexApprovalPresentationPorts,
} from './codex-chat-approval-presentation';

jest.mock('@ptah-extension/agent-sdk', () => {
  const abort = jest.requireActual<
    typeof import('../../../../../agent-sdk/src/lib/system-abort-permission-message')
  >('../../../../../agent-sdk/src/lib/system-abort-permission-message');
  return {
    UNROUTABLE_PERMISSION_TIMEOUT_MS: abort.UNROUTABLE_PERMISSION_TIMEOUT_MS,
    buildSystemAbortPermissionMessage: abort.buildSystemAbortPermissionMessage,
    presentCodexApproval: jest.requireActual<
      typeof import('../../../../../agent-sdk/src/lib/codex-app-server/codex-tool-presentation')
    >('../../../../../agent-sdk/src/lib/codex-app-server/codex-tool-presentation').presentCodexApproval,
  };
});

describe('Codex chat approval presentation', () => {
  const sessionId = SessionId.from('22222222-2222-4222-8222-222222222222');
  const now = 1_700_000_000_000;
  const choices = ['deny', 'allowOnce', 'allowWithInput', 'alwaysAllow'] as const;

  beforeEach(() => jest.useFakeTimers({ now }));
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function request(): CodexApprovalRequest {
    return {
      contextId: 'context', processGeneration: 2,
      threadId: sessionId, turnId: 'turn', requestId: 5,
      toolId: 'native-item-5', kind: 'command',
      normalizedHome: '/workspace', workspaceId: '/workspace',
      providerId: 'openai-codex', message: 'Run command',
      details: { command: 'pwd' },
    };
  }

  function harness() {
    const broadcastMessage = jest.fn<Promise<void>, [string, unknown]>()
      .mockResolvedValue(undefined);
    const publish = jest.fn<void, [PermissionPromptLifecycleEvent]>();
    const resolveAttention = jest.fn<void, [string, number]>();
    const respond = jest.fn<boolean, Parameters<SessionApprovalRouter['respond']>>()
      .mockReturnValue(true);
    const approvals: CodexApprovalPresentationPorts['approvals'] = { respond };
    const { Logger } = jest.createMockFromModule<
      typeof import('@ptah-extension/vscode-core')
    >('@ptah-extension/vscode-core');
    const ports = createCodexChatApprovalPresentation({
      logger: Logger.prototype,
      approvals,
      tabId: () => 'gw-conversation',
      webviewManager: { broadcastMessage },
      promptLifecycle: { publish },
      hostAttention: { resolve: resolveAttention },
      setTimer: (callback, delay) => setTimeout(callback, delay),
      clearTimer: (timer) => clearTimeout(timer),
    });
    const present = () => {
      ports.presentation.present(sessionId, request(), [...choices]);
      const payload = broadcastMessage.mock.calls[0][1];
      if (typeof payload !== 'object' || payload === null || !('id' in payload)) {
        throw new Error('Missing permission request id');
      }
      if (typeof payload.id !== 'string') throw new Error('Invalid permission request id');
      return payload.id;
    };
    return { ports, present, respond, publish, broadcastMessage, resolveAttention,
      logger: Logger.prototype };
  }

  it('denies an unanswered card at 60 seconds and publishes timed-out', () => {
    const h = harness();
    const wireId = h.present();
    jest.advanceTimersByTime(60_000);
    expect(h.respond).toHaveBeenCalledWith(
      { sessionId, threadId: sessionId, requestId: '5' },
      expect.objectContaining({ kind: 'codex', response: expect.objectContaining({
        decision: 'decline',
        reason: buildSystemAbortPermissionMessage('Bash',
          'Permission request timed out after 60000ms with no answer from the UI — denying to prevent a permanent hang.'),
      }) }),
    );
    expect(h.publish).toHaveBeenLastCalledWith({
      phase: 'resolved', requestId: wireId, routingHint: 'gw-conversation',
      toolName: 'Bash', outcome: 'timed-out',
    });
    expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(false);
  });

  it('accepts a response, publishes its UI outcome, and clears the timer', () => {
    const h = harness();
    const wireId = h.present();
    expect(jest.getTimerCount()).toBe(1);
    expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(true);
    expect(h.respond).toHaveBeenCalledWith(
      { sessionId, threadId: sessionId, requestId: '5' },
      expect.objectContaining({ response: expect.objectContaining({ decision: 'accept' }) }),
    );
    expect(h.publish).toHaveBeenLastCalledWith({
      phase: 'resolved', requestId: wireId, routingHint: 'gw-conversation',
      toolName: 'Bash', outcome: 'allowed',
    });
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(60_000);
    expect(h.respond).toHaveBeenCalledTimes(1);
  });

  it.each(['rejected', 'throws'] as const)(
    'consumes a %s reply and publishes aborted', (failure) => {
      const h = harness();
      const wireId = h.present();
      if (failure === 'throws') {
        h.respond.mockImplementationOnce(() => { throw new Error('private request'); });
      } else {
        h.respond.mockReturnValueOnce(false);
      }
      expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(true);
      expect(h.broadcastMessage).toHaveBeenLastCalledWith(
        MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
        { id: wireId, sessionId, toolName: 'command' },
      );
      expect(h.publish).toHaveBeenLastCalledWith({
        phase: 'resolved', requestId: wireId, routingHint: 'gw-conversation',
        toolName: 'Bash', outcome: 'aborted',
      });
      expect(h.logger.warn).toHaveBeenCalledWith(expect.any(String), {
        code: failure === 'throws' ? 'approval-response-failed' : 'approval-response-rejected',
      });
      expect(jest.getTimerCount()).toBe(0);
      expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(false);
    },
  );

  it('takes a dismissed prompt out of the timer queue', () => {
    const h = harness();
    h.present();
    expect(jest.getTimerCount()).toBe(1);
    h.ports.presentation.dismiss(sessionId, request());
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(60_000);
    expect(h.respond).not.toHaveBeenCalled();
  });
});
