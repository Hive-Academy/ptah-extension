/**
 * End-to-end renderer delivery spec for the `git:status-update` push message
 * (C1 AC1/AC2/AC5, TASK_2026_173 batch 1).
 *
 * Retargeted from `editor-message-routing.spec.ts` (TASK_2026_385 Batch 4.1):
 * that spec covered both the editor's file-tree push messages and git's
 * status push through the same `MESSAGE_HANDLERS` composition root. The
 * editor half is gone along with `@ptah-extension/editor` — `EditorService`
 * no longer exists, and three of the four editor message types it handled
 * (`EDITOR_TAB_CONTENT_REVERTED`, `FILE_TREE_CHANGED`, `EDITOR_REREAD_OPEN_TABS`)
 * were deleted from `MESSAGE_TYPES` entirely in Batch 4.4 — they have no
 * surface left to reach. `FILE_CONTENT_CHANGED` survives: `DiffTabsService`
 * still revalidates on it. The git half survives unchanged.
 *
 * This is the composition-root half of C1: it wires the REAL
 * `MessageRouterService` to the REAL `GitStatusService` through the same
 * `MESSAGE_HANDLERS` multi-provider registration `app.config.ts` uses, then
 * dispatches a genuine `window` `MessageEvent` carrying the exact wire string
 * the Electron git watcher broadcasts
 * (`apps/ptah-electron/src/services/git-watcher.service.ts`).
 *
 * It proves three things the unit specs cannot:
 *   1. The `useExisting: GitStatusService` provider does not explode at
 *      router-construction time — `MessageRouterService` reads
 *      `handledMessageTypes` in its constructor, so the service is
 *      instantiated eagerly (risk A-8).
 *   2. A raw window message with the watcher's literal string reaches the
 *      handler — i.e. the shared constants really are byte-identical to the
 *      wire format (C1 AC2).
 *   3. Delivery is host-agnostic: the router listens to `window` messages
 *      identically under VS Code, Electron and the CLI's webview host, so
 *      this path is the same code in all three (C1 AC5, renderer side).
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_HANDLERS,
  MessageRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { GitStatusService } from '@ptah-extension/git-ui';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/**
 * `rpcCall` is mocked at the module boundary so the delivery assertions can
 * observe the RPC each handler issues without a real webview bridge. Every
 * other export of `@ptah-extension/core` — `MessageRouterService` above in
 * particular — stays real.
 */
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

/**
 * The literal `git-watcher.service.ts` broadcasts. Hard-coded on purpose:
 * if the shared constant is ever edited, this spec fails rather than
 * silently agreeing with the new value.
 */
const WIRE = {
  gitStatusUpdate: 'git:status-update',
  fileContentChanged: 'file:content-changed',
} as const;

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

function dispatch(type: string, payload?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type, payload } }),
  );
}

describe('git status push-message delivery through MessageRouterService (C1)', () => {
  let router: MessageRouterService;
  let gitStatus: GitStatusService;

  beforeEach(() => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({ success: true, data: { tree: [] } });
    TestBed.configureTestingModule({
      providers: [
        { provide: VSCodeService, useValue: makeVscodeStub() },
        MessageRouterService,
        // Mirrors app.config.ts.
        {
          provide: MESSAGE_HANDLERS,
          useExisting: GitStatusService,
          multi: true,
        },
      ],
    });

    gitStatus = TestBed.inject(GitStatusService);
    // Constructing the router builds the handler map, which reads
    // handledMessageTypes off the registered service (risk A-8).
    router = TestBed.inject(MessageRouterService);
  });

  afterEach(() => {
    gitStatus.stopListening();
    TestBed.resetTestingModule();
  });

  it('constructs the router with the git handler registered (A-8)', () => {
    expect(router).toBeTruthy();
    expect(gitStatus.handledMessageTypes).toContain(WIRE.gitStatusUpdate);
  });

  it('the shared constants hold the exact strings the watcher broadcasts (C1 AC2)', () => {
    expect(MESSAGE_TYPES.GIT_STATUS_UPDATE).toBe(WIRE.gitStatusUpdate);
    expect(MESSAGE_TYPES.FILE_CONTENT_CHANGED).toBe(WIRE.fileContentChanged);
  });

  it('delivers a raw git:status-update window message to GitStatusService (C1 AC5)', () => {
    gitStatus.switchWorkspace('/ws/a');
    gitStatus.startListening();

    dispatch(WIRE.gitStatusUpdate, {
      branch: { branch: 'delivered', upstream: null, ahead: 0, behind: 0 },
      files: [],
      isGitRepo: true,
      workspaceRoot: '/ws/a',
    });

    expect(gitStatus.branchName()).toBe('delivered');
  });

  it('drops every message once the service has stopped listening (C1 AC3)', () => {
    jest.useFakeTimers();
    try {
      gitStatus.switchWorkspace('/ws/a');
      gitStatus.startListening();

      gitStatus.stopListening();
      mockRpcCall.mockClear();

      dispatch(WIRE.gitStatusUpdate, {
        branch: { branch: 'after-stop', upstream: null, ahead: 0, behind: 0 },
        files: [],
        isGitRepo: true,
        workspaceRoot: '/ws/a',
      });
      jest.advanceTimersByTime(5000);

      expect(gitStatus.branchName()).not.toBe('after-stop');
      expect(mockRpcCall).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
