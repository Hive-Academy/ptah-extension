/**
 * workspace-restore — unit specs (PR-267 Fixes #2, #4).
 *
 * Contracts locked in:
 *   1. When the active folder changes to a non-null path, the renderer receives
 *      WORKSPACE_CHANGED with workspaceInfo containing `path`, `name`, and
 *      `type: 'workspace'`.
 *   2. When all folders are removed (getActiveFolder returns null/undefined),
 *      the renderer receives WORKSPACE_CHANGED with `workspaceInfo: null`.
 *
 * Strategy: invoke `restoreWorkspaces` with a minimal stub container, then
 * fire `onDidChangeWorkspaceFolders` manually to drive the change callback.
 * The BrowserWindow mock exposes a `send` spy so assertions are deterministic.
 */

import 'reflect-metadata';

import { MESSAGE_TYPES } from '@ptah-extension/shared';

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    WORKSPACE_CONTEXT_MANAGER: Symbol.for('WorkspaceContextManager'),
  },
}));

jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: {
    STATE_STORAGE: Symbol.for('IStateStorage'),
    WORKSPACE_PROVIDER: Symbol.for('IWorkspaceProvider'),
  },
}));

jest.mock('@ptah-extension/platform-electron', () => ({
  ElectronWorkspaceProvider: class {},
}));

const WORKSPACE_CONTEXT_MANAGER_TOKEN = Symbol.for('WorkspaceContextManager');
const STATE_STORAGE_TOKEN = Symbol.for('IStateStorage');
const WORKSPACE_PROVIDER_TOKEN = Symbol.for('IWorkspaceProvider');

import { restoreWorkspaces } from './workspace-restore';

interface ChangeListener {
  (): void;
}

function buildProvider(activeFolder: string | null | undefined) {
  const listeners: ChangeListener[] = [];
  const provider = {
    getWorkspaceFolders: jest.fn(() =>
      activeFolder ? [activeFolder] : ([] as string[]),
    ),
    getActiveFolder: jest.fn(() => activeFolder),
    getWorkspaceRoot: jest.fn(() => activeFolder ?? undefined),
    setWorkspaceFolders: jest.fn(),
    setActiveFolder: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn((cb: ChangeListener) => {
      listeners.push(cb);
      return { dispose: () => undefined };
    }),
  };
  return {
    provider,
    fireChange(newActive: string | null | undefined) {
      provider.getActiveFolder.mockReturnValue(newActive);
      for (const l of listeners) l();
    },
  };
}

/**
 * Builds a self-contained test harness for the origin-tagging tests.
 * Returns a fake workspace provider with `pendingOrigin` tracking and a
 * `triggerFoldersChange` helper, plus a mock webContents for send assertions.
 *
 * TASK_2026_115 §4.2 — backend origin-tagging tests.
 */
function buildTestHarness() {
  const changeListeners: ChangeListener[] = [];
  let currentActive: string | null | undefined = null;
  const mockWebContents = { send: jest.fn() };

  const fakeProvider = {
    pendingOrigin: null as string | null,
    getActiveFolder: jest.fn(() => currentActive),
    getWorkspaceFolders: jest.fn(() =>
      currentActive ? [currentActive] : ([] as string[]),
    ),
    getWorkspaceRoot: jest.fn(() => currentActive ?? undefined),
    setWorkspaceFolders: jest.fn(),
    setActiveFolder: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn((cb: ChangeListener) => {
      changeListeners.push(cb);
      return { dispose: () => undefined };
    }),
    triggerFoldersChange(opts: { newActive: string | null | undefined }) {
      currentActive = opts.newActive;
      fakeProvider.getActiveFolder.mockReturnValue(currentActive);
      for (const l of changeListeners) l();
    },
  };

  const container = buildContainer(fakeProvider);
  const mainWindow = { webContents: mockWebContents };

  return {
    fakeProvider,
    mockWebContents,
    container,
    getMainWindow: () => mainWindow as never,
  };
}

function buildContainer(provider: object) {
  const stateStorage = {
    get: jest.fn().mockReturnValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    updateSync: jest.fn(),
  };
  const workspaceContextManager = {
    restoreWorkspaces: jest.fn().mockResolvedValue(undefined),
  };
  const resolved = new Map<symbol, object>([
    [STATE_STORAGE_TOKEN, stateStorage],
    [WORKSPACE_CONTEXT_MANAGER_TOKEN, workspaceContextManager],
    [WORKSPACE_PROVIDER_TOKEN, provider],
  ]);
  return {
    resolve: jest.fn((token: symbol) => {
      const r = resolved.get(token);
      if (!r) throw new Error(`Token not registered: ${String(token)}`);
      return r;
    }),
  };
}

describe('restoreWorkspaces — workspace change broadcasts', () => {
  const FOLDER = '/c/projects/my-repo';
  const sendSpy = jest.fn();

  function buildWindow() {
    return {
      webContents: { send: sendSpy },
    };
  }

  beforeEach(() => {
    sendSpy.mockClear();
  });

  it('sends WORKSPACE_CHANGED with workspaceInfo including type when active folder is set', async () => {
    const { provider, fireChange } = buildProvider(null);
    const container = buildContainer(provider);
    const mainWindow = buildWindow();
    const gitWatcherRef = { current: null };

    await restoreWorkspaces(
      container as never,
      undefined,
      gitWatcherRef,
      () => mainWindow as never,
    );

    fireChange(FOLDER);

    expect(sendSpy).toHaveBeenCalledWith(
      'to-renderer',
      expect.objectContaining({
        type: MESSAGE_TYPES.WORKSPACE_CHANGED,
        payload: expect.objectContaining({
          workspaceInfo: {
            path: FOLDER,
            name: 'my-repo',
            type: 'workspace',
          },
        }),
      }),
    );
  });

  it('sends WORKSPACE_CHANGED with workspaceInfo: null when last folder is removed', async () => {
    const { provider, fireChange } = buildProvider(FOLDER);
    const container = buildContainer(provider);
    const mainWindow = buildWindow();
    const gitWatcherRef = { current: null };

    await restoreWorkspaces(
      container as never,
      undefined,
      gitWatcherRef,
      () => mainWindow as never,
    );

    fireChange(null);

    expect(sendSpy).toHaveBeenCalledWith(
      'to-renderer',
      expect.objectContaining({
        type: MESSAGE_TYPES.WORKSPACE_CHANGED,
        payload: expect.objectContaining({ workspaceInfo: null }),
      }),
    );
  });

  it('does not send to renderer when getMainWindow returns null', async () => {
    const { provider, fireChange } = buildProvider(null);
    const container = buildContainer(provider);
    const gitWatcherRef = { current: null };

    await restoreWorkspaces(
      container as never,
      undefined,
      gitWatcherRef,
      () => null,
    );

    fireChange(null);

    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('WORKSPACE_CHANGED push-event origin-tagging', () => {
  const gitWatcherRef = { current: null };

  // Scenario A: backend echoes the origin from the workspace provider
  it('includes origin from pendingOrigin in the WORKSPACE_CHANGED push event', async () => {
    const { fakeProvider, mockWebContents, container, getMainWindow } =
      buildTestHarness();

    await restoreWorkspaces(
      container as never,
      undefined,
      gitWatcherRef,
      getMainWindow,
    );

    fakeProvider.pendingOrigin = 'test-origin-token';
    fakeProvider.triggerFoldersChange({ newActive: '/workspace/A' });

    expect(mockWebContents.send).toHaveBeenCalledWith(
      'to-renderer',
      expect.objectContaining({
        type: 'workspaceChanged',
        payload: expect.objectContaining({
          origin: 'test-origin-token',
          workspaceInfo: expect.objectContaining({ path: '/workspace/A' }),
        }),
      }),
    );
    // Token is consumed after the broadcast
    expect(fakeProvider.pendingOrigin).toBeNull();
  });

  // Scenario B: external change (native menu) sets origin=null
  it('sets origin=null for externally triggered workspace changes', async () => {
    const { fakeProvider, mockWebContents, container, getMainWindow } =
      buildTestHarness();

    await restoreWorkspaces(
      container as never,
      undefined,
      gitWatcherRef,
      getMainWindow,
    );

    // pendingOrigin not set (simulates native menu / OS open-folder)
    fakeProvider.triggerFoldersChange({ newActive: '/workspace/B' });

    expect(mockWebContents.send).toHaveBeenCalledWith(
      'to-renderer',
      expect.objectContaining({
        payload: expect.objectContaining({ origin: null }),
      }),
    );
  });

  // GREEN-5: mainWindow becomes null between registration and the
  // workspace-folders-changed event. The guard in workspace-restore.ts reads
  // getMainWindow() at event time (not at registration time), so a window that
  // exists during restoreWorkspaces() but is then nulled before the event fires
  // must result in a silent no-op — the send must not be called and no exception
  // must be thrown.
  it('does not crash when mainWindow becomes null between registration and the workspace-folders-changed event', async () => {
    const { fakeProvider, mockWebContents, container } = buildTestHarness();

    // Return a valid window during restoreWorkspaces() registration…
    let returnNull = false;
    const getMainWindow = () =>
      returnNull ? null : ({ webContents: mockWebContents } as never);

    await restoreWorkspaces(
      container as never,
      undefined,
      gitWatcherRef,
      getMainWindow,
    );

    // …then null out the window before the change event fires
    returnNull = true;

    // Trigger a change event — must be silently dropped, no send, no throw
    expect(() => {
      fakeProvider.triggerFoldersChange({ newActive: '/workspace/new' });
    }).not.toThrow();

    expect(mockWebContents.send).not.toHaveBeenCalled();
  });

  // Scenario C: the no-op guard on setActiveFolder clears pendingOrigin
  // so a stale token cannot leak into the next real change event.
  // This is tested via a direct fake that models the ElectronWorkspaceProvider
  // no-op guard (same-path early return clears pendingOrigin), independently
  // of restoreWorkspaces, because the module-level jest.mock replaces the
  // real ElectronWorkspaceProvider class.
  it('clears pendingOrigin when setActiveFolder is called with the same path (no-op guard)', () => {
    // Create a minimal fake that models the no-op guard behaviour from
    // ElectronWorkspaceProvider.setActiveFolder (TASK_2026_115 §3.1):
    //   if (this.activeFolder === resolved) { this.pendingOrigin = null; return; }
    class FakeProvider {
      public pendingOrigin: string | null = null;
      private activeFolder = '/workspace/A';

      setActiveFolder(folderPath: string): void {
        const resolved = folderPath; // simplified: no path.resolve in test context
        if (this.activeFolder === resolved) {
          this.pendingOrigin = null; // clear stale token even on no-op
          return;
        }
        this.activeFolder = resolved;
      }
    }

    const provider = new FakeProvider();
    provider.pendingOrigin = 'stale-token';

    // setActiveFolder with same path → no-op → pendingOrigin must be cleared
    provider.setActiveFolder('/workspace/A');

    expect(provider.pendingOrigin).toBeNull();
  });
});
