/**
 * TabManagerService — AbortController plumbing (TASK_2026_103 Wave E2)
 *
 * Focused tests for tab-close-during-stream cancellation. We exercise the
 * abort lifecycle directly against the service rather than the full chat
 * pipeline, so the suite uses lightweight mocks for the collaborators
 * (ConfirmationDialog, TabWorkspacePartition, MODEL_REFRESH_CONTROL).
 *
 * TASK_2026_105 Wave G2 Phase 2: ModelStateService dependency was inverted
 * to `MODEL_REFRESH_CONTROL` to keep `chat-state` (`type:data-access`) free
 * of `@ptah-extension/core` (`type:core`) per Nx module-boundary rules.
 *
 * TASK_2026_106 Phase 3: STREAMING_CONTROL token deleted. TabManager no
 * longer injects any streaming-side service — it emits `closedTab` events
 * and `StreamRouter` (in `@ptah-extension/chat-routing`) reacts. Specs that
 * used to mock `STREAMING_CONTROL` now omit it entirely; cleanup is the
 * router's responsibility and is exercised in `chat-routing` specs.
 */

import { TestBed } from '@angular/core/testing';
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

  it('abortStreamingForTab is a no-op when no controller is registered', () => {
    expect(() => service.abortStreamingForTab('nonexistent')).not.toThrow();
  });

  // ---------------------------------------------------------------------
  // TASK_2026_109 — applyCompactionComplete (B1, B3)
  // Asserts the patch produced by `applyCompactionComplete` clears the
  // live model stats / usage list and stamps the completion timestamp.
  // ---------------------------------------------------------------------
  describe('applyCompactionComplete (TASK_2026_109)', () => {
    it('B1 — clears liveModelStats and modelUsageList', () => {
      const tabId = service.createTab('compacting tab');
      service.setLiveModelStatsAndUsageList(
        tabId,
        {
          model: 'opus',
          contextUsed: 1234,
          contextWindow: 200000,
          contextPercent: 0.6,
        },
        [
          {
            model: 'opus',
            inputTokens: 100,
            outputTokens: 50,
            contextWindow: 200000,
            costUSD: 0.5,
          },
        ],
      );

      // Sanity-check the pre-state so the post-clear assertions are meaningful.
      const before = service.tabs().find((t) => t.id === tabId);
      expect(before?.liveModelStats).not.toBeNull();
      expect(before?.modelUsageList?.length).toBe(1);

      service.applyCompactionComplete(tabId, {
        preloadedStats: {
          totalCost: 1.0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          messageCount: 3,
        },
        compactionCount: 1,
      });

      const after = service.tabs().find((t) => t.id === tabId);
      expect(after?.liveModelStats).toBeNull();
      expect(after?.modelUsageList).toEqual([]);
    });

    it('B3 — stamps lastCompactionAt at completion time', () => {
      const tabId = service.createTab('compacting tab');

      const t0 = Date.now();
      service.applyCompactionComplete(tabId, {
        preloadedStats: null,
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
});
