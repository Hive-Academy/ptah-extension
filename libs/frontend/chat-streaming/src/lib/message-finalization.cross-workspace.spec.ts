/**
 * MessageFinalizationService — background (cross-workspace) finalize outcome
 * (TASK_2026_154 Wave 2 revision, Critical Failure Mode 1).
 *
 * A turn that ENDS while its tab is backgrounded must still promote its
 * assistant reply from `streamingState` into the persisted `messages` array.
 * Before the fix, `finalizeCurrentMessage(tabId)` resolved the tab via the
 * active-only `tabs()` signal and silently no-op'd for a background tab — the
 * reply stayed in `streamingState`, which the reload sanitize nulls (silent
 * data loss).
 *
 * Wiring: REAL TabManagerService + REAL TabWorkspacePartitionService + REAL
 * MessageFinalizationService so the workspace-aware resolution + write path is
 * genuine. Only the tree builder is stubbed to a deterministic node so the
 * assertion targets the OUTCOME (the message lands in the WS_A partition's
 * TabState), not builder internals.
 */

import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  TabWorkspacePartitionService,
  ConversationRegistry,
  TabSessionBinding,
  ConfirmationDialogService,
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import { SessionId, type ExecutionNode } from '@ptah-extension/shared';
import { MessageFinalizationService } from './message-finalization.service';
import { SessionManager } from './session-manager.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { BatchedUpdateService } from './batched-update.service';

const WS_A = '/ws/a';
const WS_B = '/ws/b';

const flushMicrotasks = () => Promise.resolve();

describe('MessageFinalizationService — background finalize outcome (Wave 2 revision)', () => {
  let finalization: MessageFinalizationService;
  let tabManager: TabManagerService;

  const replyNode: ExecutionNode = {
    id: 'root-a1',
    type: 'text',
    status: 'complete',
    content: 'A reply',
    children: [],
  } as ExecutionNode;

  beforeEach(() => {
    localStorage.clear();

    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        MessageFinalizationService,
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
        // Deterministic tree so the finalized message carries known content.
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: jest.fn(() => [replyNode]) },
        },
        { provide: BatchedUpdateService, useValue: { flushSync: jest.fn() } },
        { provide: SessionManager, useValue: { setStatus: jest.fn() } },
      ],
    });

    finalization = TestBed.inject(MessageFinalizationService);
    tabManager = TestBed.inject(TabManagerService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  /** Create a streaming tab in WS_A with a live streamingState, then background it. */
  function streamingTabInBackground(sessionId: string): string {
    tabManager.switchWorkspace(WS_A);
    const tabId = tabManager.createTab('A');
    tabManager.attachSession(tabId, sessionId);
    tabManager.markStreaming(tabId);
    const state = createEmptyStreamingState();
    state.currentMessageId = 'msg-a1';
    state.textAccumulators.set('msg-a1-block-0', 'A reply');
    tabManager.setStreamingState(tabId, state);

    tabManager.switchWorkspace(WS_B); // WS_A (and its tab) is now background
    return tabId;
  }

  it("promotes the reply into the BACKGROUND tab's messages and clears its streamingState", async () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);

    // Precondition: the reply lives only in streamingState; messages is empty.
    const before = tabManager
      .getWorkspaceTabs(WS_A)
      .find((t) => t.id === tabId);
    expect(before?.messages).toEqual([]);
    expect(before?.streamingState).not.toBeNull();

    finalization.finalizeCurrentMessage(tabId);

    // OUTCOME 1 (synchronous write 1): the assistant reply is now in the
    // WS_A partition tab's messages array — it is no longer only in
    // streamingState, so it survives the reload sanitize.
    const afterWrite1 = tabManager
      .getWorkspaceTabs(WS_A)
      .find((t) => t.id === tabId);
    expect(afterWrite1?.messages).toHaveLength(1);
    expect(afterWrite1?.messages[0].role).toBe('assistant');
    expect(afterWrite1?.messages[0].id).toBe('root-a1');

    // OUTCOME 2 (microtask write 2): streamingState is cleared and status
    // reaches 'loaded' on the background partition.
    await flushMicrotasks();
    const afterWrite2 = tabManager
      .getWorkspaceTabs(WS_A)
      .find((t) => t.id === tabId);
    expect(afterWrite2?.streamingState).toBeNull();
    expect(afterWrite2?.status).toBe('loaded');
  });

  it('does not touch the ACTIVE workspace B tab when finalizing a background tab', async () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);

    // Active workspace B has its own tab.
    const tabB = tabManager.createTab('B');
    tabManager.attachSession(tabB, SessionId.create());

    finalization.finalizeCurrentMessage(tabId);
    await flushMicrotasks();

    // Finalizing the background tab must not write onto the active tab.
    const activeB = tabManager.tabs().find((t) => t.id === tabB);
    expect(activeB?.messages).toEqual([]);
  });
});
