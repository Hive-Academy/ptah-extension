/**
 * TabManagerService — tab lifecycle, lookup, computed signals coverage.
 *
 * TASK_2026_105 Wave G2 Phase 2. Complements `tab-manager.service.spec.ts`
 * (abort plumbing) and `tab-manager.intent-mutators.spec.ts` (intent
 * mutators) so that chat-state hits its post-extraction coverage threshold.
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

describe('TabManagerService — tab lifecycle + selectors', () => {
  let service: TabManagerService;
  let confirm: jest.Mock;
  let partition: Partial<jest.Mocked<TabWorkspacePartitionService>>;

  beforeEach(() => {
    localStorage.clear();
    confirm = jest.fn().mockResolvedValue(true);
    const streamingControl: jest.Mocked<StreamingControl> = {
      cleanupSessionDeduplication: jest.fn(),
      clearSessionAgents: jest.fn(),
    } as jest.Mocked<StreamingControl>;
    partition = {
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
    const modelRefresh: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        { provide: ConfirmationDialogService, useValue: { confirm } },
        { provide: STREAMING_CONTROL, useValue: streamingControl },
        { provide: TabWorkspacePartitionService, useValue: partition },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
      ],
    });
    service = TestBed.inject(TabManagerService);
  });

  afterEach(() => localStorage.clear());

  describe('createTab + computed signals', () => {
    it('createTab appends a fresh tab and activates it', () => {
      const id = service.createTab('First');
      expect(service.tabs().length).toBe(1);
      expect(service.activeTabId()).toBe(id);
      expect(service.tabCount()).toBe(1);
      expect(service.activeTab()?.name).toBe('First');
    });

    it('activeTab* selectors return null/empty when no tab is active', () => {
      expect(service.activeTab()).toBeNull();
      expect(service.activeTabMessages()).toEqual([]);
      expect(service.activeTabStatus()).toBeNull();
      expect(service.activeTabSessionId()).toBeNull();
      expect(service.activeTabStreamingState()).toBeNull();
      expect(service.activeTabPreloadedStats()).toBeNull();
      expect(service.activeTabLiveModelStats()).toBeNull();
      expect(service.activeTabModelUsageList()).toBeNull();
      expect(service.activeTabIsCompacting()).toBe(false);
      expect(service.activeTabCompactionCount()).toBe(0);
      expect(service.activeTabViewMode()).toBe('full');
      expect(service.activeTabQueuedContent()).toBeNull();
    });

    it('activeTab* selectors track the active tab', () => {
      const id = service.createTab('A');
      service.setLiveModelStats(id, {
        model: 'm',
        contextUsed: 1,
        contextWindow: 2,
        contextPercent: 50,
      });
      service.setQueuedContent(id, 'queued');
      service.markCompactionStart(id);
      expect(service.activeTabLiveModelStats()?.model).toBe('m');
      expect(service.activeTabQueuedContent()).toBe('queued');
      expect(service.activeTabIsCompacting()).toBe(true);
    });
  });

  describe('switchTab + closeTab', () => {
    it('switchTab updates activeTabId for known ids', () => {
      const a = service.createTab('A');
      const b = service.createTab('B');
      service.switchTab(a);
      expect(service.activeTabId()).toBe(a);
      service.switchTab(b);
      expect(service.activeTabId()).toBe(b);
    });

    it('switchTab is a no-op for unknown ids', () => {
      const a = service.createTab('A');
      service.switchTab('does-not-exist');
      expect(service.activeTabId()).toBe(a);
    });

    it('closeTab removes the tab without confirmation when not dirty', async () => {
      const a = service.createTab('A');
      const b = service.createTab('B');
      await service.closeTab(a);
      expect(service.tabs().length).toBe(1);
      expect(service.activeTabId()).toBe(b);
    });

    it('closeTab seeks confirmation when streaming and aborts on cancel', async () => {
      const id = service.createTab('streaming');
      service.markStreaming(id);
      confirm.mockResolvedValueOnce(false);
      await service.closeTab(id);
      expect(confirm).toHaveBeenCalled();
      expect(service.tabs().length).toBe(1);
    });

    it('closeTab on the last tab clears active id', async () => {
      const id = service.createTab('only');
      await service.closeTab(id);
      expect(service.tabs().length).toBe(0);
      expect(service.activeTabId()).toBeNull();
    });

    it('forceCloseTab skips confirmation', () => {
      const id = service.createTab('popout');
      service.markStreaming(id);
      service.attachSession(id, 'sess-x');
      service.forceCloseTab(id);
      expect(service.tabs().length).toBe(0);
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe('openSessionTab', () => {
    it('creates a new tab when no matching session exists', () => {
      const id = service.openSessionTab('sess-1', 'My Session');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.claudeSessionId).toBe('sess-1');
      expect(tab?.name).toBe('My Session');
    });

    it('reuses the existing tab when the session is already open', () => {
      const first = service.openSessionTab('sess-1', 'My Session');
      const second = service.openSessionTab('sess-1', 'Other Title');
      expect(first).toBe(second);
      expect(service.tabs().length).toBe(1);
    });

    it('falls back to truncated session id when no title is provided', () => {
      const id = service.openSessionTab('a-very-long-session-id-12345');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.title).toBe('a-very-long-session-id-12345');
    });
  });

  describe('findTabBySessionId', () => {
    it('returns the active-workspace tab when sessionId matches', () => {
      const id = service.openSessionTab('sess-active');
      expect(service.findTabBySessionId('sess-active')?.id).toBe(id);
    });

    it('falls back to partition lookup for cross-workspace tabs', () => {
      const partitionMock = TestBed.inject(
        TabWorkspacePartitionService,
      ) as jest.Mocked<TabWorkspacePartitionService>;
      const tabFromOtherWs = {
        id: 'bg-1',
        claudeSessionId: 'sess-bg',
        placeholderSessionId: null,
        name: 'bg',
        title: 'bg',
        order: 0,
        status: 'loaded' as const,
        isDirty: false,
        lastActivityAt: 0,
        messages: [],
        streamingState: null,
      };
      partitionMock.findTabBySessionIdAcrossWorkspaces.mockReturnValueOnce({
        tab: tabFromOtherWs,
        workspacePath: '/ws/b',
      });
      expect(service.findTabBySessionId('sess-bg')?.id).toBe('bg-1');
    });
  });

  describe('reorder + duplicate + rename + view mode', () => {
    it('reorderTabs swaps tab positions and renumbers order', () => {
      const a = service.createTab('A');
      const b = service.createTab('B');
      service.reorderTabs(0, 1);
      const tabs = service.tabs();
      expect(tabs[0]?.id).toBe(b);
      expect(tabs[1]?.id).toBe(a);
      expect(tabs[0]?.order).toBe(0);
      expect(tabs[1]?.order).toBe(1);
    });

    it('duplicateTab clones the tab with " (Copy)" suffix and activates it', () => {
      const a = service.createTab('Original');
      service.duplicateTab(a);
      const tabs = service.tabs();
      expect(tabs.length).toBe(2);
      expect(tabs[1]?.name).toBe('Original (Copy)');
      expect(service.activeTabId()).toBe(tabs[1]?.id);
    });

    it('duplicateTab is a no-op for unknown ids', () => {
      service.createTab('keep');
      service.duplicateTab('missing');
      expect(service.tabs().length).toBe(1);
    });

    it('renameTab trims and truncates titles to 100 chars', () => {
      const a = service.createTab('A');
      const long = 'x'.repeat(200);
      service.renameTab(a, `  ${long}  `);
      expect(service.tabs().find((t) => t.id === a)?.title.length).toBe(100);
    });

    it('renameTab is a no-op when title is empty/whitespace', () => {
      const a = service.createTab('A');
      service.renameTab(a, '   ');
      expect(service.tabs().find((t) => t.id === a)?.title).toBe('A');
    });

    it('toggleTabViewMode + getTabViewMode operate on the requested tab', () => {
      const id = service.createTab('view');
      expect(service.getTabViewMode(id)).toBe('full');
      service.toggleTabViewMode(id);
      expect(service.getTabViewMode(id)).toBe('compact');
    });

    it('getTabViewMode returns "full" for unknown ids', () => {
      expect(service.getTabViewMode('missing')).toBe('full');
    });
  });

  describe('closeOtherTabs + closeTabsToRight', () => {
    it('closeOtherTabs keeps only the requested tab on confirmation', async () => {
      const a = service.createTab('A');
      service.createTab('B');
      service.createTab('C');
      await service.closeOtherTabs(a);
      expect(service.tabs().length).toBe(1);
      expect(service.activeTabId()).toBe(a);
    });

    it('closeOtherTabs is a no-op on cancel', async () => {
      const a = service.createTab('A');
      service.createTab('B');
      confirm.mockResolvedValueOnce(false);
      await service.closeOtherTabs(a);
      expect(service.tabs().length).toBe(2);
    });

    it('closeTabsToRight removes only tabs after the pivot', async () => {
      service.createTab('A');
      const b = service.createTab('B');
      service.createTab('C');
      service.createTab('D');
      await service.closeTabsToRight(b);
      expect(service.tabs().length).toBe(2);
    });

    it('closeTabsToRight is a no-op when pivot is the last tab', async () => {
      service.createTab('A');
      const b = service.createTab('B');
      await service.closeTabsToRight(b);
      expect(service.tabs().length).toBe(2);
    });
  });

  describe('persistence', () => {
    it('saveTabState debounces and writes to localStorage', () => {
      jest.useFakeTimers();
      service.createTab('persist');
      jest.advanceTimersByTime(600);
      const stored = localStorage.getItem('ptah.tabs');
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored as string).tabs.length).toBe(1);
      jest.useRealTimers();
    });

    it('loadTabState restores persisted tabs and clears streamingState', () => {
      localStorage.setItem(
        'ptah.tabs',
        JSON.stringify({
          version: 1,
          activeTabId: 't-1',
          tabs: [
            {
              id: 't-1',
              claudeSessionId: 'sess-stale',
              placeholderSessionId: null,
              name: 'persisted',
              title: 'persisted',
              order: 0,
              status: 'streaming',
              isDirty: false,
              lastActivityAt: 0,
              messages: [],
              streamingState: { events: {} },
            },
          ],
        }),
      );
      service.loadTabState();
      const tab = service.tabs()[0];
      expect(tab?.streamingState).toBeNull();
      expect(tab?.claudeSessionId).toBeNull();
      expect(tab?.status).toBe('loaded');
    });
  });

  describe('streaming indicator + view mode integration', () => {
    it('markTabStreaming/markTabIdle toggle the streaming set', () => {
      const id = service.createTab('marker');
      expect(service.isTabStreaming(id)).toBe(false);
      service.markTabStreaming(id);
      expect(service.isTabStreaming(id)).toBe(true);
      expect(service.streamingTabIds().has(id)).toBe(true);
      service.markTabIdle(id);
      expect(service.isTabStreaming(id)).toBe(false);
    });
  });

  describe('clearPendingSessionLoad', () => {
    it('clears the pending session load signal', () => {
      service.clearPendingSessionLoad();
      expect(service.pendingSessionLoad()).toBeNull();
    });
  });
});
