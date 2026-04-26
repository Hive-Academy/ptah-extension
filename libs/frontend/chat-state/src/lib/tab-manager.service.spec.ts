/**
 * TabManagerService — AbortController plumbing (TASK_2026_103 Wave E2)
 *
 * Focused tests for tab-close-during-stream cancellation. We exercise the
 * abort lifecycle directly against the service rather than the full chat
 * pipeline, so the suite uses lightweight mocks for the collaborators
 * (ConfirmationDialog, TabWorkspacePartition, MODEL_REFRESH_CONTROL,
 * STREAMING_CONTROL).
 *
 * TASK_2026_105 Wave G2 Phase 2: ModelStateService dependency was inverted
 * to `MODEL_REFRESH_CONTROL` to keep `chat-state` (`type:data-access`) free
 * of `@ptah-extension/core` (`type:core`) per Nx module-boundary rules.
 */

import { TestBed } from '@angular/core/testing';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { STREAMING_CONTROL, type StreamingControl } from './streaming-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

describe('TabManagerService — abort streaming on tab close (Wave E2)', () => {
  let service: TabManagerService;
  let confirmMock: { confirm: jest.Mock };
  let streamingControl: jest.Mocked<StreamingControl>;
  let partitionMock: Partial<jest.Mocked<TabWorkspacePartitionService>>;
  let modelRefreshMock: jest.Mocked<ModelRefreshControl>;

  beforeEach(() => {
    confirmMock = { confirm: jest.fn().mockResolvedValue(true) };

    streamingControl = {
      cleanupSessionDeduplication: jest.fn(),
      clearSessionAgents: jest.fn(),
    } as jest.Mocked<StreamingControl>;

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
        { provide: STREAMING_CONTROL, useValue: streamingControl },
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
});
