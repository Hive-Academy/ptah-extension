/**
 * BackgroundAgentStore specs — signal store for background (run_in_background)
 * agents spawned via the Task tool.
 *
 * Coverage:
 *   - onStarted: inserts a running entry and starts the 1s tick interval
 *   - onStarted is idempotent when already running
 *   - onProgress: appends summary and respects error status
 *   - onCompleted: updates status + cost + duration + triggers tick stop
 *   - onCompleted for an unknown toolCallId inserts a synthetic entry
 *   - onStopped: marks the entry stopped (with fallback insertion)
 *   - agentsForSession filters by sessionId
 *   - isBackgroundAgent lookup
 *   - clearCompleted drops non-running entries
 *   - Computed signals: runningAgents, completedAgents, runningCount,
 *     totalCount, hasRunningAgents, backgroundToolCallIds
 *   - MAX_COMPLETED_AGENTS eviction: oldest completed evicted first
 *   - ngOnDestroy stops the tick interval
 */

import { TestBed } from '@angular/core/testing';
import { BackgroundAgentStore } from './background-agent.store';
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

    it('uses toolCallId as agentId when agentId is empty', () => {
      store.onStarted(startEvent({ agentId: '', toolCallId: 'only-tc' }));
      expect(store.agents()[0].agentId).toBe('only-tc');
    });

    it('is idempotent when the same toolCallId is already running', () => {
      store.onStarted(startEvent({ toolCallId: 'tc-A' }));
      const firstMap = store.agents();
      store.onStarted(startEvent({ toolCallId: 'tc-A' }));
      const secondMap = store.agents();
      expect(secondMap[0]).toBe(firstMap[0]);
    });
  });

  describe('onProgress', () => {
    it('appends summaryDelta to the existing summary', () => {
      store.onStarted(startEvent({ toolCallId: 'tc-X' }));
      store.onProgress(
        progressEvent({ toolCallId: 'tc-X', summaryDelta: 'hello ' }),
      );
      store.onProgress(
        progressEvent({ toolCallId: 'tc-X', summaryDelta: 'world' }),
      );
      expect(store.agents()[0].summary).toBe('hello world');
    });

    it('is a no-op for an unknown toolCallId', () => {
      store.onProgress(progressEvent({ toolCallId: 'missing' }));
      expect(store.agents()).toHaveLength(0);
    });

    it('propagates error status from the event', () => {
      store.onStarted(startEvent({ toolCallId: 'tc-E' }));
      store.onProgress(progressEvent({ toolCallId: 'tc-E', status: 'error' }));
      expect(store.agents()[0].status).toBe('error');
    });
  });

  describe('onCompleted', () => {
    it('transitions running → completed and records cost/duration', () => {
      store.onStarted(startEvent({ toolCallId: 'tc-C' }));
      store.onCompleted(
        completedEvent({
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

    it('inserts a synthetic entry when completing an unknown toolCallId', () => {
      store.onCompleted(
        completedEvent({
          toolCallId: 'late',
          agentType: '',
          result: 'surprise',
        }),
      );
      const agent = store.agents()[0];
      expect(agent.toolCallId).toBe('late');
      expect(agent.status).toBe('completed');
      expect(agent.agentType).toBe('unknown');
      expect(agent.result).toBe('surprise');
    });

    it('stops the tick interval when no agents remain running', () => {
      store.onStarted(startEvent({ toolCallId: 'tc-stop' }));
      // Tick is running.
      jest.advanceTimersByTime(1000);
      expect(store.tick()).toBeGreaterThan(0);

      store.onCompleted(completedEvent({ toolCallId: 'tc-stop' }));
      const tickAtCompletion = store.tick();
      jest.advanceTimersByTime(5000);
      expect(store.tick()).toBe(tickAtCompletion);
    });
  });

  describe('onStopped', () => {
    it('transitions the existing entry to stopped', () => {
      store.onStarted(startEvent({ toolCallId: 'tc-S' }));
      store.onStopped(stoppedEvent({ toolCallId: 'tc-S' }));
      expect(store.agents()[0].status).toBe('stopped');
    });

    it('inserts a synthetic entry when the id is unknown', () => {
      store.onStopped(stoppedEvent({ toolCallId: 'ghost', agentType: '' }));
      const agent = store.agents()[0];
      expect(agent.toolCallId).toBe('ghost');
      expect(agent.status).toBe('stopped');
      expect(agent.agentType).toBe('unknown');
    });
  });

  describe('lookups and filters', () => {
    it('agentsForSession filters by sessionId', () => {
      store.onStarted(startEvent({ toolCallId: 't1', sessionId: 'A' }));
      store.onStarted(startEvent({ toolCallId: 't2', sessionId: 'B' }));
      store.onStarted(startEvent({ toolCallId: 't3', sessionId: 'A' }));

      const a = store.agentsForSession('A').map((e) => e.toolCallId);
      expect(new Set(a)).toEqual(new Set(['t1', 't3']));
    });

    it('isBackgroundAgent returns true only for known toolCallIds', () => {
      store.onStarted(startEvent({ toolCallId: 'known' }));
      expect(store.isBackgroundAgent('known')).toBe(true);
      expect(store.isBackgroundAgent('missing')).toBe(false);
    });
  });

  describe('computed signals', () => {
    it('runningAgents, completedAgents, totalCount all update after transitions', () => {
      store.onStarted(startEvent({ toolCallId: 't1' }));
      store.onStarted(startEvent({ toolCallId: 't2' }));
      store.onCompleted(completedEvent({ toolCallId: 't2' }));

      expect(store.totalCount()).toBe(2);
      expect(store.runningAgents().map((a) => a.toolCallId)).toEqual(['t1']);
      expect(store.completedAgents().map((a) => a.toolCallId)).toEqual(['t2']);
    });

    it('backgroundToolCallIds exposes the set of toolCallIds', () => {
      store.onStarted(startEvent({ toolCallId: 'a' }));
      store.onStarted(startEvent({ toolCallId: 'b' }));
      const ids = store.backgroundToolCallIds();
      expect(ids.has('a')).toBe(true);
      expect(ids.has('b')).toBe(true);
      expect(ids.size).toBe(2);
    });

    it('hasRunningAgents reflects runningCount', () => {
      expect(store.hasRunningAgents()).toBe(false);
      store.onStarted(startEvent({ toolCallId: 't1' }));
      expect(store.hasRunningAgents()).toBe(true);
      store.onCompleted(completedEvent({ toolCallId: 't1' }));
      expect(store.hasRunningAgents()).toBe(false);
    });
  });

  describe('clearCompleted', () => {
    it('drops every non-running entry', () => {
      store.onStarted(startEvent({ toolCallId: 'run' }));
      store.onStarted(startEvent({ toolCallId: 'done' }));
      store.onCompleted(completedEvent({ toolCallId: 'done' }));

      store.clearCompleted();
      expect(store.agents().map((a) => a.toolCallId)).toEqual(['run']);
    });
  });

  describe('eviction', () => {
    it('evicts the oldest completed entries beyond MAX_COMPLETED_AGENTS', () => {
      // Populate 51 completed entries — oldest (ts=1) must be evicted.
      for (let i = 0; i < 51; i++) {
        const id = `c-${i}`;
        store.onStarted(startEvent({ toolCallId: id, timestamp: i + 1 }));
        store.onCompleted(
          completedEvent({
            toolCallId: id,
            agentId: id,
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
      store.onStarted(startEvent({ toolCallId: 'live' }));
      jest.advanceTimersByTime(1000);
      const before = store.tick();

      store.ngOnDestroy();
      jest.advanceTimersByTime(5000);
      expect(store.tick()).toBe(before);
    });
  });
});
