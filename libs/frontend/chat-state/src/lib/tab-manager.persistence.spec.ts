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
      findTabByIdAcrossWorkspaces: jest
        .fn()
        .mockImplementation(
          (tabId: string, tabs: ReadonlyArray<{ id: string }>) => {
            const tab = tabs.find((t) => t.id === tabId);
            return tab ? { tab, workspacePath: '/ws' } : null;
          },
        ),
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

  it('never persists lastTurnStateRevision / lastTurnStateSessionId — the backend counter dies with the process (TASK_2026_360)', () => {
    const tabId = service.createTab('turn-state');
    service.applyTurnState(
      tabId,
      {
        phase: 'idle',
        revision: 9,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: 'completed',
        timestamp: 1,
      },
      'sess-turn-state',
    );
    jest.advanceTimersByTime(600);

    expect(service.tabs()[0].lastTurnStateRevision).toBe(9);
    expect(service.tabs()[0].lastTurnStateSessionId).toBe('sess-turn-state');
    const stored = readStored();
    expect('lastTurnStateRevision' in stored.tabs[0]).toBe(false);
    expect('lastTurnStateSessionId' in stored.tabs[0]).toBe(false);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toContain('lastTurnStateRevision');
    expect(raw).not.toContain('lastTurnStateSessionId');
    expect(raw).not.toContain('sess-turn-state');
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

  // ==========================================================================
  // Quota back-off (TASK_2026_437 C17, AC-12, INV-10)
  //
  // A quota failure repeats on every save, and every attempt first
  // serializes every tab's transcript on the main thread. After a failure the
  // next saves skip that work until `failedAt + min(5 s × 2^attempt, 5 min)`,
  // unless a tab closed or teardown flushes. `jest.useFakeTimers()` fakes
  // `Date.now()` too, so advancing timers is the clock.
  // ==========================================================================

  describe('quota back-off', () => {
    let warn: jest.SpyInstance;
    let stringify: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      stringify = jest.spyOn(JSON, 'stringify');
    });

    afterEach(() => {
      warn.mockRestore();
      stringify.mockRestore();
    });

    function failWrites(): void {
      setItem.mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    }

    /** `JSON.stringify` calls that serialized the tab-state envelope. */
    function envelopeSerializations(): number {
      return stringify.mock.calls.filter(([value]) => {
        const v = value as { version?: unknown; tabs?: unknown } | null;
        return v !== null && typeof v === 'object' && 'tabs' in v;
      }).length;
    }

    function saveWarnings(): string[] {
      return warn.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes('Failed to save tab state'));
    }

    /** Create a tab, fail its first write, and reset the counters. */
    function failFirstWrite(tabName = 'quota'): string {
      failWrites();
      const tabId = service.createTab(tabName);
      jest.advanceTimersByTime(600);
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(saveWarnings()).toHaveLength(1);
      setItem.mockClear();
      stringify.mockClear();
      return tabId;
    }

    it('does not serialize again inside the window, and warns once for the step', () => {
      const tabId = failFirstWrite();

      // 5 s window from the failure at ~600 ms; saves land at ~1.2 s … ~4.2 s.
      for (let i = 0; i < 5; i++) {
        service.setMessages(tabId, [makeMessage(`in-window-${i}`)]);
        jest.advanceTimersByTime(600);
      }

      expect(envelopeSerializations()).toBe(0);
      expect(setItem).not.toHaveBeenCalled();
      expect(saveWarnings()).toHaveLength(1);
    });

    it('retries after the window and doubles the next one', () => {
      const tabId = failFirstWrite();

      jest.advanceTimersByTime(5_000);
      service.setMessages(tabId, [makeMessage('after-5s')]);
      jest.advanceTimersByTime(600);
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(saveWarnings()).toHaveLength(2);
      expect(saveWarnings()[1]).toContain('retrying in 10 s');

      // 7 s later is inside the 10 s window of attempt 1.
      setItem.mockClear();
      stringify.mockClear();
      jest.advanceTimersByTime(6_400);
      service.setMessages(tabId, [makeMessage('inside-10s')]);
      jest.advanceTimersByTime(600);
      expect(envelopeSerializations()).toBe(0);
      expect(setItem).not.toHaveBeenCalled();

      // Past it, the save is attempted again.
      jest.advanceTimersByTime(3_000);
      service.setMessages(tabId, [makeMessage('after-10s')]);
      jest.advanceTimersByTime(600);
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(saveWarnings()).toHaveLength(3);
      expect(saveWarnings()[2]).toContain('retrying in 20 s');
    });

    it('retries at once when the tab set shrank', () => {
      failWrites();
      service.createTab('keep');
      const doomed = service.createTab('close-me');
      jest.advanceTimersByTime(600);
      setItem.mockClear();
      stringify.mockClear();

      service.forceCloseTab(doomed);
      jest.advanceTimersByTime(600);

      expect(envelopeSerializations()).toBe(1);
      expect(setItem).toHaveBeenCalledTimes(1);
    });

    it('teardown flush still attempts inside the window, once per unload', () => {
      const tabId = failFirstWrite();

      // The debounce fires inside the window and is skipped — nothing is
      // pending by timer any more, but storage is still behind memory.
      service.setMessages(tabId, [makeMessage('skipped-by-backoff')]);
      jest.advanceTimersByTime(600);
      expect(setItem).not.toHaveBeenCalled();

      // Storage has room again by the time the panel closes.
      setItem.mockRestore();
      setItem = jest.spyOn(Storage.prototype, 'setItem');

      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('beforeunload'));
      service.flushPendingSave();

      expect(setItem).toHaveBeenCalledTimes(1);
      expect(
        (readStored().tabs[0]['messages'] as ExecutionChatMessage[]).map(
          (m) => m.id,
        ),
      ).toEqual(['skipped-by-backoff']);
    });

    it('teardown flush that fails again does not retry on the next signal', () => {
      const tabId = failFirstWrite();
      service.setMessages(tabId, [makeMessage('still-failing')]);

      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('beforeunload'));

      expect(setItem).toHaveBeenCalledTimes(1);
      expect(saveWarnings()).toHaveLength(2);
    });

    it('a successful write resets the back-off to the first step', () => {
      const tabId = failFirstWrite();

      // Storage recovers; past the window the write lands.
      setItem.mockRestore();
      setItem = jest.spyOn(Storage.prototype, 'setItem');
      jest.advanceTimersByTime(5_000);
      service.setMessages(tabId, [makeMessage('recovered')]);
      jest.advanceTimersByTime(600);
      expect(setItem).toHaveBeenCalledTimes(1);

      // It fails again: attempt 0, a 5 s window, not 10 s.
      failWrites();
      service.setMessages(tabId, [makeMessage('fails-again')]);
      jest.advanceTimersByTime(600);
      expect(saveWarnings()).toHaveLength(2);
      expect(saveWarnings()[1]).toContain('retrying in 5 s');

      setItem.mockClear();
      jest.advanceTimersByTime(5_000);
      service.setMessages(tabId, [makeMessage('after-5s-again')]);
      jest.advanceTimersByTime(600);
      expect(setItem).toHaveBeenCalledTimes(1);
    });
  });
});
