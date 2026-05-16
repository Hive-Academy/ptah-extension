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
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';
import { ConversationRegistry } from './conversation-registry.service';
import { TabSessionBinding } from './tab-session-binding.service';
import { TabId, type ClaudeSessionId } from './identity/ids';
import { SessionId } from '@ptah-extension/shared';

// Production `TabManagerService.attachSession` validates the inbound sessionId
// via `SessionId.from()` (UUID v4). Mint stable ids per spec run.
const SESS_X = SessionId.create();
const SESS_SHARED = SessionId.create();

describe('TabManagerService — tab lifecycle + selectors', () => {
  let service: TabManagerService;
  let confirm: jest.Mock;
  let partition: Partial<jest.Mocked<TabWorkspacePartitionService>>;

  beforeEach(() => {
    localStorage.clear();
    confirm = jest.fn().mockResolvedValue(true);
    // TASK_2026_106 Phase 3: STREAMING_CONTROL provider removed.
    // Cleanup is owned by `StreamRouter` (in `@ptah-extension/chat-routing`),
    // which subscribes to `closedTab` via `effect()`. TabManager itself only
    // emits the event — assertions about cleanup live in chat-routing specs.
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
      service.attachSession(id, SESS_X);
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
        // TASK_2026_106 Phase 6b — `placeholderSessionId` removed.
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

  // TASK_2026_106 Phase 4a — multi-tab fan-out lookup. Reads
  // `ConversationRegistry` + `TabSessionBinding` for the conversation that
  // contains the session, with a legacy fallback to `findTabBySessionId`
  // when no registry entry exists yet.
  describe('findTabsBySessionId (TASK_2026_106 Phase 4a)', () => {
    it('falls back to singular lookup wrapped in an array when no registry entry exists', () => {
      const id = service.openSessionTab('sess-legacy');
      const result = service.findTabsBySessionId('sess-legacy');
      expect(result.length).toBe(1);
      expect(result[0]?.id).toBe(id);
    });

    it('returns an empty array when nothing matches', () => {
      service.createTab('plain');
      expect(service.findTabsBySessionId('sess-not-here')).toEqual([]);
    });

    it('returns ALL tabs bound to the conversation containing the session', () => {
      // Bind two tabs to the same conversation via the chat-state registries
      // directly (the StreamRouter normally drives these — Phase 4a only
      // requires that TabManager READ them).
      const registry = TestBed.inject(ConversationRegistry);
      const binding = TestBed.inject(TabSessionBinding);

      const tabA = service.createTab('A');
      const tabB = service.createTab('B');
      // Attach the same SDK session to both tabs (canvas-grid scenario).
      service.attachSession(tabA, SESS_SHARED);
      service.attachSession(tabB, SESS_SHARED);

      // tab IDs from TabManager are not UUIDs (tab_xxx_yyy format) — cast
      // through `unknown` to satisfy the branded TabId type for the
      // test-only direct registry write.
      const convId = registry.create(SESS_SHARED as ClaudeSessionId);
      binding.bind(tabA as unknown as TabId, convId);
      binding.bind(tabB as unknown as TabId, convId);

      const result = service.findTabsBySessionId(SESS_SHARED);
      expect(result.length).toBe(2);
      const ids = result.map((t) => t.id).sort();
      expect(ids).toEqual([tabA, tabB].sort());
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

    it('createTab mints a UUID-v4 tab id (v0.2.32 regression)', () => {
      // The backend permission path now calls `SessionId.from(tabId)` and
      // `TabId.from(tabId)`, both of which throw on non-UUID input. The
      // legacy `tab_<timestamp>_<random>` generator crashed every
      // `chat:start` until this was fixed — guard against regression.
      const id = service.createTab('uuid-check');
      expect(TabId.validate(id)).toBe(true);
      expect(id.startsWith('tab_')).toBe(false);
    });

    it('loadTabState re-mints legacy tab_* ids and remaps activeTabId', () => {
      // v0.2.32 and earlier persisted ids like `tab_1778939573732_w43e75q`.
      // These crash the backend on chat:start; the load path must migrate
      // them to UUID v4 in-place and keep activeTabId pointing at the
      // re-minted id.
      const legacyId = 'tab_1778939573732_w43e75q';
      localStorage.setItem(
        'ptah.tabs',
        JSON.stringify({
          version: 1,
          activeTabId: legacyId,
          tabs: [
            {
              id: legacyId,
              claudeSessionId: null,
              name: 'legacy',
              title: 'legacy',
              order: 0,
              status: 'loaded',
              isDirty: false,
              lastActivityAt: 0,
              messages: [],
              streamingState: null,
            },
          ],
        }),
      );
      service.loadTabState();
      const tab = service.tabs()[0];
      expect(tab).toBeDefined();
      expect(tab?.id).not.toBe(legacyId);
      expect(TabId.validate(tab?.id ?? '')).toBe(true);
      expect(service.activeTabId()).toBe(tab?.id);
    });

    it('loadTabState restores persisted tabs and clears streamingState', () => {
      // TASK_2026_106 Phase 6b — `placeholderSessionId` was removed from
      // `TabState`. Persisted state from old releases that still carries
      // the field MUST parse cleanly (back-compat). This fixture keeps
      // the legacy field on purpose to exercise that read path.
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
      // Confirm legacy field is dropped from in-memory state — TabState
      // shape no longer carries it.
      expect((tab as Record<string, unknown>)?.placeholderSessionId).toBe(
        undefined,
      );
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
