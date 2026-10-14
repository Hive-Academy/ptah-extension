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
 *   - Fix round B2: the announcement is a per-webview `sendMessage`;
 *     `uiAnnounced` is true only when one accepted it (no webview, a `false`
 *     send or a throw → false), and an error's name/code reach a log or
 *     `chat:error` only through the `safeErrorKind` allowlist.
 */

import 'reflect-metadata';

// Same stub as `chat/di.spec`: the adapter imports `safeErrorKind` from the
// `cli-agent-runtime` barrel, which reaches `agent-generation` and, through it,
// `workspace-intelligence`'s TreeSitter module (`import.meta.url`, which
// ts-jest's CJS transform cannot parse).
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
    SETUP_WIZARD_SERVICE: Symbol.for('SetupWizardService'),
  },
}));

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
  sendMessage: jest.Mock;
  getActiveWebviews: jest.Mock;
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
  // The announcement goes to each open webview through `sendMessage`.
  const getActiveWebviews = jest.fn((): readonly string[] => ['ptah.main']);
  const sendMessage = jest.fn(
    async (_viewType: string, type: string): Promise<boolean> => {
      order.push(`send:${type}`);
      return true;
    },
  );
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
    { broadcastMessage, sendMessage, getActiveWebviews },
    {
      startAgentChildSession,
      startHandoffSession,
    } as unknown as ChatSessionService,
    lifecycle as unknown as SessionLifecycleManager | null,
  );
  return {
    adapter,
    broadcastMessage,
    sendMessage,
    getActiveWebviews,
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
      `send:${MESSAGE_TYPES.AGENT_SESSION_OPENED}`,
      'start',
    ]);
    expect(h.sendMessage).toHaveBeenCalledWith(
      'ptah.main',
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
    h.getActiveWebviews.mockReturnValueOnce([]);

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
      h.broadcastMessage.mockRejectedValueOnce(new Error('channel closed'));

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
      h.getActiveWebviews.mockReturnValueOnce([]);
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
      h.getActiveWebviews.mockReturnValueOnce([]);
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
      `send:${MESSAGE_TYPES.SESSION_HANDOFF_OPENED}`,
      'start-handoff',
    ]);
    expect(h.sendMessage).toHaveBeenCalledWith(
      'ptah.main',
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

  it('still starts with no open webview, reporting uiAnnounced: false', async () => {
    const h = makeHarness();
    h.getActiveWebviews.mockReturnValueOnce([]);

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({ started: true, uiAnnounced: false });
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.startHandoffSession).toHaveBeenCalledTimes(1);
    expect(chatErrorCalls(h)).toHaveLength(0);
  });

  it('reports uiAnnounced: false when every webview refuses the send', async () => {
    const h = makeHarness();
    h.getActiveWebviews.mockReturnValueOnce(['ptah.main', 'ptah.sidebar']);
    h.sendMessage.mockResolvedValue(false);

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({ started: true, uiAnnounced: false });
    expect(h.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('reports uiAnnounced: true when at least one webview accepted the send', async () => {
    const h = makeHarness();
    h.getActiveWebviews.mockReturnValueOnce(['ptah.main', 'ptah.sidebar']);
    h.sendMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({ started: true, uiAnnounced: true });
  });

  it('treats a throwing enumeration as not announced', async () => {
    const h = makeHarness();
    h.getActiveWebviews.mockImplementationOnce(() => {
      throw new Error('disposed');
    });

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({ started: true, uiAnnounced: false });
    expect(h.startHandoffSession).toHaveBeenCalledTimes(1);
  });

  it('a send that throws the prompt in its message, name and code logs none of it', async () => {
    const h = makeHarness();
    const failure = Object.assign(new Error(`post failed: ${HANDOFF_PROMPT}`), {
      code: `E_${HANDOFF_PROMPT}`,
    });
    failure.name = `Quoting ${HANDOFF_PROMPT}`;
    h.sendMessage.mockImplementationOnce(() => {
      throw failure;
    });
    h.startHandoffSession.mockResolvedValueOnce({
      success: false,
      error: 'the session launch failed (unknown).',
    });

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({
      started: false,
      error: 'the session launch failed (unknown).',
    });
    expect(chatErrorCalls(h)).toHaveLength(0);
    expect(loggedText(h)).not.toContain('SECRET-CONTINUATION');
    expect(loggedText(h)).toContain('unknown');
  });

  it('a thrown start whose name and code quote the prompt reports only "unknown"', async () => {
    const h = makeHarness();
    const failure = Object.assign(new Error(`bad: ${HANDOFF_PROMPT}`), {
      code: `E_${HANDOFF_PROMPT}`,
    });
    failure.name = `Quoting ${HANDOFF_PROMPT}`;
    h.startHandoffSession.mockRejectedValueOnce(failure);
    h.broadcastMessage.mockRejectedValueOnce(failure);

    const outcome = await h.adapter.startHandoffSession(handoffInput);

    expect(outcome).toEqual({
      started: false,
      error: 'the session launch threw (unknown).',
    });
    expect(chatErrorCalls(h)).toEqual([
      [
        MESSAGE_TYPES.CHAT_ERROR,
        {
          tabId: HANDOFF_TAB,
          sessionId: HANDOFF_TAB,
          error:
            'Handoff session could not start: the session launch threw (unknown).',
        },
      ],
    ]);
    expect(loggedText(h)).not.toContain('SECRET-CONTINUATION');
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
    h.getActiveWebviews.mockReturnValueOnce([]);
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
    h.broadcastMessage.mockRejectedValueOnce(new Error('channel closed'));

    await expect(h.adapter.startHandoffSession(handoffInput)).resolves.toEqual({
      started: false,
      error: 'unknown error',
    });
    expect(chatErrorCalls(h)).toHaveLength(1);
  });

  it('never logs the prompt', async () => {
    const h = makeHarness();
    h.getActiveWebviews.mockReturnValueOnce([]);

    await h.adapter.startHandoffSession(handoffInput);

    expect(loggedText(h)).not.toContain('SECRET-CONTINUATION');
  });
});
