/**
 * AgentMonitorStore — per-agent retention bounds and ordering invariant.
 *
 * `stdout`/`stderr` have always been capped; `streamEvents` and `segments` were
 * not, and they are the two that grow per token on the ptah-cli / SDK adapter
 * paths (TASK_2026_323 / R6). This spec pins:
 *   - the stream-event cap, its slack, and that landmark events survive it;
 *   - the segment cap;
 *   - that the array identity of `streamEvents` is preserved (the card's change
 *     signal is `streamRevision`, not the reference);
 *   - that `agents()` is still newest-first now that the sort moved to
 *     insertion time.
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { AgentMonitorStore } from './agent-monitor.store';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { createMockRpcService } from '@ptah-extension/core/testing';
import type {
  AgentOutputDelta,
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';

const MAX_AGENT_STREAM_EVENTS = 2000;
const AGENT_STREAM_EVENTS_CAP_SLACK = 200;
const MAX_AGENT_SEGMENTS = 500;

const mockActiveTab = signal<{ claudeSessionId?: string } | null>(null);
const mockTabManager = {
  activeTab: mockActiveTab,
  activeTabSessionId: computed(() => mockActiveTab()?.claudeSessionId ?? null),
  tabs: signal([]),
};
const mockVSCodeService = {
  config: signal({ panelId: '' }),
  postMessage: jest.fn(),
};

function streamEvent(index: number, eventType: string): FlatStreamEventUnion {
  return {
    id: `evt-${index}`,
    eventType,
    timestamp: index,
    sessionId: undefined,
  } as unknown as FlatStreamEventUnion;
}

function textSegment(index: number): CliOutputSegment {
  return { type: 'tool', content: `segment-${index}` } as CliOutputSegment;
}

describe('AgentMonitorStore — retention bounds', () => {
  let store: AgentMonitorStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AgentMonitorStore,
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: VSCodeService, useValue: mockVSCodeService },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
      ],
    });
    store = TestBed.inject(AgentMonitorStore);
    mockActiveTab.set(null);
  });

  afterEach(() => TestBed.resetTestingModule());

  function spawn(agentId: string, startedAt = Date.now()): void {
    store.onAgentSpawned({
      agentId,
      cli: 'ptah-cli',
      task: `task ${agentId}`,
      status: 'running',
      startedAt: new Date(startedAt).toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  function pushEvents(agentId: string, events: FlatStreamEventUnion[]): void {
    store.onAgentOutput({ agentId, streamEvents: events } as AgentOutputDelta);
  }

  function agentOf(agentId: string) {
    const agent = store.agents().find((a) => a.agentId === agentId);
    if (!agent) throw new Error(`missing agent ${agentId}`);
    return agent;
  }

  it('caps streamEvents once the cap plus its slack is passed', () => {
    spawn('a1');
    const total = MAX_AGENT_STREAM_EVENTS + AGENT_STREAM_EVENTS_CAP_SLACK + 50;
    for (let i = 0; i < total; i++) {
      pushEvents('a1', [streamEvent(i, 'text_delta')]);
    }

    expect(agentOf('a1').streamEvents.length).toBeLessThanOrEqual(
      MAX_AGENT_STREAM_EVENTS,
    );
  });

  it('tolerates the slack before re-capping, so no event pays a rebuild', () => {
    spawn('a2');
    for (let i = 0; i < MAX_AGENT_STREAM_EVENTS + 10; i++) {
      pushEvents('a2', [streamEvent(i, 'text_delta')]);
    }

    // Past the cap but inside the slack — untouched.
    expect(agentOf('a2').streamEvents.length).toBe(
      MAX_AGENT_STREAM_EVENTS + 10,
    );
  });

  it('keeps the newest events and the landmark events that give them structure', () => {
    spawn('a3');
    const total = MAX_AGENT_STREAM_EVENTS + AGENT_STREAM_EVENTS_CAP_SLACK + 1;
    for (let i = 0; i < total; i++) {
      // Every 100th event is a landmark; everything else is a plain delta.
      pushEvents('a3', [
        streamEvent(i, i % 100 === 0 ? 'tool_start' : 'text_delta'),
      ]);
    }

    const kept = agentOf('a3').streamEvents;
    // The tail is intact and in order.
    expect(kept[kept.length - 1].id).toBe(`evt-${total - 1}`);
    // Landmarks from before the tail survived the trim.
    const landmarks = kept.filter((e) => e.eventType === 'tool_start');
    expect(landmarks.length).toBeGreaterThan(0);
    // Order is preserved (ids are monotonic by construction).
    const timestamps = kept.map((e) => e.timestamp);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });

  it('trims in place — the array reference is the shared one, streamRevision is the signal', () => {
    spawn('a4');
    pushEvents('a4', [streamEvent(0, 'text_delta')]);
    const firstRef = agentOf('a4').streamEvents;
    const firstRevision = agentOf('a4').streamRevision;

    const total = MAX_AGENT_STREAM_EVENTS + AGENT_STREAM_EVENTS_CAP_SLACK + 50;
    for (let i = 1; i < total; i++) {
      pushEvents('a4', [streamEvent(i, 'text_delta')]);
    }

    expect(agentOf('a4').streamEvents).toBe(firstRef);
    expect(agentOf('a4').streamRevision).toBeGreaterThan(firstRevision);
  });

  it('caps segments', () => {
    spawn('a5');
    for (let i = 0; i < MAX_AGENT_SEGMENTS + 120; i++) {
      store.onAgentOutput({
        agentId: 'a5',
        segments: [textSegment(i)],
      } as AgentOutputDelta);
    }

    const segments = agentOf('a5').segments;
    expect(segments.length).toBe(MAX_AGENT_SEGMENTS);
    // The most recent segments are the ones kept.
    expect(segments[segments.length - 1].content).toBe(
      `segment-${MAX_AGENT_SEGMENTS + 119}`,
    );
  });

  it('only the emitting agent object is replaced by a delta', () => {
    spawn('a6', 1000);
    spawn('a7', 2000);
    const before = store.agents();
    const untouched = before.find((a) => a.agentId === 'a6');

    pushEvents('a7', [streamEvent(0, 'text_delta')]);

    expect(store.agents().find((a) => a.agentId === 'a6')).toBe(untouched);
  });

  it('agents() stays newest-first without sorting on every delta', () => {
    spawn('old', 1000);
    spawn('new', 3000);
    spawn('middle', 2000);

    expect(store.agents().map((a) => a.agentId)).toEqual([
      'new',
      'middle',
      'old',
    ]);

    pushEvents('old', [streamEvent(0, 'text_delta')]);
    expect(store.agents().map((a) => a.agentId)).toEqual([
      'new',
      'middle',
      'old',
    ]);
  });

  it('agents spawned in the same millisecond keep insertion order', () => {
    spawn('first', 5000);
    spawn('second', 5000);

    expect(store.agents().map((a) => a.agentId)).toEqual(['first', 'second']);
  });
});
