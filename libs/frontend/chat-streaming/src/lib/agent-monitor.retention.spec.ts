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
const AGENT_SEGMENTS_CAP_SLACK = 100;

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

/** Matches the marker `capSegments` puts at the head of a trimmed card. */
const SEGMENT_MARKER =
  /^… (\d+) earlier output segments were trimmed to bound this card \((\d+) preserved below, (\d+) dropped\)\.$/;

/** Matches the notice `capBuffer` puts at the head of a trimmed byte buffer. */
const BUFFER_NOTICE =
  /^… (\d+) characters of earlier output were dropped to bound this card\.$/;

function markerOf(segments: readonly CliOutputSegment[]): RegExpExecArray {
  const markers = segments.filter((s) => SEGMENT_MARKER.test(s.content));
  expect(markers).toHaveLength(1);
  expect(segments[0]).toBe(markers[0]);
  return SEGMENT_MARKER.exec(markers[0].content) as RegExpExecArray;
}

/** Everything a reader of the card would actually see as prose. */
function proseOf(segments: readonly CliOutputSegment[]): string {
  return segments
    .filter((s) => s.type === 'text' || s.type === 'thinking')
    .map((s) => s.content)
    .join('');
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

  it('tolerates the segment slack before re-trimming', () => {
    spawn('a5-slack');
    const total = MAX_AGENT_SEGMENTS + AGENT_SEGMENTS_CAP_SLACK;
    for (let i = 0; i < total; i++) {
      store.onAgentOutput({
        agentId: 'a5-slack',
        segments: [textSegment(i)],
      } as AgentOutputDelta);
    }

    // Past the cap but inside the slack — untouched, so no delta pays for a
    // rebuild. The predecessor `slice(-500)` re-copied on every delta here.
    expect(agentOf('a5-slack').segments.length).toBe(total);
  });

  it('caps segments', () => {
    spawn('a5');
    for (
      let i = 0;
      i < MAX_AGENT_SEGMENTS + AGENT_SEGMENTS_CAP_SLACK + 120;
      i++
    ) {
      store.onAgentOutput({
        agentId: 'a5',
        segments: [textSegment(i)],
      } as AgentOutputDelta);
    }

    const segments = agentOf('a5').segments;
    expect(segments.length).toBeLessThanOrEqual(
      MAX_AGENT_SEGMENTS + AGENT_SEGMENTS_CAP_SLACK,
    );
    expect(segments.length).toBeLessThan(
      MAX_AGENT_SEGMENTS + AGENT_SEGMENTS_CAP_SLACK + 120,
    );
    // The most recent segments are the ones kept.
    expect(segments[segments.length - 1].content).toBe(
      `segment-${MAX_AGENT_SEGMENTS + AGENT_SEGMENTS_CAP_SLACK + 119}`,
    );
  });

  // ==========================================================================
  // The segment cap, from the reader's side (TASK_2026_335 / defect 1)
  //
  // These push ALTERNATING types on purpose: `onAgentOutput` merges a run of
  // same-typed `text`/`thinking` segments into one, so a stream of nothing but
  // text never reaches the cap at all. Interleaved prose and tool calls — a
  // real Codex or Copilot run — is what does.
  // ==========================================================================

  function pushInterleaved(agentId: string, pairs: number): void {
    for (let i = 0; i < pairs; i++) {
      store.onAgentOutput({
        agentId,
        segments: [{ type: 'text', content: `chunk-${i} ` }],
      } as AgentOutputDelta);
      store.onAgentOutput({
        agentId,
        segments: [
          { type: 'tool-call', content: '', toolName: `tool-${i}` },
        ] as CliOutputSegment[],
      } as AgentOutputDelta);
    }
  }

  it("folds the prose it drops — the agent's opening plan is still readable", () => {
    spawn('fold');
    pushInterleaved('fold', 400); // 800 segments, well past the 500 cap

    const segments = agentOf('fold').segments;
    const prose = proseOf(segments);

    // The earliest reasoning is the whole point: a bare slice(-500) deleted it
    // and nothing on the card said so.
    expect(prose).toContain('chunk-0 ');
    expect(prose).toContain('chunk-1 ');
    // ...and the most recent prose is still there, in order, after it.
    expect(prose).toContain('chunk-399 ');
    expect(prose.indexOf('chunk-0 ')).toBeLessThan(prose.indexOf('chunk-399 '));
  });

  it('states at the head of the card that a trim happened, and what it cost', () => {
    spawn('marked');
    pushInterleaved('marked', 400);

    const segments = agentOf('marked').segments;
    const [, trimmed, preserved, dropped] = markerOf(segments).map(Number);

    expect(trimmed).toBeGreaterThan(0);
    expect(preserved + dropped).toBe(trimmed);
    // Prose was foldable, so some of the trim is preserved rather than lost.
    expect(preserved).toBeGreaterThan(0);
  });

  it('marks the trim even when nothing at all can be folded', () => {
    spawn('unfoldable');
    for (
      let i = 0;
      i < MAX_AGENT_SEGMENTS + AGENT_SEGMENTS_CAP_SLACK + 120;
      i++
    ) {
      // `tool` is not a foldable prose type and carries no structure the
      // builder can re-attach content to — there is nothing to fold.
      store.onAgentOutput({
        agentId: 'unfoldable',
        segments: [textSegment(i)],
      } as AgentOutputDelta);
    }

    const segments = agentOf('unfoldable').segments;
    const [, trimmed, preserved, dropped] = markerOf(segments).map(Number);

    expect(preserved).toBe(0);
    expect(dropped).toBe(trimmed);
    expect(trimmed).toBeGreaterThan(0);
  });

  it('a second trim rolls into the first marker instead of stacking a new one', () => {
    spawn('twice');
    pushInterleaved('twice', 400);
    const first = Number(markerOf(agentOf('twice').segments)[1]);

    pushInterleaved('twice', 400);
    const segments = agentOf('twice').segments;
    const [, trimmed] = markerOf(segments).map(Number);

    // markerOf already asserts there is exactly ONE marker and that it leads
    // the card — an `info` marker is a landmark, so a naive re-cap would keep
    // the old one and stack a new one on top of it on every trim.
    expect(trimmed).toBeGreaterThan(first);
    expect(segments.length).toBeLessThanOrEqual(
      MAX_AGENT_SEGMENTS + AGENT_SEGMENTS_CAP_SLACK,
    );
  });

  // ==========================================================================
  // The stdout/stderr byte cap (TASK_2026_335 / defect 3)
  // ==========================================================================

  it('says at the head of the buffer how much earlier stdout was dropped', () => {
    spawn('buffered');
    const chunk = `${'x'.repeat(999)}\n`;
    for (let i = 0; i < 80; i++) {
      store.onAgentOutput({
        agentId: 'buffered',
        stdoutDelta: chunk,
      } as AgentOutputDelta);
    }

    const stdout = agentOf('buffered').stdout;
    const firstLine = stdout.slice(0, stdout.indexOf('\n'));
    const match = BUFFER_NOTICE.exec(firstLine);

    expect(match).not.toBeNull();
    expect(Number((match as RegExpExecArray)[1])).toBeGreaterThan(0);
  });

  it('keeps the dropped-character count cumulative across repeated trims', () => {
    spawn('cumulative');
    const chunk = `${'x'.repeat(999)}\n`;
    const readCount = (): number =>
      Number(
        (
          BUFFER_NOTICE.exec(
            agentOf('cumulative').stdout.split('\n')[0],
          ) as RegExpExecArray
        )[1],
      );

    for (let i = 0; i < 80; i++) {
      store.onAgentOutput({
        agentId: 'cumulative',
        stdoutDelta: chunk,
      } as AgentOutputDelta);
    }
    const afterFirst = readCount();

    for (let i = 0; i < 40; i++) {
      store.onAgentOutput({
        agentId: 'cumulative',
        stdoutDelta: chunk,
      } as AgentOutputDelta);
    }

    // The notice reports the agent's total loss, not the size of the most
    // recent trim — and it is never itself eaten by a later trim.
    expect(readCount()).toBeGreaterThan(afterFirst);
    expect(agentOf('cumulative').stdout.length).toBeLessThanOrEqual(
      50 * 1024 + 200,
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
