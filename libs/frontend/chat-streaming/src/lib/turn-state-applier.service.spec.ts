/**
 * TurnStateApplier specs (TASK_2026_360).
 *
 * The ONE consumer of the backend `turn_state` event. Pins:
 *   - tab resolution order: routed tabId → active tabs bound to the session
 *     (canvas fan-out) → background-partition owner;
 *   - on a terminal phase, finalization runs BEFORE the status flip, with
 *     `isAborted` derived from the terminal reason (and always true for
 *     `failed`);
 *   - `TabManagerService.applyTurnState` is called once per resolved tab;
 *   - liveness is marked per phase with the OWNING tab's workspace, and is
 *     still marked when no tab resolves (surface-owned session) — silently;
 *   - hard-denied agents are marked interrupted after finalization, from the
 *     SESSION's bucket only (review F4);
 *   - the acceptance check (`TabManagerService.canApplyTurnState`) runs
 *     BEFORE any side effect: a stale broadcaster with a foreign session and a
 *     re-used tab id, or a delayed lower-revision probe, changes nothing;
 *     surface sessions (no tab) get their own revision guard (review F1).
 */

import { TestBed } from '@angular/core/testing';
import {
  SessionLivenessRegistry,
  TabManagerService,
} from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import {
  SessionId,
  UNKNOWN_AGENT_TOOL_CALL_ID,
  type TurnStateEvent,
} from '@ptah-extension/shared';
import { MessageFinalizationService } from './message-finalization.service';
import { PermissionHandlerService } from './permission-handler.service';
import { TurnStateApplier } from './turn-state-applier.service';

const SESSION_ID = SessionId.create();
const OTHER_SESSION = SessionId.create();
const ACTIVE_WS = '/ws/active';
const BG_WS = '/ws/bg';

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Tab',
    name: 'Tab',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESSION_ID,
    ...overrides,
  } as TabState;
}

function turnState(overrides: Partial<TurnStateEvent> = {}): TurnStateEvent {
  return {
    id: 'evt-turn-state',
    eventType: 'turn_state',
    timestamp: 1,
    sessionId: SESSION_ID,
    messageId: `turn-state-${SESSION_ID}`,
    phase: 'idle',
    revision: 1,
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: 'completed',
    source: 'stream',
    ...overrides,
  };
}

describe('TurnStateApplier', () => {
  let applier: TurnStateApplier;
  let activeTabs: TabState[];
  let bgLookup: { tab: TabState; workspacePath: string } | null;
  let hardDeny: Set<string>;
  let findTabByIdAcrossWorkspaces: jest.Mock;
  let findTabsBySessionId: jest.Mock;
  let findTabBySessionIdAcrossWorkspaces: jest.Mock;
  let applyTurnState: jest.Mock;
  let canApplyTurnState: jest.Mock;
  let finalizeCurrentMessage: jest.Mock;
  let markLastAgentAsInterrupted: jest.Mock;
  let markAgentsAsInterruptedByToolCallIds: jest.Mock;
  let consumeHardDenyToolUseIds: jest.Mock;
  let liveness: {
    markStreaming: jest.Mock;
    markAwaitingBackground: jest.Mock;
    markIdle: jest.Mock;
    markFailed: jest.Mock;
  };
  let consoleWarn: jest.SpyInstance;
  let consoleDebug: jest.SpyInstance;

  beforeEach(() => {
    activeTabs = [makeTab()];
    bgLookup = null;
    hardDeny = new Set<string>();

    findTabByIdAcrossWorkspaces = jest.fn((tabId: string) => {
      const active = activeTabs.find((t) => t.id === tabId);
      if (active) return { tab: active, workspacePath: ACTIVE_WS };
      return bgLookup?.tab.id === tabId ? bgLookup : null;
    });
    findTabsBySessionId = jest.fn((sessionId: string) =>
      activeTabs.filter((t) => t.claudeSessionId === sessionId),
    );
    findTabBySessionIdAcrossWorkspaces = jest.fn(() => bgLookup);
    applyTurnState = jest.fn();
    // Mirrors `TabManagerService.acceptsTurnState` (its table is pinned in
    // tab-manager.intent-mutators.spec.ts) so the applier is driven by real
    // tab fields rather than a canned boolean.
    canApplyTurnState = jest.fn(
      (tabId: string, sessionId: string | undefined, revision: number) => {
        const tab = findTabByIdAcrossWorkspaces(tabId)?.tab as
          | TabState
          | undefined;
        if (!tab) return false;
        if (tab.claudeSessionId && tab.claudeSessionId !== sessionId) {
          return false;
        }
        const last = tab.lastTurnStateRevision;
        if (last === undefined) return true;
        if (tab.lastTurnStateSessionId !== sessionId && tab.claudeSessionId) {
          return true;
        }
        return revision > last;
      },
    );
    finalizeCurrentMessage = jest.fn();
    markLastAgentAsInterrupted = jest.fn();
    markAgentsAsInterruptedByToolCallIds = jest.fn();
    consumeHardDenyToolUseIds = jest.fn(() => hardDeny);
    liveness = {
      markStreaming: jest.fn(),
      markAwaitingBackground: jest.fn(),
      markIdle: jest.fn(),
      markFailed: jest.fn(),
    };
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleDebug = jest.spyOn(console, 'debug').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        TurnStateApplier,
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces,
            findTabsBySessionId,
            findTabBySessionIdAcrossWorkspaces,
            applyTurnState,
            canApplyTurnState,
          },
        },
        {
          provide: MessageFinalizationService,
          useValue: {
            finalizeCurrentMessage,
            markLastAgentAsInterrupted,
            markAgentsAsInterruptedByToolCallIds,
          },
        },
        {
          provide: PermissionHandlerService,
          useValue: { consumeHardDenyToolUseIds },
        },
        { provide: SessionLivenessRegistry, useValue: liveness },
      ],
    });
    applier = TestBed.inject(TurnStateApplier);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleDebug.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('terminal phases', () => {
    it('finalizes BEFORE the status flip, then applies the state to the tab', () => {
      const event = turnState({ phase: 'idle' });

      applier.apply(event, 'tab-1');

      expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab-1', false);
      expect(applyTurnState).toHaveBeenCalledWith('tab-1', event, SESSION_ID);
      expect(finalizeCurrentMessage.mock.invocationCallOrder[0]).toBeLessThan(
        applyTurnState.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ['completed', false],
      [null, false],
      ['aborted_streaming', true],
      ['aborted_tools', true],
      ['blocking_limit', true],
    ] as const)(
      'derives isAborted from terminalReason %s → %s',
      (terminalReason, isAborted) => {
        applier.apply(
          turnState({ phase: 'awaiting-background', terminalReason }),
          'tab-1',
        );
        expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab-1', isAborted);
      },
    );

    it('finalizes as aborted on failed even when the reason is null', () => {
      applier.apply(
        turnState({ phase: 'failed', terminalReason: null, error: 'unknown' }),
        'tab-1',
      );
      expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab-1', true);
    });

    it('marks hard-denied agents interrupted after finalization, draining the SESSION bucket once', () => {
      hardDeny = new Set([UNKNOWN_AGENT_TOOL_CALL_ID, 'toolu_x', 'toolu_y']);
      activeTabs = [makeTab({ id: 'tab-a' }), makeTab({ id: 'tab-b' })];

      applier.apply(turnState({ phase: 'idle' }));

      expect(consumeHardDenyToolUseIds).toHaveBeenCalledTimes(1);
      expect(consumeHardDenyToolUseIds).toHaveBeenCalledWith(SESSION_ID);
      expect(markLastAgentAsInterrupted).toHaveBeenCalledWith('tab-a');
      expect(markLastAgentAsInterrupted).toHaveBeenCalledWith('tab-b');
      expect(markAgentsAsInterruptedByToolCallIds).toHaveBeenCalledWith(
        'tab-a',
        new Set(['toolu_x', 'toolu_y']),
      );
      expect(finalizeCurrentMessage.mock.invocationCallOrder[0]).toBeLessThan(
        markLastAgentAsInterrupted.mock.invocationCallOrder[0],
      );
    });

    it('does not touch the agent markers when nothing was hard-denied', () => {
      applier.apply(turnState({ phase: 'idle' }), 'tab-1');
      expect(markLastAgentAsInterrupted).not.toHaveBeenCalled();
      expect(markAgentsAsInterruptedByToolCallIds).not.toHaveBeenCalled();
    });

    it('falls back to the placeholder tab id as the hard-deny bucket when the event carries no session', () => {
      activeTabs = [makeTab({ id: 'tab-1', claudeSessionId: null })];
      hardDeny = new Set(['toolu_p']);

      applier.apply(
        turnState({ phase: 'idle', sessionId: undefined }),
        'tab-1',
      );

      expect(consumeHardDenyToolUseIds).toHaveBeenCalledWith('tab-1');
      expect(markAgentsAsInterruptedByToolCallIds).toHaveBeenCalledWith(
        'tab-1',
        new Set(['toolu_p']),
      );
    });
  });

  describe('acceptance before any side effect (review F1)', () => {
    it('runs the check BEFORE finalization, with the event session and revision', () => {
      applier.apply(turnState({ phase: 'idle', revision: 4 }), 'tab-1');

      expect(canApplyTurnState).toHaveBeenCalledWith('tab-1', SESSION_ID, 4);
      expect(canApplyTurnState.mock.invocationCallOrder[0]).toBeLessThan(
        finalizeCurrentMessage.mock.invocationCallOrder[0],
      );
    });

    it('drops a stale idle@6 from the OLD session that captured a tab id now owned by the new session', () => {
      // The tab was reset and re-bound; the replacement session already
      // applied generating@1.
      activeTabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESSION_ID,
          lastTurnStateRevision: 1,
          lastTurnStateSessionId: SESSION_ID,
        }),
      ];
      hardDeny = new Set(['toolu_new']);

      applier.apply(
        turnState({
          phase: 'idle',
          revision: 6,
          sessionId: OTHER_SESSION,
          terminalReason: 'aborted_streaming',
        }),
        'tab-1',
      );

      expect(finalizeCurrentMessage).not.toHaveBeenCalled();
      expect(consumeHardDenyToolUseIds).not.toHaveBeenCalled();
      expect(markAgentsAsInterruptedByToolCallIds).not.toHaveBeenCalled();
      expect(applyTurnState).not.toHaveBeenCalled();
      // The new session's liveness is untouched. The old session id itself
      // may go idle — that write never reaches the tab.
      expect(liveness.markIdle).not.toHaveBeenCalledWith(
        SESSION_ID,
        expect.anything(),
      );
      expect(liveness.markIdle).not.toHaveBeenCalledWith(
        OTHER_SESSION,
        ACTIVE_WS,
      );
      expect(consoleDebug).toHaveBeenCalledWith(
        '[TurnStateApplier] dropped stale/foreign turn_state',
        expect.objectContaining({ tabId: 'tab-1', revision: 6 }),
      );
    });

    it('rejects a delayed probe idle@2 after a live generating@3 before finalization or liveness', () => {
      activeTabs = [
        makeTab({
          id: 'tab-1',
          lastTurnStateRevision: 3,
          lastTurnStateSessionId: SESSION_ID,
        }),
      ];

      applier.apply(
        turnState({ phase: 'idle', revision: 2, source: 'probe' as never }),
        'tab-1',
      );

      expect(finalizeCurrentMessage).not.toHaveBeenCalled();
      expect(applyTurnState).not.toHaveBeenCalled();
      expect(consumeHardDenyToolUseIds).not.toHaveBeenCalled();
      expect(liveness.markIdle).not.toHaveBeenCalled();
    });

    it('accepts an unresolved placeholder tab (claudeSessionId null) for any session', () => {
      activeTabs = [makeTab({ id: 'tab-1', claudeSessionId: null })];
      const event = turnState({
        phase: 'generating',
        terminalReason: null,
        sessionId: 'tab-1' as never,
      });

      applier.apply(event, 'tab-1');

      expect(applyTurnState).toHaveBeenCalledWith('tab-1', event, 'tab-1');
      expect(liveness.markStreaming).toHaveBeenCalledWith('tab-1', ACTIVE_WS);
    });

    it('accepts a bound tab whose session matches the event', () => {
      activeTabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESSION_ID,
          lastTurnStateRevision: 2,
          lastTurnStateSessionId: SESSION_ID,
        }),
      ];
      const event = turnState({ phase: 'idle', revision: 3 });

      applier.apply(event, 'tab-1');

      expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab-1', false);
      expect(applyTurnState).toHaveBeenCalledWith('tab-1', event, SESSION_ID);
      expect(liveness.markIdle).toHaveBeenCalledWith(SESSION_ID, ACTIVE_WS);
    });

    it('keeps only the accepting tabs of a fan-out', () => {
      activeTabs = [
        makeTab({ id: 'tab-a' }),
        makeTab({
          id: 'tab-b',
          lastTurnStateRevision: 9,
          lastTurnStateSessionId: SESSION_ID,
        }),
      ];
      const event = turnState({ phase: 'idle', revision: 5 });

      applier.apply(event);

      expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab-a', false);
      expect(finalizeCurrentMessage).not.toHaveBeenCalledWith(
        'tab-b',
        expect.anything(),
      );
      expect(applyTurnState).toHaveBeenCalledWith('tab-a', event, SESSION_ID);
      expect(applyTurnState).not.toHaveBeenCalledWith(
        'tab-b',
        expect.anything(),
        expect.anything(),
      );
      expect(liveness.markIdle).toHaveBeenCalledWith(SESSION_ID, ACTIVE_WS);
    });

    it('guards surface (no-tab) liveness by revision per session', () => {
      activeTabs = [];
      bgLookup = null;

      applier.apply(
        turnState({ phase: 'generating', revision: 3, terminalReason: null }),
      );
      applier.apply(turnState({ phase: 'idle', revision: 2 }));
      expect(liveness.markStreaming).toHaveBeenCalledWith(
        SESSION_ID,
        undefined,
      );
      expect(liveness.markIdle).not.toHaveBeenCalled();

      applier.apply(turnState({ phase: 'idle', revision: 3 }));
      expect(liveness.markIdle).not.toHaveBeenCalled();

      applier.apply(turnState({ phase: 'idle', revision: 4 }));
      expect(liveness.markIdle).toHaveBeenCalledWith(SESSION_ID, undefined);

      // Another session has its own counter.
      applier.apply(
        turnState({ phase: 'idle', revision: 1, sessionId: OTHER_SESSION }),
      );
      expect(liveness.markIdle).toHaveBeenCalledWith(OTHER_SESSION, undefined);
    });
  });

  describe('generating', () => {
    it('does NOT finalize and applies the state to the tab', () => {
      const event = turnState({ phase: 'generating', terminalReason: null });

      applier.apply(event, 'tab-1');

      expect(finalizeCurrentMessage).not.toHaveBeenCalled();
      expect(consumeHardDenyToolUseIds).not.toHaveBeenCalled();
      expect(applyTurnState).toHaveBeenCalledWith('tab-1', event, SESSION_ID);
    });
  });

  describe('tab resolution', () => {
    it('prefers the routed tabId and skips the session lookups', () => {
      applier.apply(turnState(), 'tab-1');

      expect(findTabByIdAcrossWorkspaces).toHaveBeenCalledWith('tab-1');
      expect(findTabsBySessionId).not.toHaveBeenCalled();
      expect(findTabBySessionIdAcrossWorkspaces).not.toHaveBeenCalled();
    });

    it('fans out to every active tab bound to the session when no tabId is given', () => {
      activeTabs = [
        makeTab({ id: 'tab-a' }),
        makeTab({ id: 'tab-b' }),
        makeTab({ id: 'tab-other', claudeSessionId: OTHER_SESSION }),
      ];
      const event = turnState({ phase: 'idle' });

      applier.apply(event);

      expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab-a', false);
      expect(finalizeCurrentMessage).toHaveBeenCalledWith('tab-b', false);
      expect(applyTurnState).toHaveBeenCalledWith('tab-a', event, SESSION_ID);
      expect(applyTurnState).toHaveBeenCalledWith('tab-b', event, SESSION_ID);
      expect(applyTurnState).not.toHaveBeenCalledWith(
        'tab-other',
        event,
        SESSION_ID,
      );
    });

    it('falls back to the background-partition owner and marks liveness with ITS workspace', () => {
      activeTabs = [];
      bgLookup = { tab: makeTab({ id: 'bg-tab' }), workspacePath: BG_WS };
      const event = turnState({ phase: 'awaiting-background' });

      applier.apply(event);

      expect(finalizeCurrentMessage).toHaveBeenCalledWith('bg-tab', false);
      expect(applyTurnState).toHaveBeenCalledWith('bg-tab', event, SESSION_ID);
      expect(liveness.markAwaitingBackground).toHaveBeenCalledWith(
        SESSION_ID,
        BG_WS,
      );
    });

    it('resolves a routed tabId that lives in a background partition', () => {
      activeTabs = [];
      bgLookup = { tab: makeTab({ id: 'bg-tab' }), workspacePath: BG_WS };

      applier.apply(turnState({ phase: 'idle' }), 'bg-tab');

      expect(applyTurnState).toHaveBeenCalledWith(
        'bg-tab',
        expect.anything(),
        SESSION_ID,
      );
      expect(liveness.markIdle).toHaveBeenCalledWith(SESSION_ID, BG_WS);
    });

    it('writes liveness only — and does not warn — when no tab resolves (surface-owned session)', () => {
      activeTabs = [];
      bgLookup = null;

      applier.apply(turnState({ phase: 'generating', terminalReason: null }));

      expect(finalizeCurrentMessage).not.toHaveBeenCalled();
      expect(applyTurnState).not.toHaveBeenCalled();
      expect(liveness.markStreaming).toHaveBeenCalledWith(
        SESSION_ID,
        undefined,
      );
      expect(consoleWarn).not.toHaveBeenCalled();
    });

    it('never throws on an event with no usable session id', () => {
      activeTabs = [];

      expect(() =>
        applier.apply(turnState({ sessionId: '' as never })),
      ).not.toThrow();
      expect(() =>
        applier.apply(turnState({ sessionId: undefined })),
      ).not.toThrow();

      expect(applyTurnState).not.toHaveBeenCalled();
      expect(liveness.markIdle).not.toHaveBeenCalled();
    });
  });

  describe('liveness per phase', () => {
    it.each([
      ['generating', 'markStreaming'],
      ['awaiting-background', 'markAwaitingBackground'],
      ['sleeping', 'markAwaitingBackground'],
      ['idle', 'markIdle'],
      ['failed', 'markFailed'],
    ] as const)('%s → %s with the owning workspace', (phase, mark) => {
      applier.apply(
        turnState({
          phase,
          terminalReason: phase === 'generating' ? null : 'completed',
        }),
        'tab-1',
      );

      expect(liveness[mark]).toHaveBeenCalledWith(SESSION_ID, ACTIVE_WS);
      for (const other of Object.keys(liveness) as (keyof typeof liveness)[]) {
        if (other !== mark) expect(liveness[other]).not.toHaveBeenCalled();
      }
    });
  });
});
