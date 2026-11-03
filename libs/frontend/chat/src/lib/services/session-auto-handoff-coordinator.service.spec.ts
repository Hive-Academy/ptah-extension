/**
 * The ROOT automatic hand-off trigger (`sessionBudget.autoHandoffAtLimit`,
 * TASK_2026_863): real SessionAutoHandoffCoordinatorService,
 * SessionAutoHandoffService, MessageDispatchService, ConversationService.
 * Only the tab store (active AND background partitions), the sender (the
 * `chat:continue` boundary) and the RPC are fakes. A turn end is the streaming
 * handler's flush: `sendQueuedMessage(tabId, queuedContent)`.
 *
 * The regression this guards: the trigger used to live in the per-view
 * `SessionBudgetActionsService` and read only the SHOWN tab and its visible
 * banner, so a background tab at its limit never fired.
 */

import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AuthStateService,
  ClaudeRpcService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  TabManagerService,
  TabWorkspacePartitionService,
  type ClosedTabEvent,
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
import { SessionAutoHandoffCoordinatorService } from './session-auto-handoff-coordinator.service';
import { SESSION_HANDOFF_COMMAND } from './session-handoff-prompts';

const TAB = 'tab-1';
const OTHER_TAB = 'tab-2';
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

/** A tab-shaped object; only the fields the coordinator and queue read. */
function makeTab(id: string, overrides: Partial<TabState> = {}): TabState {
  return {
    id,
    title: `Session ${id}`,
    status: 'loaded',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESSION,
    queuedContent: null,
    queuedOptions: null,
    sessionBudget: { ...LIMIT_BUDGET },
    ...overrides,
  } as unknown as TabState;
}

describe('SessionAutoHandoffCoordinatorService', () => {
  let activeTabs: WritableSignal<TabState[]>;
  let backgroundTabs: TabState[];
  /** Bumped on every background-tab change, like the real partition's revision. */
  let backgroundRevision: WritableSignal<number>;
  let flushed: string[];
  let send: jest.Mock;
  let skillListed: boolean;
  /** While set, every probe/send fails like a transport error. */
  let probeFails: boolean;
  let flushFails: boolean;
  let rpcCall: jest.Mock;
  let permissions: WritableSignal<PermissionRequest[]>;
  /** While set, the skill probe waits for it (an in-flight discovery). */
  let probeGate: Promise<void> | null;
  let autoHandoff: SessionAutoHandoffService;
  /** Controlled `Date.now()` for the retry gate. */
  let nowMs: number;

  const tab = (id: string) =>
    [...activeTabs(), ...backgroundTabs].find((t) => t.id === id) as TabState;
  const patch = (id: string, update: Partial<TabState>) => {
    activeTabs.update((all) =>
      all.map((t) => (t.id === id ? { ...t, ...update } : t)),
    );
    if (backgroundTabs.some((t) => t.id === id)) {
      backgroundTabs = backgroundTabs.map((t) =>
        t.id === id ? { ...t, ...update } : t,
      );
      backgroundRevision.update((revision) => revision + 1);
    }
  };
  /** The effect runs, then the probe and the send settle. */
  const run = async () => {
    TestBed.tick();
    await settle();
    await settle();
  };
  /** The running turn ends: the streaming handler flushes the queue. */
  const endTurn = async (id: string) => {
    patch(id, { status: 'loaded' });
    const content = tab(id).queuedContent?.trim();
    if (content) {
      await TestBed.inject(MessageDispatchService).sendQueuedMessage(
        id,
        content,
      );
    }
    await settle();
  };
  const handoffSends = () =>
    [...send.mock.calls.map((call) => call[0] as string), ...flushed].filter(
      (content) => content.startsWith(SESSION_HANDOFF_COMMAND),
    );

  function start(
    options: {
      /** Active-workspace tabs; the FIRST is the active tab (`activeTabId`). */
      active?: TabState[];
      /** Tabs parked in a non-active workspace partition. */
      background?: TabState[];
    } = {},
  ): void {
    activeTabs.set(options.active ?? []);
    backgroundTabs = options.background ?? [];
  }

  beforeEach(() => {
    activeTabs = signal<TabState[]>([]);
    backgroundTabs = [];
    backgroundRevision = signal(0);
    flushed = [];
    skillListed = true;
    probeFails = false;
    flushFails = false;
    permissions = signal<PermissionRequest[]>([]);
    probeGate = null;
    nowMs = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    send = jest.fn().mockResolvedValue({ success: true });

    const tabManager = {
      tabs: () => activeTabs(),
      activeTabId: () => activeTabs()[0]?.id ?? null,
      activeTab: () => activeTabs()[0] ?? null,
      activeTabStatus: () => activeTabs()[0]?.status ?? 'fresh',
      isTabStreaming: (id: string) => tab(id)?.status === 'streaming',
      backgroundTabsRevision: () => backgroundRevision(),
      findTabByIdAcrossWorkspaces: (id: string) => {
        const found = [...activeTabs(), ...backgroundTabs].find(
          (t) => t.id === id,
        );
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
      onTabClosed: (_listener: (event: ClosedTabEvent) => void) => () => {},
      removedWorkspace$: signal(null).asReadonly(),
    };
    const partition = {
      findBackgroundTabs: (predicate: (tab: TabState) => boolean) =>
        backgroundTabs.filter(predicate),
    };

    rpcCall = jest.fn((method: string) =>
      (probeGate ?? Promise.resolve()).then(() => {
        if (method !== 'autocomplete:commands') {
          return { success: true };
        }
        if (probeFails) {
          return { success: false, error: 'transport' };
        }
        return {
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
        };
      }),
    );

    TestBed.configureTestingModule({
      providers: [
        SessionAutoHandoffCoordinatorService,
        MessageDispatchService,
        ConversationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: TabWorkspacePartitionService, useValue: partition },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/ws' }) },
        },
        { provide: ActionBannerService, useValue: { showError: jest.fn() } },
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
            continueExistingSessionForQueueFlush: jest.fn(
              (
                content: string,
                _sessionId: string,
                options?: { tabId?: string },
              ) => {
                if (flushFails)
                  return Promise.resolve({ success: false, error: 'offline' });
                flushed.push(content);
                patch(options?.tabId ?? TAB, { status: 'streaming' });
                return Promise.resolve({ success: true });
              },
            ),
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
    TestBed.inject(SessionAutoHandoffCoordinatorService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('sends /session-handoff once when a HIDDEN tab reaches the limit', async () => {
    // The bug: the tab is not the shown one and no banner is visible anywhere.
    start({
      active: [
        makeTab(OTHER_TAB, {
          claudeSessionId: '22222222-2222-4222-8222-222222222222',
          sessionBudget: null,
        }),
        makeTab(TAB),
      ],
    });
    await run();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
    expect(autoHandoff.entry(SESSION)?.state).toBe('fired');

    // A later snapshot at the limit does not fire it again.
    patch(TAB, {
      sessionBudget: { ...LIMIT_BUDGET, revision: 13, used: 51_000_000 },
    });
    await run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends for a tab parked in a BACKGROUND workspace partition', async () => {
    start({
      active: [
        makeTab(OTHER_TAB, {
          claudeSessionId: '22222222-2222-4222-8222-222222222222',
          sessionBudget: null,
        }),
      ],
      background: [makeTab(TAB)],
    });
    await run();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
    expect(autoHandoff.entry(SESSION)?.state).toBe('fired');
  });

  it('sends once when duplicate budget updates keep arriving', async () => {
    start({ active: [makeTab(TAB)] });
    await run();
    expect(send).toHaveBeenCalledTimes(1);
    patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
    await run();
    patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 14 } });
    await run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the setting is off', async () => {
    start({
      active: [
        makeTab(TAB, {
          sessionBudget: { ...LIMIT_BUDGET, autoHandoff: false },
        }),
      ],
    });
    await run();
    expect(send).not.toHaveBeenCalled();
    expect(autoHandoff.entry(SESSION)).toBeNull();
  });

  it('does nothing below the limit', async () => {
    start({
      active: [
        makeTab(TAB, {
          sessionBudget: { ...LIMIT_BUDGET, stage: 'handoff', percent: 82 },
        }),
      ],
    });
    await run();
    expect(send).not.toHaveBeenCalled();
  });

  it('counts the live stage while the tab streams, and queues behind the turn', async () => {
    // The authoritative stage is still `handoff`; the live estimate says limit.
    start({
      active: [
        makeTab(TAB, {
          status: 'streaming',
          sessionBudget: { ...LIMIT_BUDGET, stage: 'handoff', percent: 82 },
          liveBudgetStage: 'limit',
        }),
      ],
    });
    await run();

    expect(send).not.toHaveBeenCalled();
    expect(tab(TAB).queuedContent).toBe(COMMAND);
    expect(autoHandoff.entry(SESSION)?.state).toBe('fired');

    await endTurn(TAB);
    expect(flushed).toEqual([COMMAND]);
  });

  it('waits while the tab resumes, and fires once it settles', async () => {
    start({ active: [makeTab(TAB, { status: 'resuming' })] });
    await run();
    expect(send).not.toHaveBeenCalled();
    expect(autoHandoff.entry(SESSION)).toBeNull();

    patch(TAB, { status: 'loaded' });
    await run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('marks the session when the workspace confirmed the skill is missing', async () => {
    skillListed = false;
    start({ active: [makeTab(TAB)] });
    await run();

    expect(send).not.toHaveBeenCalled();
    expect(tab(TAB).queuedContent).toBeNull();

    // Confirmed absence: later updates never probe again.
    patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
    await run();
    expect(send).not.toHaveBeenCalled();
    expect(autoHandoff.entry(SESSION)).toBeNull();
  });

  describe('a transient probe failure (no answer from discovery)', () => {
    it('wakes and retries after five seconds without a tab update', async () => {
      jest.restoreAllMocks();
      jest.useFakeTimers();
      jest.setSystemTime(nowMs);
      probeFails = true;
      start({ active: [makeTab(TAB)] });
      TestBed.tick();
      await jest.advanceTimersByTimeAsync(0);
      expect(send).not.toHaveBeenCalled();

      probeFails = false;
      await jest.advanceTimersByTimeAsync(5_000);
      TestBed.tick();
      await jest.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(autoHandoff.entry(SESSION)?.state).toBe('fired');
    });

    it('retries on a later update once the retry gate passes, and then sends', async () => {
      probeFails = true;
      start({ active: [makeTab(TAB)] });
      await run();

      expect(send).not.toHaveBeenCalled();
      expect(autoHandoff.entry(SESSION)).toBeNull();

      // A tab update inside the gate does not retry (no tight loop).
      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
      await run();
      expect(send).not.toHaveBeenCalled();

      probeFails = false;
      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 14 } });
      await run();
      expect(send).not.toHaveBeenCalled(); // still inside the 5 s gate

      nowMs += 5_001;
      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 15 } });
      await run();
      expect(send).toHaveBeenCalledTimes(1);
      expect(autoHandoff.entry(SESSION)?.state).toBe('fired');
    });

    it('gives up after five failed attempts for the session', async () => {
      probeFails = true;
      start({ active: [makeTab(TAB)] });
      await run();
      const attempts = async (count: number) => {
        for (let i = 0; i < count; i += 1) {
          nowMs += 60_001; // past every delay
          patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 20 + i } });
          await run();
        }
      };
      await attempts(4); // the initial attempt plus four retries
      expect(rpcCall).toHaveBeenCalledTimes(5);
      expect(send).not.toHaveBeenCalled();
      expect(autoHandoff.entry(SESSION)).toBeNull();

      // Given up: even a much later update never probes again.
      probeFails = false;
      nowMs += 600_000;
      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 99 } });
      await run();
      expect(send).not.toHaveBeenCalled();
      expect(rpcCall).toHaveBeenCalledTimes(5);
    });
  });

  describe('a failed send', () => {
    it('releases the claim when a held hand-off becomes queued then its flush fails', async () => {
      start({ active: [makeTab(TAB, { status: 'streaming' })] });
      await TestBed.inject(MessageDispatchService).sendOrQueueMessage('Please check tests', { tabId: TAB });
      await run();
      expect(autoHandoff.entry(SESSION)?.held).toBe(true);
      await endTurn(TAB);
      await settle();
      expect(autoHandoff.entry(SESSION)?.held).toBe(false);
      flushFails = true;
      await endTurn(TAB);
      expect(autoHandoff.entry(SESSION)).toBeNull();
    });
    it('releases a failed streaming queue head and waits while its text remains queued', async () => {
      start({ active: [makeTab(TAB, { status: 'streaming' })] });
      await run();
      expect(autoHandoff.entry(SESSION)?.queued).not.toBeNull();
      flushFails = true;
      await endTurn(TAB);
      expect(tab(TAB).queuedContent).toBe(COMMAND);
      expect(autoHandoff.entry(SESSION)).toBeNull();

      nowMs += 5_001;
      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
      await run();
      expect(send).not.toHaveBeenCalled();
      expect(tab(TAB).queuedContent).toBe(COMMAND);

      flushFails = false;
      await endTurn(TAB);
      await run();
      expect(flushed).toEqual([COMMAND]);
      expect(autoHandoff.entry(SESSION)?.state).toBe('fired');
      expect(send).not.toHaveBeenCalled();
    });

    it('releases the claim and retries once the blocker clears', async () => {
      send.mockResolvedValueOnce({ success: false, error: 'offline' });
      start({ active: [makeTab(TAB)] });
      await run();

      expect(send).toHaveBeenCalledTimes(1);
      // The failed attempt released the claim, so the session is not stuck.
      expect(autoHandoff.entry(SESSION)).toBeNull();

      // Inside the retry gate nothing fires.
      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
      await run();
      expect(send).toHaveBeenCalledTimes(1);

      nowMs += 5_001;
      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 14 } });
      await run();
      expect(send).toHaveBeenCalledTimes(2);
      expect(autoHandoff.entry(SESSION)?.state).toBe('fired');
    });

    it('a held command dropped with the queue releases the claim and retries', async () => {
      start({ active: [makeTab(TAB, { status: 'streaming' })] });
      // The user's text is ahead of the command: the command is held.
      await TestBed.inject(MessageDispatchService).sendOrQueueMessage(
        'Please check tests',
        { tabId: TAB },
      );
      await run();
      expect(tab(TAB).queuedContent).toBe('Please check tests');
      const held = autoHandoff.entry(SESSION);
      expect(held?.held).toBe(true);

      // Stop: the queue is withdrawn without flushing, so the held command drops.
      patch(TAB, { status: 'loaded' });
      TestBed.inject(ConversationService).withdrawQueuedCommand(
        held?.queued as QueuedCommand,
      );
      await settle();
      expect(autoHandoff.entry(SESSION)).toBeNull();

      nowMs += 5_001;
      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, revision: 13 } });
      await run();
      expect(send).toHaveBeenCalledTimes(1);
      expect(autoHandoff.entry(SESSION)?.state).toBe('fired');
    });
  });

  describe('with a pending permission prompt on the tab', () => {
    const PROMPT = {
      id: 'perm-1',
      toolName: 'Bash',
      tabId: TAB,
    } as unknown as PermissionRequest;

    it('does not queue the command, so the prompt is not denied', async () => {
      permissions.set([PROMPT]);
      start({ active: [makeTab(TAB, { status: 'streaming' })] });
      await run();

      expect(tab(TAB).queuedContent).toBeNull();
      expect(autoHandoff.entry(SESSION)).toBeNull();
    });

    it('a prompt for another tab does not hold it back', async () => {
      permissions.set([{ ...PROMPT, tabId: OTHER_TAB }]);
      start({ active: [makeTab(TAB)] });
      await run();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('fires once the prompt is answered, and only once', async () => {
      permissions.set([PROMPT]);
      start({ active: [makeTab(TAB)] });
      await run();
      expect(send).not.toHaveBeenCalled();

      permissions.set([]);
      await run();
      expect(send).toHaveBeenCalledTimes(1);

      // Another prompt and its answer later do not fire it again.
      permissions.set([{ ...PROMPT, id: 'perm-2' }]);
      await run();
      permissions.set([]);
      await run();
      expect(send).toHaveBeenCalledTimes(1);
      expect(handoffSends()).toHaveLength(1);
    });
  });

  describe('a skill probe that resolves after the target changed', () => {
    /** Hold the probe; returns its release. */
    const holdProbe = () => {
      let release!: () => void;
      probeGate = new Promise<void>((resolve) => (release = resolve));
      return release;
    };

    it('does not send into the session that replaced it on the same tab', async () => {
      const release = holdProbe();
      start({ active: [makeTab(TAB)] });
      await run();

      // `/clear` or a loaded session: the tab now holds session B.
      const B = '22222222-2222-4222-8222-222222222222';
      patch(TAB, {
        claudeSessionId: B,
        sessionBudget: { ...LIMIT_BUDGET, sessionId: B, stage: 'normal' },
      });
      release();
      await run();

      expect(send).not.toHaveBeenCalled();
      expect(tab(TAB).queuedContent).toBeNull();
      expect(autoHandoff.entry(SESSION)).toBeNull();
      expect(autoHandoff.entry(B)).toBeNull();
    });

    it('does not send when the setting was turned off meanwhile', async () => {
      const release = holdProbe();
      start({ active: [makeTab(TAB)] });
      await run();

      patch(TAB, { sessionBudget: { ...LIMIT_BUDGET, autoHandoff: false } });
      release();
      await run();

      expect(send).not.toHaveBeenCalled();
      expect(autoHandoff.entry(SESSION)).toBeNull();
    });

    it('does not send when the session left the limit meanwhile', async () => {
      const release = holdProbe();
      start({ active: [makeTab(TAB)] });
      await run();

      patch(TAB, {
        sessionBudget: { ...LIMIT_BUDGET, stage: 'handoff', percent: 85 },
      });
      release();
      await run();

      expect(send).not.toHaveBeenCalled();
      expect(autoHandoff.entry(SESSION)).toBeNull();
    });

    it('still sends when the user switched to another tab meanwhile', async () => {
      // The hand-off belongs to the session, not to the shown view.
      const OTHER_SESSION = '22222222-2222-4222-8222-222222222222';
      const otherTab = () =>
        makeTab(OTHER_TAB, {
          claudeSessionId: OTHER_SESSION,
          sessionBudget: null,
        });
      const release = holdProbe();
      start({ active: [otherTab(), makeTab(TAB)] });
      await run();

      // The user switches to the other tab while the probe is in flight.
      activeTabs.set([makeTab(TAB), otherTab()]);
      release();
      await run();

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
    });
  });

  it('never adds a second hand-off after a manual wrap-up', async () => {
    start({ active: [makeTab(TAB)] });
    autoHandoff.markManualWrapUp(SESSION);
    await run();
    expect(send).not.toHaveBeenCalled();
    expect(autoHandoff.entry(SESSION)).toBeNull();
  });
});
