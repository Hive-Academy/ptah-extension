import 'reflect-metadata';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ELECTRON_CODEX_BOUND_TOKENS } from './expected-resolvable';
import { REVIEW_CORE_TOKENS, REVIEW_CONTEXT_TOKENS, REVIEW_LANE_TOKENS } from '@ptah-extension/review-core';
import { REVIEW_GITHUB_TOKENS } from '@ptah-extension/review-github';
/**
 * Electron surface composition — lazy push host across a real registration
 * order, through the real production window getter (TASK_2026_538 Batch 14,
 * Task 14.4; plan assumption A1, Batch 2 review SERIOUS finding).
 *
 * Production order (`phase-2-libraries.ts:173`, `phase-3-storage.ts:134`,
 * `bootstrap.ts:339-357`): workspace-intelligence, THEN
 * `registerVsCodeLmToolsServices` (which registers
 * `VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE` and the lazy
 * `SURFACE_PUSH_HOST`), and only THEN `TOKENS.WEBVIEW_MANAGER` — after
 * `IpcBridge.initialize()`. `register.ts:111-121` resolves the host lazily
 * (`container.isRegistered(TOKENS.WEBVIEW_MANAGER, true)` on every push) for
 * exactly this reason: a naive constructor-time capture would see no host at
 * all. This spec reproduces that exact order and proves the lazy resolve
 * makes it a non-issue (assumption A1).
 *
 * It also proves the Batch 2 SERIOUS finding stays fixed end to end: a
 * destroyed-but-still-referenced `BrowserWindow` must read as `no-surface`,
 * never `failed`. Built through the real `createMainWindowHandleGetter`
 * (Task 2.4, `bootstrap.ts:131-149`), not a hand-rolled `{ webContents: {
 * send } }` stub — that was the shape that hid the destroyed-window race
 * before the fix.
 */

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import {
  TOKENS,
  registerVsCodeCorePlatformAgnostic,
  RpcHandler,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  KernelSessionDriverLock,
  NullSessionDriverLock,
  type ISessionDriverLock,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import { registerPlatformElectronServices } from '@ptah-extension/platform-electron';
import {
  registerVsCodeLmToolsServices,
  VSCODE_LM_TOOLS_TOKENS,
  SurfaceStateService,
  buildSurfaceNamespace,
  handleSurfaceToolCall,
  SURFACE_UPDATE_TOOL_NAME,
  SURFACE_GET_STATE_TOOL_NAME,
  ARTIFACT_NOTIFICATION_TOKEN,
} from '@ptah-extension/vscode-lm-tools';
import type { ArtifactPublishedNotification } from '@ptah-extension/shared/mcp-apps-contracts';
import { resolveRpcHandlerPlan } from '@ptah-extension/rpc-handlers';
import type { SurfaceEnvelope } from '@ptah-extension/shared';
import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';

import { createMainWindowHandleGetter } from '../activation/bootstrap';
import { IpcBridge } from '../ipc/ipc-bridge';
import { ElectronWebviewManagerAdapter } from '../ipc/webview-manager-adapter';
import { createElectronRpcHostProfile } from '../rpc-host-profile';
import { registerArtifactNotification } from './phase-3-storage';

describe('Electron session driver lock composition', () => {
  it('binds the platform lock for the Electron host', async () => {
    const c = rootContainer.createChildContainer();
    const dataPath = mkdtempSync(join(tmpdir(), 'ptah-electron-lock-'));
    // The output channel opens its log file asynchronously and has no error
    // listener, so deleting its folder right after dispose() crashes the Jest
    // worker with ENOENT. Give it its own temp folder that the test keeps.
    const logsPath = mkdtempSync(join(tmpdir(), 'ptah-electron-lock-logs-'));
    try {
      registerPlatformElectronServices(c, {
        appPath: dataPath,
        userDataPath: dataPath,
        logsPath,
        safeStorage: {
          isEncryptionAvailable: () => false,
          encryptString: (value: string) => Buffer.from(value),
          decryptString: (value: Buffer) => value.toString(),
        },
        dialog: {} as never,
        getWindow: () => null,
      });
      const lock = c.resolve<ISessionDriverLock>(
        PLATFORM_TOKENS.SESSION_DRIVER_LOCK,
      );
      expect(lock).toBeInstanceOf(
        process.platform === 'darwin'
          ? NullSessionDriverLock
          : KernelSessionDriverLock,
      );
      expect(c.resolve(PLATFORM_TOKENS.SESSION_DRIVER_LOCK)).toBe(lock);
      await lock.dispose();
    } finally {
      c.resolve<IOutputChannel>(PLATFORM_TOKENS.OUTPUT_CHANNEL).dispose();
      rmSync(dataPath, { recursive: true, force: true });
    }
  });
});

describe('Electron artifact notification composition', () => {
  const notification: ArtifactPublishedNotification = {
    id: 'abcdefghijklmnop',
    title: 'Dashboard',
    revision: 1,
    sessionId: 'tab-1',
    viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
    createdAt: '2026-10-20T12:00:00.000Z',
  };

  it('resolves the renderer lazily and sends metadata through the surface transport', async () => {
    const c = rootContainer.createChildContainer();
    registerArtifactNotification(c);
    const notify = c.resolve<
      (
        type: 'artifact:published',
        payload: ArtifactPublishedNotification,
      ) => Promise<void>
    >(ARTIFACT_NOTIFICATION_TOKEN);
    await notify('artifact:published', notification);

    const win = makeWindow();
    registerWorkspaceStateStorageStub(c);
    c.register(TOKENS.RPC_HANDLER, { useValue: {} });
    const bridge = new IpcBridge(
      c,
      createMainWindowHandleGetter(() => win),
      [],
    );
    c.register(TOKENS.WEBVIEW_MANAGER, {
      useValue: new ElectronWebviewManagerAdapter(bridge),
    });
    await notify('artifact:published', notification);
    expect(win.webContents.send).toHaveBeenCalledWith('to-renderer', {
      type: 'artifact:published',
      payload: notification,
    });
  });
});

/**
 * Resolve and `register()` the real `SurfaceRpcHandlers` — found through the
 * PUBLIC `resolveRpcHandlerPlan(realHostProfile)`, filtered to the one
 * `key: 'surface'` step (code-logic-review-batch-14.md, "smallest practical
 * follow-up"), not through a name import (`SurfaceRpcHandlers` is not
 * exported from `@ptah-extension/rpc-handlers`'s public barrel).
 */
function registerSurfaceRpc(
  container: DependencyContainer,
  logger: Logger,
): void {
  const profile = createElectronRpcHostProfile(container, logger);
  const step = resolveRpcHandlerPlan(profile).find((s) => s.key === 'surface');
  if (!step) {
    throw new Error(
      "resolveRpcHandlerPlan(createElectronRpcHostProfile(...)) has no 'surface' step — has the manifest or the Electron profile changed?",
    );
  }
  container.resolve(step.ctor).register();
}

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
}

/** IpcBridge resolves this at construction (`ipc-bridge.ts:130-132`); this spec never uses it. */
function registerWorkspaceStateStorageStub(c: DependencyContainer): void {
  c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: {
      get: jest.fn(() => undefined),
      update: jest.fn(async () => undefined),
      keys: jest.fn(() => []),
    },
  });
}

function makeWindow() {
  return {
    isDestroyed: jest.fn(() => false),
    webContents: {
      id: 1,
      send: jest.fn<void, [string, ...unknown[]]>(),
      isDestroyed: jest.fn(() => false),
    },
  };
}

function surface(id: string): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: SURFACE_CATALOG_VERSION,
    surfaceId: id,
    title: { text: id },
    components: [{ kind: 'stat', id: 'count', value: 1 }],
  };
}

/** A surface with one text input, for the UI-write/agent-read round trip below. */
function formSurface(id: string): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: SURFACE_CATALOG_VERSION,
    surfaceId: id,
    title: { text: id },
    components: [
      { kind: 'text', id: 'name', label: 'Name', path: 'form.name' },
    ],
    dataModel: { form: { name: 'Ada' } },
  };
}

describe('Electron surface composition — lazy push host and destroyed-window delivery (A1, Batch 2 finding)', () => {
  it('resolves the store before WEBVIEW_MANAGER exists, then delivers once the real window getter reports live', async () => {
    const logger = makeLogger();
    const c: DependencyContainer = rootContainer.createChildContainer();
    c.register(TOKENS.LOGGER, { useValue: logger });
    registerVsCodeCorePlatformAgnostic(c, logger, {
      includeLicensingAndAuth: false,
    });
    c.register(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, { useValue: {} });
    registerWorkspaceStateStorageStub(c);

    // Registered BEFORE WEBVIEW_MANAGER exists — the production order.
    registerVsCodeLmToolsServices(c, logger);
    const state = c.resolve<SurfaceStateService>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    );

    // A create attempted before any host is registered: the lazy provider
    // must not throw, and must report no-surface rather than failed.
    const early = state.applyAgentUpdate(
      'tab-1',
      { operation: 'create', surface: surface('early') },
      'call-early',
    );
    expect(early.status).toBe('applied');
    if (early.status !== 'applied') return;
    await expect(early.delivery).resolves.toEqual({ status: 'no-surface' });

    // WEBVIEW_MANAGER registered afterward, through the REAL window getter —
    // the same construction bootstrap.ts uses.
    const win = makeWindow();
    const bridge = new IpcBridge(
      c,
      createMainWindowHandleGetter(() => win),
      [],
    );
    const adapter = new ElectronWebviewManagerAdapter(bridge);
    c.register(TOKENS.WEBVIEW_MANAGER, { useValue: adapter });

    const live = state.applyAgentUpdate(
      'tab-1',
      { operation: 'create', surface: surface('live') },
      'call-live',
    );
    expect(live.status).toBe('applied');
    if (live.status !== 'applied') return;
    await expect(live.delivery).resolves.toEqual({
      status: 'delivered',
      surfaces: 1,
    });
    expect(win.webContents.send).toHaveBeenCalledWith(
      'to-renderer',
      expect.objectContaining({ type: 'surface:updated' }),
    );
  });

  it('reports no-surface, never failed, for a destroyed-but-referenced window (Batch 2 SERIOUS finding)', async () => {
    const logger = makeLogger();
    const c: DependencyContainer = rootContainer.createChildContainer();
    c.register(TOKENS.LOGGER, { useValue: logger });
    registerVsCodeCorePlatformAgnostic(c, logger, {
      includeLicensingAndAuth: false,
    });
    c.register(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, { useValue: {} });
    registerWorkspaceStateStorageStub(c);
    registerVsCodeLmToolsServices(c, logger);
    const state = c.resolve<SurfaceStateService>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    );

    const win = makeWindow();
    const bridge = new IpcBridge(
      c,
      createMainWindowHandleGetter(() => win),
      [],
    );
    const adapter = new ElectronWebviewManagerAdapter(bridge);
    c.register(TOKENS.WEBVIEW_MANAGER, { useValue: adapter });

    // Prove delivery works while the window is live.
    const firstResult = state.applyAgentUpdate(
      'tab-1',
      { operation: 'create', surface: surface('one') },
      'call-1',
    );
    expect(firstResult.status).toBe('applied');
    if (firstResult.status !== 'applied') return;
    await expect(firstResult.delivery).resolves.toEqual({
      status: 'delivered',
      surfaces: 1,
    });
    win.webContents.send.mockClear();

    // The native window is destroyed but the reference the getter closes
    // over is still there — exactly the shape the pre-fix `GetWindowFn`
    // could not distinguish from "live" (Batch 2 review, SERIOUS finding).
    win.isDestroyed.mockReturnValue(true);

    const second = state.applyAgentUpdate(
      'tab-1',
      { operation: 'create', surface: surface('two') },
      'call-2',
    );
    expect(second.status).toBe('applied');
    if (second.status !== 'applied') return;
    await expect(second.delivery).resolves.toEqual({ status: 'no-surface' });
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

/**
 * F1 (code-logic-review-batch-14.md, SERIOUS): real two-consumer round trip,
 * not two calls into the same directly-held service. The agent side goes
 * through `handleSurfaceToolCall` + `buildSurfaceNamespace` — tool-call /
 * namespace level, the code `protocol-dispatcher.ts:1680` calls into, NOT the
 * full JSON-RPC/MCP dispatcher (no `AsyncLocalStorage` caller-scope
 * resolution here). The UI side goes through the real
 * `RpcHandler.handleMessage`, the full RPC wire entry point, with
 * `SurfaceRpcHandlers` resolved via the public `resolveRpcHandlerPlan`
 * seam (see `registerSurfaceRpc` above).
 */
describe('Electron surface composition — real two-consumer round trip (Req 7.4, F1)', () => {
  function composeWithoutRenderer(): {
    container: DependencyContainer;
    logger: Logger;
    state: SurfaceStateService;
  } {
    const logger = makeLogger();
    const c: DependencyContainer = rootContainer.createChildContainer();
    c.register(TOKENS.LOGGER, { useValue: logger });
    registerVsCodeCorePlatformAgnostic(c, logger, {
      includeLicensingAndAuth: false,
    });
    c.register(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, { useValue: {} });
    registerWorkspaceStateStorageStub(c);
    registerVsCodeLmToolsServices(c, logger);
    const state = c.resolve<SurfaceStateService>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    );
    return { container: c, logger, state };
  }

  it('a real agent tool call is visible through the real RPC handler', async () => {
    const { container: c, logger, state } = composeWithoutRenderer();
    const namespace = buildSurfaceNamespace({ service: state, logger });
    registerSurfaceRpc(c, logger);
    const rpc = c.resolve<RpcHandler>(TOKENS.RPC_HANDLER);

    const reply = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: surface('profile') },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-create' },
      logger,
    );
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('Surface profile committed at revision 1');

    const read = await rpc.handleMessage({
      method: 'surface:read',
      params: { routingId: 'tab-1', surfaceId: 'profile' },
      correlationId: 'c-read-1',
    });
    expect(read.success).toBe(true);
    const data = read.data as {
      status: string;
      routingId: string;
      surfaces: Array<{ surfaceId: string; revision: number }>;
    };
    expect(data.status).toBe('found');
    expect(data.routingId).toBe('tab-1');
    expect(data.surfaces[0]?.surfaceId).toBe('profile');
    expect(data.surfaces[0]?.revision).toBe(1);
  });

  it('a real UI write through RpcHandler.handleMessage is visible through a real agent tool call', async () => {
    const { container: c, logger, state } = composeWithoutRenderer();
    const namespace = buildSurfaceNamespace({ service: state, logger });
    registerSurfaceRpc(c, logger);
    const rpc = c.resolve<RpcHandler>(TOKENS.RPC_HANDLER);

    await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: formSurface('profile') },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-create' },
      logger,
    );

    const operationId = `op-${Date.now()}-electroncomposetest1`;
    const change = await rpc.handleMessage({
      method: 'surface:change',
      params: {
        routingId: 'tab-1',
        surfaceId: 'profile',
        revision: 1,
        operationId,
        componentId: 'name',
        value: 'Grace',
      },
      correlationId: 'c-change-1',
    });
    expect(change.success).toBe(true);
    expect(change.data).toEqual({
      status: 'applied',
      operationId,
      revision: 2,
    });

    const reply = await handleSurfaceToolCall(
      SURFACE_GET_STATE_TOOL_NAME,
      { surfaceId: 'profile' },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-read' },
      logger,
    );
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('"revision":2');
    expect(reply.text).toContain('"name":"Grace"');
  });
});

describe('Electron Codex bootstrap composition', () => {
  it('binds each guarded port literally before adapter initialization', () => {
    const composition = readFileSync(
      join(__dirname, 'codex-runtime-composition.ts'),
      'utf8',
    );
    for (const name of [
      'SESSION_RUNTIME_IDENTITY_LOOKUP',
      'CODEX_CHAT_ADAPTER_PORTS',
      'RUNTIME_ADMISSION_PORT',
      'RUNTIME_HOST_CAPABILITIES',
      'NATIVE_SESSION_CONTROLS',
      'LEGACY_SESSION_CONTROL_PORTS',
      'NATIVE_SESSION_HISTORY_PORT',
    ])
      expect(composition).toMatch(
        new RegExp(
          String.raw`container\.register(?:<[\w.]+>)?\(\s*SDK_TOKENS\.${name},\s*\{\s*useValue:`,
        ),
      );
    expect(ELECTRON_CODEX_BOUND_TOKENS).toHaveLength(8);
    const bootstrap = readFileSync(
      join(__dirname, '../activation/bootstrap.ts'),
      'utf8',
    );
    expect(bootstrap).toContain(
      'container.register(CODEX_RUNTIME_TOKENS.SelectionSnapshot,',
    );
    const bound = bootstrap.indexOf('await bindElectronCodexChat(container,');
    expect(bound).toBeGreaterThan(
      bootstrap.indexOf('await workspaceStateStorage.whenReady()'),
    );
    expect(bound).toBeGreaterThan(
      bootstrap.indexOf('container.register(TOKENS.WEBVIEW_MANAGER,'),
    );
    expect(bound).toBeLessThan(
      bootstrap.indexOf('void startAgentAdapterInitialization(container)'),
    );
    expect(bootstrap).toContain('isPackaged: app.isPackaged');
  });
});

describe('Electron review composition', () => {
  it('binds a live publication guard before resolving the publication port', () => {
    const phase = readFileSync(join(__dirname, 'phase-2-libraries.ts'), 'utf8');
    expect(REVIEW_GITHUB_TOKENS.PUBLICATION_GUARD).toBeDefined();
    expect(phase).toContain('container.register<ReviewPublicationGuard>(REVIEW_GITHUB_TOKENS.PUBLICATION_GUARD,');
    expect(phase.indexOf('container.register<ReviewPublicationGuard>')).toBeLessThan(
      phase.indexOf('container.register(REVIEW_CORE_TOKENS.GITHUB'));
  });
  it('binds each review port and starts its worker before cron', () => {
    const phase = readFileSync(join(__dirname, 'phase-2-libraries.ts'), 'utf8');
    for (const token of [
      'GITHUB', 'SECRET_PRESENCE', 'ENVIRONMENT', 'ARTIFACT_FILES',
    ] as const) {
      expect(REVIEW_CORE_TOKENS[token]).toBeDefined();
      expect(phase).toContain(`container.register(REVIEW_CORE_TOKENS.${token},`);
    }
    for (const token of ['COMMAND_RUNNER', 'FILES'] as const) {
      expect(REVIEW_CONTEXT_TOKENS[token]).toBeDefined();
      expect(phase).toContain(`container.register(REVIEW_CONTEXT_TOKENS.${token},`);
    }
    for (const token of ['GATEWAY', 'FILES'] as const) {
      expect(REVIEW_LANE_TOKENS[token]).toBeDefined();
      expect(phase).toContain(`container.register(REVIEW_LANE_TOKENS.${token},`);
    }
    const boot = readFileSync(join(__dirname, '../activation/boot-heavy-services.ts'), 'utf8');
    expect(boot.indexOf('startReviewWorker(container, signal, logger)')).toBeLessThan(
      boot.indexOf('await startThothCron(container, thoth,'),
    );
  });
});
