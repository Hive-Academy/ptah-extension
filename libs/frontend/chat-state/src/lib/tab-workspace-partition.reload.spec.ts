/**
 * TabWorkspacePartitionService — reload survival of a background-finalized turn
 * (TASK_2026_154 Wave 2 revision, Critical Failure Mode 1).
 *
 * The reload path (`_loadWorkspaceTabsFromStorage`) unconditionally nulls
 * `streamingState` on every restored tab. That is why a background-completed
 * turn whose reply was left ONLY in `streamingState` was lost on reload. The
 * Wave 2 revision finalizes background turns so the reply lives in `messages`
 * — a persisted, sanitize-safe field. This spec proves the sanitize preserves
 * `messages` (the finalized reply) while nulling `streamingState` and
 * normalizing the in-flight status to 'loaded'.
 */

import { TestBed } from '@angular/core/testing';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';
import { ConversationRegistry } from './conversation-registry.service';
import { TabSessionBinding } from './tab-session-binding.service';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';

const WS_A = '/ws/a';

describe('TabWorkspacePartitionService — reload survival of background-finalized reply', () => {
  let tabManager: TabManagerService;
  let partition: TabWorkspacePartitionService;

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

    tabManager = TestBed.inject(TabManagerService);
    partition = TestBed.inject(TabWorkspacePartitionService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps the finalized reply in messages while nulling streamingState on reload', () => {
    // Simulate persisted state for a workspace whose tab finished a turn in the
    // background: the reply is in `messages`, but a stale `streamingState` and
    // in-flight `status` are also present (as they would be just before the
    // finalize microtask persisted).
    const key = partition.getStorageKeyForWorkspace(WS_A);
    const persisted = {
      version: 2,
      activeTabId: 'tab-a',
      tabs: [
        {
          id: 'tab-a',
          title: 'A',
          name: 'A',
          status: 'streaming',
          claudeSessionId: 'sess-a',
          currentMessageId: null,
          messages: [
            { id: 'root-a1', role: 'assistant', rawContent: 'A reply' },
          ],
          streamingState: {
            currentMessageId: 'msg-a1',
            events: [],
          },
        },
      ],
    };
    localStorage.setItem(key, JSON.stringify(persisted));

    // First switch into WS_A loads it from storage and runs the sanitize.
    tabManager.switchWorkspace(WS_A);

    const loaded = tabManager.tabs().find((t) => t.id === 'tab-a');
    expect(loaded).toBeDefined();
    // The finalized reply survives — it is in messages, not streamingState.
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0].id).toBe('root-a1');
    expect(loaded?.messages[0].role).toBe('assistant');
    // streamingState is nulled and the in-flight status normalized to loaded.
    expect(loaded?.streamingState).toBeNull();
    expect(loaded?.status).toBe('loaded');
  });
});
