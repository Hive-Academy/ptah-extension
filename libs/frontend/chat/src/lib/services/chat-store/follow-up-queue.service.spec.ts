/**
 * FollowUpQueueService — backend-owned follow-up queue, renderer side
 * (TASK_2026_884).
 *
 * Regression: a follow-up typed in a busy tab that no view shows is handed to
 * the backend at once (`submitQueuedFollowUp` → `chat:continue` with
 * `queueIntent`), with the tab and session captured at queue time, and the
 * `delivered` push updates the store without any reveal of the tab.
 */
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AuthStateService,
  ClaudeRpcService,
  LoggingService,
} from '@ptah-extension/core';
import {
  CommandCenterSendLockService,
  QueuedFollowUpStore,
  TabManagerService,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import {
  createEmptyStreamingState,
  type TabState,
} from '@ptah-extension/chat-types';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { ActionBannerService } from '../action-banner.service';
import { ComposerRestoreService } from '../composer-restore.service';
import { MessageSenderService } from '../message-sender.service';
import { StreamViewportController } from '../stream-viewport-controller.service';
import { FollowUpQueueService } from './follow-up-queue.service';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Session',
    name: 'Session',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: S1,
    ...overrides,
  } as TabState;
}

/** A deferred promise, to hold an RPC reply open. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const queuedReply = {
  success: true,
  data: { success: true, queueState: 'queued' as const },
};

describe('FollowUpQueueService', () => {
  let service: FollowUpQueueService;
  let store: QueuedFollowUpStore;
  let restore: ComposerRestoreService;
  let tabs: ReturnType<typeof signal<TabState[]>>;
  let streamingTabIds: ReturnType<typeof signal<ReadonlySet<string>>>;
  let closedListeners: Array<(event: ClosedTabEvent) => void>;
  let tiers: Map<string, 'focused' | 'visible' | 'hidden'>;
  let submit: jest.Mock;
  let send: jest.Mock;
  let rpcCall: jest.Mock;
  let recordBoundary: jest.Mock;
  let showError: jest.Mock;
  let activeProviderId: ReturnType<typeof signal<string>>;

  const patchTab = (tabId: string, patch: Partial<TabState>): void =>
    tabs.update((list) =>
      list.map((t) => (t.id === tabId ? ({ ...t, ...patch } as TabState) : t)),
    );
  const tab = (tabId = 'tab-1'): TabState =>
    tabs().find((t) => t.id === tabId) as TabState;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    TestBed.tick();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    tabs = signal<TabState[]>([makeTab()]);
    streamingTabIds = signal<ReadonlySet<string>>(new Set());
    closedListeners = [];
    tiers = new Map();
    submit = jest.fn().mockResolvedValue(queuedReply);
    send = jest.fn().mockResolvedValue({ success: true });
    rpcCall = jest.fn();
    recordBoundary = jest.fn();
    showError = jest.fn();
    activeProviderId = signal('anthropic');

    TestBed.configureTestingModule({
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            backgroundTabsRevision: signal(0),
            streamingTabIds,
            removedWorkspace$: signal(null),
            isTabStreaming: (id: string) => streamingTabIds().has(id),
            findTabByIdAcrossWorkspaces: (id: string) => {
              const found = tabs().find((t) => t.id === id);
              return found ? { tab: found, workspacePath: '/ws' } : null;
            },
            onTabClosed: (listener: (event: ClosedTabEvent) => void) => {
              closedListeners.push(listener);
              return () => undefined;
            },
            setMessages: (id: string, messages: ExecutionChatMessage[]) =>
              patchTab(id, { messages }),
            markStreaming: (id: string) => patchTab(id, { status: 'streaming' }),
          },
        },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: MessageSenderService,
          useValue: { submitQueuedFollowUp: submit, send },
        },
        {
          provide: StreamingHandlerService,
          useValue: { recordUserPromptBoundary: recordBoundary },
        },
        {
          provide: StreamViewportController,
          useValue: { tierFor: (id: string) => tiers.get(id) ?? 'focused' },
        },
        { provide: ActionBannerService, useValue: { showError } },
        { provide: AuthStateService, useValue: { activeProviderId } },
        {
          provide: LoggingService,
          useValue: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
        },
      ],
    });
    service = TestBed.inject(FollowUpQueueService);
    store = TestBed.inject(QueuedFollowUpStore);
    restore = TestBed.inject(ComposerRestoreService);
  });

  describe('regression: hidden busy tab', () => {
    it('hands the follow-up to the backend at once, and the delivered push lands without a reveal', async () => {
      tiers.set('tab-1', 'hidden');
      const ref = service.enqueue('tab-1', 'and then add tests', {
        files: ['a.ts'],
      });

      expect(submit).toHaveBeenCalledTimes(1);
      const [input] = submit.mock.calls[0];
      expect(input).toEqual({
        content: 'and then add tests',
        sessionId: S1,
        tabId: 'tab-1',
        clientMessageId: ref?.clientMessageId,
        options: { files: ['a.ts'] },
      });
      expect(input.clientMessageId).toMatch(UUID_V4);

      await flush();
      expect(store.get(ref!.clientMessageId)?.phase).toBe('queued');

      service.handleStateEvent({
        sessionId: S1,
        tabId: 'tab-1',
        clientMessageId: ref!.clientMessageId,
        state: 'delivered',
      });

      expect(store.isPending(ref!.clientMessageId)).toBe(false);
      expect(tab().messages.map((m) => m.id)).toEqual([ref!.clientMessageId]);
      expect(tab().messages[0].rawContent).toBe('and then add tests');
      expect(recordBoundary).toHaveBeenCalledWith('tab-1', tab().messages[0]);
    });

    it('ignores a malformed push and one for another tab', async () => {
      const ref = service.enqueue('tab-1', 'hello')!;
      await flush();
      service.handleStateEvent({ state: 'delivered' });
      service.handleStateEvent({
        sessionId: S1,
        tabId: 'tab-2',
        clientMessageId: ref.clientMessageId,
        state: 'delivered',
      });
      expect(store.get(ref.clientMessageId)?.phase).toBe('queued');
    });
  });

  describe('captured target', () => {
    it('never appends the delivered bubble after the tab moved to another session', async () => {
      const ref = service.enqueue('tab-1', 'for session one')!;
      await flush();
      patchTab('tab-1', { claudeSessionId: S2 as TabState['claudeSessionId'] });

      service.handleStateEvent({
        sessionId: S1,
        tabId: 'tab-1',
        clientMessageId: ref.clientMessageId,
        state: 'delivered',
      });

      expect(store.isPending(ref.clientMessageId)).toBe(false);
      expect(tab().messages).toEqual([]);
    });

    it('drafts a held item instead of sending it into a new session of the tab', async () => {
      const lock = TestBed.inject(CommandCenterSendLockService);
      lock.engage('tab-1', S1, 'owner');
      service.enqueue('tab-1', 'held by the lock');
      expect(submit).not.toHaveBeenCalled();

      patchTab('tab-1', { claudeSessionId: S2 as TabState['claudeSessionId'] });
      lock.release('owner');
      await flush();

      expect(submit).not.toHaveBeenCalled();
      expect(restore.pendingFor('tab-1')).toBe('held by the lock');
      expect(store.entries()).toEqual([]);
    });

    it('a tab close forgets its items; a later push for them changes nothing', async () => {
      const ref = service.enqueue('tab-1', 'bye')!;
      await flush();
      closedListeners.forEach((l) =>
        l({ tabId: 'tab-1', sessionId: S1, kind: 'close' }),
      );
      tabs.set([]);

      service.handleStateEvent({
        sessionId: S1,
        tabId: 'tab-1',
        clientMessageId: ref.clientMessageId,
        state: 'failed',
      });

      expect(store.entries()).toEqual([]);
      expect(showError).not.toHaveBeenCalled();
    });

    it('a tab reset drafts held items and hides the old session items from the new view', async () => {
      const queued = service.enqueue('tab-1', 'already queued')!;
      await flush();
      service.enqueue('tab-1', '/compact');
      patchTab('tab-1', { claudeSessionId: null, status: 'fresh' });
      closedListeners.forEach((l) =>
        l({ tabId: 'tab-1', sessionId: S1, kind: 'reset' }),
      );

      expect(restore.pendingFor('tab-1')).toBe('/compact');
      expect(store.forView('tab-1', null)).toEqual([]);
      expect(store.isPending(queued.clientMessageId)).toBe(true);
    });

    it('a not-yet-bound tab holds the item and sends it to the first session bound to it', async () => {
      patchTab('tab-1', { claudeSessionId: null });
      service.enqueue('tab-1', 'typed before the id resolved');
      expect(submit).not.toHaveBeenCalled();

      patchTab('tab-1', { claudeSessionId: S1 as TabState['claudeSessionId'] });
      await flush();

      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: S1, tabId: 'tab-1' }),
      );
    });
  });

  describe('failures become drafts', () => {
    it('a failed push puts the text back in the composer with a notice', async () => {
      const ref = service.enqueue('tab-1', 'please keep me')!;
      await flush();
      service.handleStateEvent({
        sessionId: S1,
        tabId: 'tab-1',
        clientMessageId: ref.clientMessageId,
        state: 'failed',
        reason: 'the session ended',
      });

      expect(store.isPending(ref.clientMessageId)).toBe(false);
      expect(restore.pendingFor('tab-1')).toBe('please keep me');
      expect(showError).toHaveBeenCalledWith(
        'A queued message was not sent (the session ended). It is back in the composer.',
        'tab-1',
      );
    });

    it('a rejected or thrown chat:continue drafts the text', async () => {
      submit.mockResolvedValueOnce({ success: false, error: 'boom' });
      submit.mockRejectedValueOnce(new Error('transport'));
      service.enqueue('tab-1', 'first');
      await flush();
      service.enqueue('tab-1', 'second');
      await flush();

      expect(restore.pendingFor('tab-1')).toBe('first\nsecond');
      expect(store.entries()).toEqual([]);
    });

    it('an admitted reply (idle session) is delivered at once', async () => {
      submit.mockResolvedValueOnce({
        success: true,
        data: { success: true, queueState: 'admitted', enqueued: true },
      });
      patchTab('tab-1', { status: 'loaded' });
      const ref = service.enqueue('tab-1', 'go')!;
      await flush();

      expect(store.isPending(ref.clientMessageId)).toBe(false);
      expect(tab().messages.map((m) => m.id)).toEqual([ref.clientMessageId]);
      expect(tab().status).toBe('streaming');
    });
  });

  describe('Stop', () => {
    it('keeps a withdrawal push recoverable while Stop awaits its reply', async () => {
      const item = service.enqueue('tab-1', 'recover me')!;
      await flush();
      service.beginStop(S1);
      service.handleStateEvent({
        sessionId: S1, tabId: 'tab-1', clientMessageId: item.clientMessageId,
        state: 'withdrawn',
      });
      expect(service.endStop(S1)).toEqual([{
        clientMessageId: item.clientMessageId, content: 'recover me', tabId: 'tab-1',
      }]);
      expect(store.get(item.clientMessageId)).toBeNull();
    });
    it('restores a withdrawn item to its originating tab', async () => {
      tabs.set([makeTab(), makeTab({ id: 'tab-2', claudeSessionId: S1 })]);
      service.restoreAfterStop('tab-2', [
        { clientMessageId: 'a', content: 'first tab', tabId: 'tab-1' },
      ], []);
      expect(restore.pendingFor('tab-1')).toBe('first tab');
      expect(restore.pendingFor('tab-2')).toBeFalsy();
    });
    it('restores backend-withdrawn texts first, then held ones, in FIFO order', async () => {
      const a = service.enqueue('tab-1', 'one')!;
      await flush();
      service.enqueue('tab-1', '/review');
      service.enqueue('tab-1', 'three');

      const held = service.takeHeldForStop('tab-1', S1);
      expect(held).toEqual(['/review', 'three']);
      service.restoreAfterStop(
        'tab-1',
        [{ clientMessageId: a.clientMessageId, content: 'one', tabId: 'tab-1' }],
        held,
      );

      expect(restore.pendingFor('tab-1')).toBe('one\n/review\nthree');
      expect(store.entries()).toEqual([]);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('held slash commands', () => {
    it('waits for the text ahead and the turn, then sends the command, then what followed it', async () => {
      const a = service.enqueue('tab-1', 'text first')!;
      await flush();
      service.enqueue('tab-1', '/compact');
      service.enqueue('tab-1', 'after the command');
      await flush();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();

      // The text ahead is delivered: its turn runs, the command still waits.
      service.handleStateEvent({
        sessionId: S1,
        tabId: 'tab-1',
        clientMessageId: a.clientMessageId,
        state: 'delivered',
      });
      await flush();
      expect(send).not.toHaveBeenCalled();

      const sent = deferred<{ success: boolean }>();
      send.mockReturnValueOnce(sent.promise);
      patchTab('tab-1', { status: 'loaded' });
      await flush();
      expect(send).toHaveBeenCalledWith('/compact', { tabId: 'tab-1' });
      expect(submit).toHaveBeenCalledTimes(1);

      patchTab('tab-1', { status: 'streaming' });
      sent.resolve({ success: true });
      await flush();
      expect(submit).toHaveBeenCalledTimes(2);
      expect(submit.mock.calls[1][0].content).toBe('after the command');
    });

    it('fires for a HIDDEN tab from the status-only terminal copy', async () => {
      tiers.set('tab-1', 'hidden');
      const tree = createEmptyStreamingState();
      tree.currentMessageId = 'assistant-1';
      patchTab('tab-1', { streamingState: tree });
      streamingTabIds.set(new Set(['tab-1']));
      service.enqueue('tab-1', '/session-handoff');
      await flush();
      expect(send).not.toHaveBeenCalled();

      // `applyHiddenTurnStateStatus` writes the status only; the tree and the
      // spinner set stay as they were.
      patchTab('tab-1', { status: 'loaded' });
      await flush();

      expect(send).toHaveBeenCalledWith('/session-handoff', { tabId: 'tab-1' });
    });

    it('does not fire for a SHOWN tab while its tree is still unsettled', async () => {
      const tree = createEmptyStreamingState();
      tree.currentMessageId = 'assistant-1';
      patchTab('tab-1', { streamingState: tree });
      service.enqueue('tab-1', '/compact');
      patchTab('tab-1', { status: 'loaded' });
      await flush();
      expect(send).not.toHaveBeenCalled();

      patchTab('tab-1', { streamingState: null });
      await flush();
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('Withdraw and Send now', () => {
    it('withdraws a queued item through the backend and restores its text', async () => {
      const ref = service.enqueue('tab-1', 'never mind')!;
      await flush();
      rpcCall.mockResolvedValueOnce({ success: true, data: { withdrawn: true } });

      await expect(service.withdraw(ref, { restore: true })).resolves.toBe(true);

      expect(rpcCall).toHaveBeenCalledWith('chat:queued-withdraw', {
        sessionId: S1,
        tabId: 'tab-1',
        clientMessageId: ref.clientMessageId,
      });
      expect(restore.pendingFor('tab-1')).toBe('never mind');
    });

    it('keeps an item a turn already claimed', async () => {
      const ref = service.enqueue('tab-1', 'too late')!;
      await flush();
      rpcCall.mockResolvedValueOnce({ success: true, data: { withdrawn: false } });

      await expect(service.withdraw(ref, { restore: true })).resolves.toBe(false);
      expect(store.isPending(ref.clientMessageId)).toBe(true);
    });

    it('offers Send now for any session: interrupt for Claude SDK, steer for Codex', () => {
      patchTab('tab-1', { claudeSessionId: undefined });
      expect(service.canSendNow('tab-1')).toBe(false);
      patchTab('tab-1', { claudeSessionId: S1, providerId: undefined });
      // The real active provider id for Claude is `anthropic` (live-run regression).
      activeProviderId.set('anthropic');
      expect(service.canSendNow('tab-1')).toBe(true);
      expect(service.isClaudeSession('tab-1')).toBe(true);
      patchTab('tab-1', { providerId: 'openai-codex' });
      expect(service.canSendNow('tab-1')).toBe(true);
      expect(service.isClaudeSession('tab-1')).toBe(false);
      patchTab('tab-1', { providerId: undefined });
      activeProviderId.set('openai-codex');
      expect(service.isClaudeSession('tab-1')).toBe(false);
    });

    it('waits for the Claude delivered event after interrupt and reports failure', async () => {
      patchTab('tab-1', { providerId: 'claude-cli' });
      const ref = service.enqueue('tab-1', 'send after interrupt')!;
      await flush();
      rpcCall.mockResolvedValueOnce({ success: true, data: { ok: true, mode: 'interrupt' } });
      await service.sendNow(ref);
      expect(store.get(ref.clientMessageId)?.phase).toBe('queued');
      rpcCall.mockResolvedValueOnce({ success: true, data: { ok: false, code: 'INTERRUPT_FAILED' } });
      await service.sendNow(ref);
      expect(store.get(ref.clientMessageId)?.note).toBeDefined();
    });

    it('steers into the running turn, or keeps it queued with a note on TURN_CHANGED', async () => {
      patchTab('tab-1', { providerId: 'openai-codex' });
      const a = service.enqueue('tab-1', 'steer me')!;
      const b = service.enqueue('tab-1', 'turn moved')!;
      await flush();

      rpcCall.mockResolvedValueOnce({ success: true, data: { ok: true } });
      await service.sendNow(a);
      expect(rpcCall).toHaveBeenCalledWith('chat:queued-steer', {
        sessionId: S1,
        tabId: 'tab-1',
        clientMessageId: a.clientMessageId,
      });
      expect(store.isPending(a.clientMessageId)).toBe(false);
      expect(tab().messages.map((m) => m.id)).toEqual([a.clientMessageId]);

      rpcCall.mockResolvedValueOnce({
        success: true,
        data: { ok: false, code: 'TURN_CHANGED' },
      });
      await service.sendNow(b);
      expect(store.get(b.clientMessageId)).toEqual(
        expect.objectContaining({
          phase: 'queued',
          note: 'The turn changed. It stays queued for the next turn.',
        }),
      );
    });
  });

  it('reconcile adds backend items this renderer did not know', async () => {
    rpcCall.mockResolvedValueOnce({
      success: true,
      data: { items: [{ clientMessageId: 'x-1', content: 'from before' }] },
    });
    await service.reconcile('tab-1', S1);
    expect(rpcCall).toHaveBeenCalledWith('chat:queued-list', {
      sessionId: S1,
      tabId: 'tab-1',
    });
    expect(store.forView('tab-1', S1).map((e) => e.content)).toEqual([
      'from before',
    ]);
  });
});
