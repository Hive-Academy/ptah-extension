/**
 * ElectronLayoutService — unit specs for the first-launch path and
 * WORKSPACE_CHANGED re-sync.
 *
 * First launch: On first launch state is null (no LAYOUT_STATE_KEY in webview
 * state). The old code had `if (!state) return` which skipped workspace:getInfo
 * entirely. The fix removes that early-return so workspace:getInfo +
 * coordinateWorkspaceSwitch always run.
 *
 * WORKSPACE_CHANGED: ElectronLayoutService now implements MessageHandler and
 * listens for MESSAGE_TYPES.WORKSPACE_CHANGED. On receipt it calls
 * workspace:getInfo and re-syncs the folder list + coordinates the workspace
 * switch. Crucially, workspace:switch is called BEFORE coordinateWorkspaceSwitch
 * so the backend session context is set for the correct workspace before
 * TabManager loads sessions.
 *
 * Strategy: Use TestBed with stub providers for VSCodeService, AppStateManager,
 * ClaudeRpcService, and WORKSPACE_COORDINATOR. Drive the service through its
 * constructor (which calls restoreLayout) and via handleMessage.
 */

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { ElectronLayoutService } from './electron-layout.service';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { WORKSPACE_COORDINATOR } from '../tokens/workspace-coordinator.token';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rpcSuccess<T>(data: T): RpcResult<T> {
  return new RpcResult<T>(true, data, undefined, undefined);
}

/** Build a mock WorkspaceCoordinator whose methods are jest spies. */
function buildCoordinator() {
  return {
    switchWorkspace: jest.fn(),
    removeWorkspaceState: jest.fn(),
    getStreamingSessionIds: jest.fn().mockReturnValue([]),
    confirm: jest.fn().mockResolvedValue(true),
  };
}

/** Build a mock VSCodeService that pretends to be Electron. */
function buildVscodeService(storedState: unknown = null) {
  const configSignal = signal({
    isElectron: true,
    workspaceRoot: '',
    workspaceName: '',
    isVSCode: false,
    theme: 'dark' as const,
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
  });
  return {
    isElectron: true,
    config: configSignal.asReadonly(),
    getState: jest.fn().mockReturnValue(storedState),
    setState: jest.fn(),
    updateWorkspaceRoot: jest.fn(),
  };
}

/** Build a mock AppStateManager. */
function buildAppState() {
  return {
    setWorkspaceInfo: jest.fn(),
  };
}

// ── Default RPC result constants ───────────────────────────────────────────────
// Defined at module level so every test gets a consistent baseline without
// rebuilding them inside buildRpc() defaults on each call.

const DEFAULT_GET_INFO_RESULT = rpcSuccess({
  folders: ['/projects/my-repo'],
  activeFolder: '/projects/my-repo',
  root: '/projects/my-repo',
  name: 'my-repo',
});

const DEFAULT_SWITCH_RESULT = rpcSuccess({ success: true });

/** Build a mock ClaudeRpcService with configurable getInfo + switch results. */
function buildRpc(
  getInfoResult: RpcResult<unknown> = DEFAULT_GET_INFO_RESULT,
  switchResult: RpcResult<unknown> = DEFAULT_SWITCH_RESULT,
) {
  return {
    call: jest.fn(async (method: string) => {
      if (method === 'workspace:getInfo') return getInfoResult;
      if (method === 'workspace:switch') return switchResult;
      return rpcSuccess(undefined);
    }),
    handledMessageTypes: [MESSAGE_TYPES.RPC_RESPONSE],
    handleMessage: jest.fn(),
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('ElectronLayoutService', () => {
  let coordinator: ReturnType<typeof buildCoordinator>;
  let vscodeService: ReturnType<typeof buildVscodeService>;
  let appState: ReturnType<typeof buildAppState>;
  let rpc: ReturnType<typeof buildRpc>;

  function createService(): ElectronLayoutService {
    return TestBed.inject(ElectronLayoutService);
  }

  function setup(
    storedState: unknown = null,
    rpcOverride?: ReturnType<typeof buildRpc>,
  ) {
    coordinator = buildCoordinator();
    vscodeService = buildVscodeService(storedState);
    appState = buildAppState();
    rpc = rpcOverride ?? buildRpc();

    TestBed.configureTestingModule({
      providers: [
        ElectronLayoutService,
        { provide: VSCodeService, useValue: vscodeService },
        { provide: AppStateManager, useValue: appState },
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: WORKSPACE_COORDINATOR, useValue: coordinator },
      ],
    });
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── First launch (null stored state) ──────────────────────────────────────

  describe('restoreLayout — first launch (no stored state)', () => {
    it('calls workspace:getInfo even when LAYOUT_STATE_KEY state is null', fakeAsync(() => {
      setup(null); // null = no stored state (first launch)
      createService();
      tick(0); // flush Promise microtasks

      expect(rpc.call).toHaveBeenCalledWith('workspace:getInfo', {});
    }));

    it('populates workspaceFolders signal from backend response', fakeAsync(() => {
      setup(null);
      const service = createService();
      tick(0);

      expect(service.workspaceFolders()).toEqual([
        { path: '/projects/my-repo', name: 'my-repo' },
      ]);
    }));

    it('calls workspace:switch for the active backend folder', fakeAsync(() => {
      setup(null);
      createService();
      tick(0);

      expect(rpc.call).toHaveBeenCalledWith('workspace:switch', {
        path: '/projects/my-repo',
      });
    }));

    it('calls workspace:switch before coordinator.switchWorkspace', fakeAsync(() => {
      setup(null);
      createService();
      tick(0);

      // workspace:switch must have been called before the coordinator fires
      const switchCallOrder = rpc.call.mock.invocationCallOrder.find(
        (_: unknown, i: number) =>
          rpc.call.mock.calls[i][0] === 'workspace:switch',
      );
      const coordinatorCallOrder =
        coordinator.switchWorkspace.mock.invocationCallOrder[0];
      expect(switchCallOrder).toBeDefined();
      expect(coordinatorCallOrder).toBeDefined();
      expect(switchCallOrder).toBeLessThan(coordinatorCallOrder);
    }));

    it('coordinates workspace switch via coordinator after switch RPC succeeds', fakeAsync(() => {
      setup(null);
      createService();
      tick(0);

      expect(coordinator.switchWorkspace).toHaveBeenCalledWith(
        '/projects/my-repo',
      );
    }));

    it('updates VSCodeService workspaceRoot', fakeAsync(() => {
      setup(null);
      createService();
      tick(0);

      expect(vscodeService.updateWorkspaceRoot).toHaveBeenCalledWith(
        '/projects/my-repo',
      );
    }));

    it('updates AppStateManager workspaceInfo', fakeAsync(() => {
      setup(null);
      createService();
      tick(0);

      expect(appState.setWorkspaceInfo).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/projects/my-repo' }),
      );
    }));

    it('does NOT call workspace:switch when getInfo returns empty folders', fakeAsync(() => {
      const emptyGetInfo = rpcSuccess({
        folders: [],
        activeFolder: undefined,
        root: undefined,
        name: 'No Workspace',
      });
      setup(null, buildRpc(emptyGetInfo));
      createService();
      tick(0);

      expect(rpc.call).toHaveBeenCalledWith('workspace:getInfo', {});
      expect(rpc.call).not.toHaveBeenCalledWith(
        'workspace:switch',
        expect.anything(),
      );
    }));
  });

  // ── Normal launch (stored state present) ─────────────────────────────────

  describe('restoreLayout — normal launch (stored state exists)', () => {
    const storedState = {
      sidebarWidth: 300,
      sidebarVisible: true,
      editorWidth: 600,
      editorVisible: true,
    };

    it('still calls workspace:getInfo when stored state exists', fakeAsync(() => {
      setup(storedState);
      createService();
      tick(0);

      expect(rpc.call).toHaveBeenCalledWith('workspace:getInfo', {});
    }));

    it('restores sidebar width from stored state', fakeAsync(() => {
      setup(storedState);
      const service = createService();
      tick(0);

      expect(service.workspaceSidebarWidth()).toBe(300);
    }));
  });

  // ── WORKSPACE_CHANGED re-sync ──────────────────────────────────────────────

  describe('handleMessage — WORKSPACE_CHANGED re-sync', () => {
    it('declares WORKSPACE_CHANGED in handledMessageTypes', () => {
      setup(null);
      const service = createService();

      expect(service.handledMessageTypes).toContain(
        MESSAGE_TYPES.WORKSPACE_CHANGED,
      );
    });

    it('calls workspace:getInfo when WORKSPACE_CHANGED is received', fakeAsync(() => {
      setup(null);
      const service = createService();
      tick(0); // flush initial restoreLayout

      // Reset call count after initial restore
      rpc.call.mockClear();

      service.handleMessage({ type: MESSAGE_TYPES.WORKSPACE_CHANGED });
      tick(0);

      expect(rpc.call).toHaveBeenCalledWith('workspace:getInfo', {});
    }));

    it('calls workspace:switch before coordinator.switchWorkspace on WORKSPACE_CHANGED', fakeAsync(() => {
      setup(null);
      const service = createService();
      tick(0);

      // Reset spies so we measure only the handleMessage-triggered calls
      rpc.call.mockClear();
      coordinator.switchWorkspace.mockClear();

      service.handleMessage({ type: MESSAGE_TYPES.WORKSPACE_CHANGED });
      tick(0);

      const switchCallOrder = rpc.call.mock.invocationCallOrder.find(
        (_: unknown, i: number) =>
          rpc.call.mock.calls[i][0] === 'workspace:switch',
      );
      const coordinatorCallOrder =
        coordinator.switchWorkspace.mock.invocationCallOrder[0];
      expect(switchCallOrder).toBeDefined();
      expect(coordinatorCallOrder).toBeDefined();
      expect(switchCallOrder).toBeLessThan(coordinatorCallOrder);
    }));

    it('re-syncs workspaceFolders after WORKSPACE_CHANGED', fakeAsync(() => {
      // Start with no backend workspaces
      const emptyGetInfo = rpcSuccess({ folders: [], activeFolder: undefined });
      setup(null, buildRpc(emptyGetInfo));
      const service = createService();
      tick(0);

      expect(service.workspaceFolders()).toEqual([]);

      // Now simulate the backend gaining a new folder
      rpc.call.mockImplementation(async (method: string) => {
        if (method === 'workspace:getInfo') {
          return rpcSuccess({
            folders: ['/projects/new-repo'],
            activeFolder: '/projects/new-repo',
          });
        }
        return rpcSuccess({ success: true });
      });

      service.handleMessage({ type: MESSAGE_TYPES.WORKSPACE_CHANGED });
      tick(0);

      expect(service.workspaceFolders()).toEqual([
        { path: '/projects/new-repo', name: 'new-repo' },
      ]);
    }));

    it('coordinates workspace switch after WORKSPACE_CHANGED', fakeAsync(() => {
      setup(null);
      const service = createService();
      tick(0);
      coordinator.switchWorkspace.mockClear();

      service.handleMessage({ type: MESSAGE_TYPES.WORKSPACE_CHANGED });
      tick(0);

      expect(coordinator.switchWorkspace).toHaveBeenCalledWith(
        '/projects/my-repo',
      );
    }));

    it('clears folder list when WORKSPACE_CHANGED has empty backend response', fakeAsync(() => {
      // Start with a folder in place
      setup(null);
      const service = createService();
      tick(0);
      expect(service.workspaceFolders().length).toBe(1);

      // Simulate backend clearing all folders
      rpc.call.mockImplementation(async (method: string) => {
        if (method === 'workspace:getInfo') {
          return rpcSuccess({ folders: [], activeFolder: undefined });
        }
        return rpcSuccess({ success: true });
      });

      service.handleMessage({ type: MESSAGE_TYPES.WORKSPACE_CHANGED });
      tick(0);

      expect(service.workspaceFolders()).toEqual([]);
      expect(vscodeService.updateWorkspaceRoot).toHaveBeenCalledWith('');
    }));

    it('WORKSPACE_CHANGED mid-restore: later sync wins, earlier restore is dropped', fakeAsync(() => {
      // Simulate the race: restoreLayout starts a getInfo that is slow.
      // WORKSPACE_CHANGED arrives before it resolves and bumps _switchId.
      // The restore's stale-id guard must bail; only the handleMessage sync
      // should commit state.
      let resolveFirstGetInfo!: (v: RpcResult<unknown>) => void;
      const firstGetInfoPromise = new Promise<RpcResult<unknown>>((res) => {
        resolveFirstGetInfo = res;
      });

      // First call (from restoreLayout) blocks; second call (from handleMessage) returns immediately
      let callCount = 0;
      rpc = buildRpc();
      rpc.call = jest.fn(async (method: string) => {
        if (method === 'workspace:getInfo') {
          callCount++;
          if (callCount === 1) {
            return firstGetInfoPromise; // blocks
          }
          // Second call returns new-repo immediately
          return rpcSuccess({
            folders: ['/projects/new-repo'],
            activeFolder: '/projects/new-repo',
          });
        }
        return DEFAULT_SWITCH_RESULT;
      });

      coordinator = buildCoordinator();
      vscodeService = buildVscodeService(null);
      appState = buildAppState();

      TestBed.configureTestingModule({
        providers: [
          ElectronLayoutService,
          { provide: VSCodeService, useValue: vscodeService },
          { provide: AppStateManager, useValue: appState },
          { provide: ClaudeRpcService, useValue: rpc },
          { provide: WORKSPACE_COORDINATOR, useValue: coordinator },
        ],
      });

      const service = TestBed.inject(ElectronLayoutService);
      // restoreLayout is now blocked on firstGetInfoPromise

      // Trigger handleMessage before the first getInfo resolves
      service.handleMessage({ type: MESSAGE_TYPES.WORKSPACE_CHANGED });
      tick(0); // handleMessage's getInfo resolves immediately → sets new-repo

      // Now resolve the original slow restoreLayout getInfo — it should be discarded
      resolveFirstGetInfo(
        rpcSuccess({
          folders: ['/projects/old-repo'],
          activeFolder: '/projects/old-repo',
        }),
      );
      tick(0);

      // The stale restore must not overwrite new-repo
      expect(service.workspaceFolders()).toEqual([
        { path: '/projects/new-repo', name: 'new-repo' },
      ]);
    }));

    it('is a no-op in non-Electron context', fakeAsync(() => {
      // Override vscodeService to non-Electron
      coordinator = buildCoordinator();
      appState = buildAppState();
      rpc = buildRpc();
      const nonElectronVscode = {
        ...buildVscodeService(null),
        isElectron: false,
      };

      TestBed.configureTestingModule({
        providers: [
          ElectronLayoutService,
          { provide: VSCodeService, useValue: nonElectronVscode },
          { provide: AppStateManager, useValue: appState },
          { provide: ClaudeRpcService, useValue: rpc },
          { provide: WORKSPACE_COORDINATOR, useValue: coordinator },
        ],
      });

      const service = TestBed.inject(ElectronLayoutService);
      tick(0);
      rpc.call.mockClear();

      service.handleMessage({ type: MESSAGE_TYPES.WORKSPACE_CHANGED });
      tick(0);

      // Should NOT call workspace:getInfo in non-Electron context
      expect(rpc.call).not.toHaveBeenCalled();
    }));
  });
});
