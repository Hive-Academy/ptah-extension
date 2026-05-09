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
        payload: {
          workspaceInfo: {
            path: FOLDER,
            name: 'my-repo',
            type: 'workspace',
          },
        },
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
        payload: { workspaceInfo: null },
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
