/**
 * BackgroundAgentStore specs — signal store for background (run_in_background)
 * agents spawned via the Task tool.
 *
 * Store is keyed by `BackgroundAgentId` (the SDK-issued `agentId`), not by
 * `toolCallId`. The toolCallId stays on the entry so the tree builder's
 * `isBackgroundAgent(toolCallId)` lookup keeps working (now O(n) over the
 * bounded agent set).
 *
 * Coverage:
 *   - onStarted: inserts a running entry and starts the 1s tick interval
 *   - onStarted is idempotent when the same agentId is already running
 *   - onProgress: appends summary and respects error status
 *   - onCompleted: updates status + cost + duration + triggers tick stop
 *   - onCompleted for an unknown agentId inserts a synthetic entry
 *   - onStopped: marks the entry stopped (with fallback insertion)
 *   - agentsForSession filters by sessionId
 *   - isBackgroundAgent lookup (by toolCallId, scans entries)
 *   - findByAgentId — O(1) lookup by branded agentId
 *   - sessionForAgent — parent-session lookup, null when missing
 *   - Map keyed by agentId — same toolCallId across two agentIds
 *     keeps both entries
 *   - Fallback warning — SDK-omits-agentId path warns once
 *   - clearCompleted drops non-running entries
 *   - Computed signals: runningAgents, completedAgents, runningCount,
 *     totalCount, hasRunningAgents, backgroundToolCallIds
 *   - MAX_COMPLETED_AGENTS eviction: oldest completed evicted first
 *   - ngOnDestroy stops the tick interval
 */

import { TestBed } from '@angular/core/testing';
import { BackgroundAgentStore } from './background-agent.store';
import { BackgroundAgentId } from '@ptah-extension/chat-state';
import type {
  BackgroundAgentCompletedEvent,
  BackgroundAgentProgressEvent,
  BackgroundAgentStartedEvent,
  BackgroundAgentStoppedEvent,
} from '@ptah-extension/shared';

function startEvent(
  overrides: Partial<BackgroundAgentStartedEvent> = {},
): BackgroundAgentStartedEvent {
  return {
    toolCallId: 'tc-1',
    agentId: 'a-1',
    agentType: 'general-purpose',
    agentDescription: 'Do a thing',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    ...overrides,
  } as BackgroundAgentStartedEvent;
}

function progressEvent(
  overrides: Partial<BackgroundAgentProgressEvent> = {},
): BackgroundAgentProgressEvent {
  return {
    toolCallId: 'tc-1',
    agentId: 'a-1',
    sessionId: 'sess-1',
    summaryDelta: 'tick ',
    status: 'running',
    timestamp: Date.now(),
    ...overrides,
  } as BackgroundAgentProgressEvent;
}

function completedEvent(
  overrides: Partial<BackgroundAgentCompletedEvent> = {},
): BackgroundAgentCompletedEvent {
  return {
    toolCallId: 'tc-1',
    agentId: 'a-1',
    agentType: 'general-purpose',
    sessionId: 'sess-1',
    result: 'done',
    cost: 0.01,
    duration: 1200,
    timestamp: Date.now(),
    ...overrides,
  } as BackgroundAgentCompletedEvent;
}

function stoppedEvent(
  overrides: Partial<BackgroundAgentStoppedEvent> = {},
): BackgroundAgentStoppedEvent {
  return {
    toolCallId: 'tc-1',
    agentId: 'a-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    ...overrides,
  } as BackgroundAgentStoppedEvent;
}

describe('BackgroundAgentStore', () => {
  let store: BackgroundAgentStore;

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({ providers: [BackgroundAgentStore] });
    store = TestBed.inject(BackgroundAgentStore);
  });

  afterEach(() => {
    store.ngOnDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('onStarted', () => {
    it('inserts a running entry and starts the tick interval', () => {
      store.onStarted(startEvent());

      const agents = store.agents();
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        toolCallId: 'tc-1',
        agentId: 'a-1',
        agentType: 'general-purpose',
        status: 'running',
        summary: '',
      });
      expect(store.hasRunningAgents()).toBe(true);
      expect(store.runningCount()).toBe(1);

      // Tick signal increments after 1s.
      const before = store.tick();
      jest.advanceTimersByTime(1000);
      expect(store.tick()).toBe(before + 1);
    });

    it('uses toolCallId as agentId when agentId is empty (fallback path)', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation();
      store.onStarted(startEvent({ agentId: '', toolCallId: 'only-tc' }));
      expect(store.agents()[0].agentId).toBe('only-tc');
      // Warn fires exactly once for the missing-agentId fallback.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(
        'background_agent event missing agentId',
      );
      warn.mockRestore();
    });

    it('is idempotent when the same agentId is already running', () => {
      store.onStarted(startEvent({ agentId: 'a-A', toolCallId: 'tc-A' }));
      const firstMap = store.agents();
      // Same agentId, even with a different toolCallId, must dedup.
      store.onStarted(startEvent({ agentId: 'a-A', toolCallId: 'tc-A2' }));
      const secondMap = store.agents();
      expect(secondMap).toHaveLength(1);
      expect(secondMap[0]).toBe(firstMap[0]);
    });
  });

  describe('onProgress', () => {
    it('appends summaryDelta to the existing summary', () => {
      store.onStarted(startEvent({ agentId: 'a-X', toolCallId: 'tc-X' }));
      store.onProgress(
        progressEvent({
          agentId: 'a-X',
          toolCallId: 'tc-X',
          summaryDelta: 'hello ',
        }),
      );
      store.onProgress(
        progressEvent({
          agentId: 'a-X',
          toolCallId: 'tc-X',
          summaryDelta: 'world',
        }),
      );
      expect(store.agents()[0].summary).toBe('hello world');
    });

    it('is a no-op for an unknown agentId', () => {
      store.onProgress(
        progressEvent({ agentId: 'missing', toolCallId: 'missing' }),
      );
      expect(store.agents()).toHaveLength(0);
    });

    it('propagates error status from the event', () => {
      store.onStarted(startEvent({ agentId: 'a-E', toolCallId: 'tc-E' }));
      store.onProgress(
        progressEvent({
          agentId: 'a-E',
          toolCallId: 'tc-E',
          status: 'error',
        }),
      );
      expect(store.agents()[0].status).toBe('error');
    });
  });

  describe('onCompleted', () => {
    it('transitions running → completed and records cost/duration', () => {
      store.onStarted(startEvent({ agentId: 'a-C', toolCallId: 'tc-C' }));
      store.onCompleted(
        completedEvent({
          agentId: 'a-C',
          toolCallId: 'tc-C',
          result: 'OK',
          cost: 0.5,
          duration: 3000,
        }),
      );

      const agent = store.agents()[0];
      expect(agent.status).toBe('completed');
      expect(agent.result).toBe('OK');
      expect(agent.cost).toBe(0.5);
      expect(agent.duration).toBe(3000);
      expect(agent.completedAt).toBeDefined();
    });

    it('inserts a synthetic entry when completing an unknown agentId', () => {
      store.onCompleted(
        completedEvent({
          agentId: 'late-a',
          toolCallId: 'late',
          agentType: '',
          result: 'surprise',
        }),
      );
      const agent = store.agents()[0];
      expect(agent.toolCallId).toBe('late');
      expect(agent.agentId).toBe('late-a');
      expect(agent.status).toBe('completed');
      expect(agent.agentType).toBe('unknown');
      expect(agent.result).toBe('surprise');
    });

    it('stops the tick interval when no agents remain running', () => {
      store.onStarted(startEvent({ agentId: 'a-stop', toolCallId: 'tc-stop' }));
      // Tick is running.
      jest.advanceTimersByTime(1000);
      expect(store.tick()).toBeGreaterThan(0);

      store.onCompleted(
        completedEvent({ agentId: 'a-stop', toolCallId: 'tc-stop' }),
      );
      const tickAtCompletion = store.tick();
      jest.advanceTimersByTime(5000);
      expect(store.tick()).toBe(tickAtCompletion);
    });
  });

  describe('onStopped', () => {
    it('transitions the existing entry to stopped', () => {
      store.onStarted(startEvent({ agentId: 'a-S', toolCallId: 'tc-S' }));
      store.onStopped(stoppedEvent({ agentId: 'a-S', toolCallId: 'tc-S' }));
      expect(store.agents()[0].status).toBe('stopped');
    });

    it('inserts a synthetic entry when the agentId is unknown', () => {
      store.onStopped(
        stoppedEvent({
          agentId: 'ghost-a',
          toolCallId: 'ghost',
          agentType: '',
        }),
      );
      const agent = store.agents()[0];
      expect(agent.toolCallId).toBe('ghost');
      expect(agent.agentId).toBe('ghost-a');
      expect(agent.status).toBe('stopped');
      expect(agent.agentType).toBe('unknown');
    });
  });

  describe('lookups and filters', () => {
    it('agentsForSession filters by sessionId', () => {
      store.onStarted(
        startEvent({ agentId: 'a1', toolCallId: 't1', sessionId: 'A' }),
      );
      store.onStarted(
        startEvent({ agentId: 'a2', toolCallId: 't2', sessionId: 'B' }),
      );
      store.onStarted(
        startEvent({ agentId: 'a3', toolCallId: 't3', sessionId: 'A' }),
      );

      const a = store.agentsForSession('A').map((e) => e.toolCallId);
      expect(new Set(a)).toEqual(new Set(['t1', 't3']));
    });

    it('isBackgroundAgent returns true only for known toolCallIds', () => {
      store.onStarted(startEvent({ agentId: 'known-a', toolCallId: 'known' }));
      expect(store.isBackgroundAgent('known')).toBe(true);
      expect(store.isBackgroundAgent('missing')).toBe(false);
    });

    it('findByAgentId returns the entry when present, null otherwise', () => {
      store.onStarted(startEvent({ agentId: 'a-find', toolCallId: 'tc-find' }));
      const entry = store.findByAgentId('a-find' as BackgroundAgentId);
      expect(entry).not.toBeNull();
      expect(entry?.toolCallId).toBe('tc-find');
      expect(store.findByAgentId('nope' as BackgroundAgentId)).toBeNull();
    });

    it('sessionForAgent returns the parent ClaudeSessionId or null', () => {
      store.onStarted(
        startEvent({
          agentId: 'a-sess',
          toolCallId: 'tc-sess',
          sessionId: 'sess-XYZ',
        }),
      );
      expect(store.sessionForAgent('a-sess' as BackgroundAgentId)).toBe(
        'sess-XYZ',
      );
      expect(store.sessionForAgent('unknown' as BackgroundAgentId)).toBeNull();
    });

    it('keys by agentId — two events with the same toolCallId but different agentIds keep both entries', () => {
      // Synthetic edge case: a hypothetical SDK quirk where two background
      // agents share a parent toolCallId. Under the legacy toolCallId-keyed
      // store the second event would have clobbered the first.
      store.onStarted(
        startEvent({ agentId: 'agent-A', toolCallId: 'shared-tc' }),
      );
      store.onStarted(
        startEvent({ agentId: 'agent-B', toolCallId: 'shared-tc' }),
      );

      expect(store.totalCount()).toBe(2);
      const ids = store.agents().map((a) => a.agentId);
      expect(new Set(ids)).toEqual(new Set(['agent-A', 'agent-B']));
    });
  });

  describe('agentId fallback warning', () => {
    it('warns exactly once per offending toolCallId when SDK omits agentId', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation();

      // First fallback for tc-fb1 — warns.
      store.onStarted(startEvent({ agentId: '', toolCallId: 'tc-fb1' }));
      // Second event (progress) for the same tc-fb1 — no extra warn.
      store.onProgress(progressEvent({ agentId: '', toolCallId: 'tc-fb1' }));
      // Different toolCallId — warns again (one per id).
      store.onStarted(startEvent({ agentId: '', toolCallId: 'tc-fb2' }));

      expect(warn).toHaveBeenCalledTimes(2);
      const messages = warn.mock.calls.map((c) => c.join(' '));
      expect(messages.some((m) => m.includes('tc-fb1'))).toBe(true);
      expect(messages.some((m) => m.includes('tc-fb2'))).toBe(true);
      warn.mockRestore();
    });

    it('uses toolCallId as the storage key in the fallback path', () => {
      jest.spyOn(console, 'warn').mockImplementation();
      store.onStarted(startEvent({ agentId: '', toolCallId: 'fb-key' }));
      // The fallback agentId = the toolCallId.
      const entry = store.findByAgentId('fb-key' as BackgroundAgentId);
      expect(entry).not.toBeNull();
      expect(entry?.toolCallId).toBe('fb-key');
    });
  });

  describe('computed signals', () => {
    it('runningAgents, completedAgents, totalCount all update after transitions', () => {
      store.onStarted(startEvent({ agentId: 'a1', toolCallId: 't1' }));
      store.onStarted(startEvent({ agentId: 'a2', toolCallId: 't2' }));
      store.onCompleted(completedEvent({ agentId: 'a2', toolCallId: 't2' }));

      expect(store.totalCount()).toBe(2);
      expect(store.runningAgents().map((a) => a.toolCallId)).toEqual(['t1']);
      expect(store.completedAgents().map((a) => a.toolCallId)).toEqual(['t2']);
    });

    it('backgroundToolCallIds exposes the set of toolCallIds (not agentIds)', () => {
      store.onStarted(startEvent({ agentId: 'a-a', toolCallId: 'tc-a' }));
      store.onStarted(startEvent({ agentId: 'a-b', toolCallId: 'tc-b' }));
      const ids = store.backgroundToolCallIds();
      expect(ids.has('tc-a')).toBe(true);
      expect(ids.has('tc-b')).toBe(true);
      expect(ids.size).toBe(2);
    });

    it('hasRunningAgents reflects runningCount', () => {
      expect(store.hasRunningAgents()).toBe(false);
      store.onStarted(startEvent({ agentId: 'a1', toolCallId: 't1' }));
      expect(store.hasRunningAgents()).toBe(true);
      store.onCompleted(completedEvent({ agentId: 'a1', toolCallId: 't1' }));
      expect(store.hasRunningAgents()).toBe(false);
    });
  });

  describe('clearCompleted', () => {
    it('drops every non-running entry', () => {
      store.onStarted(startEvent({ agentId: 'a-run', toolCallId: 'run' }));
      store.onStarted(startEvent({ agentId: 'a-done', toolCallId: 'done' }));
      store.onCompleted(
        completedEvent({ agentId: 'a-done', toolCallId: 'done' }),
      );

      store.clearCompleted();
      expect(store.agents().map((a) => a.toolCallId)).toEqual(['run']);
    });
  });

  describe('eviction', () => {
    it('evicts the oldest completed entries beyond MAX_COMPLETED_AGENTS', () => {
      // Populate 51 completed entries — oldest (ts=1) must be evicted.
      for (let i = 0; i < 51; i++) {
        const tcId = `c-${i}`;
        const agId = `agent-${i}`;
        store.onStarted(
          startEvent({ agentId: agId, toolCallId: tcId, timestamp: i + 1 }),
        );
        store.onCompleted(
          completedEvent({
            agentId: agId,
            toolCallId: tcId,
            timestamp: i + 1,
          }),
        );
      }

      expect(store.totalCount()).toBe(50);
      // The earliest started (c-0, timestamp 1) should have been evicted.
      expect(store.isBackgroundAgent('c-0')).toBe(false);
      expect(store.isBackgroundAgent('c-50')).toBe(true);
    });
  });

  describe('ngOnDestroy', () => {
    it('stops the tick interval', () => {
      store.onStarted(startEvent({ agentId: 'a-live', toolCallId: 'live' }));
      jest.advanceTimersByTime(1000);
      const before = store.tick();

      store.ngOnDestroy();
      jest.advanceTimersByTime(5000);
      expect(store.tick()).toBe(before);
    });
  });
});
