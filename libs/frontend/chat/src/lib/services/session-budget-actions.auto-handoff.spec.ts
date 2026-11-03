/**
 * The budget banner's VIEW side of the automatic hand-off
 * (`sessionBudget.autoHandoffAtLimit`): the queued state it projects
 * (`autoHandoffQueued`), its Cancel, and the manual wrap-up mark that keeps
 * the root coordinator (TASK_2026_863) from adding a second hand-off.
 *
 * Real SessionBudgetActionsService, SessionAutoHandoffService,
 * MessageDispatchService and ConversationService. Only the tab store, the
 * sender (the `chat:continue` boundary) and the RPC are fakes. The trigger
 * itself lives in the root coordinator and has its own spec; here an
 * automatic hand-off is seeded exactly the way the coordinator records one:
 * claim → `sendOrQueueMessage` → `recordQueued`.
 */

import { Injector, computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AuthStateService,
  ClaudeRpcService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  TabManagerService,
  type ClosedTabEvent,
  type WorkspaceRemovalEvent,
} from '@ptah-extension/chat-state';
import {
  MessageFinalizationService,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import type { SendMessageOptions, TabState } from '@ptah-extension/chat-types';
import type {
  PermissionRequest,
  SessionBudgetState,
} from '@ptah-extension/shared';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import {
  ConversationService,
  type QueuedCommand,
} from './chat-store/conversation.service';
import { MessageDispatchService } from './chat-store/message-dispatch.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { MessageSenderService } from './message-sender.service';
import { SessionAutoHandoffService } from './session-auto-handoff.service';
import { SessionBudgetActionsService } from './session-budget-actions.service';
import { SESSION_HANDOFF_COMMAND } from './session-handoff-prompts';

const TAB = 'tab-1';
const SESSION = '11111111-1111-4111-8111-111111111111';
const COMMAND = '/session-handoff This session has used 50.0M tokens.';
const LIMIT_BUDGET: SessionBudgetState = {
  sessionId: SESSION,
  stage: 'limit',
  unit: 'tokens',
  measure: 'tokens',
  used: 50_000_000,
  limit: 50_000_000,
  percent: 100,
  lowerBound: false,
  revision: 12,
  compactions: 0,
  autoHandoff: true,
  closeSourceAfterAutoHandoff: false,
};

/** Let the skill probe and the dispatch awaits settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SessionBudgetActionsService automatic hand-off (view side)', () => {
  let tabs: WritableSignal<TabState[]>;
  let flushed: string[];
  let showError: jest.Mock;
  let send: jest.Mock;
  let skillListed: boolean;
  let permissions: WritableSignal<PermissionRequest[]>;
  let autoHandoff: SessionAutoHandoffService;
  let service: SessionBudgetActionsService;
  let dispatch: MessageDispatchService;

  const tab = () => tabs().find((t) => t.id === TAB) as TabState;
  const patch = (id: string, update: Partial<TabState>) =>
    tabs.update((all) =>
      all.map((t) => (t.id === id ? { ...t, ...update } : t)),
    );
  /** The effect-free view does not need a tick; the sends still settle. */
  const run = async () => {
    TestBed.tick();
    await settle();
    await settle();
  };
  /** The running turn ends: the streaming handler flushes the queue. */
  const endTurn = async () => {
    patch(TAB, { status: 'loaded' });
    const content = tab().queuedContent?.trim();
    if (content) await dispatch.sendQueuedMessage(TAB, content);
    await settle();
  };
  const connect = (target: SessionBudgetActionsService) =>
    target.connect({
      activeTab: computed(() => tab()),
      tabId: signal<string | null>(TAB),
      sessionId: signal<string | null>(SESSION),
      bannerVisible: signal(true),
    });
  const handoffSends = () =>
    [...send.mock.calls.map((call) => call[0] as string), ...flushed].filter(
      (content) => content.startsWith(SESSION_HANDOFF_COMMAND),
    );

  /**
   * Seed the session's automatic hand-off exactly the way the root
   * coordinator records one: claim, send through the real queue, record.
   */
  async function seedAutoHandoff(): Promise<void> {
    expect(autoHandoff.claim(SESSION)).toBe(true);
    const outcome = await dispatch.sendOrQueueMessage(COMMAND, { tabId: TAB });
    autoHandoff.recordQueued(
      SESSION,
      outcome?.queuedCommand ?? null,
      outcome?.heldCommand !== undefined,
    );
    await settle();
  }

  function start(
    budget: Partial<SessionBudgetState> = {},
    status: TabState['status'] = 'streaming',
  ): void {
    tabs.set([
      {
        id: TAB,
        title: 'Session',
        status,
        messages: [],
        streamingState: null,
        currentMessageId: null,
        claudeSessionId: SESSION,
        queuedContent: null,
        queuedOptions: null,
        sessionBudget: { ...LIMIT_BUDGET, ...budget },
      } as unknown as TabState,
    ]);
    service = TestBed.inject(SessionBudgetActionsService);
    dispatch = TestBed.inject(MessageDispatchService);
    connect(service);
  }

  beforeEach(() => {
    tabs = signal<TabState[]>([]);
    flushed = [];
    skillListed = true;
    permissions = signal<PermissionRequest[]>([]);
    showError = jest.fn();
    send = jest.fn().mockResolvedValue({ success: true });

    const closedTabListeners = new Set<(event: ClosedTabEvent) => void>();
    const removedWorkspace = signal<WorkspaceRemovalEvent | null>(null);

    const tabManager = {
      tabs: () => tabs(),
      activeTabId: () => TAB,
      activeTab: () => tab(),
      activeTabStatus: () => tab().status,
      isTabStreaming: () => tab().status === 'streaming',
      findTabByIdAcrossWorkspaces: (id: string) => {
        const found = tabs().find((t) => t.id === id);
        return found ? { tab: found, workspacePath: '/ws' } : null;
      },
      setQueuedContent: (id: string, content: string | null) =>
        patch(id, { queuedContent: content }),
      setQueuedContentAndOptions: (
        id: string,
        content: string,
        options: SendMessageOptions,
      ) => patch(id, { queuedContent: content, queuedOptions: options }),
      clearQueuedContentAndOptions: (id: string) =>
        patch(id, { queuedContent: null, queuedOptions: null }),
      resetQueuedContentAndOptions: (id: string) =>
        patch(id, { queuedContent: '', queuedOptions: null }),
      setMessages: (id: string, messages: TabState['messages']) =>
        patch(id, { messages }),
      setLastTerminalReason: jest.fn(),
      onTabClosed: (listener: (event: ClosedTabEvent) => void) => {
        closedTabListeners.add(listener);
        return () => closedTabListeners.delete(listener);
      },
      removedWorkspace$: removedWorkspace.asReadonly(),
    };

    const rpcCall = jest.fn((method: string) =>
      method === 'autocomplete:commands'
        ? Promise.resolve({
            success: true,
            data: {
              commands: skillListed
                ? [
                    {
                      name: SESSION_HANDOFF_COMMAND.slice(1),
                      description: '',
                      scope: 'project',
                    },
                  ]
                : [],
            },
          })
        : Promise.resolve({ success: true }),
    );

    TestBed.configureTestingModule({
      providers: [
        SessionBudgetActionsService,
        MessageDispatchService,
        ConversationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/ws' }) },
        },
        { provide: ActionBannerService, useValue: { showError } },
        {
          provide: AuthStateService,
          useValue: {
            isLoading: () => false,
            persistedAuthMethod: () => 'apiKey',
          },
        },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: permissions.asReadonly(),
            routingTargetRevision: signal(0).asReadonly(),
            handlePermissionResponse: jest.fn(),
            targetTabsFor: () => [],
          },
        },
        {
          provide: MessageSenderService,
          useValue: {
            send,
            // `chat:continue`: the turn it starts streams on the same tab.
            continueExistingSessionForQueueFlush: jest.fn((content: string) => {
              flushed.push(content);
              patch(TAB, { status: 'streaming' });
              return Promise.resolve({ success: true });
            }),
          },
        },
        { provide: SessionLoaderService, useValue: {} },
        { provide: MessageFinalizationService, useValue: {} },
        {
          provide: ChatStore,
          useFactory: (
            d: MessageDispatchService,
            conversation: ConversationService,
          ) => ({
            sendOrQueueMessage: (
              content: string,
              options?: SendMessageOptions,
            ) => d.sendOrQueueMessage(content, options),
            hasPendingPermissionForTab: (tabId: string) =>
              d.hasPendingPermissionForTab(tabId),
            withdrawQueuedCommand: (command: QueuedCommand) =>
              conversation.withdrawQueuedCommand(command),
            isQueuedCommand: (command: QueuedCommand) =>
              conversation.isQueuedCommand(command),
          }),
          deps: [MessageDispatchService, ConversationService],
        },
      ],
    });
    autoHandoff = TestBed.inject(SessionAutoHandoffService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('projects the queued automatic hand-off, and the queue sends it at turn end', async () => {
    start();
    await seedAutoHandoff();

    expect(tab().queuedContent).toBe(COMMAND);
    expect(service.autoHandoffQueued()).toBe(true);
    expect(service.wrapUpSent()).toBe(true);

    await endTurn();
    expect(flushed).toEqual([COMMAND]);
    expect(service.autoHandoffQueued()).toBe(false);
    expect(handoffSends()).toEqual([COMMAND]);
  });

  it('every view of the session projects the same claim-store entry', async () => {
    start();
    const second = Injector.create({
      providers: [SessionBudgetActionsService],
      parent: TestBed.inject(Injector),
    }).get(SessionBudgetActionsService);
    connect(second);
    await seedAutoHandoff();

    expect(service.autoHandoffQueued()).toBe(true);
    expect(second.autoHandoffQueued()).toBe(true);

    await endTurn();
    expect(service.autoHandoffQueued()).toBe(false);
    expect(second.autoHandoffQueued()).toBe(false);
    expect(handoffSends()).toEqual([COMMAND]);
  });

  it('Cancel withdraws the queued command and it never fires again', async () => {
    start();
    await seedAutoHandoff();
    expect(service.autoHandoffQueued()).toBe(true);

    service.cancelAutoHandoff();
    expect(tab().queuedContent).toBeNull();
    expect(service.autoHandoffQueued()).toBe(false);
    expect(service.wrapUpSent()).toBe(false);
    expect(autoHandoff.entry(SESSION)?.state).toBe('cancelled');

    await endTurn();
    patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
    await run();
    expect(handoffSends()).toEqual([]);
    expect(tab().queuedContent).toBeNull();
  });

  it('Cancel keeps text the user queued after the command', async () => {
    start();
    await seedAutoHandoff();
    await dispatch.sendOrQueueMessage('also check tests', { tabId: TAB });
    expect(tab().queuedContent).toBe(`${COMMAND}\nalso check tests`);

    service.cancelAutoHandoff();
    expect(tab().queuedContent).toBe('also check tests');
  });

  it('Cancel drops a command held behind queued text, silently, and keeps the text', async () => {
    start();
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    await seedAutoHandoff();
    expect(tab().queuedContent).toBe('Please check tests');
    expect(service.autoHandoffQueued()).toBe(true);

    service.cancelAutoHandoff();
    await settle();
    expect(service.autoHandoffQueued()).toBe(false);
    expect(showError).not.toHaveBeenCalled();

    await endTurn();
    await endTurn();
    expect(flushed).toEqual(['Please check tests']);
  });

  describe('identical user commands', () => {
    it('Cancel withdraws the automatic command, not the identical one the user held after it', async () => {
      start();
      await seedAutoHandoff();
      expect(tab().queuedContent).toBe(COMMAND);

      // The user queues the same command: it is held behind the auto one.
      const user = await dispatch.sendOrQueueMessage(COMMAND, { tabId: TAB });
      expect(user.heldCommand).toBeInstanceOf(Promise);

      service.cancelAutoHandoff();
      await settle();

      // The user's command moved up and is the one delivered.
      expect(tab().queuedContent).toBe(COMMAND);
      await expect(user.heldCommand).resolves.toBe(true);
      expect(service.autoHandoffQueued()).toBe(false);
      expect(autoHandoff.entry(SESSION)?.state).toBe('cancelled');
      await endTurn();
      expect(flushed).toEqual([COMMAND]);
    });

    it('Cancel withdraws the held automatic command, not the identical one the user held after it', async () => {
      start();
      await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
      await seedAutoHandoff();
      const user = await dispatch.sendOrQueueMessage(COMMAND, { tabId: TAB });

      service.cancelAutoHandoff();
      await settle();

      await endTurn();
      await endTurn();
      expect(flushed).toEqual(['Please check tests', COMMAND]);
      await expect(user.heldCommand).resolves.toBe(true);
      expect(showError).not.toHaveBeenCalled();
    });

    it('an identical command the user queues after the automatic one ran is not shown as automatic', async () => {
      start();
      await seedAutoHandoff();
      await endTurn();
      expect(flushed).toEqual([COMMAND]);

      // The turn ran; the user queues the same command by hand.
      await dispatch.sendOrQueueMessage(COMMAND, { tabId: TAB });
      expect(tab().queuedContent).toBe(COMMAND);
      expect(service.autoHandoffQueued()).toBe(false);

      service.cancelAutoHandoff();
      expect(tab().queuedContent).toBe(COMMAND);
    });
  });

  describe('the manual wrap-up mark (the view ↔ coordinator contract)', () => {
    it('a manual wrap-up marks the session, so the automatic trigger never adds a second one', async () => {
      start({}, 'loaded');
      await service.sendWrapUp();

      expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
      expect(service.wrapUpSent()).toBe(true);
      expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(true);
      expect(autoHandoff.entry(SESSION)).toBeNull();
    });

    it('a manual wrap-up that never sends clears the mark again', async () => {
      send.mockResolvedValue({ success: false, error: 'offline' });
      start({}, 'loaded');
      await service.sendWrapUp();

      expect(service.wrapUpSent()).toBe(false);
      expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(false);
    });

    it('Cancel of an automatic hand-off releases the manual mark', async () => {
      start();
      await seedAutoHandoff();
      expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(false);

      service.cancelAutoHandoff();
      expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(false);
      // The cancel itself stays: the automatic hand-off never fires again.
      expect(autoHandoff.entry(SESSION)?.state).toBe('cancelled');
    });
  });
});