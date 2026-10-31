import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { sessionContextCue, type LiveModelStats } from '@ptah-extension/chat-ui';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { ModelStateService, PlanLimitsStore } from '@ptah-extension/core';
import { SessionId, type ChatSessionSummary } from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import { RecentSessionsStore } from '../session-list/recent-sessions.store';
import { ChatVitalsStore } from './chat-vitals.store';
import {
  fact,
  fakePlanLimits,
  fakeUsageCache,
  owner,
  planSnapshot,
  summary,
  type FakePlanLimits,
  type FakeUsageCache,
} from './testing/vitals-fixtures';
import { SPEND_DAY_COUNT } from './usage-vitals.model';
import { UsageVitalsCache } from './usage-vitals.cache';
import { VITALS_EMPTY, VITALS_LOADING, vitalsReady } from './vitals-load';

function session(name: string, lastActivityAt: number): ChatSessionSummary {
  return {
    id: SessionId.create(),
    name,
    createdAt: 1,
    lastActivityAt,
    messageCount: 1,
    isActive: false,
  };
}

describe('ChatVitalsStore', () => {
  let usage: FakeUsageCache;
  let plan: FakePlanLimits;
  let path: WritableSignal<string | null>;
  let sessionId: WritableSignal<string | null>;
  let tab: WritableSignal<TabState | null>;
  let modelDisplay: WritableSignal<string>;
  let recent: {
    confirmed: WritableSignal<boolean>;
    workspacePath: WritableSignal<string | null>;
    sessions: WritableSignal<readonly ChatSessionSummary[]>;
    loading: WritableSignal<boolean>;
    load: jest.Mock;
  };

  function create(): ChatVitalsStore {
    TestBed.configureTestingModule({
      providers: [
        ChatVitalsStore,
        { provide: UsageVitalsCache, useValue: usage },
        { provide: PlanLimitsStore, useValue: plan },
        {
          provide: ModelStateService,
          useValue: { currentModelDisplay: modelDisplay },
        },
        { provide: RecentSessionsStore, useValue: recent },
        {
          provide: ChatStore,
          useValue: {
            sessionStats: signal(null),
            liveModelStats: signal(null),
            compactionCount: signal(0),
          },
        },
        {
          provide: AgentMonitorStore,
          useValue: { agentsOwnedBySession: () => [] },
        },
      ],
    });
    const store = TestBed.inject(ChatVitalsStore);
    store.bind({
      tab: () => tab(),
      sessionId: () => sessionId(),
      workspacePath: () => path(),
    });
    TestBed.flushEffects();
    return store;
  }

  beforeEach(() => {
    usage = fakeUsageCache();
    plan = fakePlanLimits();
    path = signal<string | null>('/work/ptah');
    sessionId = signal<string | null>(null);
    tab = signal<TabState | null>(null);
    modelDisplay = signal('');
    recent = {
      confirmed: signal(false),
      workspacePath: signal<string | null>(null),
      sessions: signal<readonly ChatSessionSummary[]>([]),
      loading: signal(false),
      load: jest.fn(async () => undefined),
    };
  });

  afterEach(() => TestBed.resetTestingModule());

  it('reads the workspace spend and rereads recent sessions per workspace', () => {
    create();
    expect(usage.summary).toHaveBeenCalledWith('/work/ptah', 7);
    expect(recent.load).toHaveBeenCalledWith('/work/ptah');

    path.set('/work/other');
    TestBed.flushEffects();
    expect(usage.summary).toHaveBeenLastCalledWith('/work/other', 7);
    expect(recent.load).toHaveBeenLastCalledWith('/work/other');
  });

  it('reuses a recent-sessions read another surface holds for this workspace', () => {
    recent.workspacePath.set('/work/ptah');
    recent.loading.set(true);
    create();
    expect(recent.load).not.toHaveBeenCalled();

    recent.workspacePath.set('/work/other');
    recent.loading.set(false);
    recent.confirmed.set(true);
    path.set('/work/other');
    TestBed.flushEffects();
    expect(recent.load).not.toHaveBeenCalled();
  });

  it('re-reads the workspace spend on each clock tick, so a failure is retried', () => {
    create();
    const reads = usage.summary.mock.calls.length;
    plan.now.set(plan.now() + 30_000);
    TestBed.flushEffects();
    expect(usage.summary.mock.calls.length).toBe(reads + 1);
    expect(usage.summary).toHaveBeenLastCalledWith('/work/ptah', 7);
  });

  it('throws on a second bind', () => {
    const store = create();
    expect(() =>
      store.bind({
        tab: () => null,
        sessionId: () => null,
        workspacePath: () => '/x',
      }),
    ).toThrow(/called twice/);
  });

  it('never reads the all-workspaces summary without a workspace', () => {
    path.set(null);
    const store = create();
    expect(usage.summary).not.toHaveBeenCalled();
    expect(recent.load).not.toHaveBeenCalled();
    expect(store.spend7()).toEqual(VITALS_LOADING);
  });

  it('maps the 7-day spend over one window', () => {
    const store = create();
    usage.entry('/work/ptah', 7).set(vitalsReady(summary([])));
    expect(store.spend7()).toEqual(VITALS_EMPTY);
    usage
      .entry('/work/ptah', 7)
      .set(vitalsReady(summary([fact(new Date().toISOString().slice(0, 10))])));
    const spend = store.spend7();
    expect(spend.status).toBe('ready');
    if (spend.status !== 'ready') return;
    expect(spend.value.days).toHaveLength(SPEND_DAY_COUNT);
    expect(spend.value.totals).toEqual({ tokens: 100, costUsd: 1.5 });
  });

  it('offers the newest recent session of this workspace that is not the current one', () => {
    const store = create();
    const newest = session('newest', 9);
    const older = session('older', 3);
    recent.sessions.set([newest, older]);
    recent.workspacePath.set('/work/ptah');
    expect(store.resume()).toBeNull();

    recent.confirmed.set(true);
    expect(store.resume()).toBe(newest);
    sessionId.set(newest.id);
    expect(store.resume()).toBe(older);

    recent.workspacePath.set('/work/other');
    expect(store.resume()).toBeNull();
    recent.workspacePath.set('/work/ptah');
    recent.sessions.set([newest]);
    expect(store.resume()).toBeNull();
  });

  it("shows the session's own account, else the first known one", () => {
    const store = create();
    expect(store.planRing()).toEqual(VITALS_LOADING);
    plan.snapshot.set(
      planSnapshot([owner('a', 20), owner('b', 70)], {
        s1: { ownerKey: 'b', modelScope: null },
      }),
    );
    expect(store.planRing()).toEqual(
      vitalsReady({ percent: 20, label: '5-hour', resetsInMs: null }),
    );
    sessionId.set('s1');
    expect(store.planRing()).toEqual(
      vitalsReady({ percent: 70, label: '5-hour', resetsInMs: null }),
    );
  });

  it('reads the model display name and the context cue', () => {
    const store = create();
    expect(store.model()).toBeNull();
    modelDisplay.set('Claude Sonnet 4');
    expect(store.model()).toBe('Claude Sonnet 4');
    expect(store.context()).toEqual(sessionContextCue(null));
  });

  const liveContext = {
    model: 'claude-sonnet-4',
    contextUsed: 130_000,
    contextWindow: 200_000,
    contextPercent: 65,
    contextCapacity: {
      tokens: 200_000,
      source: 'sdk-native',
      providerId: null,
      model: 'claude-sonnet-4',
    },
  } satisfies LiveModelStats;

  it('exposes 65% for the empty-state context ring (F2)', () => {
    const store = create();
    tab.set({ liveModelStats: liveContext } as TabState);
    expect(store.context()).toMatchObject({
      known: true, percent: 65, label: '65%', usedTokens: 130_000,
    });
  });

  it('exposes 13% for the sdk-native million-token window (F3)', () => {
    const store = create();
    tab.set({ liveModelStats: {
      ...liveContext,
      contextWindow: 1_000_000,
      contextPercent: 13,
      contextCapacity: { ...liveContext.contextCapacity, tokens: 1_000_000 },
    } } as TabState);
    expect(store.context()).toMatchObject({
      known: true, percent: 13, label: '13%', usedTokens: 130_000,
    });
  });

  it('exposes 105% before the empty-state ring clamps its width to 100% (F5)', () => {
    const store = create();
    tab.set({ liveModelStats: {
      ...liveContext, contextUsed: 210_000, contextPercent: 105,
    } } as TabState);
    expect(store.context()).toMatchObject({
      known: true, percent: 105, label: '105%', usedTokens: 210_000,
    });
  });

  it.each([
    ['unknown capacity', { ...liveContext, contextWindow: 0, contextPercent: 0,
      contextCapacity: { ...liveContext.contextCapacity, tokens: null, source: 'unknown' as const } }],
    ['provider catalog without provider id', { ...liveContext,
      contextCapacity: { ...liveContext.contextCapacity, source: 'provider-catalog' as const } }],
    ['capacity for a different model', { ...liveContext,
      contextCapacity: { ...liveContext.contextCapacity, model: 'other-model' } }],
  ])('shows a dash instead of 0%% for %s (F6)', (_case, live) => {
    const store = create();
    tab.set({ liveModelStats: live } as TabState);
    expect(store.context()).toMatchObject({
      known: false, percent: null, label: '—', usedTokens: null,
    });
  });
});
