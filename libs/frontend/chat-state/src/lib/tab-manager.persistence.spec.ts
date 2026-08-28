/**
 * TabManagerService — what reaches `localStorage`, and how often.
 *
 * Covers the three properties the streaming hot path depends on
 * (TASK_2026_323 / R5):
 *   1. the persisted payload carries no `streamingState`;
 *   2. the debounce has a max wait, so continuous streaming cannot starve it;
 *   3. an unchanged tab set does not write at all.
 */

import { TestBed } from '@angular/core/testing';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';

const STORAGE_KEY = 'ptah.tabs';

function makeExecutionNode(id: string): ExecutionNode {
  return {
    id,
    type: 'tool',
    status: 'complete',
    timestamp: 0,
    children: [],
    toolName: 'Read',
    toolInput: { file_path: 'x'.repeat(2000) },
    toolOutput: 'y'.repeat(5000),
  } as unknown as ExecutionNode;
}

function makeMessage(id: string): ExecutionChatMessage {
  return {
    id,
    role: 'assistant',
    timestamp: 0,
    streamingState: makeExecutionNode(`node-${id}`),
  } as ExecutionChatMessage;
}

describe('TabManagerService — persistence payload + write cadence', () => {
  let service: TabManagerService;
  let setItem: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();

    const partition: Partial<jest.Mocked<TabWorkspacePartitionService>> = {
      initialize: jest.fn(),
      activeWorkspacePath: null,
      registerSessionForWorkspace: jest.fn(),
      unregisterSession: jest.fn(),
      findTabBySessionIdAcrossWorkspaces: jest.fn().mockReturnValue(null),
      getStorageKeyForWorkspace: jest.fn().mockReturnValue(STORAGE_KEY),
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
          useValue: { confirm: jest.fn() },
        },
        { provide: TabWorkspacePartitionService, useValue: partition },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
      ],
    });
    service = TestBed.inject(TabManagerService);
    setItem = jest.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    setItem.mockRestore();
    jest.useRealTimers();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function readStored(): {
    version: number;
    activeTabId: string | null;
    tabs: Array<Record<string, unknown>>;
  } {
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    return JSON.parse(raw as string);
  }

  it('writes no streamingState — the readers null it, so persisting it is waste', () => {
    const tabId = service.createTab('with-stream');
    service.setStreamingState(tabId, createEmptyStreamingState());
    jest.advanceTimersByTime(600);

    const stored = readStored();
    expect(stored.version).toBe(2);
    expect(stored.tabs).toHaveLength(1);
    expect(stored.tabs[0].streamingState).toBeNull();
    expect(stored.tabs[0].attachedBinding).toBeNull();
    // The serialized blob must not mention the live event model at all.
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('messageEventIds');
  });

  it('keeps each finalized message and its execution tree — nothing re-fetches them on restore', () => {
    const tabId = service.createTab('with-messages');
    service.setMessages(tabId, [makeMessage('m1'), makeMessage('m2')]);
    jest.advanceTimersByTime(600);

    const stored = readStored();
    const messages = stored.tabs[0].messages as ExecutionChatMessage[];
    expect(messages).toHaveLength(2);
    expect(messages[0].streamingState?.id).toBe('node-m1');
    expect(messages[1].streamingState?.id).toBe('node-m2');
  });

  it('skips the write when the persisted fields are unchanged', () => {
    const tabId = service.createTab('idle');
    jest.advanceTimersByTime(600);
    expect(setItem).toHaveBeenCalledTimes(1);

    // A streaming flush changes only `streamingState` + `lastActivityAt`, and
    // neither reaches storage — so this must not write again.
    for (let i = 0; i < 20; i++) {
      service.setStreamingState(tabId, createEmptyStreamingState());
      jest.advanceTimersByTime(600);
    }
    expect(setItem).toHaveBeenCalledTimes(1);

    // A real change writes again.
    service.setMessages(tabId, [makeMessage('m1')]);
    jest.advanceTimersByTime(600);
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('max wait fires under continuous updates that never leave a debounce gap', () => {
    const tabId = service.createTab('busy');
    jest.advanceTimersByTime(600);
    setItem.mockClear();

    // Every 100 ms — the trailing 500 ms debounce alone would reset forever.
    for (let i = 0; i < 60; i++) {
      service.setMessages(tabId, [makeMessage(`m${i}`)]);
      jest.advanceTimersByTime(100);
    }

    expect(setItem).toHaveBeenCalled();
    const elapsedWrites = setItem.mock.calls.filter(
      (call) => call[0] === STORAGE_KEY,
    );
    // 6 s of dense traffic at a 5 s ceiling: at least one forced write.
    expect(elapsedWrites.length).toBeGreaterThanOrEqual(1);
  });

  it('the trailing debounce still coalesces bursts into one write', () => {
    const tabId = service.createTab('burst');
    jest.advanceTimersByTime(600);
    setItem.mockClear();

    for (let i = 0; i < 5; i++) {
      service.setMessages(tabId, [makeMessage(`b${i}`)]);
      jest.advanceTimersByTime(50);
    }
    jest.advanceTimersByTime(600);

    expect(setItem).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Teardown flush (TASK_2026_335 / defect 2)
  //
  // `setTimeout` timers do not survive a document unload or an injector
  // destroy. Without a flush, finishing a turn and closing the panel inside
  // the 500 ms debounce — or inside the 5 s ceiling under a live stream —
  // silently dropped the last finalized assistant message and its execution
  // tree, and the resume path does not bring them back.
  // ==========================================================================

  describe('flush on teardown', () => {
    /** Queue a save and return the message that must survive. */
    function queuePendingSave(): string {
      const tabId = service.createTab('closing');
      jest.advanceTimersByTime(600);
      setItem.mockClear();

      service.setMessages(tabId, [makeMessage('last-reply')]);
      // Deliberately NOT advancing timers: this is the race — the panel is
      // closing while the trailing debounce is still pending.
      expect(setItem).not.toHaveBeenCalled();
      return tabId;
    }

    function storedMessageIds(): string[] {
      return (readStored().tabs[0].messages as ExecutionChatMessage[]).map(
        (m) => m.id,
      );
    }

    it('flushPendingSave() writes the pending save immediately', () => {
      queuePendingSave();

      service.flushPendingSave();

      expect(setItem).toHaveBeenCalledTimes(1);
      expect(storedMessageIds()).toEqual(['last-reply']);
    });

    it('flushPendingSave() is a no-op when nothing is pending', () => {
      service.createTab('idle');
      jest.advanceTimersByTime(600);
      setItem.mockClear();

      service.flushPendingSave();
      service.flushPendingSave();

      expect(setItem).not.toHaveBeenCalled();
    });

    it('pagehide flushes — the webview document being torn down', () => {
      queuePendingSave();

      window.dispatchEvent(new Event('pagehide'));

      expect(storedMessageIds()).toEqual(['last-reply']);
    });

    it('beforeunload flushes — Electron closing the renderer window', () => {
      queuePendingSave();

      window.dispatchEvent(new Event('beforeunload'));

      expect(storedMessageIds()).toEqual(['last-reply']);
    });

    it('the document going hidden flushes — a webview may be discarded next', () => {
      queuePendingSave();

      const original = Object.getOwnPropertyDescriptor(
        Document.prototype,
        'visibilityState',
      );
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        delete (document as unknown as Record<string, unknown>)[
          'visibilityState'
        ];
        if (original) {
          Object.defineProperty(
            Document.prototype,
            'visibilityState',
            original,
          );
        }
      }

      expect(storedMessageIds()).toEqual(['last-reply']);
    });

    it('injector destroy flushes — the Electron/canvas shell tearing the app down', () => {
      queuePendingSave();

      TestBed.resetTestingModule();

      expect(storedMessageIds()).toEqual(['last-reply']);
    });

    it('several teardown signals in one unload still write only once', () => {
      queuePendingSave();

      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('beforeunload'));
      service.flushPendingSave();

      expect(setItem).toHaveBeenCalledTimes(1);
    });
  });
});
