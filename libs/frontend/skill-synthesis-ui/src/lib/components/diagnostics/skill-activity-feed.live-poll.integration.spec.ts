/**
 * TASK_2026_586 - live push + snapshot poll, end to end inside the webview.
 *
 * Wires the REAL `SkillSynthesisLiveService` (the `skillSynthesis:event`
 * message handler), the REAL `SkillDiagnosticsStateService` and the REAL
 * `SkillActivityFeedComponent` / `SkillEventFeedComponent`. Only the RPC edge,
 * app state and tab manager are stubbed.
 *
 * Events come from `FakeBackendRing`, which mirrors the two backend contracts
 * that matter here: ids come from a monotonic `ulid` factory seeded with the
 * event's own timestamp, and the snapshot is the newest `limit` events,
 * NEWEST FIRST. The real backend service is proven to behave this way, and to
 * put the same wire object on the push and in the snapshot, by
 * `libs/backend/rpc-handlers/.../skills-synthesis-rpc.activity-feed.integration.spec.ts`
 * (a webview lib may not import a backend lib, so the two halves share their
 * contract by construction, not by import).
 */
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { monotonicFactory } from 'ulid';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  MESSAGE_TYPES,
  type SkillDiagnosticsParams,
  type SkillDiagnosticsResult,
  type SkillSynthesisEventWire,
} from '@ptah-extension/shared';

import { SkillDiagnosticsRpcService } from '../../services/skill-diagnostics-rpc.service';
import {
  SKILL_EVENT_WINDOW,
  SkillDiagnosticsStateService,
} from '../../services/skill-diagnostics-state.service';
import { SkillSynthesisLiveService } from '../../services/skill-synthesis-live.service';
import { SkillSynthesisStateService } from '../../services/skill-synthesis-state.service';
import { SkillActivityFeedComponent } from './skill-activity-feed.component';

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const T0 = 1_700_000_000_000;

type EventInput = Omit<SkillSynthesisEventWire, 'id'>;

/** Backend ring contract: assign a monotonic ULID on record, read newest-first. */
class FakeBackendRing {
  private readonly nextId = monotonicFactory();
  private readonly ring: SkillSynthesisEventWire[] = [];

  /** Records an event and returns the wire object the live push carries. */
  public record(input: EventInput): SkillSynthesisEventWire {
    const ev: SkillSynthesisEventWire = {
      ...input,
      id: this.nextId(Math.floor(input.timestamp)),
    };
    this.ring.push(ev);
    return ev;
  }

  /** The newest `limit` events, newest first (what the snapshot RPC returns). */
  public snapshot(limit: number): SkillSynthesisEventWire[] {
    return this.ring.slice(-limit).reverse();
  }
}

function diagnosticsResult(
  recentEvents: readonly SkillSynthesisEventWire[],
): SkillDiagnosticsResult {
  return {
    lastAnalyzeRunAt: null,
    lastCuratorPassAt: null,
    totalCandidates: 0,
    totalPromoted: 0,
    totalRejected: 0,
    totalInvocations: 0,
    activeSkills: 0,
    totalMerged: 0,
    totalRetired: 0,
    totalDormant: 0,
    eligibilityHistogram: {
      prefilterTooThin: 0,
      prefilterRejected: 0,
      accepted: 0,
    },
    recentEvents,
    triggers: { idleMs: 600_000, bootScan: true },
  };
}

interface Harness {
  readonly ring: FakeBackendRing;
  readonly fixture: ComponentFixture<SkillActivityFeedComponent>;
  readonly root: HTMLElement;
  readonly state: SkillDiagnosticsStateService;
  readonly diagnostics: jest.Mock<
    Promise<SkillDiagnosticsResult>,
    [SkillDiagnosticsParams]
  >;
  /** Records on the backend AND delivers the live push to the webview. */
  readonly push: (input: EventInput) => SkillSynthesisEventWire;
  /** Delivers an already-recorded event as a live push (re-delivery, reorder). */
  readonly deliver: (ev: SkillSynthesisEventWire) => void;
  /** The 30s poll / a manual refresh: asks the backend for the snapshot. */
  readonly poll: () => Promise<void>;
}

function mount(): Harness {
  const ring = new FakeBackendRing();
  const diagnostics = jest.fn(async (params: SkillDiagnosticsParams) =>
    diagnosticsResult(ring.snapshot(params.eventLimit ?? 10)),
  );
  const skillSynthesisState = {
    refreshSuggestions: jest.fn(async () => undefined),
    refreshCandidates: jest.fn(async () => undefined),
    loadStats: jest.fn(async () => undefined),
    refreshDigest: jest.fn(async () => undefined),
  };
  TestBed.configureTestingModule({
    imports: [SkillActivityFeedComponent],
    providers: [
      {
        provide: SkillDiagnosticsRpcService,
        useValue: {
          diagnostics,
          analyzeNow: jest.fn(),
          setTriggers: jest.fn(),
          getTriggers: jest.fn(),
        },
      },
      { provide: SkillSynthesisStateService, useValue: skillSynthesisState },
      {
        provide: AppStateManager,
        useValue: {
          workspaceInfo: signal({ path: '/w', name: 'w', type: 'workspace' }),
        },
      },
      {
        provide: TabManagerService,
        useValue: { activeTab: signal({ claudeSessionId: 'sess-live' }) },
      },
    ],
  });
  const fixture = TestBed.createComponent(SkillActivityFeedComponent);
  fixture.detectChanges();
  const live = TestBed.inject(SkillSynthesisLiveService);
  const state = TestBed.inject(SkillDiagnosticsStateService);

  const deliver = (ev: SkillSynthesisEventWire): void => {
    live.handleMessage({
      type: MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT,
      payload: { event: ev },
    });
    fixture.detectChanges();
  };
  return {
    ring,
    fixture,
    root: fixture.nativeElement as HTMLElement,
    state,
    diagnostics,
    deliver,
    push: (input) => {
      const ev = ring.record(input);
      deliver(ev);
      return ev;
    },
    poll: async () => {
      await state.refresh();
      fixture.detectChanges();
    },
  };
}

/** Lets the on-mount refresh settle. */
async function settle(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  h.fixture.detectChanges();
}

function rowIds(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      '[data-test="panel-events"] li[data-event-id]',
    ),
  ).map((li) => li.dataset['eventId'] ?? '');
}

function rowCounts(root: HTMLElement): Array<string | null> {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      '[data-test="panel-events"] li[data-event-id]',
    ),
  ).map(
    (li) =>
      li
        .querySelector('[data-test="event-count"] [aria-hidden="true"]')
        ?.textContent?.trim() ?? null,
  );
}

function stateIds(state: SkillDiagnosticsStateService): string[] {
  return state.recentEvents().map((e) => e.id);
}

describe('Activity feed: live push then snapshot poll (real live service + state + feed)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('mount refresh asks the backend for the shared window and renders it newest first', async () => {
    const h = mount();
    const a = h.ring.record({
      kind: 'analyze-run',
      timestamp: T0,
      sessionId: 's-a',
    });
    const b = h.ring.record({
      kind: 'ineligible',
      timestamp: T0 + 1000,
      sessionId: 's-b',
    });
    await h.poll();
    await settle(h);

    expect(h.diagnostics).toHaveBeenCalledWith({
      workspaceRoot: '/w',
      eventLimit: SKILL_EVENT_WINDOW,
    });
    expect(rowIds(h.root)).toEqual([b.id, a.id]);
    for (const id of rowIds(h.root)) expect(id).toMatch(ULID_SHAPE);
  });

  it('a live event followed by the poll that contains it yields one row per id, newest first', async () => {
    const h = mount();
    await settle(h);

    const e1 = h.push({
      kind: 'analyze-run',
      timestamp: T0,
      sessionId: 's-1',
    });
    const e2 = h.push({
      kind: 'ineligible',
      timestamp: T0 + 1000,
      sessionId: 's-2',
      stats: { reason: 'prefilterTooThin' },
    });
    const liveOrder = rowIds(h.root);
    expect(liveOrder).toEqual([e2.id, e1.id]);
    const histogramAfterLive = h.state.eligibilityHistogram();
    expect(histogramAfterLive.prefilterTooThin).toBe(1);

    // The poll returns the same two events plus a third one that was never
    // pushed live (for example a push missed while the webview was hidden).
    const e3 = h.ring.record({
      kind: 'error',
      timestamp: T0 + 2000,
      sessionId: 's-3',
      error: 'boom',
    });
    await h.poll();

    expect(rowIds(h.root)).toEqual([e3.id, e2.id, e1.id]);
    expect(new Set(rowIds(h.root)).size).toBe(3);
    expect(stateIds(h.state)).toEqual([e3.id, e2.id, e1.id]);
  });

  it('a snapshot followed by the live push of an event it already holds adds nothing', async () => {
    const h = mount();
    await settle(h);

    const e1 = h.ring.record({
      kind: 'ineligible',
      timestamp: T0,
      sessionId: 's-1',
      stats: { reason: 'prefilterRejected' },
    });
    await h.poll();
    expect(rowIds(h.root)).toEqual([e1.id]);
    const histogram = h.state.eligibilityHistogram();

    // The broadcast of the same event lands after the snapshot already had it.
    h.deliver(e1);

    expect(rowIds(h.root)).toEqual([e1.id]);
    expect(h.state.eligibilityHistogram()).toEqual(histogram);
  });

  it('delivering the same push twice, and polling twice, never duplicates a row', async () => {
    const h = mount();
    await settle(h);
    const e1 = h.push({
      kind: 'analyze-run',
      timestamp: T0,
      sessionId: 's-1',
    });
    h.deliver(e1);
    h.deliver(e1);
    await h.poll();
    await h.poll();

    expect(rowIds(h.root)).toEqual([e1.id]);
    expect(stateIds(h.state)).toEqual([e1.id]);
  });

  it('live-only, snapshot-only and shuffled-live delivery of the same events converge on one order', async () => {
    // Recording order: e1, e2 (same ms as e1, other session), e3 (newest),
    // e4 (recorded last but stamped older than e1).
    const events: EventInput[] = [
      { kind: 'ineligible', timestamp: T0, sessionId: 's-a' },
      { kind: 'ineligible', timestamp: T0, sessionId: 's-b' },
      { kind: 'analyze-run', timestamp: T0 + 1000, sessionId: 's-a' },
      { kind: 'error', timestamp: T0 - 5000, error: 'late' },
    ];

    const liveOnly = mount();
    await settle(liveOnly);
    const recorded = events.map((input) => liveOnly.push(input));
    const liveIds = stateIds(liveOnly.state);
    TestBed.resetTestingModule();

    const snapshotOnly = mount();
    await settle(snapshotOnly);
    const sameEvents = events.map((input) => snapshotOnly.ring.record(input));
    await snapshotOnly.poll();
    const snapshotIds = stateIds(snapshotOnly.state);
    TestBed.resetTestingModule();

    const shuffled = mount();
    await settle(shuffled);
    const shuffledEvents = events.map((input) => shuffled.ring.record(input));
    for (const index of [3, 1, 2, 0]) shuffled.deliver(shuffledEvents[index]);
    const shuffledIds = stateIds(shuffled.state);

    const [e1, e2, e3, e4] = recorded.map((e) => e.id);
    // timestamp desc, then id desc within one millisecond.
    expect(liveIds).toEqual([e3, e2, e1, e4]);
    // Ids differ between runs (random ULID tail), so compare by position.
    const positions = (ids: string[], all: SkillSynthesisEventWire[]) =>
      ids.map((id) => all.findIndex((e) => e.id === id));
    expect(positions(snapshotIds, sameEvents)).toEqual([2, 1, 0, 3]);
    expect(positions(shuffledIds, shuffledEvents)).toEqual([2, 1, 0, 3]);
  });

  it('one analyze-run per drain tick for the same session stays ONE row whose count grows', async () => {
    const h = mount();
    await settle(h);

    const first = h.push({
      kind: 'analyze-run',
      timestamp: T0,
      sessionId: 's-1',
    });
    expect(rowIds(h.root)).toEqual([first.id]);
    expect(rowCounts(h.root)).toEqual([null]);

    let newest = first;
    for (let tick = 1; tick <= 5; tick++) {
      newest = h.push({
        kind: 'analyze-run',
        timestamp: T0 + tick * 900_000,
        sessionId: 's-1',
      });
      // Still a single row; it is tracked by the newest event's id.
      expect(rowIds(h.root)).toEqual([newest.id]);
      expect(rowCounts(h.root)).toEqual([`x${tick + 1}`]);
    }

    // A poll over the same history renders the identical single row.
    await h.poll();
    expect(rowIds(h.root)).toEqual([newest.id]);
    expect(rowCounts(h.root)).toEqual(['x6']);

    // A different session breaks the run; the old run keeps its count below.
    const other = h.push({
      kind: 'analyze-run',
      timestamp: T0 + 6 * 900_000,
      sessionId: 's-2',
    });
    expect(rowIds(h.root)).toEqual([other.id, newest.id]);
    expect(rowCounts(h.root)).toEqual([null, 'x6']);
  });

  it('two same-kind events in the same millisecond render as two rows and trigger no duplicate-key warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* captured */
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {
      /* captured */
    });
    const h = mount();
    await settle(h);

    const a = h.push({
      kind: 'ineligible',
      timestamp: T0,
      sessionId: 's-a',
    });
    const b = h.push({
      kind: 'ineligible',
      timestamp: T0,
      sessionId: 's-b',
    });
    await h.poll();

    expect(a.timestamp).toBe(b.timestamp);
    expect(a.kind).toBe(b.kind);
    expect(a.id).not.toBe(b.id);
    expect(rowIds(h.root)).toEqual([b.id, a.id]);
    const messages = [...warn.mock.calls, ...error.mock.calls].map((call) =>
      call.map(String).join(' '),
    );
    expect(messages.filter((m) => m.includes('NG0955'))).toEqual([]);
  });

  it('more events than the window keeps only the newest window, in step on both paths', async () => {
    const h = mount();
    await settle(h);
    const recorded: SkillSynthesisEventWire[] = [];
    for (let i = 0; i < SKILL_EVENT_WINDOW + 5; i++) {
      recorded.push(
        h.push({
          kind: 'analyze-run',
          timestamp: T0 + i * 1000,
          sessionId: `s-${i}`,
        }),
      );
    }
    const expected = recorded
      .slice(-SKILL_EVENT_WINDOW)
      .map((e) => e.id)
      .reverse();
    expect(stateIds(h.state)).toEqual(expected);

    await h.poll();
    expect(stateIds(h.state)).toEqual(expected);
  });
});
