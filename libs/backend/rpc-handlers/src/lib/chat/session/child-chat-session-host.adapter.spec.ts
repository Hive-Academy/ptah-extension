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
 *   - TASK_2026_655: `startHandoffSession` follows the same order with
 *     `sessionHandoff:opened`, passes cwd, model and permission level through,
 *     starts at most once per call, and never puts a thrown message (which
 *     may quote the prompt) into its outcome or its `chat:error`.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  type AgentSessionOpenedPayload,
  type SessionHandoffOpenedPayload,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  ChildChatSessionStartInput,
  HandoffChatSessionStartInput,
} from '@ptah-extension/cli-agent-runtime';

import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';

import { ChildChatSessionHostAdapter } from './child-chat-session-host.adapter';
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

const HANDOFF_TAB = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const HANDOFF_PROMPT = 'SECRET-CONTINUATION continue the parser work';

const handoffDescriptor: SessionHandoffOpenedPayload = {
  tabId: HANDOFF_TAB,
  fromTabId: '11111111-2222-4333-8444-555555555555',
  fromSessionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
  workspaceRoot: '/repo',
  cwd: '/repo/packages/parser',
  label: 'Continued: fix the parser',
  displayPrompt: HANDOFF_PROMPT,
  startedAt: 1_700_000_000_000,
};

const handoffInput: HandoffChatSessionStartInput = {
  tabId: HANDOFF_TAB,
  workspaceRoot: '/repo',
  cwd: '/repo/packages/parser',
  prompt: HANDOFF_PROMPT,
  sessionName: 'Continued: fix the parser',
  descriptor: handoffDescriptor,
  model: 'claude-parent-model',
  permissionLevel: 'yolo',
};

interface Harness {
  adapter: ChildChatSessionHostAdapter;
  broadcastMessage: jest.Mock;
  startAgentChildSession: jest.Mock;
  startHandoffSession: jest.Mock;
  logger: ReturnType<typeof createMockLogger>;
  order: string[];
}

function makeHarness(lifecycle: { find: jest.Mock } | null = null): Harness {
  const order: string[] = [];
  const broadcastMessage = jest.fn(async (type: string) => {
    order.push(`broadcast:${type}`);
  });
  const startAgentChildSession = jest.fn(async () => {
    order.push('start');
    return { success: true };
  });
  const startHandoffSession = jest.fn(async () => {
    order.push('start-handoff');
    return { success: true };
  });
  const logger = createMockLogger();
  const adapter = new ChildChatSessionHostAdapter(
    logger as unknown as Logger,
    {
      broadcastMessage,
      sendMessage: jest.fn(),
    } as unknown as WebviewManager,
    {
      startAgentChildSession,
      startHandoffSession,
    } as unknown as ChatSessionService,
    lifecycle as unknown as SessionLifecycleManager | null,
  );
  return {
    adapter,
    broadcastMessage,
    startAgentChildSession,
    startHandoffSession,
    logger,
    order,
  };
}

function chatErrorCalls(h: Harness): unknown[][] {
  return h.broadcastMessage.mock.calls.filter(
    ([type]) => type === MESSAGE_TYPES.CHAT_ERROR,
  );
}

describe('ChildChatSessionHostAdapter', () => {
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

  it('uses the captured parent level when its lifecycle record is gone', async () => {
    const h = makeHarness();

    await h.adapter.startChildSession({ ...input, permissionLevel: 'yolo' });

    expect(h.startAgentChildSession).toHaveBeenCalledWith(
      expect.objectContaining({ permissionLevel: 'yolo' }),
    );
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

describe('ChildChatSessionHostAdapter.startHandoffSession (TASK_2026_655)', () => {
  function loggedText(h: Harness): string {
    return JSON.stringify([
      h.logger.debug.mock.calls,
      h.logger.info.mock.calls,
      h.logger.warn.mock.calls,
      h.logger.error.mock.calls,
    ]);
  }

  it('announces sessionHandoff:opened with the descriptor, then starts the session once', async () => {
    const h = makeHarness();

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({ started: true, uiAnnounced: true });
    expect(h.order).toEqual([
      `broadcast:${MESSAGE_TYPES.SESSION_HANDOFF_OPENED}`,
      'start-handoff',
    ]);
    expect(h.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.SESSION_HANDOFF_OPENED,
      handoffDescriptor,
    );
    expect(h.startHandoffSession).toHaveBeenCalledTimes(1);
    expect(h.startHandoffSession).toHaveBeenCalledWith({
      tabId: HANDOFF_TAB,
      workspaceRoot: '/repo',
      cwd: '/repo/packages/parser',
      prompt: HANDOFF_PROMPT,
      sessionName: 'Continued: fix the parser',
      model: 'claude-parent-model',
      permissionLevel: 'yolo',
    });
    expect(h.startAgentChildSession).not.toHaveBeenCalled();
    expect(chatErrorCalls(h)).toHaveLength(0);
  });

  it.each(['yolo', 'plan', 'auto-edit', 'ask'] as const)(
    'keeps the caller level %s for the new session',
    async (level) => {
      const h = makeHarness();

      await h.adapter.startHandoffSession({
        ...handoffInput,
        permissionLevel: level,
      });

      expect(h.startHandoffSession).toHaveBeenCalledWith(
        expect.objectContaining({ permissionLevel: level }),
      );
    },
  );

  it('falls back to the caller record level (full autopilot) when the input has none', async () => {
    const find = jest.fn().mockReturnValue({ permissionLevel: 'yolo' });
    const h = makeHarness({ find });

    await h.adapter.startHandoffSession({
      ...handoffInput,
      permissionLevel: undefined,
    });

    expect(find).toHaveBeenCalledWith(handoffDescriptor.fromTabId);
    expect(h.startHandoffSession).toHaveBeenCalledWith(
      expect.objectContaining({ permissionLevel: 'yolo' }),
    );
  });

  it('prefers the level the runtime read at handoff time over the record', async () => {
    const find = jest.fn().mockReturnValue({ permissionLevel: 'ask' });
    const h = makeHarness({ find });

    await h.adapter.startHandoffSession(handoffInput);

    expect(h.startHandoffSession).toHaveBeenCalledWith(
      expect.objectContaining({ permissionLevel: 'yolo' }),
    );
  });

  it('omits model and permission level when the caller had none', async () => {
    const h = makeHarness();
    const bare: HandoffChatSessionStartInput = {
      tabId: HANDOFF_TAB,
      workspaceRoot: '/repo',
      cwd: '/repo',
      prompt: HANDOFF_PROMPT,
      sessionName: 'Continued: session',
      descriptor: handoffDescriptor,
    };

    await h.adapter.startHandoffSession(bare);

    const params = h.startHandoffSession.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(params).not.toHaveProperty('model');
    expect(params).not.toHaveProperty('permissionLevel');
  });

  it('still starts when the announcement fails, reporting uiAnnounced: false', async () => {
    const h = makeHarness();
    h.broadcastMessage.mockRejectedValueOnce(new Error('no webview'));

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({ started: true, uiAnnounced: false });
    expect(h.startHandoffSession).toHaveBeenCalledTimes(1);
    expect(chatErrorCalls(h)).toHaveLength(0);
  });

  it('after an announced { success: false } start, returns the error and sends one chat:error', async () => {
    const h = makeHarness();
    h.startHandoffSession.mockResolvedValueOnce({
      success: false,
      error: 'Access denied: working directory is not inside an open folder.',
    });

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({
      started: false,
      error: 'Access denied: working directory is not inside an open folder.',
    });
    expect(chatErrorCalls(h)).toEqual([
      [
        MESSAGE_TYPES.CHAT_ERROR,
        {
          tabId: HANDOFF_TAB,
          sessionId: HANDOFF_TAB,
          error:
            'Handoff session could not start: Access denied: working directory is not inside an open folder.',
        },
      ],
    ]);
    expect(h.startHandoffSession).toHaveBeenCalledTimes(1);
  });

  it('a thrown start returns started: false with only the error name, never its message', async () => {
    const h = makeHarness();
    h.startHandoffSession.mockRejectedValueOnce(
      new TypeError(`bad input: ${HANDOFF_PROMPT}`),
    );

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({
      started: false,
      error: 'the session launch threw (TypeError).',
    });
    expect(chatErrorCalls(h)).toEqual([
      [
        MESSAGE_TYPES.CHAT_ERROR,
        {
          tabId: HANDOFF_TAB,
          sessionId: HANDOFF_TAB,
          error:
            'Handoff session could not start: the session launch threw (TypeError).',
        },
      ],
    ]);
    expect(loggedText(h)).not.toContain('SECRET-CONTINUATION');
    expect(h.startHandoffSession).toHaveBeenCalledTimes(1);
  });

  it('a failed start without an announced tab sends no chat:error', async () => {
    const h = makeHarness();
    h.broadcastMessage.mockRejectedValueOnce(new Error('no webview'));
    h.startHandoffSession.mockResolvedValueOnce({
      success: false,
      error: 'nope',
    });

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({ started: false, error: 'nope' });
    expect(chatErrorCalls(h)).toHaveLength(0);
  });

  it('a failing chat:error broadcast is swallowed and the outcome is unchanged', async () => {
    const h = makeHarness();
    h.startHandoffSession.mockResolvedValueOnce({ success: false });
    h.broadcastMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('channel closed'));

    await expect(h.adapter.startHandoffSession(handoffInput)).resolves.toEqual({
      started: false,
      error: 'unknown error',
    });
    expect(chatErrorCalls(h)).toHaveLength(1);
  });

  it('never logs the prompt', async () => {
    const h = makeHarness();
    h.broadcastMessage.mockRejectedValueOnce(new Error('no webview'));

    await h.adapter.startHandoffSession(handoffInput);

    expect(loggedText(h)).not.toContain('SECRET-CONTINUATION');
  });
});
