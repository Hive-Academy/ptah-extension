/**
 * "Hand off automatically at 100%" (`sessionBudget.autoHandoffAtLimit`)
 * against the REAL queue: real SessionBudgetActionsService,
 * SessionAutoHandoffService, MessageDispatchService, ConversationService and
 * MessageValidationService. Only the tab store, the sender (the
 * `chat:continue` boundary) and the RPC are fakes. A turn end is the streaming
 * handler's flush: `sendQueuedMessage(tabId, queuedContent)`.
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
import {
  SESSION_HANDOFF_COMMAND,
  SessionBudgetActionsService,
} from './session-budget-actions.service';

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
};

/** Let the skill probe and the dispatch awaits settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SessionBudgetActionsService automatic hand-off', () => {
  let tabs: WritableSignal<TabState[]>;
  let flushed: string[];
  let showError: jest.Mock;
  let send: jest.Mock;
  let skillListed: boolean;
  let permissions: WritableSignal<PermissionRequest[]>;
  let denyPermission: jest.Mock;
  /** While set, the skill probe waits for it (an in-flight discovery). */
  let probeGate: Promise<void> | null;
  let service: SessionBudgetActionsService;
  let dispatch: MessageDispatchService;

  const tab = () => tabs().find((t) => t.id === TAB) as TabState;
  const patch = (id: string, update: Partial<TabState>) =>
    tabs.update((all) =>
      all.map((t) => (t.id === id ? { ...t, ...update } : t)),
    );
  /** The effect runs, then the probe and the send settle. */
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
    });
  const handoffSends = () =>
    [...send.mock.calls.map((call) => call[0] as string), ...flushed].filter(
      (content) => content.startsWith(SESSION_HANDOFF_COMMAND),
    );

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
    denyPermission = jest.fn();
    probeGate = null;
    showError = jest.fn();
    send = jest.fn().mockResolvedValue({ success: true });
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
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
      (probeGate ?? Promise.resolve()).then(() =>
        method === 'autocomplete:commands'
          ? {
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
            }
          : { success: true },
      ),
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
            handlePermissionResponse: denyPermission,
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
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('sends /session-handoff once when an idle session reaches the limit', async () => {
    start({}, 'loaded');
    await run();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
    expect(
      TestBed.inject(SessionAutoHandoffService).entry(SESSION)?.state,
    ).toBe('fired');

    // A later snapshot at the limit does not fire it again.
    patch(TAB, {
      sessionBudget: { ...LIMIT_BUDGET, revision: 13, used: 51_000_000 },
    });
    await run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the setting is off', async () => {
    start({ autoHandoff: false }, 'loaded');
    await run();
    expect(send).not.toHaveBeenCalled();
    expect(TestBed.inject(SessionAutoHandoffService).entry(SESSION)).toBeNull();
  });

  it('does nothing below the limit', async () => {
    start({ stage: 'handoff', percent: 82 }, 'loaded');
    await run();
    expect(send).not.toHaveBeenCalled();
  });

  it('never sends the inline prompt when the skill is missing', async () => {
    skillListed = false;
    start({}, 'loaded');
    await run();

    expect(send).not.toHaveBeenCalled();
    expect(tab().queuedContent).toBeNull();
    // The button stays usable (it sends the inline prompt by hand).
    expect(service.wrapUpSent()).toBe(false);
    expect(showError).not.toHaveBeenCalled();
  });

  it('queues behind the running turn and sends after it ends', async () => {
    start();
    await run();

    expect(send).not.toHaveBeenCalled();
    expect(tab().queuedContent).toBe(COMMAND);
    expect(service.autoHandoffQueued()).toBe(true);
    expect(service.wrapUpSent()).toBe(true);

    await endTurn();
    expect(flushed).toEqual([COMMAND]);
    expect(service.autoHandoffQueued()).toBe(false);
  });

  it('fires once for two views of the same session', async () => {
    start();
    const second = Injector.create({
      providers: [SessionBudgetActionsService],
      parent: TestBed.inject(Injector),
    }).get(SessionBudgetActionsService);
    connect(second);
    await run();

    expect(tab().queuedContent).toBe(COMMAND);
    expect(service.autoHandoffQueued()).toBe(true);
    expect(second.autoHandoffQueued()).toBe(true);
    await endTurn();
    expect(handoffSends()).toEqual([COMMAND]);
  });

  it('Cancel withdraws the queued command and it never fires again', async () => {
    start();
    await run();
    expect(service.autoHandoffQueued()).toBe(true);

    service.cancelAutoHandoff();
    expect(tab().queuedContent).toBeNull();
    expect(service.autoHandoffQueued()).toBe(false);
    expect(service.wrapUpSent()).toBe(false);
    expect(
      TestBed.inject(SessionAutoHandoffService).entry(SESSION)?.state,
    ).toBe('cancelled');

    await endTurn();
    patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
    await run();
    expect(handoffSends()).toEqual([]);
    expect(tab().queuedContent).toBeNull();
  });

  it('Cancel keeps text the user queued after the command', async () => {
    start();
    await run();
    await dispatch.sendOrQueueMessage('also check tests', { tabId: TAB });
    expect(tab().queuedContent).toBe(`${COMMAND}\nalso check tests`);

    service.cancelAutoHandoff();
    expect(tab().queuedContent).toBe('also check tests');
  });

  it('Cancel drops a command held behind queued text, silently, and keeps the text', async () => {
    start();
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    await run();
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

  it('a failed send does not re-arm it; the button is usable again', async () => {
    send.mockResolvedValue({ success: false, error: 'offline' });
    start({}, 'loaded');
    await run();
    expect(send).toHaveBeenCalledTimes(1);
    expect(service.wrapUpSent()).toBe(false);

    patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
    await run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  describe('with a pending permission prompt on the tab', () => {
    const PROMPT = {
      id: 'perm-1',
      toolName: 'Bash',
      tabId: TAB,
    } as unknown as PermissionRequest;

    it('does not queue the command, so the prompt is not denied', async () => {
      permissions.set([PROMPT]);
      start();
      await run();

      expect(tab().queuedContent).toBeNull();
      expect(denyPermission).not.toHaveBeenCalled();
      expect(service.wrapUpSent()).toBe(false);
      expect(
        TestBed.inject(SessionAutoHandoffService).entry(SESSION),
      ).toBeNull();
    });

    it('a prompt for another tab does not hold it back', async () => {
      permissions.set([{ ...PROMPT, tabId: 'tab-2' }]);
      start();
      await run();
      expect(tab().queuedContent).toBe(COMMAND);
    });

    it('queues it once the prompt is answered, and only once', async () => {
      permissions.set([PROMPT]);
      start();
      await run();
      expect(tab().queuedContent).toBeNull();

      permissions.set([]);
      await run();
      expect(tab().queuedContent).toBe(COMMAND);
      expect(denyPermission).not.toHaveBeenCalled();

      // Another prompt and its answer later do not fire it again.
      permissions.set([{ ...PROMPT, id: 'perm-2' }]);
      await run();
      permissions.set([]);
      await run();
      await endTurn();
      expect(handoffSends()).toEqual([COMMAND]);
    });

    it('leaves the manual button as it was: it queues and answers the prompt', async () => {
      permissions.set([PROMPT]);
      start({ autoHandoff: false });
      await run();

      await service.sendWrapUp();
      expect(tab().queuedContent).toBe(COMMAND);
      expect(denyPermission).toHaveBeenCalledWith({
        id: 'perm-1',
        decision: 'deny_with_message',
        reason: COMMAND,
      });
      expect(service.wrapUpSent()).toBe(true);
    });
  });

  describe('a skill probe that resolves after the target changed (F1)', () => {
    /** Hold the probe; returns its release. */
    const holdProbe = () => {
      let release!: () => void;
      probeGate = new Promise<void>((resolve) => (release = resolve));
      return release;
    };

    it('does not send into the session that replaced it on the same tab', async () => {
      const release = holdProbe();
      start();
      await run();
      expect(service.wrapUpSent()).toBe(true);

      // `/clear` or a loaded session: the tab now holds session B.
      const B = '22222222-2222-4222-8222-222222222222';
      patch(TAB, {
        claudeSessionId: B,
        sessionBudget: { ...LIMIT_BUDGET, sessionId: B, stage: 'normal' },
      });
      release();
      await run();

      expect(send).not.toHaveBeenCalled();
      expect(tab().queuedContent).toBeNull();
      const store = TestBed.inject(SessionAutoHandoffService);
      expect(store.entry(SESSION)).toBeNull();
      expect(store.entry(B)).toBeNull();
    });

    it('does not send when the setting was turned off meanwhile', async () => {
      const release = holdProbe();
      start();
      await run();

      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, autoHandoff: false } });
      release();
      await run();

      expect(tab().queuedContent).toBeNull();
      expect(
        TestBed.inject(SessionAutoHandoffService).entry(SESSION),
      ).toBeNull();
    });

    it('does not send when the session left the limit meanwhile', async () => {
      const release = holdProbe();
      start();
      await run();

      patch(TAB, {
        sessionBudget: { ...LIMIT_BUDGET, stage: 'handoff', percent: 85 },
      });
      release();
      await run();

      expect(tab().queuedContent).toBeNull();
      expect(
        TestBed.inject(SessionAutoHandoffService).entry(SESSION),
      ).toBeNull();
    });
  });

  describe('identical user commands (F2)', () => {
    it('Cancel withdraws the automatic command, not the identical one the user held after it', async () => {
      start();
      await run();
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
      expect(
        TestBed.inject(SessionAutoHandoffService).entry(SESSION)?.state,
      ).toBe('cancelled');
      await endTurn();
      expect(flushed).toEqual([COMMAND]);
    });

    it('Cancel withdraws the held automatic command, not the identical one the user held after it', async () => {
      start();
      await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
      await run();
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
      await run();
      await endTurn();
      expect(flushed).toEqual([COMMAND]);

      // A new turn runs; the user queues the same command by hand.
      await dispatch.sendOrQueueMessage(COMMAND, { tabId: TAB });
      expect(tab().queuedContent).toBe(COMMAND);
      expect(service.autoHandoffQueued()).toBe(false);

      service.cancelAutoHandoff();
      expect(tab().queuedContent).toBe(COMMAND);
    });
  });
});
