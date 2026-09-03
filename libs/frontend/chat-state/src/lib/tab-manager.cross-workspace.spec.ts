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

/**
 * TASK_2026_360 — `applyTurnState` is workspace-aware. A backend turn state for
 * a tab that lives in a BACKGROUND partition writes that partition and the
 * global spinner set, and never touches the active workspace's tabs.
 */
describe('TabManagerService.applyTurnState on a background partition (TASK_2026_360)', () => {
  let service: TabManagerService;

  const task = {
    id: 'bg-1',
    type: 'subagent' as const,
    status: 'running' as const,
    description: 'still going',
  };

  function turnState(
    phase:
      | 'generating'
      | 'awaiting-background'
      | 'sleeping'
      | 'idle'
      | 'failed',
    revision: number,
  ) {
    return {
      phase,
      revision,
      backgroundTasks: phase === 'awaiting-background' ? [task] : [],
      sessionCrons: [],
      terminalReason: phase === 'generating' ? null : ('completed' as const),
      timestamp: 1,
    };
  }

  // The applier always passes the event's session id; a bound tab accepts
  // only its own session (review F1).
  const BG_SESSION = SessionId.create();

  /** A streaming tab in WS_A, then WS_B goes active so it is backgrounded. */
  function streamingTabInBackground(): string {
    service.switchWorkspace(WS_A);
    const tabId = service.createTab('a');
    service.attachSession(tabId, BG_SESSION);
    service.markStreaming(tabId);
    service.markTabStreaming(tabId);
    service.switchWorkspace(WS_B);
    return tabId;
  }

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

  it('writes status + snapshot into the partition and clears the global spinner set', () => {
    const tabId = streamingTabInBackground();
    expect(service.isTabStreaming(tabId)).toBe(true);

    service.applyTurnState(
      tabId,
      turnState('awaiting-background', 1),
      BG_SESSION,
    );

    const bg = service.getWorkspaceTabs(WS_A).find((t) => t.id === tabId);
    expect(bg?.status).toBe('awaiting-background');
    expect(bg?.pendingBackgroundTasks).toEqual([task]);
    expect(bg?.lastTerminalReason).toBe('completed');
    expect(bg?.lastTurnStateRevision).toBe(1);
    expect(service.isTabStreaming(tabId)).toBe(false);
    // The active workspace (WS_B) never saw the tab.
    expect(service.tabs().some((t) => t.id === tabId)).toBe(false);
  });

  it('re-lights a backgrounded tab on generating (cron-woken turn)', () => {
    const tabId = streamingTabInBackground();
    service.applyTurnState(tabId, turnState('sleeping', 1), BG_SESSION);
    expect(service.isTabStreaming(tabId)).toBe(false);

    service.applyTurnState(tabId, turnState('generating', 2), BG_SESSION);

    const bg = service.getWorkspaceTabs(WS_A).find((t) => t.id === tabId);
    expect(bg?.status).toBe('streaming');
    expect(service.isTabStreaming(tabId)).toBe(true);
  });

  // Re-expressed for the TASK_2026_371 terminal heal: the tab is BOUND to
  // BG_SESSION, so a terminal phase at or below the recorded revision is now
  // accepted. The revision guard is what decides a NON-terminal phase, and
  // that is the replay window TASK_2026_360 review F1 closed.
  it('honours the revision guard on a background tab', () => {
    const tabId = streamingTabInBackground();
    service.applyTurnState(tabId, turnState('sleeping', 5), BG_SESSION);

    service.applyTurnState(tabId, turnState('generating', 4), BG_SESSION);

    const bg = service.getWorkspaceTabs(WS_A).find((t) => t.id === tabId);
    expect(bg?.status).toBe('sleeping');
    expect(bg?.lastTurnStateRevision).toBe(5);
    expect(service.isTabStreaming(tabId)).toBe(false);
  });

  // The other half of the same rule, on a background partition: the backend
  // floor map evicted BG_SESSION, so its counter restarted and the terminal
  // event lands below what the tab holds. Without the heal the tab would keep
  // `streaming` for good (TASK_2026_371 D1).
  it('heals a background tab on a terminal event below its recorded revision', () => {
    const tabId = streamingTabInBackground();
    service.applyTurnState(tabId, turnState('generating', 5), BG_SESSION);

    service.applyTurnState(tabId, turnState('idle', 2), BG_SESSION);

    const bg = service.getWorkspaceTabs(WS_A).find((t) => t.id === tabId);
    expect(bg?.status).toBe('loaded');
    // The watermark realigns DOWN onto the restarted backend counter.
    expect(bg?.lastTurnStateRevision).toBe(2);
    expect(service.isTabStreaming(tabId)).toBe(false);
  });
});
