/**
 * ChildChatSessionHostAdapter specs (TASK_2026_584, Task 4.3).
 *
 * Contract pinned here:
 *   - the tab is announced (`agentSession:opened` with the descriptor) BEFORE
 *     the child session starts;
 *   - a failing announcement still starts the session, with `uiAnnounced: false`;
 *   - a `{ success: false }` start and a thrown start both return
 *     `{ started: false, error }` — never a throw;
 *   - Revision 1 fix 2: when announced, each failure sends exactly one
 *     `chat:error` `{ tabId, sessionId: tabId, error }` for the child tab; when
 *     not announced, none; a failing error broadcast does not change the outcome.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  type AgentSessionOpenedPayload,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  ChildChatSessionStartInput,
  StartSuccessorSessionInput,
} from '@ptah-extension/cli-agent-runtime';

import {
  ChildChatSessionHostAdapter,
  SUCCESSOR_BIND_TIMEOUT_MS,
} from './child-chat-session-host.adapter';
import type { ChatSessionService } from './chat-session.service';
import type { WebviewManager } from '../streaming/chat-stream-broadcaster.service';

const CHILD_TAB = '0f1e2d3c-4b5a-4968-8776-655443322110';

const descriptor: AgentSessionOpenedPayload = {
  tabId: CHILD_TAB,
  sessionId: null,
  parentTabId: '11111111-2222-4333-8444-555555555555',
  parentSessionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
  workspaceRoot: '/repo',
  worktreePath: '/repo/.ptah/worktrees/child-1',
  branch: 'ptah/child-1',
  label: 'fix the parser',
  displayPrompt: 'Fix the parser',
  startedAt: 1_700_000_000_000,
};

const input: ChildChatSessionStartInput = {
  tabId: CHILD_TAB,
  workspaceRoot: '/repo',
  worktreePath: '/repo/.ptah/worktrees/child-1',
  prompt: 'contract + task',
  descriptor,
  sessionName: 'child: fix the parser',
  model: 'claude-child-model',
};

const successorInput: StartSuccessorSessionInput = {
  operationId: '11111111-2222-4333-8444-555555555555',
  source: {
    sessionId: '22222222-3333-4444-8555-666666666666',
    tabId: 'source-tab',
    token: 'source-token',
    workspacePath: '/repo',
    successorConfig: {
      model: 'claude-sonnet',
      effort: 'medium',
      permissionLevel: 'yolo',
      workspacePath: '/repo',
    },
  },
  seed: 'Continue from handoff',
  resourceLease: {
    worktreePath: '/repo',
    inheritedParentIds: [],
  },
};

interface Harness {
  adapter: ChildChatSessionHostAdapter;
  broadcastMessage: jest.Mock;
  startAgentChildSession: jest.Mock;
  startHandoverSuccessor: jest.Mock;
  stopHandoverSuccessor: jest.Mock;
  getActiveWebviews: jest.Mock;
  order: string[];
}

function makeHarness(): Harness {
  const order: string[] = [];
  const broadcastMessage = jest.fn(async (type: string) => {
    order.push(`broadcast:${type}`);
  });
  const startAgentChildSession = jest.fn(async () => {
    order.push('start');
    return { success: true };
  });
  const startHandoverSuccessor = jest.fn().mockResolvedValue({ success: true });
  const stopHandoverSuccessor = jest.fn().mockResolvedValue(undefined);
  const getActiveWebviews = jest.fn(() => []);
  const adapter = new ChildChatSessionHostAdapter(
    createMockLogger() as unknown as Logger,
    {
      broadcastMessage,
      sendMessage: jest.fn(),
      getActiveWebviews,
    } as unknown as WebviewManager,
    {
      startAgentChildSession,
      startHandoverSuccessor,
      stopHandoverSuccessor,
    } as unknown as ChatSessionService,
  );
  return {
    adapter,
    broadcastMessage,
    startAgentChildSession,
    startHandoverSuccessor,
    stopHandoverSuccessor,
    getActiveWebviews,
    order,
  };
}

function chatErrorCalls(h: Harness): unknown[][] {
  return h.broadcastMessage.mock.calls.filter(
    ([type]) => type === MESSAGE_TYPES.CHAT_ERROR,
  );
}

describe('ChildChatSessionHostAdapter', () => {
  it('starts a headless successor after live registration without a UI acknowledgement', async () => {
    const h = makeHarness();

    await expect(h.adapter.startSuccessorSession(successorInput)).resolves.toEqual(expect.objectContaining({
      started: true,
      uiAnnounced: false,
      successorTabId: expect.any(String),
    }));
    expect(h.startHandoverSuccessor).toHaveBeenCalledWith({
      tabId: expect.any(String),
      workspaceRoot: '/repo',
      worktreePath: '/repo',
      seed: 'Continue from handoff',
      model: 'claude-sonnet',
      effort: 'medium',
      permissionLevel: 'yolo',
    });
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });

  it('confirms an interactive successor only after its matching bind acknowledgement', async () => {
    const h = makeHarness();
    h.getActiveWebviews.mockReturnValue(['webview-1']);

    const outcome = h.adapter.startSuccessorSession(successorInput);
    await Promise.resolve();
    const [type, payload] = h.broadcastMessage.mock.calls[0] as [string, {
      operationId: string;
      sourceTabId: string;
      successorTabId: string;
    }];
    expect(type).toBe(MESSAGE_TYPES.SESSION_SUCCESSOR_REPLACEMENT);
    expect(h.adapter.acknowledgeSuccessorBound(
      payload.operationId,
      payload.sourceTabId,
      payload.successorTabId,
    )).toBe(true);

    await expect(outcome).resolves.toEqual(expect.objectContaining({
      started: true,
      uiAnnounced: true,
      successorTabId: payload.successorTabId,
    }));
    expect(h.stopHandoverSuccessor).not.toHaveBeenCalled();
  });

  it('ends the successor when its interactive tab does not bind before timeout', async () => {
    jest.useFakeTimers();
    try {
      const h = makeHarness();
      h.getActiveWebviews.mockReturnValue(['webview-1']);

      const outcome = h.adapter.startSuccessorSession(successorInput);
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(SUCCESSOR_BIND_TIMEOUT_MS);

      await expect(outcome).resolves.toEqual({
        started: false,
        error: 'successor tab was not bound before timeout',
      });
      const [[{ tabId: successorTabId }]] = h.startHandoverSuccessor.mock.calls;
      expect(h.stopHandoverSuccessor).toHaveBeenCalledWith(successorTabId);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops a bound successor when its source ends during coordinator completion', async () => {
    const h = makeHarness();
    h.getActiveWebviews.mockReturnValue([]);

    await expect(h.adapter.startSuccessorSession(successorInput)).resolves.toEqual(expect.objectContaining({
      started: true,
      uiAnnounced: false,
      successorTabId: expect.any(String),
    }));
    await h.adapter.stopSuccessorSession(successorInput.operationId);

    const [[{ tabId: successorTabId }]] = h.startHandoverSuccessor.mock.calls;
    expect(h.stopHandoverSuccessor).toHaveBeenCalledWith(successorTabId);
  });

  it('announces the tab with the descriptor, then starts the session', async () => {
    const h = makeHarness();

    const outcome = await h.adapter.startChildSession(input);

    expect(outcome).toEqual({ started: true, uiAnnounced: true });
    expect(h.order).toEqual([
      `broadcast:${MESSAGE_TYPES.AGENT_SESSION_OPENED}`,
      'start',
    ]);
    expect(h.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.AGENT_SESSION_OPENED,
      descriptor,
    );
    expect(h.startAgentChildSession).toHaveBeenCalledWith({
      tabId: CHILD_TAB,
      workspaceRoot: '/repo',
      worktreePath: '/repo/.ptah/worktrees/child-1',
      prompt: 'contract + task',
      sessionName: 'child: fix the parser',
      model: 'claude-child-model',
    });
    expect(chatErrorCalls(h)).toHaveLength(0);
  });

  it('still starts when the announcement fails, reporting uiAnnounced: false', async () => {
    const h = makeHarness();
    h.broadcastMessage.mockRejectedValueOnce(new Error('no webview'));

    const outcome = await h.adapter.startChildSession(input);

    expect(outcome).toEqual({ started: true, uiAnnounced: false });
    expect(h.startAgentChildSession).toHaveBeenCalledTimes(1);
  });

  describe('when the tab was announced', () => {
    it('a { success: false } start returns the error and sends exactly one chat:error', async () => {
      const h = makeHarness();
      h.startAgentChildSession.mockResolvedValueOnce({
        success: false,
        error: 'Access denied: worktree path is not inside an open folder.',
      });

      const outcome = await h.adapter.startChildSession(input);

      expect(outcome).toEqual({
        started: false,
        error: 'Access denied: worktree path is not inside an open folder.',
      });
      expect(chatErrorCalls(h)).toEqual([
        [
          MESSAGE_TYPES.CHAT_ERROR,
          {
            tabId: CHILD_TAB,
            sessionId: CHILD_TAB,
            error:
              'Child session could not start: Access denied: worktree path is not inside an open folder.',
          },
        ],
      ]);
    });

    it('a thrown start returns the error and sends exactly one chat:error', async () => {
      const h = makeHarness();
      h.startAgentChildSession.mockRejectedValueOnce(new Error('kaboom'));

      const outcome = await h.adapter.startChildSession(input);

      expect(outcome).toEqual({ started: false, error: 'kaboom' });
      expect(chatErrorCalls(h)).toEqual([
        [
          MESSAGE_TYPES.CHAT_ERROR,
          {
            tabId: CHILD_TAB,
            sessionId: CHILD_TAB,
            error: 'Child session could not start: kaboom',
          },
        ],
      ]);
    });

    it('a failing chat:error broadcast is swallowed and the outcome is unchanged', async () => {
      const h = makeHarness();
      h.startAgentChildSession.mockResolvedValueOnce({
        success: false,
        error: 'nope',
      });
      h.broadcastMessage
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('channel closed'));

      await expect(h.adapter.startChildSession(input)).resolves.toEqual({
        started: false,
        error: 'nope',
      });
      expect(chatErrorCalls(h)).toHaveLength(1);
    });

    it('a { success: false } start without an error text still reports a reason', async () => {
      const h = makeHarness();
      h.startAgentChildSession.mockResolvedValueOnce({ success: false });

      const outcome = await h.adapter.startChildSession(input);

      expect(outcome).toEqual({ started: false, error: 'unknown error' });
      expect(chatErrorCalls(h)).toHaveLength(1);
    });
  });

  describe('when the tab was not announced', () => {
    it('a { success: false } start sends no chat:error', async () => {
      const h = makeHarness();
      h.broadcastMessage.mockRejectedValueOnce(new Error('no webview'));
      h.startAgentChildSession.mockResolvedValueOnce({
        success: false,
        error: 'nope',
      });

      const outcome = await h.adapter.startChildSession(input);

      expect(outcome).toEqual({ started: false, error: 'nope' });
      expect(chatErrorCalls(h)).toHaveLength(0);
    });

    it('a thrown start sends no chat:error', async () => {
      const h = makeHarness();
      h.broadcastMessage.mockRejectedValueOnce(new Error('no webview'));
      h.startAgentChildSession.mockRejectedValueOnce('string failure');

      const outcome = await h.adapter.startChildSession(input);

      expect(outcome).toEqual({ started: false, error: 'string failure' });
      expect(chatErrorCalls(h)).toHaveLength(0);
    });
  });
});
