/**
 * TabManagerService — cross-workspace routing invariants (TASK_2026_154).
 *
 * Uses the REAL TabManagerService wired to the REAL TabWorkspacePartitionService
 * (and the real registries) so the assertions exercise genuine workspace
 * partitioning, the global `_streamingTabIds` visual set, and the new
 * `findTabByIdAcrossWorkspaces` lookup — not mocked stand-ins.
 *
 * Bug 1 mechanism: attaching a resolved session to a BACKGROUND tab id must
 * write to that tab's partitioned TabState and must NOT touch the active tab's
 * live `claudeSessionId`.
 *
 * Bug 2 mechanism: the `_streamingTabIds` spinner set is global and survives a
 * workspace switch; `markTabIdle(bgTabId)` clears it for a backgrounded tab.
 */

import { TestBed } from '@angular/core/testing';
import { SessionId } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';
import { ConversationRegistry } from './conversation-registry.service';
import { TabSessionBinding } from './tab-session-binding.service';

const WS_A = '/ws/a';
const WS_B = '/ws/b';

describe('TabManagerService — cross-workspace routing (TASK_2026_154)', () => {
  let service: TabManagerService;

  beforeEach(() => {
    localStorage.clear();

    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
      ],
    });

    service = TestBed.inject(TabManagerService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  describe('findTabByIdAcrossWorkspaces', () => {
    it('resolves a tab in the active workspace', () => {
      service.switchWorkspace(WS_A);
      const tabId = service.createTab('a');

      const lookup = service.findTabByIdAcrossWorkspaces(tabId);

      expect(lookup?.tab.id).toBe(tabId);
      expect(lookup?.workspacePath).toBe(WS_A);
    });

    it('resolves a tab that lives in a BACKGROUND workspace', () => {
      service.switchWorkspace(WS_A);
      const bgTabId = service.createTab('a');
      // Switch away — WS_A (and its tab) is now a background partition.
      service.switchWorkspace(WS_B);

      const lookup = service.findTabByIdAcrossWorkspaces(bgTabId);

      expect(lookup?.tab.id).toBe(bgTabId);
      expect(lookup?.workspacePath).toBe(WS_A);
      // The background tab id is NOT visible in the active signal.
      expect(service.tabs().some((t) => t.id === bgTabId)).toBe(false);
    });

    it('returns null for an unknown tab id', () => {
      service.switchWorkspace(WS_A);
      service.createTab('a');

      expect(service.findTabByIdAcrossWorkspaces('nope')).toBeNull();
    });
  });

  describe('Bug 1 — session attach never clobbers the active tab', () => {
    it('attaching to a background tab id updates the partition, not the active tab', () => {
      const sessB = SessionId.create();
      const sessA = SessionId.create();
      const foreignA = SessionId.create();

      // Workspace A: background tab that owns session A.
      service.switchWorkspace(WS_A);
      const tabIdA = service.createTab('a');
      service.attachSession(tabIdA, sessA);

      // Workspace B active: tab owns its own live session B.
      service.switchWorkspace(WS_B);
      const tabIdB = service.createTab('b');
      service.attachSession(tabIdB, sessB);

      // Resolve the owner of a resolution across workspaces (tabIdA is in the
      // WS_A background partition) and attach a new session id to it — the
      // exact routing handleSessionIdResolved performs.
      const owner = service.findTabByIdAcrossWorkspaces(tabIdA);
      expect(owner?.workspacePath).toBe(WS_A);
      service.attachSession(owner!.tab.id, foreignA);

      // Active tab B keeps its own live session — NOT clobbered.
      const activeB = service.tabs().find((t) => t.id === tabIdB);
      expect(activeB?.claudeSessionId).toBe(sessB);

      // Background tab A received the new session id in its partition.
      const bgA = service.getWorkspaceTabs(WS_A).find((t) => t.id === tabIdA);
      expect(bgA?.claudeSessionId).toBe(foreignA);
    });
  });

  describe('Bug 2 — spinner set survives workspace switch and clears on idle', () => {
    it('markTabIdle clears isTabStreaming for a backgrounded tab', () => {
      service.switchWorkspace(WS_A);
      const tabIdA = service.createTab('a');
      service.markTabStreaming(tabIdA);
      expect(service.isTabStreaming(tabIdA)).toBe(true);

      // Switch away — the tab moves to the background partition, but the global
      // spinner set still holds its id.
      service.switchWorkspace(WS_B);
      expect(service.isTabStreaming(tabIdA)).toBe(true);

      // The turn-end handlers' Bug 2 fix calls markTabIdle for the background
      // tab id — assert it genuinely clears the spinner.
      service.markTabIdle(tabIdA);
      expect(service.isTabStreaming(tabIdA)).toBe(false);
    });
  });
});
