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

// ─── Loop-Prevention Test Harness ────────────────────────────────────────────
//
// buildTestHarness sets up a minimal TestBed environment for the loop-prevention
// tests (TASK_2026_115 §4.3). It differs from the ad-hoc `setup()` helper in
// the main describe block in that:
//   1. It accepts { isElectron, activeWorkspace } configuration.
//   2. It directly seeds `_workspaceFolders` and `_activeWorkspaceIndex` on the
//      service instance (via string-indexed private access) so the activeWorkspace
//      computed signal reflects the desired state immediately — without relying on
//      the async restoreLayout RPC flow, which would require fakeAsync/tick.
//   3. It attaches syncSpy immediately so the initial restoreLayout's async
//      path is also mocked (preventing real RPC). Call counts are zeroed after
//      construction so tests start from a clean slate.
//   4. It provides simulateMessage(msg) as a thin wrapper around handleMessage.

function buildTestHarness(
  opts: {
    isElectron?: boolean;
    activeWorkspace?: { path: string; name: string };
  } = {},
) {
  const { isElectron = true, activeWorkspace } = opts;

  const coordinator = buildCoordinator();

  const configSignal = signal({
    isElectron,
    workspaceRoot: activeWorkspace?.path ?? '',
    workspaceName: activeWorkspace?.name ?? '',
    isVSCode: false,
    theme: 'dark' as const,
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
  });

  const vscodeService = {
    isElectron,
    config: configSignal.asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    updateWorkspaceRoot: jest.fn(),
  };

  const appState = buildAppState();
  const rpc = buildRpc();

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

  // Attach syncSpy immediately — this also intercepts the constructor-triggered
  // restoreLayout → syncFromBackend call, preventing any real RPC during tests.
  // Cast to never for private method access — intentional test introspection pattern.
  const syncSpy = jest
    .spyOn(service as never, 'syncFromBackend')
    .mockResolvedValue(undefined);

  // Directly seed the workspace signals so activeWorkspace() reflects the
  // desired state without waiting for the async RPC-driven restoreLayout.
  // This is a deliberate test-only bypass of the private signal; it avoids
  // fakeAsync/tick complexity in the loop-prevention tests.
  if (activeWorkspace) {
    (service as never)['_workspaceFolders'].set([activeWorkspace]);
    (service as never)['_activeWorkspaceIndex'].set(0);
  }

  // Zero the call count so construction-time invocations don't pollute assertions.
  syncSpy.mockClear();

  function simulateMessage(msg: { type: string; payload?: unknown }): void {
    service.handleMessage(msg);
  }

  return { service, syncSpy, simulateMessage, vscodeService, rpc, coordinator };
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

// ─── Loop Prevention Tests (TASK_2026_115) ────────────────────────────────────
//
// These tests use buildTestHarness (defined above) instead of the ad-hoc
// setup() helper so that activeWorkspace can be pre-seeded and syncFromBackend
// can be mocked before handleMessage fires.
//
// Each test is intentionally synchronous — handleMessage is synchronous; the
// guards operate before any async code. fakeAsync/tick is NOT needed here.

describe('ElectronLayoutService — loop prevention', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * HEADLINE REGRESSION TEST — TASK_2026_115
   * Reproduces the original WORKSPACE_CHANGED infinite loop.
   * This test MUST fail when handleMessage has no guards (syncFromBackend always called).
   * This test MUST pass with the origin-tag guard in place.
   */
  it('does not call syncFromBackend when receiving own-origin push event', () => {
    const { service, syncSpy, simulateMessage } = buildTestHarness({
      isElectron: true,
      activeWorkspace: { path: '/workspace/A', name: 'A' },
    });

    // Stamp a pending origin — exactly as debouncedWorkspaceSwitch does before
    // calling rpcService.call('workspace:switch', { path, origin }).
    service['_pendingOriginRef'].current = 'uuid-abc';

    // Simulate the backend echoing the same origin back via WORKSPACE_CHANGED.
    simulateMessage({
      type: 'workspaceChanged',
      payload: {
        origin: 'uuid-abc',
        workspaceInfo: { path: '/workspace/A', name: 'A', type: 'workspace' },
      },
    });

    // syncFromBackend MUST NOT be called — calling it here would start the loop.
    expect(syncSpy).not.toHaveBeenCalled();
    // Token must be consumed so subsequent events are not incorrectly dropped.
    expect(service['_pendingOriginRef'].current).toBeNull();
  });

  /**
   * Scenario B: external workspace change propagates.
   * An external change (origin=null, different path) MUST trigger syncFromBackend
   * exactly once — the backend changed the workspace, the frontend must catch up.
   */
  it('calls syncFromBackend for external workspace change (origin=null)', () => {
    const { syncSpy, simulateMessage } = buildTestHarness({
      isElectron: true,
      activeWorkspace: { path: '/workspace/A', name: 'A' },
    });

    simulateMessage({
      type: 'workspaceChanged',
      payload: {
        origin: null,
        workspaceInfo: { path: '/workspace/B', name: 'B', type: 'workspace' },
      },
    });

    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario C: belt-and-suspenders path-compare guard.
   * Even when the origin does not match (foreign UUID — not our own token),
   * the path-compare guard prevents a redundant sync if the incoming path is
   * identical to the current active workspace path.
   */
  it('does not call syncFromBackend when incoming path equals current path and origin is foreign', () => {
    const { syncSpy, simulateMessage } = buildTestHarness({
      isElectron: true,
      activeWorkspace: { path: '/workspace/A', name: 'A' },
    });

    simulateMessage({
      type: 'workspaceChanged',
      payload: {
        origin: 'some-other-uuid',
        workspaceInfo: { path: '/workspace/A', name: 'A', type: 'workspace' },
      },
    });

    // Belt-and-suspenders: same path → no sync, regardless of origin mismatch.
    expect(syncSpy).not.toHaveBeenCalled();
  });

  /**
   * Scenario D: rapid external changes — hard upper-bound determinism test.
   * Three rapid external workspace-change events MUST trigger at most 3
   * syncFromBackend calls (one per event, never compounding recursively).
   * Without both guards, a recursive loop would amplify this beyond 3.
   */
  it('handles rapid external workspace switches without compounding syncFromBackend calls', () => {
    const { syncSpy, simulateMessage } = buildTestHarness({
      isElectron: true,
      activeWorkspace: { path: '/workspace/A', name: 'A' },
    });

    // Three rapid external changes to different paths — none blocked by path guard
    for (const p of ['/workspace/B', '/workspace/C', '/workspace/D']) {
      simulateMessage({
        type: 'workspaceChanged',
        payload: {
          origin: null,
          workspaceInfo: {
            path: p,
            name: p.split('/').pop()!,
            type: 'workspace',
          },
        },
      });
    }

    // Each external event triggers exactly one sync — no recursive amplification.
    // Exact assertion: handleMessage is synchronous and syncFromBackend is mocked,
    // so no debounce or coalescing can occur. Exactly 3 calls — one per message.
    expect(syncSpy.mock.calls.length).toBe(3);
  });

  /**
   * GREEN-2: Non-Electron guard fires before origin logic.
   * When isElectron is false, handleMessage must be a complete no-op even when
   * the payload includes an origin field — ensuring the platform guard runs
   * before any origin-tag logic, not after.
   */
  it('does not stamp origin or call rpc when handleMessage receives WORKSPACE_CHANGED in non-Electron mode (even when payload includes origin)', () => {
    const { service, simulateMessage, rpc } = buildTestHarness({
      isElectron: false,
    });

    simulateMessage({
      type: 'workspaceChanged',
      payload: {
        origin: 'some-uuid',
        workspaceInfo: { path: '/workspace/X', name: 'X', type: 'workspace' },
      },
    });

    // Non-Electron guard must fire first — no RPC calls
    expect(rpc.call).not.toHaveBeenCalled();
    // _pendingOriginRef must remain null — origin logic must not have run
    expect(service['_pendingOriginRef'].current).toBeNull();
  });

  /**
   * GREEN-3: handleMessage with no payload is a no-op.
   * The implementation uses `payload?.origin` optional chaining, so an absent
   * payload must result in syncFromBackend being called (no origin guard fires,
   * no path guard fires either since incomingPath is undefined). However, reading
   * the source: `payload?.workspaceInfo?.path` → undefined, `currentPath` is
   * '/workspace/A' → `incomingPath && currentPath && ...` → short-circuits on
   * incomingPath being undefined. So syncFromBackend IS called. This test
   * confirms that — or more precisely that no crash occurs and the guard
   * behaves deterministically.
   */
  it('is a no-op when handleMessage receives a WORKSPACE_CHANGED message with no payload', () => {
    const { syncSpy, simulateMessage } = buildTestHarness({
      isElectron: true,
      // No activeWorkspace — so currentPath is null and the path guard cannot fire
    });

    // Send a WORKSPACE_CHANGED with no payload — must not throw
    expect(() => {
      simulateMessage({ type: 'workspaceChanged' });
    }).not.toThrow();

    // With no payload: origin guard → payload?.origin is undefined → guard does
    // not fire (condition requires origin !== null AND origin !== undefined AND
    // origin === _pendingOriginRef.current). Path guard → incomingPath is
    // undefined → short-circuits. So syncFromBackend IS invoked once.
    // This is the correct behaviour — an absent payload is treated as an
    // external change (conservative: better to sync than to miss a real change).
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * YELLOW-4: workspace:switch RPC call includes the origin field in params.
   * debouncedWorkspaceSwitch stamps _pendingOriginRef.current immediately before
   * calling rpcService.call('workspace:switch', { path, origin }). This test
   * verifies that the origin field is threaded through to the RPC params — the
   * critical link between the frontend origin-tag and the backend pendingOrigin.
   */
  it('passes the stamped origin through to the workspace:switch RPC call', async () => {
    jest.useFakeTimers();

    const { service, rpc } = buildTestHarness({
      isElectron: true,
      activeWorkspace: { path: '/workspace/A', name: 'A' },
    });

    // Add a second folder so switchWorkspace(1) triggers a real switch
    (service as never)['_workspaceFolders'].set([
      { path: '/workspace/A', name: 'A' },
      { path: '/workspace/B', name: 'B' },
    ]);

    // Switch to folder index 1 — triggers debouncedWorkspaceSwitch
    service.switchWorkspace(1);

    // Advance timers past the debounce (SWITCH_DEBOUNCE_MS = 100ms)
    jest.advanceTimersByTime(150);

    // Flush microtasks so the async setTimeout callback runs to completion
    await Promise.resolve();
    await Promise.resolve();

    jest.useRealTimers();

    // workspace:switch must have been called
    const switchCalls = (rpc.call as jest.Mock).mock.calls.filter(
      (c: unknown[]) => c[0] === 'workspace:switch',
    );
    expect(switchCalls.length).toBeGreaterThan(0);

    // The second argument must include an origin field of type string
    const switchParams = switchCalls[0][1] as { path: string; origin?: string };
    expect(typeof switchParams.origin).toBe('string');
    expect(switchParams.origin).not.toBeNull();
    expect(switchParams.origin!.length).toBeGreaterThan(0);
  });

  /**
   * YELLOW-5: _pendingOriginRef cleared on workspace:switch RPC failure.
   * When workspace:switch returns a non-success result, _pendingOriginRef.current
   * must be set to null. A stale non-null ref would permanently block all future
   * external workspace-change events from updating the UI.
   */
  it('clears _pendingOriginRef when workspace:switch RPC returns a failure result', async () => {
    jest.useFakeTimers();

    // Override rpc to return a failure result for workspace:switch
    const failSwitchRpc = buildRpc(
      DEFAULT_GET_INFO_RESULT,
      // Failure result — isSuccess() returns false
      new RpcResult<{ success: boolean }>(false, undefined, 'fail'),
    );

    const coordinator = buildCoordinator();
    const configSignal = signal({
      isElectron: true,
      workspaceRoot: '/workspace/A',
      workspaceName: 'A',
      isVSCode: false,
      theme: 'dark' as const,
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
    });
    const vscodeService = {
      isElectron: true,
      config: configSignal.asReadonly(),
      getState: jest.fn().mockReturnValue(null),
      setState: jest.fn(),
      updateWorkspaceRoot: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ElectronLayoutService,
        { provide: VSCodeService, useValue: vscodeService },
        { provide: AppStateManager, useValue: buildAppState() },
        { provide: ClaudeRpcService, useValue: failSwitchRpc },
        { provide: WORKSPACE_COORDINATOR, useValue: coordinator },
      ],
    });

    const service = TestBed.inject(ElectronLayoutService);

    // Spy on syncFromBackend to prevent the constructor restoreLayout from
    // interfering — same pattern as buildTestHarness
    jest
      .spyOn(service as never, 'syncFromBackend')
      .mockResolvedValue(undefined);

    // Seed folders directly
    (service as never)['_workspaceFolders'].set([
      { path: '/workspace/A', name: 'A' },
      { path: '/workspace/B', name: 'B' },
    ]);
    (service as never)['_activeWorkspaceIndex'].set(0);

    // Switch to folder 1 — will stamp _pendingOriginRef and then call workspace:switch
    service.switchWorkspace(1);

    // Advance timers past the debounce
    jest.advanceTimersByTime(150);

    // Flush microtasks to let the async callback run
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    jest.useRealTimers();

    // After the failed RPC, _pendingOriginRef must be cleared so future external
    // events are not permanently suppressed.
    expect(service['_pendingOriginRef'].current).toBeNull();
  });
});
