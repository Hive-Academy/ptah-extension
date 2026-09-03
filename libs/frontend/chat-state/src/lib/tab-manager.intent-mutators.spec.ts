/**
 * TabManagerService — intent-named mutator coverage.
 *
 * Covers the most-frequently invoked mutators so that the chat-state lib
 * hits its coverage threshold. These are exercised end-to-end against
 * `_tabs` / readonly signals to catch any regression in the partial-write
 * path through `updateTabInternal`.
 */

import { TestBed } from '@angular/core/testing';
import {
  StreamingState,
  createEmptyStreamingState,
  type TabState,
} from '@ptah-extension/chat-types';
import {
  ExecutionChatMessage,
  SessionId,
  type SessionTurnPhase,
  type SessionTurnState,
} from '@ptah-extension/shared';

// Production `TabManagerService.attachSession` and `applyResumingSession`
// validate the incoming sessionId via `SessionId.from()` (UUID v4). Mint
// stable ids per spec run.
const SESS_123 = SessionId.create();
const SESS_XYZ = SessionId.create();
const SESS_X = SessionId.create();
const SESS_R = SessionId.create();
const SESS_PRE = SessionId.create();

import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

describe('TabManagerService — intent-named mutators', () => {
  let service: TabManagerService;
  let partitionMock: Partial<jest.Mocked<TabWorkspacePartitionService>>;

  const makeMessage = (id: string, text: string): ExecutionChatMessage => ({
    id,
    role: 'assistant',
    content: text,
    timestamp: Date.now(),
    nodes: [],
  });

  beforeEach(() => {
    const confirmMock = { confirm: jest.fn().mockResolvedValue(true) };
    // Cleanup ownership lives in `StreamRouter` (see chat-routing specs).
    partitionMock = {
      initialize: jest.fn(),
      activeWorkspacePath: null,
      registerSessionForWorkspace: jest.fn(),
      unregisterSession: jest.fn(),
      findTabBySessionIdAcrossWorkspaces: jest.fn().mockReturnValue(null),
      // `applyTurnState` / the `applyFinalizedTurn` microtask resolve the tab
      // by id across workspaces; every tab in this spec is active.
      findTabByIdAcrossWorkspaces: jest
        .fn()
        .mockImplementation((tabId: string, tabs: readonly TabState[]) => {
          const tab = tabs.find((t) => t.id === tabId);
          return tab ? { tab, workspacePath: '/ws' } : null;
        }),
      getStorageKeyForWorkspace: jest.fn().mockReturnValue('ptah.tabs'),
      syncActiveWorkspaceState: jest.fn(),
      switchWorkspace: jest.fn().mockReturnValue(null),
      removeWorkspaceState: jest.fn().mockReturnValue(false),
      getWorkspaceTabs: jest.fn().mockReturnValue([]),
      setBackendEncodedPath: jest.fn(),
      updateBackgroundTab: jest.fn(),
    };
    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        { provide: ConfirmationDialogService, useValue: confirmMock },
        { provide: TabWorkspacePartitionService, useValue: partitionMock },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
      ],
    });
    service = TestBed.inject(TabManagerService);
  });

  describe('status transitions', () => {
    it('markStreaming/markLoaded/markResuming flip status', () => {
      const id = service.createTab('status flip');
      service.markStreaming(id);
      expect(service.tabs().find((t) => t.id === id)?.status).toBe('streaming');
      service.markLoaded(id);
      expect(service.tabs().find((t) => t.id === id)?.status).toBe('loaded');
      service.markResuming(id);
      expect(service.tabs().find((t) => t.id === id)?.status).toBe('resuming');
    });

    it('setStatus accepts dynamic SessionStatus values', () => {
      const id = service.createTab('dynamic');
      service.setStatus(id, 'switching');
      expect(service.tabs().find((t) => t.id === id)?.status).toBe('switching');
    });
  });

  describe('applyTurnState (TASK_2026_360)', () => {
    const base = (
      overrides: Partial<SessionTurnState> = {},
    ): SessionTurnState => ({
      phase: 'idle',
      revision: 1,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'completed',
      timestamp: 1,
      ...overrides,
    });
    const tabOf = (id: string) => service.tabs().find((t) => t.id === id);
    const task = {
      id: 'bg-1',
      type: 'subagent' as const,
      status: 'running' as const,
      description: 'd',
    };
    const cron = {
      id: 'c-1',
      schedule: '*/5 * * * *',
      recurring: true,
      prompt: 'p',
    };

    it('generating → streaming, spinner on, live session, terminal reason cleared, tasks emptied', () => {
      const id = service.createTab('g');
      service.setTurnEndedFields(id, {
        pendingBackgroundTasks: [task],
        pendingSessionCrons: [cron],
        lastTerminalReason: 'completed',
      });

      service.applyTurnState(
        id,
        base({ phase: 'generating', terminalReason: null }),
      );

      const tab = tabOf(id);
      expect(tab?.status).toBe('streaming');
      expect(tab?.hasLiveSession).toBe(true);
      expect(service.isTabStreaming(id)).toBe(true);
      expect(tab?.lastTerminalReason).toBeUndefined();
      expect(tab?.pendingBackgroundTasks).toEqual([]);
      expect(tab?.lastTurnStateRevision).toBe(1);
    });

    it.each([
      ['awaiting-background', 'awaiting-background'],
      ['sleeping', 'sleeping'],
      ['idle', 'loaded'],
      ['failed', 'loaded'],
    ] as const)(
      '%s → status %s, spinner off, snapshot copied from the event',
      (phase, status) => {
        const id = service.createTab(phase);
        service.markStreaming(id);
        service.markTabStreaming(id);

        service.applyTurnState(
          id,
          base({
            phase,
            backgroundTasks: [task],
            sessionCrons: [cron],
            terminalReason: 'aborted_streaming',
          }),
        );

        const tab = tabOf(id);
        expect(tab?.status).toBe(status);
        expect(service.isTabStreaming(id)).toBe(false);
        expect(tab?.pendingBackgroundTasks).toEqual([task]);
        expect(tab?.pendingSessionCrons).toEqual([cron]);
        expect(tab?.lastTerminalReason).toBe('aborted_streaming');
      },
    );

    it('drops an event whose revision is <= the last applied one (replayed batch)', () => {
      const id = service.createTab('rev');
      service.applyTurnState(
        id,
        base({ phase: 'generating', revision: 3, terminalReason: null }),
      );

      service.applyTurnState(id, base({ phase: 'idle', revision: 3 }));
      expect(tabOf(id)?.status).toBe('streaming');
      service.applyTurnState(id, base({ phase: 'idle', revision: 2 }));
      expect(tabOf(id)?.status).toBe('streaming');
      expect(service.isTabStreaming(id)).toBe(true);
      expect(tabOf(id)?.lastTurnStateRevision).toBe(3);

      service.applyTurnState(id, base({ phase: 'idle', revision: 4 }));
      expect(tabOf(id)?.status).toBe('loaded');
      expect(service.isTabStreaming(id)).toBe(false);
      expect(tabOf(id)?.lastTurnStateRevision).toBe(4);
    });

    it('accepts any revision on a tab with none recorded (optimistic send, restore, resume)', () => {
      const id = service.createTab('fresh');
      service.markStreaming(id);
      service.markTabStreaming(id);

      service.applyTurnState(
        id,
        base({ phase: 'generating', revision: 1, terminalReason: null }),
      );

      expect(tabOf(id)?.status).toBe('streaming');
      expect(tabOf(id)?.lastTurnStateRevision).toBe(1);
    });

    it('is a no-op for an unknown tab id', () => {
      expect(() => service.applyTurnState('nope', base())).not.toThrow();
    });

    it('applyFinalizedTurn no longer overrides a status the applier wrote', async () => {
      const id = service.createTab('fin');
      service.markStreaming(id);
      service.setStreamingState(id, createEmptyStreamingState());

      // Same order as TurnStateApplier: finalize (queues the microtask), then
      // the backend phase, synchronously.
      service.applyFinalizedTurn(id, []);
      service.applyTurnState(
        id,
        base({ phase: 'awaiting-background', backgroundTasks: [task] }),
      );
      await Promise.resolve();

      expect(tabOf(id)?.status).toBe('awaiting-background');
      expect(tabOf(id)?.streamingState).toBeNull();
    });

    it('applyFinalizedTurn still flips a plain streaming tab to loaded', async () => {
      const id = service.createTab('fin2');
      service.markStreaming(id);
      service.setStreamingState(id, createEmptyStreamingState());

      service.applyFinalizedTurn(id, []);
      await Promise.resolve();

      expect(tabOf(id)?.status).toBe('loaded');
      expect(tabOf(id)?.streamingState).toBeNull();
    });

    it('records the session the revision came from and refuses a foreign session on a bound tab', () => {
      const id = service.createTab('bound');
      service.attachSession(id, SESS_123);

      service.applyTurnState(
        id,
        base({ phase: 'generating', revision: 1, terminalReason: null }),
        SESS_123,
      );
      expect(tabOf(id)?.lastTurnStateSessionId).toBe(SESS_123);

      // The old broadcaster: higher revision, other session, same tab id.
      service.applyTurnState(
        id,
        base({
          phase: 'idle',
          revision: 6,
          terminalReason: 'aborted_streaming',
        }),
        SESS_XYZ,
      );

      expect(tabOf(id)?.status).toBe('streaming');
      expect(service.isTabStreaming(id)).toBe(true);
      expect(tabOf(id)?.lastTurnStateRevision).toBe(1);
      expect(tabOf(id)?.lastTurnStateSessionId).toBe(SESS_123);
    });
  });

  describe('canApplyTurnState (TASK_2026_360 review F1)', () => {
    const tabOf = (id: string) => service.tabs().find((t) => t.id === id);
    // The default phase is 'idle', which is TERMINAL, so a case that means to
    // exercise the revision comparison alone must pass 'generating'
    // explicitly (TASK_2026_371 terminal heal).
    const state = (
      sessionId: string | undefined,
      revision: number,
      phase: SessionTurnPhase = 'idle',
    ): SessionTurnState & { sessionId: string | undefined } => ({
      phase,
      revision,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: phase === 'generating' ? null : 'completed',
      timestamp: 1,
      sessionId,
    });
    const applied = (
      id: string,
      sessionId: string | undefined,
      rev: number,
      phase: SessionTurnPhase = 'idle',
    ) => service.applyTurnState(id, state(sessionId, rev, phase), sessionId);

    it('is false for an unknown tab', () => {
      expect(service.canApplyTurnState('nope', SESS_123, 1, 'idle')).toBe(
        false,
      );
    });

    it('placeholder tab (claudeSessionId null): accepts any session when nothing was recorded', () => {
      const id = service.createTab('ph');
      expect(service.canApplyTurnState(id, undefined, 1, 'idle')).toBe(true);
      expect(service.canApplyTurnState(id, id, 1, 'idle')).toBe(true);
      expect(service.canApplyTurnState(id, SESS_123, 7, 'idle')).toBe(true);
    });

    it('placeholder tab: the counter is continuous across the placeholder → real-id rekey', () => {
      const id = service.createTab('ph2');
      applied(id, id, 2);

      // `bound` is null here, so the terminal heal NEVER applies: every
      // assertion below is decided by `revision > last`, exactly as before
      // (TASK_2026_371 — `rekey` carries the floors across the migration, so a
      // low revision on a placeholder is a true replay).
      expect(service.canApplyTurnState(id, id, 2, 'idle')).toBe(false);
      expect(service.canApplyTurnState(id, id, 3, 'idle')).toBe(true);
      expect(service.canApplyTurnState(id, SESS_123, 1, 'idle')).toBe(false);
      expect(service.canApplyTurnState(id, SESS_123, 3, 'idle')).toBe(true);
    });

    it('bound tab: rejects every event from another session, whatever its revision', () => {
      const id = service.createTab('bound');
      service.attachSession(id, SESS_123);

      expect(service.canApplyTurnState(id, SESS_XYZ, 1, 'idle')).toBe(false);
      expect(service.canApplyTurnState(id, SESS_XYZ, 99, 'idle')).toBe(false);
      expect(service.canApplyTurnState(id, undefined, 99, 'idle')).toBe(false);
      expect(service.canApplyTurnState(id, SESS_123, 1, 'idle')).toBe(true);
    });

    it('bound tab: same session compares revisions monotonically', () => {
      const id = service.createTab('mono');
      service.attachSession(id, SESS_123);
      applied(id, SESS_123, 3);

      // Re-expressed with 'generating' for the TASK_2026_371 terminal heal:
      // the monotonic comparison is what decides a NON-terminal phase, and
      // that is the replay window TASK_2026_360 review F1 closed.
      expect(service.canApplyTurnState(id, SESS_123, 2, 'generating')).toBe(
        false,
      );
      expect(service.canApplyTurnState(id, SESS_123, 3, 'generating')).toBe(
        false,
      );
      expect(service.canApplyTurnState(id, SESS_123, 4, 'generating')).toBe(
        true,
      );
    });

    it('bound tab: the terminal counterpart of the same revisions heals', () => {
      const id = service.createTab('mono-terminal');
      service.attachSession(id, SESS_123);
      applied(id, SESS_123, 3);

      // Decided by the terminal heal, not by the comparison: the backend says
      // the turn ended, and a tab that would otherwise hold `streaming`
      // forever is the worse of the two errors (TASK_2026_371).
      expect(service.canApplyTurnState(id, SESS_123, 2, 'idle')).toBe(true);
      expect(service.canApplyTurnState(id, SESS_123, 3, 'idle')).toBe(true);
      expect(service.canApplyTurnState(id, SESS_123, 4, 'idle')).toBe(true);
    });

    it('bound tab: an UNORDERED terminal does not heal, it is compared', () => {
      const id = service.createTab('mono-unordered');
      service.attachSession(id, SESS_123);
      applied(id, SESS_123, 3);

      // `allowTerminalHeal: false` is how the `session:status` reconciler
      // marks an event that did not come from the tab's chunk stream. Healing
      // it would idle a tab mid-turn, so it falls back to the comparison
      // (TASK_2026_371).
      expect(service.canApplyTurnState(id, SESS_123, 2, 'idle', false)).toBe(
        false,
      );
      expect(service.canApplyTurnState(id, SESS_123, 3, 'idle', false)).toBe(
        false,
      );
      // Above the watermark it is accepted on the ordinary rule, heal or not.
      expect(service.canApplyTurnState(id, SESS_123, 4, 'idle', false)).toBe(
        true,
      );
    });

    it('bound tab: a newly bound session restarts the counter', () => {
      const id = service.createTab('restart');
      applied(id, id, 5); // placeholder-era revision
      service.attachSession(id, SESS_123);

      expect(service.canApplyTurnState(id, SESS_123, 1, 'idle')).toBe(true);
      applied(id, SESS_123, 1);
      expect(tabOf(id)?.lastTurnStateSessionId).toBe(SESS_123);
      // Re-expressed with 'generating' for the TASK_2026_371 terminal heal:
      // the replayed revision 1 is rejected because the phase is NOT terminal.
      expect(service.canApplyTurnState(id, SESS_123, 1, 'generating')).toBe(
        false,
      );
      // Its terminal counterpart heals instead - the other half of the rule.
      expect(service.canApplyTurnState(id, SESS_123, 1, 'idle')).toBe(true);
      expect(service.canApplyTurnState(id, SESS_123, 2, 'generating')).toBe(
        true,
      );
      // The placeholder-era counter is no longer comparable. Decided by
      // OWNERSHIP (rule 1), which the heal never reaches - unchanged.
      expect(service.canApplyTurnState(id, id, 6, 'idle')).toBe(false);
    });

    // TASK_2026_371 F1. `SessionTurnStateRegistry.revisionFloors` is bounded
    // by `REVISION_FLOOR_MAP_LIMIT`, so an eviction INSIDE a live process
    // restarts the backend counter for a session whose tab is still open and
    // still holds a high revision. Without the heal both events of the next
    // turn lose `revision > last` and the tab keeps its spinner and Stop
    // button for good, with the backend idle - defect D1, reproduced.
    it('D1 under floor eviction: a bound tab heals on the restarted counter terminal event', () => {
      const id = service.createTab('evicted');
      service.attachSession(id, SESS_123);
      applied(id, SESS_123, 120);
      expect(tabOf(id)?.lastTurnStateRevision).toBe(120);

      expect(service.canApplyTurnState(id, SESS_123, 2, 'idle')).toBe(true);
      applied(id, SESS_123, 2);

      // The heal REALIGNS the watermark down onto the restarted counter, so
      // the rest of that session's turn is accepted normally instead of
      // sticking and healing again.
      expect(tabOf(id)?.lastTurnStateRevision).toBe(2);
      expect(tabOf(id)?.status).toBe('loaded');
      expect(service.canApplyTurnState(id, SESS_123, 3, 'generating')).toBe(
        true,
      );
    });

    it('the same tab still REJECTS generating@2 - the TASK_2026_360 replay window stays closed', () => {
      const id = service.createTab('no-spinner-replay');
      service.attachSession(id, SESS_123);
      applied(id, SESS_123, 120);

      // A replayed `generating` must never be able to resurrect a spinner.
      expect(service.canApplyTurnState(id, SESS_123, 2, 'generating')).toBe(
        false,
      );
    });

    it('placeholder tab: a terminal event at or below the recorded revision is still rejected', () => {
      const id = service.createTab('ph-no-heal');
      applied(id, id, 5);
      expect(tabOf(id)?.claudeSessionId).toBeFalsy();

      // The heal is bound-tab only. `rekey` carries the floors through the
      // placeholder -> real-id migration, so a low revision here is a true
      // replay (TASK_2026_371).
      expect(service.canApplyTurnState(id, id, 4, 'idle')).toBe(false);
      expect(service.canApplyTurnState(id, id, 5, 'idle')).toBe(false);
    });

    it.each(['failed', 'sleeping', 'awaiting-background'] as const)(
      'terminal phase %s heals a bound tab, so the predicate and the applier agree',
      (phase) => {
        const id = service.createTab(`terminal-${phase}`);
        service.attachSession(id, SESS_123);
        applied(id, SESS_123, 120);

        expect(service.canApplyTurnState(id, SESS_123, 2, phase)).toBe(true);
      },
    );

    it('resetTabToFresh clears both revision and session so the next query starts clean', () => {
      const id = service.createTab('fresh');
      service.attachSession(id, SESS_123);
      applied(id, SESS_123, 4);

      service.resetTabToFresh(id);

      expect(tabOf(id)?.lastTurnStateRevision).toBeUndefined();
      expect(tabOf(id)?.lastTurnStateSessionId).toBeUndefined();
    });
  });

  describe('session id attach', () => {
    it('attachSession sets claudeSessionId', () => {
      const id = service.createTab('attach');
      service.attachSession(id, SESS_123);
      expect(service.tabs().find((t) => t.id === id)?.claudeSessionId).toBe(
        SESS_123,
      );
    });

    // Verify that the explicit `attachSession` + `markStreaming` pairing
    // has the expected observable effect (no separate "adopt" helper).
    it('attachSession + markStreaming is the post-Phase-6b replacement for adoptStreamingSession', () => {
      const id = service.createTab('adopt-replacement');
      service.attachSession(id, SESS_XYZ);
      service.markStreaming(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.claudeSessionId).toBe(SESS_XYZ);
      expect(tab?.status).toBe('streaming');
    });
  });

  describe('streaming state lifecycle', () => {
    let state: StreamingState;
    beforeEach(() => {
      state = createEmptyStreamingState();
    });

    it('setStreamingState replaces or nulls streamingState', () => {
      const id = service.createTab('stream');
      service.setStreamingState(id, state);
      expect(service.tabs().find((t) => t.id === id)?.streamingState).toBe(
        state,
      );
      service.setStreamingState(id, null);
      expect(
        service.tabs().find((t) => t.id === id)?.streamingState,
      ).toBeNull();
    });

    it('setStreamingStateAndCurrentMessage writes both atomically', () => {
      const id = service.createTab('atomic');
      service.setStreamingStateAndCurrentMessage(id, state, 'msg-1');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.streamingState).toBe(state);
      expect(tab?.currentMessageId).toBe('msg-1');
    });
  });

  describe('messages', () => {
    it('setMessages replaces the messages array', () => {
      const id = service.createTab('msgs');
      const msgs = [makeMessage('a', 'hello')];
      service.setMessages(id, msgs);
      expect(service.tabs().find((t) => t.id === id)?.messages).toBe(msgs);
    });

    it('appendUserMessageForNewTurn resets currentMessageId', () => {
      const id = service.createTab('turn');
      service.setStreamingStateAndCurrentMessage(id, null, 'old');
      service.appendUserMessageForNewTurn(id, [makeMessage('u', 'hi')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.messages.length).toBe(1);
      expect(tab?.currentMessageId).toBeNull();
    });

    it('appendUserMessageAndResetStreaming clears stale streamingState', () => {
      const id = service.createTab('reset');
      const state = createEmptyStreamingState();
      service.setStreamingState(id, state);
      service.appendUserMessageAndResetStreaming(id, [makeMessage('u', 'hi')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.currentMessageId).toBeNull();
    });

    it('setMessagesAndMarkLoaded forces loaded state', () => {
      const id = service.createTab('failpath');
      service.markStreaming(id);
      service.setMessagesAndMarkLoaded(id, [makeMessage('e', 'err')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.status).toBe('loaded');
      expect(tab?.messages.length).toBe(1);
    });
  });

  describe('reconcileUserMessageNativeUuid', () => {
    const UUID = 'ee01a4e6-3ca4-43f1-9e3f-6ff56a227fbb';
    const userMsg = (id: string): ExecutionChatMessage =>
      ({
        id,
        role: 'user',
        timestamp: 1,
        streamingState: null,
        rawContent: 'hi',
      }) as unknown as ExecutionChatMessage;

    it('stamps nativeUuid onto the optimistic bubble without changing its id', () => {
      const id = service.createTab('rec');
      service.setMessages(id, [userMsg('msg_1780940558448_oekdvwh')]);
      service.reconcileUserMessageNativeUuid(id, UUID);
      const msg = service.tabs().find((t) => t.id === id)?.messages[0];
      expect(msg?.id).toBe('msg_1780940558448_oekdvwh'); // id unchanged (no remount)
      expect(msg?.nativeUuid).toBe(UUID);
    });

    it('is idempotent and a no-op once stamped', () => {
      const id = service.createTab('rec2');
      service.setMessages(id, [userMsg('msg_1_a')]);
      service.reconcileUserMessageNativeUuid(id, UUID);
      const before = service.tabs().find((t) => t.id === id)?.messages;
      service.reconcileUserMessageNativeUuid(id, UUID);
      const after = service.tabs().find((t) => t.id === id)?.messages;
      expect(after).toBe(before); // same array reference — no write
    });

    it('ignores messages whose id is already a real uuid (history-loaded)', () => {
      const id = service.createTab('rec3');
      service.setMessages(id, [userMsg(UUID)]);
      service.reconcileUserMessageNativeUuid(
        id,
        '11111111-2222-4333-8444-555555555555',
      );
      const msg = service.tabs().find((t) => t.id === id)?.messages[0];
      expect(msg?.nativeUuid).toBeUndefined();
    });

    it('rejects a non-uuid value', () => {
      const id = service.createTab('rec4');
      service.setMessages(id, [userMsg('msg_1_a')]);
      service.reconcileUserMessageNativeUuid(id, 'not-a-uuid');
      const msg = service.tabs().find((t) => t.id === id)?.messages[0];
      expect(msg?.nativeUuid).toBeUndefined();
    });
  });

  describe('finalization', () => {
    it('applyFinalizedTurn drops streamingState and switches to loaded', async () => {
      const id = service.createTab('final');
      const state = createEmptyStreamingState();
      service.setStreamingStateAndCurrentMessage(id, state, 'msg');
      service.applyFinalizedTurn(id, [makeMessage('a', 'done')]);
      // applyFinalizedTurn splits the commit across two writes to prevent
      // a scroll-vs-FLIP race during finalize: messages + currentMessageId
      // land synchronously while status and streamingState flip together
      // one microtask later, so every streaming-derived signal flips on a
      // single coherent boundary AFTER the DOM commits the finalized
      // messages.
      const sync = service.tabs().find((t) => t.id === id);
      expect(sync?.currentMessageId).toBeNull();
      expect(sync?.messages.length).toBe(1);
      expect(sync?.streamingState).not.toBeNull();
      await Promise.resolve();
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.status).toBe('loaded');
      expect(tab?.currentMessageId).toBeNull();
    });

    it('applyFinalizedHistory keeps currentMessageId untouched logic', () => {
      const id = service.createTab('hist');
      service.applyFinalizedHistory(id, [makeMessage('a', 'h')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.status).toBe('loaded');
      expect(tab?.streamingState).toBeNull();
    });

    it('clearStreamingForLoaded preserves messages', () => {
      const id = service.createTab('dedupe');
      service.setMessages(id, [makeMessage('a', 'kept')]);
      service.setStreamingState(id, createEmptyStreamingState());
      service.clearStreamingForLoaded(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.messages.length).toBe(1);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.status).toBe('loaded');
    });
  });

  describe('error/abort reset', () => {
    it('applyErrorReset drops queue + clears currentMessageId', () => {
      const id = service.createTab('err');
      service.setQueuedContentAndOptions(id, 'pending', { files: [] });
      service.applyErrorReset(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBeNull();
      expect(tab?.queuedOptions).toBeNull();
      expect(tab?.status).toBe('loaded');
    });

    it('applyStatusErrorReset only clears status + currentMessageId', () => {
      const id = service.createTab('lite');
      service.setQueuedContent(id, 'still here');
      service.applyStatusErrorReset(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBe('still here');
      expect(tab?.status).toBe('loaded');
    });

    it('detachSessionAndMarkLoaded clears claudeSessionId', () => {
      const id = service.createTab('detach');
      service.attachSession(id, SESS_X);
      service.detachSessionAndMarkLoaded(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.claudeSessionId).toBeNull();
      expect(tab?.status).toBe('loaded');
    });
  });

  describe('compaction', () => {
    it('markCompactionStart/clearCompactingFlag toggle isCompacting', () => {
      const id = service.createTab('compact');
      service.markCompactionStart(id);
      expect(service.tabs().find((t) => t.id === id)?.isCompacting).toBe(true);
      service.clearCompactingFlag(id);
      expect(service.tabs().find((t) => t.id === id)?.isCompacting).toBe(false);
    });

    it('applyCompactionTimeoutReset clears state machine', () => {
      const id = service.createTab('timeout');
      service.markCompactionStart(id);
      service.setStreamingState(id, createEmptyStreamingState());
      service.applyCompactionTimeoutReset(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.isCompacting).toBe(false);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.status).toBe('loaded');
    });

    it('applyCompactionComplete resets messages + bumps count', () => {
      const id = service.createTab('done');
      service.setMessages(id, [makeMessage('a', 'old')]);
      service.applyCompactionComplete(id, {
        preloadedStats: {
          totalCost: 1,
          tokens: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
          messageCount: 1,
        },
        compactionCount: 2,
      });
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.messages).toEqual([]);
      expect(tab?.compactionCount).toBe(2);
      expect(tab?.preloadedStats?.totalCost).toBe(1);
    });
  });

  describe('turn-end snapshot', () => {
    it('setTurnEndedFields persists background tasks, session crons, and terminal reason', () => {
      const id = service.createTab('turn-end');
      service.setTurnEndedFields(id, {
        pendingBackgroundTasks: [
          {
            id: 'bg-1',
            type: 'subagent',
            status: 'running',
            description: 'still going',
          },
        ],
        pendingSessionCrons: [
          {
            id: 'cron-1',
            schedule: '*/5 * * * *',
            recurring: true,
            prompt: 'ping',
          },
        ],
        lastTerminalReason: 'completed',
      });
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.pendingBackgroundTasks).toHaveLength(1);
      expect(tab?.pendingBackgroundTasks?.[0].id).toBe('bg-1');
      expect(tab?.pendingSessionCrons).toHaveLength(1);
      expect(tab?.pendingSessionCrons?.[0].id).toBe('cron-1');
      expect(tab?.lastTerminalReason).toBe('completed');
    });

    it('setLastTerminalReason stamps the terminal reason only', () => {
      const id = service.createTab('turn-failed');
      service.setLastTerminalReason(id, 'aborted_streaming');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.lastTerminalReason).toBe('aborted_streaming');
      expect(tab?.pendingBackgroundTasks).toBeUndefined();
      expect(tab?.pendingSessionCrons).toBeUndefined();
    });

    it('setLastTerminalReason accepts null without throwing', () => {
      const id = service.createTab('turn-null');
      service.setLastTerminalReason(id, null);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.lastTerminalReason).toBeNull();
    });

    it('setPendingBackgroundTasks replaces the snapshot without touching other fields', () => {
      const id = service.createTab('bg-snapshot');
      service.setTurnEndedFields(id, {
        pendingBackgroundTasks: [
          { id: 'bg-1', type: 'subagent', status: 'running', description: 'a' },
          { id: 'bg-2', type: 'subagent', status: 'running', description: 'b' },
        ],
        pendingSessionCrons: [],
        lastTerminalReason: 'completed',
      });

      service.setPendingBackgroundTasks(id, [
        { id: 'bg-2', type: 'subagent', status: 'running', description: 'b' },
      ]);

      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.pendingBackgroundTasks).toHaveLength(1);
      expect(tab?.pendingBackgroundTasks?.[0].id).toBe('bg-2');
      expect(tab?.lastTerminalReason).toBe('completed');
    });
  });

  describe('stats and model bookkeeping', () => {
    it('setLiveModelStats updates the live stats payload', () => {
      const id = service.createTab('lms');
      service.setLiveModelStats(id, {
        model: 'claude',
        contextUsed: 10,
        contextWindow: 100,
        contextPercent: 10,
      });
      expect(
        service.tabs().find((t) => t.id === id)?.liveModelStats?.model,
      ).toBe('claude');
    });

    it('setLiveModelStatsAndUsageList writes both', () => {
      const id = service.createTab('combo');
      service.setLiveModelStatsAndUsageList(
        id,
        {
          model: 'claude',
          contextUsed: 1,
          contextWindow: 2,
          contextPercent: 50,
        },
        [
          {
            model: 'claude',
            inputTokens: 1,
            outputTokens: 1,
            costUSD: 0,
            contextWindow: 2,
          },
        ],
      );
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.modelUsageList?.length).toBe(1);
      expect(tab?.liveModelStats?.contextWindow).toBe(2);
    });

    it('setPreloadedStats and applyLoadedSessionStats install the snapshot', () => {
      const id = service.createTab('preload');
      const stats = {
        totalCost: 0.5,
        tokens: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0 },
        messageCount: 3,
      };
      service.setPreloadedStats(id, stats);
      expect(service.tabs().find((t) => t.id === id)?.preloadedStats).toBe(
        stats,
      );
      service.applyLoadedSessionStats(id, stats, 'claude-3-5-sonnet');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.sessionModel).toBe('claude-3-5-sonnet');
    });

    // `applyLoadedSessionStats` synthesizes a best-effort liveModelStats so
    // the header renders the model name and context window immediately on
    // resume, instead of staying empty until the first live SESSION_STATS
    // arrives.
    it('N6 — synthesizes liveModelStats from sessionModel on session resume', () => {
      const id = service.createTab('resume');
      const stats = {
        totalCost: 1.25,
        tokens: { input: 100, output: 50, cacheRead: 10, cacheCreation: 0 },
        messageCount: 8,
      };
      // claude-opus-4-7 is a known model in the shared pricing registry
      // (1_000_000 token window — see pricing.utils.spec.ts).
      service.applyLoadedSessionStats(id, stats, 'claude-opus-4-7');

      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.sessionModel).toBe('claude-opus-4-7');
      expect(tab?.liveModelStats).not.toBeNull();
      expect(tab?.liveModelStats?.model).toBe('claude-opus-4-7');
      expect(tab?.liveModelStats?.contextUsed).toBe(0);
      expect(tab?.liveModelStats?.contextPercent).toBe(0);
      // Window populated from the shared getModelContextWindow lookup.
      expect(tab?.liveModelStats?.contextWindow).toBeGreaterThan(0);
    });

    it('N6 — leaves liveModelStats null when sessionModel is null', () => {
      const id = service.createTab('resume-null-model');
      const stats = {
        totalCost: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        messageCount: 0,
      };
      service.applyLoadedSessionStats(id, stats, null);

      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.sessionModel).toBeNull();
      expect(tab?.liveModelStats).toBeNull();
    });
  });

  describe('queue helpers', () => {
    it('setQueuedContent / clear / reset variants update the queue', () => {
      const id = service.createTab('q');
      service.setQueuedContentAndOptions(id, 'first', { files: ['a.ts'] });
      let tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBe('first');
      expect(tab?.queuedOptions?.files).toEqual(['a.ts']);

      service.resetQueuedContentAndOptions(id);
      tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBe('');
      expect(tab?.queuedOptions).toBeNull();

      service.clearQueuedContentAndOptions(id);
      tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBeNull();
      expect(tab?.queuedOptions).toBeNull();
    });
  });

  describe('per-session overrides + naming', () => {
    it('setOverrideModel and setOverrideEffort set tab overrides', () => {
      const id = service.createTab('over');
      service.setOverrideModel(id, 'opus');
      service.setOverrideEffort(id, 'high');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.overrideModel).toBe('opus');
      expect(tab?.overrideEffort).toBe('high');
    });

    it('setNameAndTitle updates both fields atomically', () => {
      const id = service.createTab('rename');
      service.setNameAndTitle(id, 'New Name', 'New Title');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.name).toBe('New Name');
      expect(tab?.title).toBe('New Title');
    });
  });

  describe('resume helpers', () => {
    it('applyResumingSession loads sessionId + resuming status', () => {
      const id = service.createTab('resume');
      const state = createEmptyStreamingState();
      service.applyResumingSession(id, {
        sessionId: SESS_R,
        name: 'name',
        title: 'title',
        streamingState: state,
      });
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.claudeSessionId).toBe(SESS_R);
      expect(tab?.status).toBe('resuming');
      expect(tab?.streamingState).toBe(state);
    });

    it('applyResumedHistory installs replay messages and marks loaded', () => {
      const id = service.createTab('replay');
      const msgs = [makeMessage('h', 'hist')];
      service.applyResumedHistory(id, msgs);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.messages).toBe(msgs);
      expect(tab?.status).toBe('loaded');
    });

    it('applyResumeFailure clears streamingState', () => {
      const id = service.createTab('failure');
      service.setStreamingState(id, createEmptyStreamingState());
      service.applyResumeFailure(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.status).toBe('loaded');
    });
  });

  describe('view mode + draft helpers', () => {
    it('toggleTabViewMode flips between full and compact', () => {
      const id = service.createTab('view');
      expect(service.getTabViewMode(id)).toBe('full');
      service.toggleTabViewMode(id);
      expect(service.getTabViewMode(id)).toBe('compact');
      service.toggleTabViewMode(id);
      expect(service.getTabViewMode(id)).toBe('full');
    });

    it('applyNewConversationDraft sets draft + clears claudeSessionId', () => {
      const id = service.createTab('draft');
      service.attachSession(id, SESS_PRE);
      service.applyNewConversationDraft(id, 'Drafted');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.status).toBe('draft');
      expect(tab?.name).toBe('Drafted');
      expect(tab?.claudeSessionId).toBeNull();
    });

    it('applyNewConversationStreaming applies name+title and forces streaming', () => {
      const id = service.createTab('go');
      service.applyNewConversationStreaming(id, 'Auto Name');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.name).toBe('Auto Name');
      expect(tab?.status).toBe('streaming');
    });
  });
});
