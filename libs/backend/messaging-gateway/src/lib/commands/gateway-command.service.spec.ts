import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { GatewayCommandService } from './gateway-command.service';
import { COMMAND_REPLIES, workspaceBasename } from './command-replies';
import type {
  GatewayCommand,
  GatewayCommandInvocation,
  GatewayAutocompleteRequest,
} from './gateway-command.types';
import { AttachedSessionRegistry } from '../attached-session-registry';
import { ConversationTurnTracker } from '../turn-activity-tracker';
import { workspaceRootDigest } from '../workspace-resolution';
import {
  BindingId,
  ConversationKey,
  type ApprovalStatus,
  type GatewayBinding,
  type GatewayConversation,
  type GatewayConversationId,
} from '../types';
import type { BindingStore } from '../binding.store';
import type { ConversationStore } from '../conversation.store';
import type { ISessionResumabilityChecker } from '../session-resumability';
import type {
  GatewaySessionSummary,
  IGatewaySessionLister,
} from '../session-lister.interface';
import type { ISessionActivityProbe } from '../session-activity.interface';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

const CHAT_ID = 'chan-1';
const THREAD_ID = 'thread-1';
const GUILD_ID = 'guild-1';
const WS_A = 'D:\\projects\\alpha';
const WS_B = 'D:\\projects\\beta';
const UUID_1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const UUID_2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const UUID_3 = 'cccccccc-3333-4333-8333-333333333333';

function makeBinding(overrides?: Partial<GatewayBinding>): GatewayBinding {
  return {
    id: BindingId.create('binding-1'),
    platform: 'discord',
    externalChatId: CHAT_ID,
    allowListId: GUILD_ID,
    displayName: 'chan',
    approvalStatus: 'approved' as ApprovalStatus,
    ptahSessionId: null,
    workspaceRoot: WS_A,
    pairingCode: null,
    createdAt: 1,
    approvedAt: 1,
    lastActiveAt: 1,
    ...overrides,
  };
}

function makeConversation(
  overrides?: Partial<GatewayConversation>,
): GatewayConversation {
  return {
    id: 'conv-1' as GatewayConversationId,
    bindingId: BindingId.create('binding-1'),
    externalConversationId: THREAD_ID,
    ptahSessionId: null,
    workspaceRoot: null,
    createdAt: 1,
    lastActiveAt: 1,
    ...overrides,
  };
}

function session(
  sessionId: string,
  name: string,
  lastActiveAt = 1_000,
): GatewaySessionSummary {
  return { sessionId, name, lastActiveAt };
}

interface Fixture {
  service: GatewayCommandService;
  workspace: {
    getWorkspaceFolders: jest.Mock;
    getWorkspaceRoot: jest.Mock;
    setActiveFolder: jest.Mock;
  };
  bindings: {
    findByExternal: jest.Mock;
    upsertPending: jest.Mock;
    setWorkspaceRoot: jest.Mock;
  };
  conversations: {
    findByExternal: jest.Mock;
    resolveOrAdopt: jest.Mock;
    setPtahSessionId: jest.Mock;
    clearPtahSessionId: jest.Mock;
    setWorkspaceRoot: jest.Mock;
    setWorkspaceRootAndClearSession: jest.Mock;
    findBySessionId: jest.Mock;
  };
  registry: AttachedSessionRegistry;
  resumability: { isResumable: jest.Mock };
  tracker: ConversationTurnTracker;
  lister: { listForWorkspace: jest.Mock };
  probe: { isActive: jest.Mock };
}

function createFixture(args?: {
  folders?: string[];
  activeRoot?: string;
  binding?: GatewayBinding | null;
  conversation?: GatewayConversation | null;
  sessions?: GatewaySessionSummary[];
  truncated?: boolean;
}): Fixture {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const workspace = {
    getWorkspaceFolders: jest.fn(() => args?.folders ?? [WS_A, WS_B]),
    getWorkspaceRoot: jest.fn(() => args?.activeRoot),
    setActiveFolder: jest.fn(),
  };
  const binding = args?.binding === undefined ? makeBinding() : args.binding;
  const conversation =
    args?.conversation === undefined ? makeConversation() : args.conversation;
  const bindings = {
    findByExternal: jest.fn(() => binding),
    upsertPending: jest.fn(),
    setWorkspaceRoot: jest.fn(),
  };
  const conversations = {
    findByExternal: jest.fn(() => conversation),
    resolveOrAdopt: jest.fn(() => conversation),
    setPtahSessionId: jest.fn(),
    clearPtahSessionId: jest.fn(),
    setWorkspaceRoot: jest.fn(),
    setWorkspaceRootAndClearSession: jest.fn(),
    findBySessionId: jest.fn(() => []),
  };
  const registry = new AttachedSessionRegistry();
  const resumability = { isResumable: jest.fn().mockResolvedValue(true) };
  const tracker = new ConversationTurnTracker();
  const lister = {
    listForWorkspace: jest.fn().mockResolvedValue({
      sessions: args?.sessions ?? [],
      truncated: args?.truncated ?? false,
    }),
  };
  const probe = { isActive: jest.fn(() => false) };

  const service = new GatewayCommandService(
    logger as unknown as Logger,
    workspace as unknown as IWorkspaceProvider,
    bindings as unknown as BindingStore,
    conversations as unknown as ConversationStore,
    registry,
    resumability as unknown as ISessionResumabilityChecker,
    tracker,
    lister as unknown as IGatewaySessionLister,
    probe as unknown as ISessionActivityProbe,
  );

  return {
    service,
    workspace,
    bindings,
    conversations,
    registry,
    resumability,
    tracker,
    lister,
    probe,
  };
}

function inv(
  command: GatewayCommand,
  opts?: { threadId?: string | undefined; allowListId?: string },
): GatewayCommandInvocation {
  return {
    platform: 'discord',
    externalChatId: CHAT_ID,
    ...(opts && 'threadId' in opts
      ? opts.threadId !== undefined
        ? { threadId: opts.threadId }
        : {}
      : { threadId: THREAD_ID }),
    allowListId: opts?.allowListId ?? GUILD_ID,
    command,
  };
}

function autocompleteReq(
  target: 'session-pick' | 'workspace-pick',
  query = '',
  opts?: { threadId?: string | undefined; allowListId?: string },
): GatewayAutocompleteRequest {
  return {
    platform: 'discord',
    externalChatId: CHAT_ID,
    ...(opts && 'threadId' in opts
      ? opts.threadId !== undefined
        ? { threadId: opts.threadId }
        : {}
      : { threadId: THREAD_ID }),
    allowListId: opts?.allowListId ?? GUILD_ID,
    target,
    query,
  };
}

function expectNoMutations(f: Fixture): void {
  expect(f.conversations.setPtahSessionId).not.toHaveBeenCalled();
  expect(f.conversations.clearPtahSessionId).not.toHaveBeenCalled();
  expect(f.conversations.setWorkspaceRoot).not.toHaveBeenCalled();
  expect(
    f.conversations.setWorkspaceRootAndClearSession,
  ).not.toHaveBeenCalled();
  expect(f.bindings.setWorkspaceRoot).not.toHaveBeenCalled();
  expect(f.bindings.upsertPending).not.toHaveBeenCalled();
}

describe('GatewayCommandService', () => {
  describe('approval gate (SEC-5, AC-2.6/5.6)', () => {
    it('refuses generically when no binding exists — no data disclosed, no pairing created', async () => {
      const f = createFixture({ binding: null });
      const outcome = await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(outcome).toEqual({ ephemeralText: COMMAND_REPLIES.notPaired });
      expect(f.lister.listForWorkspace).not.toHaveBeenCalled();
      expectNoMutations(f);
    });

    it('replies with pairing guidance WITHOUT the code for pending bindings and never upsertPending', async () => {
      const f = createFixture({
        binding: makeBinding({
          approvalStatus: 'pending',
          pairingCode: '123456',
        }),
      });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.pendingApproval,
      });
      expect(outcome.ephemeralText).not.toContain('123456');
      expect(f.bindings.upsertPending).not.toHaveBeenCalled();
      expect(f.lister.listForWorkspace).not.toHaveBeenCalled();
    });

    it.each(['rejected', 'revoked'] as const)(
      'refuses %s bindings with the generic reply',
      async (status) => {
        const f = createFixture({
          binding: makeBinding({ approvalStatus: status }),
        });
        const outcome = await f.service.handleCommand(
          inv({ kind: 'workspace-list' }),
        );
        expect(outcome).toEqual({ ephemeralText: COMMAND_REPLIES.notPaired });
        expect(f.workspace.getWorkspaceFolders).not.toHaveBeenCalled();
      },
    );
  });

  describe('rate limiting (SEC-7)', () => {
    it('drops the 61st command in a minute per allowListId', async () => {
      const f = createFixture({ binding: null });
      for (let i = 0; i < 60; i++) {
        const outcome = await f.service.handleCommand(
          inv({ kind: 'sessions' }),
        );
        expect(outcome.ephemeralText).toBe(COMMAND_REPLIES.notPaired);
      }
      const blocked = await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(blocked).toEqual({ ephemeralText: COMMAND_REPLIES.rateLimited });
      expect(f.bindings.findByExternal).toHaveBeenCalledTimes(60);
    });

    it('autocomplete shares the window and returns [] when capped', async () => {
      const f = createFixture();
      for (let i = 0; i < 60; i++) {
        await f.service.handleCommand(inv({ kind: 'workspace-list' }));
      }
      const choices = await f.service.handleAutocomplete(
        autocompleteReq('workspace-pick'),
      );
      expect(choices).toEqual([]);
      expect(f.bindings.findByExternal).toHaveBeenCalledTimes(60);
    });

    it('keys the window on allowListId — other guilds are unaffected', async () => {
      const f = createFixture();
      for (let i = 0; i < 60; i++) {
        await f.service.handleCommand(inv({ kind: 'workspace-list' }));
      }
      const other = await f.service.handleCommand(
        inv({ kind: 'workspace-list' }, { allowListId: 'guild-2' }),
      );
      expect(other.ephemeralText).not.toBe(COMMAND_REPLIES.rateLimited);
    });
  });

  describe('/sessions (US-2)', () => {
    it('lists the effective workspace sessions with name, uuid8, humanized time (AC-2.1)', async () => {
      const now = Date.now();
      const f = createFixture({
        sessions: [
          session(UUID_1, 'fix build', now - 2 * 60 * 60 * 1000),
          session(UUID_2, 'add tests', now - 5 * 60 * 1000),
        ],
      });
      const outcome = await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(f.lister.listForWorkspace).toHaveBeenCalledWith(WS_A);
      expect(outcome.ephemeralText).toContain('fix build');
      expect(outcome.ephemeralText).toContain(UUID_1.slice(0, 8));
      expect(outcome.ephemeralText).toContain('2h ago');
      expect(outcome.ephemeralText).toContain('5m ago');
      expect(outcome.publicText).toBeUndefined();
    });

    it('prefers the conversation-pinned root over the binding root (AC-7.2)', async () => {
      const f = createFixture({
        conversation: makeConversation({ workspaceRoot: WS_B }),
      });
      await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(f.lister.listForWorkspace).toHaveBeenCalledWith(WS_B);
    });

    it('notes truncation when the lister capped the list (AC-2.2)', async () => {
      const f = createFixture({
        sessions: [session(UUID_1, 's1')],
        truncated: true,
      });
      const outcome = await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(outcome.ephemeralText).toContain('truncated');
    });

    it('replies explicitly for zero sessions (AC-2.3)', async () => {
      const f = createFixture({ sessions: [] });
      const outcome = await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(outcome.ephemeralText).toBe(
        `No resumable sessions for \`${workspaceBasename(WS_A)}\`.`,
      );
    });

    it('marks the currently attached session (AC-2.4)', async () => {
      const f = createFixture({
        conversation: makeConversation({ ptahSessionId: UUID_2 }),
        sessions: [session(UUID_1, 's1'), session(UUID_2, 's2')],
      });
      const outcome = await f.service.handleCommand(inv({ kind: 'sessions' }));
      const currentLine = outcome.ephemeralText
        .split('\n')
        .find((l) => l.includes(UUID_2.slice(0, 8)));
      expect(currentLine).toContain('(current)');
      const otherLine = outcome.ephemeralText
        .split('\n')
        .find((l) => l.includes(UUID_1.slice(0, 8)));
      expect(otherLine).not.toContain('(current)');
    });

    it('works in a parent channel against the binding-effective root and points at threads (AC-2.5)', async () => {
      const f = createFixture({ sessions: [session(UUID_1, 's1')] });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'sessions' }, { threadId: undefined }),
      );
      expect(f.conversations.findByExternal).not.toHaveBeenCalled();
      expect(f.lister.listForWorkspace).toHaveBeenCalledWith(WS_A);
      expect(outcome.ephemeralText).toContain(
        COMMAND_REPLIES.parentChannelAttachNote,
      );
    });

    it('fails closed when the conversation root left the allowlist (Data-2)', async () => {
      const f = createFixture({
        conversation: makeConversation({ workspaceRoot: 'D:\\gone\\away' }),
      });
      const outcome = await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(outcome.ephemeralText).toBe(
        COMMAND_REPLIES.conversationRootRevoked,
      );
      expect(f.lister.listForWorkspace).not.toHaveBeenCalled();
    });

    it('reports no-workspace-open when nothing resolves', async () => {
      const f = createFixture({
        binding: makeBinding({ workspaceRoot: null }),
        conversation: null,
      });
      const outcome = await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(outcome.ephemeralText).toBe(COMMAND_REPLIES.noWorkspaceOpen);
    });
  });

  describe('/session use (US-3)', () => {
    const listed = [session(UUID_1, 'fix build'), session(UUID_2, 'add tests')];

    it('refuses in a parent channel (AC-3.8)', async () => {
      const f = createFixture({ sessions: listed });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }, { threadId: undefined }),
      );
      expect(outcome).toEqual({ ephemeralText: COMMAND_REPLIES.threadOnly });
      expect(f.conversations.resolveOrAdopt).not.toHaveBeenCalled();
      expectNoMutations(f);
    });

    it('refuses while a turn is in flight for this conversation (AC-3.6)', async () => {
      const f = createFixture({ sessions: listed });
      f.tracker.begin(ConversationKey.for('discord', CHAT_ID, THREAD_ID));
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.turnInProgress,
      });
      expectNoMutations(f);
    });

    it('does not block on turns in OTHER conversations (NFR-4)', async () => {
      const f = createFixture({ sessions: listed });
      f.tracker.begin(ConversationKey.for('discord', CHAT_ID, 'thread-9'));
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }),
      );
      expect(outcome.publicText).toBeDefined();
    });

    it('refuses a pick matching nothing in the re-derived set (AC-3.3, SEC-1)', async () => {
      const f = createFixture({ sessions: listed });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_3 }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.sessionPickUnresolved,
      });
      expectNoMutations(f);
    });

    it('refuses an ambiguous prefix (AC-3.3)', async () => {
      const f = createFixture({
        sessions: [session(UUID_1, 'fix build'), session(UUID_2, 'fix bug')],
      });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: 'fix' }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.sessionPickUnresolved,
      });
      expectNoMutations(f);
    });

    it('resolves a unique uuid prefix', async () => {
      const f = createFixture({ sessions: listed });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: 'aaaaaaaa' }),
      );
      expect(f.conversations.setPtahSessionId).toHaveBeenCalledWith(
        'conv-1',
        UUID_1,
      );
      expect(outcome.publicText).toContain('fix build');
    });

    it('re-runs the resumability gate on the effective root (AC-3.2)', async () => {
      const f = createFixture({ sessions: listed });
      f.resumability.isResumable.mockResolvedValue(false);
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }),
      );
      expect(f.resumability.isResumable).toHaveBeenCalledWith(UUID_1, WS_A);
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.sessionNotResumable,
      });
      expectNoMutations(f);
    });

    it('refuses a session registered to another binding — no stealing (AC-3.4, SEC-3)', async () => {
      const f = createFixture({ sessions: listed });
      f.registry.attach(UUID_1, 'other-binding');
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.sessionInUseElsewhere,
      });
      expect(f.registry.bindingFor(UUID_1)).toBe('other-binding');
      expectNoMutations(f);
    });

    it('refuses a session durably owned by another conversation row (AC-3.4)', async () => {
      const f = createFixture({ sessions: listed });
      f.conversations.findBySessionId.mockReturnValue([
        makeConversation({ id: 'conv-other' as GatewayConversationId }),
      ]);
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.sessionInUseElsewhere,
      });
      expectNoMutations(f);
    });

    it('refuses a session currently active in the agent adapter (AC-3.5, SEC-3)', async () => {
      const f = createFixture({ sessions: listed });
      f.probe.isActive.mockReturnValue(true);
      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }),
      );
      expect(f.probe.isActive).toHaveBeenCalledWith(UUID_1);
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.sessionCurrentlyRunning,
      });
      expectNoMutations(f);
    });

    it('attaches on success: link set, registry swapped, no workspace write (AC-3.1/3.7/3.9)', async () => {
      const f = createFixture({
        conversation: makeConversation({ ptahSessionId: UUID_2 }),
        sessions: listed,
      });
      f.conversations.findBySessionId.mockReturnValue([]);
      f.registry.attach(UUID_2, 'binding-1');

      const outcome = await f.service.handleCommand(
        inv({ kind: 'session-use', pick: UUID_1 }),
      );

      expect(f.conversations.setPtahSessionId).toHaveBeenCalledWith(
        'conv-1',
        UUID_1,
      );
      expect(f.registry.bindingFor(UUID_2)).toBeNull();
      expect(f.registry.bindingFor(UUID_1)).toBe('binding-1');
      expect(f.conversations.setWorkspaceRoot).not.toHaveBeenCalled();
      expect(
        f.conversations.setWorkspaceRootAndClearSession,
      ).not.toHaveBeenCalled();
      expect(outcome.ephemeralText).toContain('fix build');
      expect(outcome.publicText).toContain(UUID_1.slice(0, 8));
    });

    it('validates the pick against the conversation-pinned workspace (AC-3.9 + AC-7.2)', async () => {
      const f = createFixture({
        conversation: makeConversation({ workspaceRoot: WS_B }),
        sessions: listed,
      });
      await f.service.handleCommand(inv({ kind: 'session-use', pick: UUID_1 }));
      expect(f.lister.listForWorkspace).toHaveBeenCalledWith(WS_B);
      expect(f.resumability.isResumable).toHaveBeenCalledWith(UUID_1, WS_B);
    });
  });

  describe('/new (US-4)', () => {
    it('refuses in a parent channel (AC-4.6)', async () => {
      const f = createFixture();
      const outcome = await f.service.handleCommand(
        inv({ kind: 'new' }, { threadId: undefined }),
      );
      expect(outcome).toEqual({ ephemeralText: COMMAND_REPLIES.threadOnly });
      expectNoMutations(f);
    });

    it('refuses mid-turn (AC-4.3)', async () => {
      const f = createFixture({
        conversation: makeConversation({ ptahSessionId: UUID_1 }),
      });
      f.tracker.begin(ConversationKey.for('discord', CHAT_ID, THREAD_ID));
      const outcome = await f.service.handleCommand(inv({ kind: 'new' }));
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.turnInProgress,
      });
      expectNoMutations(f);
    });

    it('is idempotent when no session is bound (AC-4.2)', async () => {
      const f = createFixture();
      const outcome = await f.service.handleCommand(inv({ kind: 'new' }));
      expect(outcome).toEqual({ ephemeralText: COMMAND_REPLIES.alreadyFresh });
      expect(f.conversations.clearPtahSessionId).not.toHaveBeenCalled();
      expect(outcome.publicText).toBeUndefined();
    });

    it('clears only this conversation and detaches the registry uuid (AC-4.1/4.5)', async () => {
      const f = createFixture({
        conversation: makeConversation({ ptahSessionId: UUID_1 }),
      });
      f.registry.attach(UUID_1, 'binding-1');
      const outcome = await f.service.handleCommand(inv({ kind: 'new' }));
      expect(f.conversations.clearPtahSessionId).toHaveBeenCalledTimes(1);
      expect(f.conversations.clearPtahSessionId).toHaveBeenCalledWith('conv-1');
      expect(f.registry.isAttached(UUID_1)).toBe(false);
      expect(outcome.publicText).toBeDefined();
    });
  });

  describe('/workspace list (US-5)', () => {
    it('lists exactly the provider folders with the current effective root marked (AC-5.1/5.2)', async () => {
      const f = createFixture({ folders: [WS_A, WS_B] });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-list' }),
      );
      expect(f.workspace.getWorkspaceFolders).toHaveBeenCalled();
      expect(outcome.ephemeralText).toContain('alpha (current)');
      expect(outcome.ephemeralText).toContain('beta');
      expect(outcome.publicText).toBeUndefined();
    });

    it('marks the binding-effective root in a parent channel (AC-5.1/5.5)', async () => {
      const f = createFixture({
        folders: [WS_A, WS_B],
        binding: makeBinding({ workspaceRoot: WS_B }),
      });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-list' }, { threadId: undefined }),
      );
      expect(outcome.ephemeralText).toContain('beta (current)');
    });

    it('disambiguates same-named folders (AC-5.1)', async () => {
      const f = createFixture({
        folders: ['D:\\one\\app', 'D:\\two\\app'],
        binding: makeBinding({ workspaceRoot: null }),
        conversation: null,
        activeRoot: 'D:\\one\\app',
      });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-list' }),
      );
      expect(outcome.ephemeralText).toContain('one/app');
      expect(outcome.ephemeralText).toContain('two/app');
    });

    it('points at the desktop app when zero workspaces exist (AC-5.3)', async () => {
      const f = createFixture({
        folders: [],
        binding: makeBinding({ workspaceRoot: null }),
        conversation: null,
      });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-list' }),
      );
      expect(outcome.ephemeralText).toBe(COMMAND_REPLIES.zeroWorkspaces);
    });

    it('caps at 25 and notes truncation (AC-5.4)', async () => {
      const folders = Array.from({ length: 30 }, (_, i) => `D:\\ws\\p-${i}`);
      const f = createFixture({ folders });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-list' }),
      );
      expect(outcome.ephemeralText).toContain('p-24');
      expect(outcome.ephemeralText).not.toContain('p-25');
      expect(outcome.ephemeralText).toContain('truncated');
    });
  });

  describe('/workspace use (US-6)', () => {
    const existingA = process.cwd();
    const existingB = os.tmpdir();
    const missing = path.join(
      os.tmpdir(),
      `ptah-gone-${process.pid}-does-not-exist`,
    );

    function switchFixture(args?: {
      conversation?: GatewayConversation | null;
      folders?: string[];
    }): Fixture {
      return createFixture({
        folders: args?.folders ?? [existingA, existingB],
        binding: makeBinding({ workspaceRoot: existingA }),
        conversation:
          args?.conversation === undefined
            ? makeConversation()
            : args.conversation,
      });
    }

    it('refuses in a parent channel — no binding-default mutation from chat (AC-6.8)', async () => {
      const f = switchFixture();
      const outcome = await f.service.handleCommand(
        inv(
          { kind: 'workspace-use', pick: existingB },
          { threadId: undefined },
        ),
      );
      expect(outcome).toEqual({ ephemeralText: COMMAND_REPLIES.threadOnly });
      expectNoMutations(f);
    });

    it('refuses mid-turn (AC-6.6)', async () => {
      const f = switchFixture();
      f.tracker.begin(ConversationKey.for('discord', CHAT_ID, THREAD_ID));
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-use', pick: existingB }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.turnInProgress,
      });
      expectNoMutations(f);
    });

    it('refuses a raw path outside the allowlist (SEC-1/SEC-2, AC-6.2)', async () => {
      const f = switchFixture();
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-use', pick: 'D:\\attacker\\payload' }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.workspacePickUnresolved,
      });
      expectNoMutations(f);
    });

    it('refuses a SUBPATH of an allowlisted folder — exact roots only (SEC-2)', async () => {
      const f = switchFixture();
      const outcome = await f.service.handleCommand(
        inv({
          kind: 'workspace-use',
          pick: path.join(existingB, 'nested', 'dir'),
        }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.workspacePickUnresolved,
      });
      expectNoMutations(f);
    });

    it('refuses an allowlisted folder that vanished from disk (AC-6.3)', async () => {
      const f = switchFixture({ folders: [existingA, missing] });
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-use', pick: missing }),
      );
      expect(outcome).toEqual({
        ephemeralText: COMMAND_REPLIES.workspaceNoLongerAvailable,
      });
      expectNoMutations(f);
    });

    it('is a session-preserving no-op when the pick equals the current effective root (AC-6.5)', async () => {
      const f = switchFixture({
        conversation: makeConversation({ ptahSessionId: UUID_1 }),
      });
      const differentCasing = existingA.toUpperCase();
      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-use', pick: differentCasing }),
      );
      expect(outcome.ephemeralText).toContain('Already targeting');
      expect(outcome.publicText).toBeUndefined();
      expectNoMutations(f);
      expect(f.registry.isAttached(UUID_1)).toBe(false);
    });

    it('switches: single-txn root write + session clear + registry detach (AC-6.1/6.4, SEC-4)', async () => {
      const f = switchFixture({
        conversation: makeConversation({
          ptahSessionId: UUID_1,
          workspaceRoot: existingA,
        }),
      });
      f.registry.attach(UUID_1, 'binding-1');

      const outcome = await f.service.handleCommand(
        inv({ kind: 'workspace-use', pick: existingB }),
      );

      expect(
        f.conversations.setWorkspaceRootAndClearSession,
      ).toHaveBeenCalledWith('conv-1', existingB);
      expect(f.registry.isAttached(UUID_1)).toBe(false);
      expect(outcome.ephemeralText).toContain('new session');
      expect(outcome.publicText).toBeDefined();
    });

    it('never touches the binding root, the active folder, or session writes (AC-6.7)', async () => {
      const f = switchFixture();
      await f.service.handleCommand(
        inv({ kind: 'workspace-use', pick: existingB }),
      );
      expect(f.bindings.setWorkspaceRoot).not.toHaveBeenCalled();
      expect(f.workspace.setActiveFolder).not.toHaveBeenCalled();
      expect(f.conversations.setPtahSessionId).not.toHaveBeenCalled();
      expect(f.conversations.setWorkspaceRoot).not.toHaveBeenCalled();
    });

    it('resolves a digest pick to the allowlisted folder (SEC-1 closed-set)', async () => {
      const f = switchFixture();
      await f.service.handleCommand(
        inv({ kind: 'workspace-use', pick: workspaceRootDigest(existingB) }),
      );
      expect(
        f.conversations.setWorkspaceRootAndClearSession,
      ).toHaveBeenCalledWith('conv-1', existingB);
    });

    it('resolves a unique basename pick', async () => {
      const f = switchFixture();
      const basename = existingB.replace(/\\/g, '/').split('/').filter(Boolean);
      await f.service.handleCommand(
        inv({ kind: 'workspace-use', pick: basename[basename.length - 1] }),
      );
      expect(
        f.conversations.setWorkspaceRootAndClearSession,
      ).toHaveBeenCalledWith('conv-1', existingB);
    });
  });

  describe('autocomplete (SEC-1 advisory surface)', () => {
    it('returns [] for non-approved bindings (SEC-5)', async () => {
      const f = createFixture({
        binding: makeBinding({ approvalStatus: 'pending' }),
      });
      await expect(
        f.service.handleAutocomplete(autocompleteReq('workspace-pick')),
      ).resolves.toEqual([]);
      await expect(
        f.service.handleAutocomplete(autocompleteReq('session-pick')),
      ).resolves.toEqual([]);
    });

    it('offers workspace choices with exact allowlisted paths as values', async () => {
      const f = createFixture({ folders: [WS_A, WS_B] });
      const choices = await f.service.handleAutocomplete(
        autocompleteReq('workspace-pick'),
      );
      expect(choices.map((c) => c.value)).toEqual([WS_A, WS_B]);
      expect(choices.map((c) => c.name)).toEqual(['alpha', 'beta']);
    });

    it('uses the digest value for paths over 100 chars', async () => {
      const longRoot = `D:\\${'x'.repeat(120)}\\project`;
      const f = createFixture({ folders: [longRoot] });
      const choices = await f.service.handleAutocomplete(
        autocompleteReq('workspace-pick'),
      );
      expect(choices[0].value).toBe(workspaceRootDigest(longRoot));
      expect(choices[0].value.length).toBeLessThanOrEqual(100);
    });

    it('filters workspace choices by query and caps at 25', async () => {
      const folders = Array.from({ length: 40 }, (_, i) => `D:\\ws\\pkg-${i}`);
      const f = createFixture({ folders });
      const all = await f.service.handleAutocomplete(
        autocompleteReq('workspace-pick'),
      );
      expect(all).toHaveLength(25);
      const filtered = await f.service.handleAutocomplete(
        autocompleteReq('workspace-pick', 'pkg-39'),
      );
      expect(filtered.map((c) => c.value)).toEqual(['D:\\ws\\pkg-39']);
    });

    it('offers session choices with uuid values and formatted names', async () => {
      const now = Date.now();
      const f = createFixture({
        sessions: [session(UUID_1, 'fix build', now - 60_000)],
      });
      const choices = await f.service.handleAutocomplete(
        autocompleteReq('session-pick'),
      );
      expect(choices).toHaveLength(1);
      expect(choices[0].value).toBe(UUID_1);
      expect(choices[0].name).toContain('fix build');
      expect(choices[0].name).toContain(UUID_1.slice(0, 8));
      expect(choices[0].name.length).toBeLessThanOrEqual(100);
    });

    it('filters session choices by query', async () => {
      const f = createFixture({
        sessions: [session(UUID_1, 'fix build'), session(UUID_2, 'add docs')],
      });
      const choices = await f.service.handleAutocomplete(
        autocompleteReq('session-pick', 'docs'),
      );
      expect(choices.map((c) => c.value)).toEqual([UUID_2]);
    });

    it('returns [] when the workspace fails to resolve', async () => {
      const f = createFixture({
        binding: makeBinding({ workspaceRoot: null }),
        conversation: null,
      });
      await expect(
        f.service.handleAutocomplete(autocompleteReq('session-pick')),
      ).resolves.toEqual([]);
    });
  });

  describe('failure isolation + control-plane containment', () => {
    it('maps unexpected errors to a generic ephemeral reply', async () => {
      const f = createFixture();
      f.lister.listForWorkspace.mockRejectedValue(new Error('boom'));
      const outcome = await f.service.handleCommand(inv({ kind: 'sessions' }));
      expect(outcome).toEqual({ ephemeralText: COMMAND_REPLIES.commandFailed });
    });

    it('has no message-store or event surface — commands cannot become turns (AC-1.3, Data-6)', () => {
      const f = createFixture();
      const bag = f.service as unknown as Record<string, unknown>;
      expect(bag['messages']).toBeUndefined();
      expect(bag['emit']).toBeUndefined();
    });
  });
});
