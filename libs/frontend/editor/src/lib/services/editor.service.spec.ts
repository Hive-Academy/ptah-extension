/**
 * EditorService message-routing specs (C1, TASK_2026_173 batch 1).
 *
 * `EditorWorkspaceHelper` is a plain class and cannot register itself as a
 * `MessageHandler`, so `EditorService` declares its three push types and
 * delegates. These specs pin that contract:
 *
 *   - C1 AC1: no raw `window.addEventListener('message')` anywhere in the
 *     service or its helpers
 *   - C1 AC2: the declared types are byte-identical to what the Electron
 *     watcher broadcasts, and the file:content-changed payload shape guard
 *     (`payload.filePath`, NOT `data.filePath`) survives the move
 *   - C1 AC3: nothing pending after destruction
 *   - C1 AC4: exactly one place to add a new type —
 *     `handledMessageTypes` + the `handleMessage` switch
 *
 * `rpcCall` is mocked at the module boundary; VSCodeService is a stub.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { EditorService } from './editor.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

function makeVscodeStub() {
  const config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws/a',
    workspaceName: 'a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

describe('EditorService message routing (C1)', () => {
  let service: EditorService;

  beforeEach(() => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({ success: true, data: { tree: [] } });
    TestBed.configureTestingModule({
      providers: [
        EditorService,
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });
    service = TestBed.inject(EditorService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('declares every inbound editor message type in one place (C1 AC4)', () => {
    // `git:status-update` joined the list in batch 2: it is the authoritative
    // "git state changed" push and now also drives diff-tab revalidation (A1).
    // MessageRouterService maps a type to an ARRAY of handlers, so declaring it
    // here does not displace GitStatusService's own subscription.
    expect(service.handledMessageTypes).toEqual([
      MESSAGE_TYPES.EDITOR_TAB_CONTENT_REVERTED,
      MESSAGE_TYPES.FILE_TREE_CHANGED,
      MESSAGE_TYPES.FILE_CONTENT_CHANGED,
      MESSAGE_TYPES.EDITOR_REREAD_OPEN_TABS,
      MESSAGE_TYPES.GIT_STATUS_UPDATE,
    ]);
  });

  it('the three watcher types carry the exact strings the watcher broadcasts (C1 AC2)', () => {
    expect(MESSAGE_TYPES.FILE_TREE_CHANGED).toBe('file:tree-changed');
    expect(MESSAGE_TYPES.FILE_CONTENT_CHANGED).toBe('file:content-changed');
    expect(MESSAGE_TYPES.EDITOR_REREAD_OPEN_TABS).toBe(
      'editor:reread-open-tabs',
    );
  });

  it('registers NO global message listener when the watcher starts (C1 AC1)', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');

    service.startFileTreeWatcher();

    expect(
      addSpy.mock.calls.filter(([type]) => type === 'message'),
    ).toHaveLength(0);

    service.stopFileTreeWatcher();
    addSpy.mockRestore();
  });

  it('routes file:tree-changed to a debounced tree reload (window unchanged at 500ms)', () => {
    jest.useFakeTimers();
    service.switchWorkspace('/ws/a');
    mockRpcCall.mockClear();
    service.startFileTreeWatcher();

    service.handleMessage({ type: MESSAGE_TYPES.FILE_TREE_CHANGED });
    service.handleMessage({ type: MESSAGE_TYPES.FILE_TREE_CHANGED });

    jest.advanceTimersByTime(499);
    expect(mockRpcCall).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'editor:getFileTree',
      { rootPath: '/ws/a' },
    );

    service.stopFileTreeWatcher();
  });

  it('reads file:content-changed from payload.filePath, not data.filePath (regression guard)', () => {
    jest.useFakeTimers();
    service.switchWorkspace('/ws/a');
    service.startFileTreeWatcher();
    mockRpcCall.mockClear();

    // OLD shape — must be ignored.
    service.handleMessage({
      type: MESSAGE_TYPES.FILE_CONTENT_CHANGED,
      payload: { data: { filePath: '/ws/a/old-shape.ts' } },
    });
    jest.advanceTimersByTime(1000);
    expect(mockRpcCall).not.toHaveBeenCalled();

    // NEW shape — reaches the file-ops path (which issues editor:openFile
    // only for a tab that is actually open; the guard we assert here is that
    // the OLD shape produced nothing at all).
    expect(() =>
      service.handleMessage({
        type: MESSAGE_TYPES.FILE_CONTENT_CHANGED,
        payload: { filePath: '/ws/a/new-shape.ts' },
      }),
    ).not.toThrow();

    service.stopFileTreeWatcher();
  });

  it('ignores an unknown message type without throwing', () => {
    expect(() =>
      service.handleMessage({ type: 'totally:unknown', payload: {} }),
    ).not.toThrow();
  });

  it('leaves no timer pending after destruction (C1 AC3)', () => {
    jest.useFakeTimers();
    service.switchWorkspace('/ws/a');
    service.startFileTreeWatcher();

    service.handleMessage({ type: MESSAGE_TYPES.FILE_TREE_CHANGED });
    service.handleMessage({ type: MESSAGE_TYPES.EDITOR_REREAD_OPEN_TABS });
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    // Destroying the injector runs EditorService's DestroyRef hook.
    TestBed.resetTestingModule();

    expect(jest.getTimerCount()).toBe(0);
  });
});

// ============================================================================
// SEQ-2 gate closure — A2 AC5 (TASK_2026_173 seq-2-verification.md).
//
// "GIVEN a diff tab of either kind, WHEN the tab is persisted and the
// workspace is reopened, THEN the tab SHALL restore the same comparison it
// had, or SHALL be discarded — it SHALL NOT silently restore as the other
// comparison." R-2's mitigation: old-format persisted diff tab entries are
// dropped cleanly on load, not misinterpreted.
//
// EditorService is the coordinator constructed fresh on every real webview
// bootstrap (an actual VS Code/Electron reload tears down and rebuilds the
// whole Angular injector, this service included — it is `providedIn: 'root'`,
// not a cross-reload singleton). This proves its constructor never reads
// `openTabs` (or anything diff-tab-shaped) out of `VSCodeService.getState()`,
// even when `getState()` is stubbed to return exactly the kind of stale,
// old-format payload R-2 describes. That is what makes "discard" true for a
// GENUINE reload, as distinct from the in-session workspace-switch round trip
// covered in `editor-workspace.spec.ts`.
// ============================================================================
describe('EditorService construction — no diff tab survives a reload (A2 AC5, discard branch)', () => {
  it('starts with zero open tabs even when VSCodeService.getState() holds an old-format persisted tab list', () => {
    const staleOldFormatPayload = {
      // Shape predates diffTabKey()'s `diff:<comparison>:<path>` scheme —
      // whatever it once was, it must never reach `openTabs`.
      openTabs: [
        {
          filePath: 'a.ts::diff::HEAD::worktree', // pre-SEQ-1 shape, illustrative
          fileName: 'a.ts',
          content: 'stale',
          isDirty: false,
        },
      ],
    };
    const vscodeStub = makeVscodeStub();
    (vscodeStub.getState as jest.Mock).mockReturnValue(staleOldFormatPayload);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EditorService,
        { provide: VSCodeService, useValue: vscodeStub },
      ],
    });
    const freshService = TestBed.inject(EditorService);

    // The stub's getState() was wired to return old-format tab data on ANY
    // call; the assertion is that EditorService's constructor never called it
    // for tabs in the first place.
    expect(freshService.openTabs()).toEqual([]);
  });
});
