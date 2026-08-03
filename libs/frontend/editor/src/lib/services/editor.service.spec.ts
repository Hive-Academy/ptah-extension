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

  it('declares all four inbound editor message types (C1 AC4)', () => {
    expect(service.handledMessageTypes).toEqual([
      MESSAGE_TYPES.EDITOR_TAB_CONTENT_REVERTED,
      MESSAGE_TYPES.FILE_TREE_CHANGED,
      MESSAGE_TYPES.FILE_CONTENT_CHANGED,
      MESSAGE_TYPES.EDITOR_REREAD_OPEN_TABS,
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
