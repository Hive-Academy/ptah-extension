import { TestBed } from '@angular/core/testing';
import {
  createEmptyStreamingState,
  type TabState,
} from '@ptah-extension/chat-types';
import { SessionId, type ExecutionChatMessage } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { projectTabForPersist, sanitizeRestoredTab } from './tab-persistence';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

function message(id: string): ExecutionChatMessage {
  return {
    id,
    role: 'user',
    content: id,
    timestamp: 1,
    nodes: [],
  };
}

describe('TabManagerService history window', () => {
  let service: TabManagerService;

  beforeEach(() => {
    const partition = {
      initialize: jest.fn(),
      activeWorkspacePath: null,
      registerSessionForWorkspace: jest.fn(),
      unregisterSession: jest.fn(),
      findTabBySessionIdAcrossWorkspaces: jest.fn().mockReturnValue(null),
      findTabByIdAcrossWorkspaces: jest
        .fn()
        .mockImplementation((tabId: string, tabs: readonly TabState[]) => {
          const tab = tabs.find((candidate) => candidate.id === tabId);
          return tab ? { tab, workspacePath: '/workspace' } : null;
        }),
      getStorageKeyForWorkspace: jest.fn().mockReturnValue('ptah.tabs'),
      syncActiveWorkspaceState: jest.fn(),
      switchWorkspace: jest.fn().mockReturnValue(null),
      removeWorkspaceState: jest.fn().mockReturnValue(false),
      getWorkspaceTabs: jest.fn().mockReturnValue([]),
      setBackendEncodedPath: jest.fn(),
      updateBackgroundTab: jest.fn(),
    };
    const modelRefresh: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        {
          provide: ConfirmationDialogService,
          useValue: { confirm: jest.fn().mockResolvedValue(true) },
        },
        { provide: TabWorkspacePartitionService, useValue: partition },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
      ],
    });
    service = TestBed.inject(TabManagerService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('prepends once against current messages, retaining a live append and dropping duplicate ids', () => {
    const tabId = service.createTab('history');
    service.setMessages(tabId, [message('loaded')]);

    // Represents a live append arriving after the older-page request began.
    service.setMessages(tabId, [message('loaded'), message('live')]);
    const before = service.tabs().find((candidate) => candidate.id === tabId);

    const internal = service as unknown as {
      updateTabInternal: (id: string, updates: Partial<TabState>) => void;
    };
    const update = jest.spyOn(internal, 'updateTabInternal');
    service.prependHistoryMessages(
      tabId,
      [message('older'), message('loaded'), message('older')],
      'cursor-2',
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(tabId, {
      messages: [message('older'), message('loaded'), message('live')],
      olderHistoryCursor: 'cursor-2',
    });
    const tab = service.tabs().find((candidate) => candidate.id === tabId);
    expect(tab?.messages.map((entry) => entry.id)).toEqual([
      'older',
      'loaded',
      'live',
    ]);
    expect(tab?.olderHistoryCursor).toBe('cursor-2');
    expect(tab?.status).toBe(before?.status);
    expect(tab?.streamingState).toBe(before?.streamingState);
  });

  it('records a null cursor for an empty page without changing messages', () => {
    const tabId = service.createTab('history');
    service.setMessages(tabId, [message('loaded')]);

    service.prependHistoryMessages(tabId, [], null);

    const tab = service.tabs().find((candidate) => candidate.id === tabId);
    expect(tab?.messages).toEqual([message('loaded')]);
    expect(tab?.olderHistoryCursor).toBeNull();
  });

  it('preserves older-page order and exact membership when ids partially overlap current messages', () => {
    const tabId = service.createTab('history');
    service.setMessages(tabId, [message('current-a'), message('current-b')]);

    service.prependHistoryMessages(
      tabId,
      [
        message('older-a'),
        message('current-b'),
        message('older-b'),
        message('current-a'),
        message('older-c'),
      ],
      'next-cursor',
    );

    const tab = service.tabs().find((candidate) => candidate.id === tabId);
    expect(tab?.messages.map((entry) => entry.id)).toEqual([
      'older-a',
      'older-b',
      'older-c',
      'current-a',
      'current-b',
    ]);
    expect(tab?.messages).toHaveLength(5);
    expect(tab?.olderHistoryCursor).toBe('next-cursor');
  });

  it('sets the tri-state cursor and treats an unknown tab as a no-op', () => {
    const tabId = service.createTab('history');
    expect(
      service.tabs().find((candidate) => candidate.id === tabId)
        ?.olderHistoryCursor,
    ).toBeUndefined();

    service.setOlderHistoryCursor(tabId, 'cursor-1');
    expect(
      service.tabs().find((candidate) => candidate.id === tabId)
        ?.olderHistoryCursor,
    ).toBe('cursor-1');

    expect(() =>
      service.prependHistoryMessages('missing', [message('older')], null),
    ).not.toThrow();
    expect(() => service.setOlderHistoryCursor('missing', null)).not.toThrow();
  });

  it('resets paging when a fresh resume begins', () => {
    const tabId = service.createTab('history');
    service.setOlderHistoryCursor(tabId, 'cursor-1');

    service.applyResumingSession(tabId, {
      sessionId: SessionId.create(),
      name: 'resumed',
      title: 'Resumed',
      streamingState: createEmptyStreamingState(),
    });

    expect(
      service.tabs().find((candidate) => candidate.id === tabId)
        ?.olderHistoryCursor,
    ).toBeUndefined();
  });

  it('clears paging when a tab is reset or rebound to another session', () => {
    const resetTabId = service.createTab('reset-history');
    service.setOlderHistoryCursor(resetTabId, 'reset-cursor');

    service.resetTabToFresh(resetTabId);

    expect(
      service.tabs().find((candidate) => candidate.id === resetTabId)
        ?.olderHistoryCursor,
    ).toBeUndefined();

    const reboundTabId = service.createTab('rebind-history');
    service.setOlderHistoryCursor(reboundTabId, 'rebind-cursor');
    service.rebindTabSession(
      reboundTabId,
      SessionId.create(),
      'Replacement session',
    );

    expect(
      service.tabs().find((candidate) => candidate.id === reboundTabId)
        ?.olderHistoryCursor,
    ).toBeUndefined();
  });

  it('persists and restores the cursor without coercion', () => {
    const tabId = service.createTab('history');
    service.setOlderHistoryCursor(tabId, 'opaque-cursor');
    const tab = service.tabs().find((candidate) => candidate.id === tabId);
    expect(tab).toBeDefined();

    const restored = sanitizeRestoredTab(projectTabForPersist(tab as TabState));

    expect(restored.olderHistoryCursor).toBe('opaque-cursor');
  });
});
