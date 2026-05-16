/**
 * TabWorkspacePartitionService — workspace-partitioned tab state coverage.
 *
 * TASK_2026_105 Wave G2 Phase 2. Exercises the API surface that
 * TabManagerService delegates to: workspace switching, cross-workspace
 * lookup via the reverse index, background updates, and removal cleanup.
 */

import { TestBed } from '@angular/core/testing';
import { TabState } from '@ptah-extension/chat-types';
import type { SessionId, TabId } from '@ptah-extension/shared';

import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

const makeTab = (id: string, sessionId: string | null = null): TabState => ({
  id: id as TabId,
  claudeSessionId: sessionId as SessionId | null,
  name: id,
  title: id,
  order: 0,
  status: 'loaded',
  isDirty: false,
  lastActivityAt: 0,
  messages: [],
  streamingState: null,
});

describe('TabWorkspacePartitionService', () => {
  let svc: TabWorkspacePartitionService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [TabWorkspacePartitionService],
    });
    svc = TestBed.inject(TabWorkspacePartitionService);
    svc.initialize(undefined);
  });

  afterEach(() => localStorage.clear());

  describe('switchWorkspace', () => {
    it('creates an empty tab set on first switch into a brand-new workspace', () => {
      const result = svc.switchWorkspace('/ws/a', [], null);
      expect(result).toEqual({ tabs: [], activeTabId: null });
      expect(svc.activeWorkspacePath).toBe('/ws/a');
    });

    it('returns null when switching to the already-active workspace', () => {
      svc.switchWorkspace('/ws/a', [], null);
      expect(svc.switchWorkspace('/ws/a', [], null)).toBeNull();
    });

    it('saves current tabs and restores target workspace tab set', () => {
      const aTabs = [makeTab('a-1', 'sess-a')];
      svc.switchWorkspace('/ws/a', [], null);
      svc.switchWorkspace('/ws/b', aTabs, 'a-1');
      // Switching back returns the saved /ws/a tabs (active id we passed in)
      const back = svc.switchWorkspace('/ws/a', [makeTab('b-1')], null);
      expect(back?.tabs[0]?.id).toBe('a-1');
      expect(back?.activeTabId).toBe('a-1');
    });
  });

  describe('reverse index', () => {
    it('finds a tab in the active workspace by sessionId via fast path', () => {
      const tabs = [makeTab('t1', 'sess-1')];
      svc.switchWorkspace('/ws/a', [], null);
      svc.registerSessionForWorkspace('sess-1', '/ws/a');
      const result = svc.findTabBySessionIdAcrossWorkspaces('sess-1', tabs);
      expect(result?.workspacePath).toBe('/ws/a');
      expect(result?.tab.id).toBe('t1');
    });

    it('falls back to linear scan when reverse index is stale', () => {
      svc.switchWorkspace('/ws/a', [], null);
      svc.switchWorkspace('/ws/b', [makeTab('a-1', 'sess-a')], 'a-1');
      // No registerSession call -- forces linear scan over background ws map
      const result = svc.findTabBySessionIdAcrossWorkspaces('sess-a', []);
      expect(result?.workspacePath).toBe('/ws/a');
    });

    it('returns null when sessionId is unknown', () => {
      svc.switchWorkspace('/ws/a', [], null);
      expect(
        svc.findTabBySessionIdAcrossWorkspaces('nonexistent', []),
      ).toBeNull();
    });

    it('unregisterSession removes the index entry', () => {
      svc.switchWorkspace('/ws/a', [], null);
      svc.registerSessionForWorkspace('sess-x', '/ws/a');
      svc.unregisterSession('sess-x');
      expect(svc.findTabBySessionIdAcrossWorkspaces('sess-x', [])).toBeNull();
    });
  });

  describe('updateBackgroundTab', () => {
    it('mutates a tab in the background workspace', () => {
      svc.switchWorkspace('/ws/a', [], null);
      svc.switchWorkspace('/ws/b', [makeTab('a-1', 'sess-a')], 'a-1');
      const updated = svc.updateBackgroundTab('a-1', { status: 'streaming' });
      expect(updated).toBe(true);
      const result = svc.findTabBySessionIdAcrossWorkspaces('sess-a', []);
      expect(result?.tab.status).toBe('streaming');
    });

    it('returns false when tab is not in any background workspace', () => {
      svc.switchWorkspace('/ws/a', [], null);
      expect(svc.updateBackgroundTab('missing', { status: 'loaded' })).toBe(
        false,
      );
    });
  });

  describe('removeWorkspaceState', () => {
    it('clears in-memory state and reports active==true when removing the active ws', () => {
      svc.switchWorkspace('/ws/a', [], null);
      const wasActive = svc.removeWorkspaceState('/ws/a');
      expect(wasActive).toBe(true);
      expect(svc.activeWorkspacePath).toBeNull();
    });

    it('reports active==false when removing a background ws', () => {
      svc.switchWorkspace('/ws/a', [], null);
      svc.switchWorkspace('/ws/b', [makeTab('a-1', 'sess-a')], 'a-1');
      const wasActive = svc.removeWorkspaceState('/ws/a');
      expect(wasActive).toBe(false);
      expect(svc.activeWorkspacePath).toBe('/ws/b');
    });
  });

  describe('storage key + encoded path helpers', () => {
    it('uses backend-provided encoded path when set', () => {
      svc.setBackendEncodedPath('/ws/a', 'BACKEND_KEY');
      const key = svc.getStorageKeyForWorkspace('/ws/a');
      expect(key).toContain('BACKEND_KEY');
    });

    it('falls back to encodeURIComponent for unknown ws paths', () => {
      const key = svc.getStorageKeyForWorkspace('/ws/spaces here');
      // No %, replaced with _
      expect(key).not.toContain('%');
      expect(key).toContain('ptah.tabs.ws.');
    });

    it('respects the panelId namespace when initialized with one', () => {
      svc.initialize('panel-uuid', 'ptah.tabs.panel-uuid');
      expect(svc.getStorageKeyForWorkspace('/ws/a')).toContain('.panel-uuid');
    });
  });

  describe('syncActiveWorkspaceState', () => {
    it('keeps the in-memory map in sync with current signal state', () => {
      svc.switchWorkspace('/ws/a', [], null);
      const tabs = [makeTab('t1')];
      svc.syncActiveWorkspaceState(tabs, 't1');
      // Switch away and back -- should restore synced tabs
      svc.switchWorkspace('/ws/b', tabs, 't1');
      const back = svc.switchWorkspace('/ws/a', [], null);
      expect(back?.tabs[0]?.id).toBe('t1');
    });
  });

  describe('getWorkspaceTabs', () => {
    it('returns the active tab signal for the active workspace fast path', () => {
      svc.switchWorkspace('/ws/a', [], null);
      const activeTabs = [makeTab('hot')];
      expect(svc.getWorkspaceTabs('/ws/a', activeTabs)).toBe(activeTabs);
    });

    it('returns the stored tabs for a background workspace', () => {
      svc.switchWorkspace('/ws/a', [], null);
      svc.switchWorkspace('/ws/b', [makeTab('a-1')], 'a-1');
      expect(svc.getWorkspaceTabs('/ws/a').length).toBe(1);
    });

    it('returns empty array for unknown workspace', () => {
      expect(svc.getWorkspaceTabs('/ws/none')).toEqual([]);
    });
  });
});
