/**
 * TabManagerService — AbortController plumbing.
 *
 * Focused tests for tab-close-during-stream cancellation. We exercise the
 * abort lifecycle directly against the service rather than the full chat
 * pipeline, so the suite uses lightweight mocks for the collaborators
 * (ConfirmationDialog, TabWorkspacePartition, MODEL_REFRESH_CONTROL).
 *
 * TabManager does not inject any streaming-side service — it emits
 * `closedTab` events and `StreamRouter` (in `@ptah-extension/chat-routing`)
 * reacts. Cleanup is the router's responsibility and is exercised in
 * `chat-routing` specs.
 */

import { TestBed } from '@angular/core/testing';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId, type SessionStatsEntry } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

describe('TabManagerService — abort streaming on tab close (Wave E2)', () => {
  let service: TabManagerService;
  let confirmMock: { confirm: jest.Mock };
  let partitionMock: Partial<jest.Mocked<TabWorkspacePartitionService>>;
  let modelRefreshMock: jest.Mocked<ModelRefreshControl>;

  beforeEach(() => {
    confirmMock = { confirm: jest.fn().mockResolvedValue(true) };

    partitionMock = {
      initialize: jest.fn(),
      activeWorkspacePath: null,
      registerSessionForWorkspace: jest.fn(),
      unregisterSession: jest.fn(),
      findTabBySessionIdAcrossWorkspaces: jest.fn().mockReturnValue(null),
      // Every tab in this spec lives in the active workspace.
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

    modelRefreshMock = {
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

  // The header's one-click affordance is binary and its round-trip is
  // load-bearing: two clicks must land back where they started
  // (canvas.spec.ts). Height is tab state, not a third mode.
  it('toggles full and compact independently per tab, without cycling', () => {
    const tabId = service.createTab('toggling');
    const otherId = service.createTab('unchanged');
    expect(service.getTabViewMode(tabId)).toBe('full');

    service.toggleTabViewMode(tabId);
    expect(service.getTabViewMode(tabId)).toBe('compact');
    expect(service.getTabViewMode(otherId)).toBe('full');

    service.toggleTabViewMode(tabId);
    expect(service.getTabViewMode(tabId)).toBe('full');
    expect(service.getTabViewMode(otherId)).toBe('full');
  });

  it('returns a tall compact tab to full on toggle, then back to the same height', () => {
    const tabId = service.createTab('tall');
    service.setCompactHeight(tabId, 4);

    service.toggleTabViewMode(tabId);
    expect(service.getTabViewMode(tabId)).toBe('full');
    expect(service.getTabCompactHeightUnits(tabId)).toBe(4);

    service.toggleTabViewMode(tabId);
    expect(service.getTabViewMode(tabId)).toBe('compact');
    expect(service.getTabCompactHeightUnits(tabId)).toBe(4);
  });

  it('selects a view mode directly and ignores repeated selections or missing tabs', () => {
    const tabId = service.createTab('direct selection');
    service.setViewMode(tabId, 'compact');
    expect(service.getTabViewMode(tabId)).toBe('compact');
    const selected = service.tabs();
    service.setViewMode(tabId, 'compact');
    service.setViewMode('missing-tab', 'compact');
    service.toggleTabViewMode('missing-tab');
    expect(service.tabs()).toBe(selected);
    service.toggleTabViewMode(tabId);
    expect(service.getTabViewMode(tabId)).toBe('full');
  });

  it('setCompactHeight switches a full tab to compact at the given height', () => {
    const tabId = service.createTab('height');
    const otherId = service.createTab('other');
    expect(service.getTabCompactHeightUnits(tabId)).toBeUndefined();

    service.setCompactHeight(tabId, 3);

    expect(service.getTabViewMode(tabId)).toBe('compact');
    expect(service.getTabCompactHeightUnits(tabId)).toBe(3);
    expect(service.getTabViewMode(otherId)).toBe('full');
    expect(service.getTabCompactHeightUnits(otherId)).toBeUndefined();
  });

  it('setCompactHeight is a no-op for an equal height, invalid units or a missing tab', () => {
    const tabId = service.createTab('height');
    service.setCompactHeight(tabId, 2);
    const before = service.tabs();

    service.setCompactHeight(tabId, 2);
    service.setCompactHeight(tabId, 0);
    service.setCompactHeight(tabId, -1);
    service.setCompactHeight(tabId, 2.5);
    service.setCompactHeight(tabId, Number.NaN);
    service.setCompactHeight('missing-tab', 3);

    expect(service.tabs()).toBe(before);
    expect(service.getTabCompactHeightUnits(tabId)).toBe(2);
    expect(service.getTabCompactHeightUnits('missing-tab')).toBeUndefined();
  });

  it('setCompactHeight re-enters compact from full even when the height is unchanged', () => {
    const tabId = service.createTab('height');
    service.setCompactHeight(tabId, 5);
    service.setViewMode(tabId, 'full');

    service.setCompactHeight(tabId, 5);

    expect(service.getTabViewMode(tabId)).toBe('compact');
    expect(service.getTabCompactHeightUnits(tabId)).toBe(5);
  });

  it('aborts the in-flight controller when closeTab() runs while streaming', async () => {
    const tabId = service.createTab('streaming tab');
    const signal = service.createAbortController(tabId);
    const onAbort = jest.fn();
    signal.addEventListener('abort', onAbort);

    await service.closeTab(tabId);

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
    // Controller should have been removed from the internal Map
    expect(service.getAbortSignal(tabId)).toBeUndefined();
  });

  it('clears the controller on markTabIdle without firing abort', () => {
    const tabId = service.createTab('done tab');
    const signal = service.createAbortController(tabId);
    const onAbort = jest.fn();
    signal.addEventListener('abort', onAbort);

    service.markTabIdle(tabId);

    expect(onAbort).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
    expect(service.getAbortSignal(tabId)).toBeUndefined();
  });

  it('replaces an existing controller when createAbortController is called twice', () => {
    const tabId = service.createTab('respawn');
    const firstSignal = service.createAbortController(tabId);
    const firstOnAbort = jest.fn();
    firstSignal.addEventListener('abort', firstOnAbort);

    const secondSignal = service.createAbortController(tabId);

    // The old controller is aborted defensively to release stale listeners
    expect(firstOnAbort).toHaveBeenCalledTimes(1);
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    expect(service.getAbortSignal(tabId)).toBe(secondSignal);
  });

  it('forceCloseTab drops the controller without aborting (pop-out transfer)', () => {
    const tabId = service.createTab('popout tab');
    const signal = service.createAbortController(tabId);
    const onAbort = jest.fn();
    signal.addEventListener('abort', onAbort);

    service.forceCloseTab(tabId);

    expect(onAbort).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
  });

  it('isolates a throwing close listener so remaining listeners and post-close state still run', () => {
    const closingTab = service.createTab('closing');
    const remainingTab = service.createTab('remaining');
    service.switchTab(closingTab);
    const saveTabState = jest
      .spyOn(service, 'saveTabState')
      .mockImplementation(() => undefined);
    const received = jest.fn();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    service.onTabClosed(() => {
      throw new Error('view listener failure');
    });
    service.onTabClosed(received);

    service.forceCloseTab(closingTab);

    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: closingTab, kind: 'forceClose' }),
    );
    expect(service.activeTabId()).toBe(remainingTab);
    expect(saveTabState).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[TabManager] Closed-tab listener failed'),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('delivers a re-entrant close to every listener without corrupting the outer delivery', () => {
    const firstTab = service.createTab('first');
    const nestedTab = service.createTab('nested');
    const firstListener = jest.fn((event: { tabId: string }) => {
      if (event.tabId === firstTab) service.forceCloseTab(nestedTab);
    });
    const secondListener = jest.fn();
    service.onTabClosed(firstListener);
    service.onTabClosed(secondListener);

    service.forceCloseTab(firstTab);

    expect(firstListener.mock.calls.map(([event]) => event.tabId)).toEqual([
      firstTab,
      nestedTab,
    ]);
    expect(secondListener.mock.calls.map(([event]) => event.tabId)).toEqual([
      nestedTab,
      firstTab,
    ]);
  });

  it('abortStreamingForTab is a no-op returning false when no controller is registered', () => {
    expect(service.abortStreamingForTab('nonexistent')).toBe(false);
  });

  it('abortStreamingForTab returns true when it aborts a live controller', () => {
    const tabId = service.createTab('live');
    const signal = service.createAbortController(tabId);

    expect(service.abortStreamingForTab(tabId)).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(service.getAbortSignal(tabId)).toBeUndefined();
  });

  it('abortStreamingForTab returns false on a second call for the same tab', () => {
    const tabId = service.createTab('twice');
    service.createAbortController(tabId);

    expect(service.abortStreamingForTab(tabId)).toBe(true);
    expect(service.abortStreamingForTab(tabId)).toBe(false);
  });

  it('abortStreamingForTab returns false for a registered but already-aborted controller', () => {
    const tabId = service.createTab('stale');
    const stale = new AbortController();
    const onAbort = jest.fn();
    stale.signal.addEventListener('abort', onAbort);
    stale.abort();
    onAbort.mockClear();
    service['abortControllers'].set(tabId, stale);

    expect(service.abortStreamingForTab(tabId)).toBe(false);
    expect(onAbort).not.toHaveBeenCalled();
    expect(service.getAbortSignal(tabId)).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // applyCompactionComplete
  // Asserts the patch produced by `applyCompactionComplete` clears the
  // live model stats, keeps the backend session snapshot and stamps the
  // completion timestamp.
  // ---------------------------------------------------------------------
  describe('applyCompactionComplete (TASK_2026_109)', () => {
    it('B1 — clears liveModelStats', () => {
      const tabId = service.createTab('compacting tab');
      service.setLiveModelStats(tabId, {
        model: 'claude-sonnet-4-5',
        contextUsed: 1234,
        contextWindow: 200000,
        contextPercent: 0.6,
      });

      // Sanity-check the pre-state so the post-clear assertion is meaningful.
      const before = service.tabs().find((t) => t.id === tabId);
      expect(before?.liveModelStats).not.toBeNull();

      service.applyCompactionComplete(tabId, { compactionCount: 1 });

      const after = service.tabs().find((t) => t.id === tabId);
      expect(after?.liveModelStats).toBeNull();
    });

    it('seeds post-compaction context with verified same-model capacity', () => {
      const tabId = service.createTab('compacting tab');
      const contextCapacity = {
        tokens: 200000,
        source: 'provider-catalog' as const,
        providerId: 'anthropic',
        model: 'claude-sonnet-4-5',
      };
      service.setLiveModelStats(tabId, {
        model: 'claude-sonnet-4-5',
        contextKnown: true,
        contextCapacity,
        contextUsed: 1234,
        contextWindow: 200000,
        contextPercent: 0.6,
      });

      service.applyCompactionComplete(tabId, {
        compactionCount: 1,
        postCompactionContextTokens: 1200,
      });

      expect(service.tabs().find((tab) => tab.id === tabId)?.liveModelStats).toEqual({
        model: 'claude-sonnet-4-5',
        contextKnown: true,
        contextCapacity,
        contextUsed: 1200,
        contextWindow: 200000,
        contextPercent: 0.6,
      });
    });

    it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'does not synthesize context for an invalid post-compaction token value: %p',
      (postCompactionContextTokens) => {
        const tabId = service.createTab('compacting tab');
        service.setLiveModelStats(tabId, {
          model: 'claude-sonnet-4-5',
          contextUsed: 1234,
          contextWindow: 200000,
          contextPercent: 0.6,
        });

        service.applyCompactionComplete(tabId, {
          compactionCount: 1,
          postCompactionContextTokens,
        });

        expect(
          service.tabs().find((tab) => tab.id === tabId)?.liveModelStats,
        ).toBeNull();
      },
    );

    it('retains verified provider capacity for an unrecognized model', () => {
      // Exact provider evidence keeps an uncatalogued model's capacity known.
      const tabId = service.createTab('compacting tab');
      const contextCapacity = {
        tokens: 200000,
        source: 'provider-catalog' as const,
        providerId: 'openai-codex',
        model: 'gpt-5.6-sol',
      };
      service.setLiveModelStats(tabId, {
        model: 'gpt-5.6-sol',
        contextKnown: true,
        contextCapacity,
        contextUsed: 1234,
        contextWindow: 200000,
        contextPercent: 0.6,
      });

      service.applyCompactionComplete(tabId, {
        compactionCount: 1,
        postCompactionContextTokens: 1200,
      });

      expect(
        service.tabs().find((tab) => tab.id === tabId)?.liveModelStats,
      ).toEqual({
        model: 'gpt-5.6-sol',
        contextKnown: true,
        contextCapacity,
        contextUsed: 1200,
        contextWindow: 200000,
        contextPercent: 0.6,
      });
    });

    it('keeps the measured post-context with unknown capacity for legacy metadata', () => {
      const tabId = service.createTab('compacting tab');
      service.setLiveModelStats(tabId, {
        model: 'unrecognized-model',
        contextUsed: 1234,
        contextWindow: 0,
        contextPercent: 0,
      });

      service.applyCompactionComplete(tabId, {
        compactionCount: 1,
        postCompactionContextTokens: 1200,
      });

      expect(service.tabs().find((tab) => tab.id === tabId)?.liveModelStats).toEqual({
        model: 'unrecognized-model',
        contextKnown: true,
        contextCapacity: undefined,
        contextUsed: 1200,
        contextWindow: 0,
        contextPercent: 0,
      });
    });

    it('does not seed context when the tab has no existing model', () => {
      const tabId = service.createTab('compacting tab');

      service.applyCompactionComplete(tabId, {
        compactionCount: 1,
        postCompactionContextTokens: 1200,
      });

      expect(service.tabs().find((tab) => tab.id === tabId)?.liveModelStats).toBeNull();
    });

    it('preserves the backend session snapshot while seeding only context', () => {
      const tabId = service.createTab('compacting tab');
      const sessionStats: SessionStatsEntry = {
        sessionId: 'session-1',
        model: 'claude-sonnet-4-5',
        totalCost: 1.5,
        tokens: { input: 100, output: 50, cacheRead: 25, cacheCreation: 10 },
        tokenCount: 185,
        messageCount: 3,
        status: 'ok',
        revision: 2,
      };
      service.installSessionStats(tabId, sessionStats);
      service.setLiveModelStats(tabId, {
        model: 'claude-sonnet-4-5',
        contextUsed: 1234,
        contextWindow: 200000,
        contextPercent: 0.6,
      });

      service.applyCompactionComplete(tabId, {
        compactionCount: 1,
        postCompactionContextTokens: 1200,
      });

      const tab = service.tabs().find((candidate) => candidate.id === tabId);
      expect(tab?.sessionStats).toBe(sessionStats);
      expect(tab?.liveModelStats?.contextUsed).toBe(1200);
    });

    it('keeps context seeds isolated to the completed tab and lets live usage replace it', () => {
      const compactedTabId = service.createTab('compacted tab');
      const otherTabId = service.createTab('other tab');
      service.setLiveModelStats(compactedTabId, {
        model: 'claude-sonnet-4-5',
        contextUsed: 1234,
        contextWindow: 200000,
        contextPercent: 0.6,
      });
      service.setLiveModelStats(otherTabId, {
        model: 'claude-sonnet-4-5',
        contextUsed: 5678,
        contextWindow: 200000,
        contextPercent: 2.8,
      });

      service.applyCompactionComplete(compactedTabId, {
        compactionCount: 1,
        postCompactionContextTokens: 1200,
      });
      service.setLiveModelStats(compactedTabId, {
        model: 'claude-sonnet-4-5',
        contextUsed: 1400,
        contextWindow: 200000,
        contextPercent: 0.7,
      });

      expect(
        service.tabs().find((tab) => tab.id === compactedTabId)?.liveModelStats,
      ).toEqual({
        model: 'claude-sonnet-4-5',
        contextUsed: 1400,
        contextWindow: 200000,
        contextPercent: 0.7,
      });
      expect(service.tabs().find((tab) => tab.id === otherTabId)?.liveModelStats)
        .toEqual({
          model: 'claude-sonnet-4-5',
          contextUsed: 5678,
          contextWindow: 200000,
          contextPercent: 2.8,
        });
    });

    it('seeds verified late boundary context without resetting messages or compaction count', () => {
      const tabId = service.createTab('compacted tab');
      const contextCapacity = {
        tokens: 200000,
        source: 'provider-catalog' as const,
        providerId: 'anthropic',
        model: 'claude-sonnet-4-5',
      };
      service.setLiveModelStats(tabId, {
        model: 'claude-sonnet-4-5',
        contextKnown: true,
        contextCapacity,
        contextUsed: 1234,
        contextWindow: 200000,
        contextPercent: 0.6,
      });
      const messagesBefore = service.tabs().find(
        (candidate) => candidate.id === tabId,
      )?.messages;

      service.seedPostCompactionContext(tabId, 1600);

      const tab = service.tabs().find((candidate) => candidate.id === tabId);
      expect(tab?.messages).toBe(messagesBefore);
      expect(tab?.compactionCount).toBeUndefined();
      expect(tab?.liveModelStats).toEqual({
        model: 'claude-sonnet-4-5',
        contextKnown: true,
        contextCapacity,
        contextUsed: 1600,
        contextWindow: 200000,
        contextPercent: 0.8,
      });
    });

    it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'does not seed late boundary context for invalid token value: %p',
      (postTokens) => {
        const tabId = service.createTab('compacted tab');
        service.setLiveModelStats(tabId, {
          model: 'claude-sonnet-4-5',
          contextUsed: 1234,
          contextWindow: 200000,
          contextPercent: 0.6,
        });

        service.seedPostCompactionContext(tabId, postTokens);

        expect(service.tabs().find((tab) => tab.id === tabId)?.liveModelStats).toBeNull();
      },
    );

    it('B3 — stamps lastCompactionAt at completion time', () => {
      const tabId = service.createTab('compacting tab');

      const t0 = Date.now();
      service.applyCompactionComplete(tabId, {
        compactionCount: 1,
      });
      const t1 = Date.now();

      const tab = service.tabs().find((t) => t.id === tabId);
      expect(tab?.lastCompactionAt).toBeDefined();
      const stamp = tab?.lastCompactionAt as number;
      expect(stamp).toBeGreaterThanOrEqual(t0);
      expect(stamp).toBeLessThanOrEqual(t1);
    });
  });

  // ---------------------------------------------------------------------
  // installLiveSessionStats (TASK_2026_626)
  // A `session:stats-live` snapshot is admitted exactly like
  // `installSessionStats`; its context reading is applied in the same update
  // only for a provisional snapshot whose model matches the tab's live reading.
  // ---------------------------------------------------------------------
  describe('installLiveSessionStats (TASK_2026_626)', () => {
    const MODEL = 'claude-sonnet-4-5';
    const SESSION = SessionId.create();
    const contextCapacity = {
      tokens: 200000,
      source: 'provider-catalog' as const,
      providerId: 'anthropic',
      model: MODEL,
    };

    function snapshot(
      revision: number,
      overrides: Partial<SessionStatsEntry> = {},
    ): SessionStatsEntry {
      return {
        sessionId: SESSION,
        model: MODEL,
        totalCost: 0.5,
        tokens: { input: 100 * revision, output: 10, cacheRead: 0, cacheCreation: 0 },
        messageCount: revision,
        status: 'ok',
        revision,
        ...overrides,
      };
    }

    function provisional(revision: number): SessionStatsEntry {
      return snapshot(revision, { provisional: true });
    }

    /** A tab bound to SESSION showing a same-model 40 000-token fill. */
    function tabWithFill(): string {
      const tabId = service.createTab('live tab');
      service.attachSession(tabId, SESSION);
      service.setLiveModelStats(tabId, {
        model: MODEL,
        contextKnown: true,
        contextCapacity,
        contextUsed: 40000,
        contextWindow: 200000,
        contextPercent: 20,
      });
      return tabId;
    }

    const tabOf = (tabId: string) =>
      service.tabs().find((candidate) => candidate.id === tabId);

    function spyOnUpdates(): jest.SpyInstance {
      const internal = service as unknown as {
        updateTabInternal: (id: string, updates: Partial<TabState>) => void;
      };
      return jest.spyOn(internal, 'updateTabInternal');
    }

    it('installs an admitted snapshot and its fill (prior capacity) in one update', () => {
      const tabId = tabWithFill();
      const live = provisional(5);
      const update = spyOnUpdates();

      const admitted = service.installLiveSessionStats(tabId, live, {
        model: MODEL,
        contextTokens: 60000,
      });

      expect(admitted).toBe(true);
      expect(update).toHaveBeenCalledTimes(1);
      const tab = tabOf(tabId);
      expect(tab?.sessionStats).toBe(live);
      expect(tab?.liveModelStats).toEqual({
        model: MODEL,
        contextKnown: true,
        contextCapacity,
        contextUsed: 60000,
        contextWindow: 200000,
        contextPercent: 30,
      });
    });

    it('matches the model under normalizeModelKey', () => {
      const tabId = tabWithFill();

      service.installLiveSessionStats(tabId, provisional(5), {
        model: 'Anthropic/Claude-Sonnet-4-5-20250929',
        contextTokens: 60000,
      });

      expect(tabOf(tabId)?.liveModelStats?.contextUsed).toBe(60000);
    });

    it('rejects a live snapshot older than an installed authoritative one and writes nothing', () => {
      const tabId = tabWithFill();
      const authoritative = snapshot(10);
      service.installSessionStats(tabId, authoritative);
      const fillBefore = tabOf(tabId)?.liveModelStats;
      const update = spyOnUpdates();

      const admitted = service.installLiveSessionStats(tabId, provisional(8), {
        model: MODEL,
        contextTokens: 90000,
      });

      expect(admitted).toBe(false);
      expect(update).not.toHaveBeenCalled();
      const tab = tabOf(tabId);
      expect(tab?.sessionStats).toBe(authoritative);
      expect(tab?.liveModelStats).toBe(fillBefore);
      expect(tab?.liveModelStats?.contextUsed).toBe(40000);
    });

    it.each([
      ['an invalid snapshot', { provisional: 'yes' as unknown as boolean }],
      ['another session', { sessionId: SessionId.create() }],
    ])('returns false and writes nothing for %s', (_label, overrides) => {
      const tabId = tabWithFill();
      service.installSessionStats(tabId, snapshot(1));
      const before = tabOf(tabId);
      const update = spyOnUpdates();

      const admitted = service.installLiveSessionStats(
        tabId,
        snapshot(2, { provisional: true, ...overrides }),
        { model: MODEL, contextTokens: 90000 },
      );

      expect(admitted).toBe(false);
      expect(update).not.toHaveBeenCalled();
      expect(tabOf(tabId)).toBe(before);
    });

    it('returns false for an unknown tab', () => {
      expect(
        service.installLiveSessionStats('missing-tab', provisional(1), {
          model: MODEL,
          contextTokens: 90000,
        }),
      ).toBe(false);
    });

    it('installs the snapshot but leaves the fill on a model mismatch', () => {
      const tabId = tabWithFill();
      const live = provisional(5);

      expect(
        service.installLiveSessionStats(tabId, live, {
          model: 'claude-opus-4-1',
          contextTokens: 90000,
        }),
      ).toBe(true);

      expect(tabOf(tabId)?.sessionStats).toBe(live);
      expect(tabOf(tabId)?.liveModelStats?.contextUsed).toBe(40000);
    });

    it('installs the snapshot but writes no fill when the tab has no live reading', () => {
      const tabId = service.createTab('no reading');
      service.attachSession(tabId, SESSION);
      const live = provisional(5);
      const fillBefore = tabOf(tabId)?.liveModelStats;

      expect(
        service.installLiveSessionStats(tabId, live, {
          model: MODEL,
          contextTokens: 90000,
        }),
      ).toBe(true);

      expect(tabOf(tabId)?.sessionStats).toBe(live);
      expect(tabOf(tabId)?.liveModelStats).toBe(fillBefore);
    });

    it('installs the snapshot but leaves the fill for zero context tokens', () => {
      const tabId = tabWithFill();
      const live = provisional(5);

      expect(
        service.installLiveSessionStats(tabId, live, {
          model: MODEL,
          contextTokens: 0,
        }),
      ).toBe(true);

      expect(tabOf(tabId)?.sessionStats).toBe(live);
      expect(tabOf(tabId)?.liveModelStats?.contextUsed).toBe(40000);
    });

    it('never writes the fill from an equal-revision authoritative snapshot carrying a context', () => {
      const tabId = tabWithFill();
      service.installSessionStats(tabId, snapshot(10));
      const authoritative = snapshot(10, { totalCost: 0.75 });

      const admitted = service.installLiveSessionStats(tabId, authoritative, {
        model: MODEL,
        contextTokens: 90000,
      });

      expect(admitted).toBe(true);
      expect(tabOf(tabId)?.sessionStats).toBe(authoritative);
      expect(tabOf(tabId)?.liveModelStats?.contextUsed).toBe(40000);
    });

    it('preserves the session budget across a live install', () => {
      const tabId = tabWithFill();
      const budget = {
        sessionId: SESSION,
        stage: 'normal' as const,
        unit: 'tokens' as const,
        measure: 'tokens' as const,
        used: 100,
        limit: 1000,
        percent: 10,
        lowerBound: false,
        revision: 3,
        compactions: 0,
        extensions: 0,
        blocked: false,
      };
      service.installSessionStats(tabId, snapshot(3), budget);

      expect(service.installLiveSessionStats(tabId, provisional(4))).toBe(true);

      expect(tabOf(tabId)?.sessionBudget).toBe(budget);
    });
  });

  // ---------------------------------------------------------------------
  // Messaging-gateway attachment intents (markTabAttached / markTabDetached /
  // findTabIdsBySessionId). These are the frontend-only read-only flag driven
  // by backend gateway:sessionAttached / gateway:sessionDetached push events.
  // ---------------------------------------------------------------------
  describe('messaging attachment intents', () => {
    it('markTabAttached stamps the binding onto the tab', () => {
      const tabId = service.createTab('attach me');

      service.markTabAttached(tabId, {
        bindingId: 'binding-1',
        platform: 'telegram',
      });

      const tab = service.tabs().find((t) => t.id === tabId);
      expect(tab?.attachedBinding).toEqual({
        bindingId: 'binding-1',
        platform: 'telegram',
      });
    });

    it('markTabDetached clears the binding', () => {
      const tabId = service.createTab('detach me');
      service.markTabAttached(tabId, {
        bindingId: 'binding-1',
        platform: 'discord',
      });

      service.markTabDetached(tabId);

      const tab = service.tabs().find((t) => t.id === tabId);
      expect(tab?.attachedBinding).toBeNull();
    });

    it('findTabIdsBySessionId resolves a tab by its claudeSessionId', () => {
      const sessionId = SessionId.create();
      const tabId = service.openSessionTab(sessionId, 'bound tab');

      const ids = service.findTabIdsBySessionId(sessionId);

      expect(ids).toContain(tabId);
    });

    it('findTabIdsBySessionId returns empty for an unknown session', () => {
      const ids = service.findTabIdsBySessionId(SessionId.create());
      expect(ids).toEqual([]);
    });
  });
});
