/**
 * code-execution-mcp.service â€” unit specs.
 *
 * `CodeExecutionMCP` is a thin orchestrator that wires HTTP server lifecycle
 * + MCP JSON-RPC dispatch together, delegating the actual work to helpers in
 * `./mcp-handlers`. The behaviours this spec locks down are:
 *
 *   1. MCP tool registration â€” constructor wiring:
 *        - builds `PtahAPI` eagerly via the injected `PtahAPIBuilder`,
 *        - resolves `WebviewManager` lazily only when registered in the
 *          container (present in VS Code, absent in Electron),
 *        - detects `hasIDECapabilities` via `container.isRegistered`.
 *
 *   2. Request dispatch â€” `start()` / `stop()`:
 *        - `start()` reads the configured port from `IWorkspaceProvider`,
 *          delegates to `startHttpServer`, stores the returned server + port
 *          for later shutdown, and wires `onMCPRequest` to `handleMCPRequest`
 *          with the correct context (api, permissions, webview, flags,
 *          disabled namespaces).
 *        - Calling `start()` twice returns the existing port without
 *          re-spinning the server.
 *        - `stop()` tears the server down via `stopHttpServer` and clears
 *          internal state.
 *        - `ensureRegisteredForSubagents()` is idempotent per (path, port):
 *          repeated calls against the same workspace write once, but a
 *          workspace switch MOVES the entry (section 5).
 *        - `setToolResultCallback` / `clearToolResultCallback` forward the
 *          callback to the dispatch context on the NEXT `start()`.
 *
 *   3. Error propagation â€” MCP request dispatch surfaces handler errors via
 *      the mocked `handleMCPRequest` without swallowing them, and `dispose()`
 *      surfaces `stop()` failures to the logger instead of silently eating
 *      them (the regression that motivated `disposeAsync`).
 *
 * External surfaces are mocked:
 *   - `./mcp-handlers` â€” HTTP + protocol helpers replaced with `jest.fn()`s.
 *   - `fs` â€” `.mcp.json` read/write isolated from disk.
 *   - `tsyringe.container` â€” registration checks controlled per-test via
 *     `registerInstance` / `clearInstances` so both VS Code and Electron
 *     wiring paths are exercised.
 */

import 'reflect-metadata';

// `@ptah-extension/vscode-core` transitively imports `vscode`, which blows up
// jest's parser in a node env. Stub the surface we touch (TOKENS) BEFORE any
// static import so the SUT sees the mocked module. Mirrors the pattern used
// by `output-validation.service.spec.ts` in agent-generation.
jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    PTAH_API_BUILDER: Symbol.for('PtahAPIBuilder'),
    LOGGER: Symbol.for('Logger'),
    PERMISSION_PROMPT_SERVICE: Symbol.for('PermissionPromptService'),
    WEBVIEW_MANAGER: Symbol.for('WebviewManager'),
  },
  Logger: class {},
  WebviewManager: class {},
  FileSystemManager: class {},
}));

// Replace ptah-api-builder.service at the module boundary â€” its real impl
// transitively loads workspace-intelligence + agent-sdk which in turn pull in
// the `vscode` ambient module.  We only need the IDE_CAPABILITIES_TOKEN
// Symbol (read by the SUT constructor) and the class as a type.
jest.mock('../ptah-api-builder.service', () => ({
  IDE_CAPABILITIES_TOKEN: Symbol.for('IDECapabilities'),
  PtahAPIBuilder: class PtahAPIBuilderStub {},
}));

// Replace the permission-prompt service for the same reason: it transitively
// pulls in webview/agent-sdk types we don't want to load here.
jest.mock('../../permission/permission-prompt.service', () => ({
  PermissionPromptService: class PermissionPromptServiceStub {},
}));

jest.mock('../mcp-core', () => ({
  handleMCPRequest: jest.fn(),
}));

jest.mock('./http-server.handler', () => ({
  startHttpServer: jest.fn(),
  stopHttpServer: jest.fn(),
  getConfiguredPort: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// `withMcpConfigLock` is the REAL thing in production â€” that is the whole of
// TASK_2026_318 â€” but it is `harness-sync`'s concern and it needs a real `fs`,
// which the mock above has replaced wholesale. So it is stubbed to run its task
// straight through, and the fact that the write happens INSIDE it is asserted
// separately via `mock.invocationCallOrder` (see "takes the harness-sync config
// lock" below). Never delete that assertion with this mock in place: without it
// the stub would let a future unlocked write pass unnoticed.
jest.mock('@ptah-extension/harness-sync', () => {
  // `FileLockTimeoutError` / `isFileLockTimeoutError` are the REAL ones. The
  // SUT branches on `isFileLockTimeoutError`, which is an `instanceof` check, so
  // a local look-alike would silently fall through to the generic I/O branch and
  // this spec would happily certify the wrong one.
  const actual = jest.requireActual<
    typeof import('@ptah-extension/harness-sync')
  >('@ptah-extension/harness-sync');
  return {
    withMcpConfigLock: jest.fn(
      async (_configPath: string, task: () => Promise<unknown>) => task(),
    ),
    FileLockTimeoutError: actual.FileLockTimeoutError,
    isFileLockTimeoutError: actual.isFileLockTimeoutError,
  };
});

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, WebviewManager } from '@ptah-extension/vscode-core';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

// Import AFTER jest.mock so the SUT receives the mocked module.
import { CodeExecutionMCP } from './http-mcp-server.service';
import { IDE_CAPABILITIES_TOKEN } from '../ptah-api-builder.service';
import type { PtahAPIBuilder } from '../ptah-api-builder.service';
import type { PermissionPromptService } from '../../permission/permission-prompt.service';
import type { PtahAPI, MCPRequest, MCPResponse } from '../types';
import { handleMCPRequest as handleMCPRequestMock } from '../mcp-core';
import {
  FileLockTimeoutError,
  withMcpConfigLock as withMcpConfigLockMock,
} from '@ptah-extension/harness-sync';
import {
  startHttpServer as startHttpServerMock,
  stopHttpServer as stopHttpServerMock,
  getConfiguredPort as getConfiguredPortMock,
} from './http-server.handler';

// ---- Local test helpers --------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function buildApi(): PtahAPI {
  return {
    help: jest.fn().mockResolvedValue('help'),
  } as unknown as PtahAPI;
}

function buildApiBuilder(api: PtahAPI): jest.Mocked<PtahAPIBuilder> {
  return {
    build: jest.fn(() => api),
    hasSymbolAndMemoryLayer: jest.fn(() => false),
  } as unknown as jest.Mocked<PtahAPIBuilder>;
}

function buildPermissionPromptService(): jest.Mocked<PermissionPromptService> {
  return {
    requestApproval: jest.fn(),
  } as unknown as jest.Mocked<PermissionPromptService>;
}

function buildWebviewManager(): jest.Mocked<WebviewManager> {
  return {
    postMessage: jest.fn(),
  } as unknown as jest.Mocked<WebviewManager>;
}

function makeFakeServer(): http.Server {
  // Protocol handlers never call anything on this object â€” it's opaque to
  // the SUT; stopHttpServer is mocked. A plain Record is enough.
  return {} as unknown as http.Server;
}

// Typed aliases for the mocked helpers â€” avoids `as any` at every callsite.
const startHttpServer = startHttpServerMock as jest.MockedFunction<
  typeof startHttpServerMock
>;
const stopHttpServer = stopHttpServerMock as jest.MockedFunction<
  typeof stopHttpServerMock
>;
const getConfiguredPort = getConfiguredPortMock as jest.MockedFunction<
  typeof getConfiguredPortMock
>;
const handleMCPRequest = handleMCPRequestMock as jest.MockedFunction<
  typeof handleMCPRequestMock
>;

const fsExistsSyncMock = fs.existsSync as jest.MockedFunction<
  typeof fs.existsSync
>;
const fsReadFileSyncMock = fs.readFileSync as jest.MockedFunction<
  typeof fs.readFileSync
>;
const fsWriteFileSyncMock = fs.writeFileSync as jest.MockedFunction<
  typeof fs.writeFileSync
>;

interface Fixture {
  service: CodeExecutionMCP;
  apiBuilder: jest.Mocked<PtahAPIBuilder>;
  api: PtahAPI;
  logger: MockLogger;
  workspaceState: ReturnType<typeof createMockStateStorage>;
  workspaceProvider: ReturnType<typeof createMockWorkspaceProvider>;
  permissionPromptService: jest.Mocked<PermissionPromptService>;
}

interface BuildOptions {
  registerWebview?: WebviewManager | false;
  registerIdeCapabilities?: boolean;
  configOverrides?: Record<string, unknown>;
  folders?: string[];
}

function build(opts: BuildOptions = {}): Fixture {
  container.clearInstances();
  container.reset();

  const api = buildApi();
  const apiBuilder = buildApiBuilder(api);
  const logger = createMockLogger();
  const workspaceState = createMockStateStorage();
  const workspaceProvider = createMockWorkspaceProvider({
    folders: opts.folders,
    config: opts.configOverrides,
  });
  const permissionPromptService = buildPermissionPromptService();

  const webviewManager: WebviewManager | undefined = opts.registerWebview
    ? (opts.registerWebview as WebviewManager)
    : undefined;
  const ideCapabilities = opts.registerIdeCapabilities ? {} : undefined;
  if (webviewManager) {
    container.registerInstance(TOKENS.WEBVIEW_MANAGER, webviewManager);
  }
  if (ideCapabilities) {
    container.registerInstance(IDE_CAPABILITIES_TOKEN, ideCapabilities);
  }

  const service = new CodeExecutionMCP(
    apiBuilder,
    asLogger(logger),
    workspaceState as unknown as IStateStorage,
    workspaceProvider as unknown as IWorkspaceProvider,
    permissionPromptService,
    webviewManager,
    ideCapabilities as ConstructorParameters<typeof CodeExecutionMCP>[6],
  );

  return {
    service,
    apiBuilder,
    api,
    logger,
    workspaceState,
    workspaceProvider,
    permissionPromptService,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults â€” individual tests override as needed.
  getConfiguredPort.mockReturnValue(51820);
  startHttpServer.mockResolvedValue({
    server: makeFakeServer(),
    port: 51820,
  });
  stopHttpServer.mockResolvedValue(undefined);
  handleMCPRequest.mockResolvedValue({
    jsonrpc: '2.0',
    id: 1,
    result: {},
  });
  fsExistsSyncMock.mockReturnValue(false);
  fsReadFileSyncMock.mockReturnValue('{}');
  fsWriteFileSyncMock.mockReturnValue(undefined);
  // `jest.clearAllMocks()` clears CALLS, not implementations, and several tests
  // below replace this one (`deferConfigLock`, the per-path timeout). Restore
  // the straight-through default explicitly so a leak cannot make an unrelated
  // test fail three files later.
  (withMcpConfigLockMock as unknown as jest.Mock).mockImplementation(
    async (_configPath: string, task: () => Promise<unknown>) => task(),
  );
});

afterEach(() => {
  container.clearInstances();
  container.reset();
});

// ===========================================================================
// 1. MCP tool registration â€” constructor wiring
// ===========================================================================

describe('CodeExecutionMCP â€” construction / tool registration', () => {
  it('builds the ptah API eagerly via the injected PtahAPIBuilder', () => {
    const { apiBuilder } = build();
    expect(apiBuilder.build).toHaveBeenCalledTimes(1);
  });

  it('resolves WebviewManager when registered in the container (VS Code host)', async () => {
    const webview = buildWebviewManager();
    const { service } = build({ registerWebview: webview });
    await service.start();

    // Wire-through assertion â€” the dispatch closure receives the same webview.
    const ctxProbe: MCPRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };
    await (
      startHttpServer.mock.calls[0][0].onMCPRequest as (
        r: MCPRequest,
      ) => Promise<MCPResponse>
    )(ctxProbe);

    expect(handleMCPRequest).toHaveBeenCalledWith(
      ctxProbe,
      expect.objectContaining({ webviewManager: webview }),
    );
  });

  it('leaves WebviewManager undefined when not registered (Electron host)', async () => {
    const { service } = build({ registerWebview: false });
    await service.start();

    const probe: MCPRequest = { jsonrpc: '2.0', id: 9, method: 'tools/list' };
    await (
      startHttpServer.mock.calls[0][0].onMCPRequest as (
        r: MCPRequest,
      ) => Promise<MCPResponse>
    )(probe);

    expect(handleMCPRequest).toHaveBeenCalledWith(
      probe,
      expect.objectContaining({ webviewManager: undefined }),
    );
  });

  it('flags hasIDECapabilities=true when IDE_CAPABILITIES_TOKEN is registered', async () => {
    const { service } = build({ registerIdeCapabilities: true });
    await service.start();

    const probe: MCPRequest = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    await (
      startHttpServer.mock.calls[0][0].onMCPRequest as (
        r: MCPRequest,
      ) => Promise<MCPResponse>
    )(probe);

    expect(handleMCPRequest).toHaveBeenCalledWith(
      probe,
      expect.objectContaining({ hasIDECapabilities: true }),
    );
  });

  it('flags hasIDECapabilities=false when IDE_CAPABILITIES_TOKEN is absent (Electron)', async () => {
    const { service } = build({ registerIdeCapabilities: false });
    await service.start();

    const probe: MCPRequest = { jsonrpc: '2.0', id: 3, method: 'tools/list' };
    await (
      startHttpServer.mock.calls[0][0].onMCPRequest as (
        r: MCPRequest,
      ) => Promise<MCPResponse>
    )(probe);

    expect(handleMCPRequest).toHaveBeenCalledWith(
      probe,
      expect.objectContaining({ hasIDECapabilities: false }),
    );
  });
});

// ===========================================================================
// 2. Request dispatch â€” start/stop lifecycle and MCP routing
// ===========================================================================

describe('CodeExecutionMCP â€” start/stop lifecycle', () => {
  it('reads configured port from workspaceProvider and returns the actual listening port', async () => {
    getConfiguredPort.mockReturnValue(60001);
    startHttpServer.mockResolvedValue({
      server: makeFakeServer(),
      port: 60002, // OS-assigned after EACCES retry
    });

    const { service, workspaceProvider } = build();
    const port = await service.start();

    expect(getConfiguredPort).toHaveBeenCalledWith(workspaceProvider);
    expect(startHttpServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 60001 }),
    );
    expect(port).toBe(60002);
    expect(service.getPort()).toBe(60002);
  });

  it('returns existing port and warns when start() is invoked twice', async () => {
    const { service, logger } = build();
    const first = await service.start();
    const second = await service.start();

    expect(first).toBe(second);
    expect(startHttpServer).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already started'),
      'CodeExecutionMCP',
    );
  });

  it('routes incoming MCP requests to handleMCPRequest with the built PtahAPI', async () => {
    const { service, api, permissionPromptService } = build();
    await service.start();

    const onMCPRequest = startHttpServer.mock.calls[0][0].onMCPRequest;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'ptah_workspace_analyze' },
    };
    await onMCPRequest(request);

    expect(handleMCPRequest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        ptahAPI: api,
        permissionPromptService,
      }),
    );
  });

  it('forwards the disabledMcpNamespaces config into the dispatch context', async () => {
    const { service } = build({
      configOverrides: {
        'ptah.agentOrchestration.disabledMcpNamespaces': ['browser', 'git'],
      },
    });
    await service.start();

    const onMCPRequest = startHttpServer.mock.calls[0][0].onMCPRequest;
    await onMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(handleMCPRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disabledMcpNamespaces: ['browser', 'git'] }),
    );
  });

  it('defaults disabledMcpNamespaces to [] when the config key is unset', async () => {
    const { service } = build();
    await service.start();

    const onMCPRequest = startHttpServer.mock.calls[0][0].onMCPRequest;
    await onMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(handleMCPRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disabledMcpNamespaces: [] }),
    );
  });

  it('stop() delegates to stopHttpServer and clears internal port/server', async () => {
    const fakeServer = makeFakeServer();
    startHttpServer.mockResolvedValue({ server: fakeServer, port: 51820 });

    const { service, workspaceState, logger } = build();
    await service.start();
    expect(service.getPort()).toBe(51820);

    await service.stop();

    expect(stopHttpServer).toHaveBeenCalledWith(
      fakeServer,
      workspaceState,
      asLogger(logger),
    );
    expect(service.getPort()).toBeNull();
  });

  it('stop() is safe to call before start() (no server to tear down)', async () => {
    const { service } = build();
    await expect(service.stop()).resolves.toBeUndefined();
    // stopHttpServer is still invoked with null â€” the helper guards internally.
    expect(stopHttpServer).toHaveBeenCalledWith(
      null,
      expect.anything(),
      expect.anything(),
    );
  });

  it('forwards tool result callbacks set BEFORE start() into the dispatch context', async () => {
    const { service } = build();
    const cb = jest.fn();
    service.setToolResultCallback(cb);

    await service.start();
    const onMCPRequest = startHttpServer.mock.calls[0][0].onMCPRequest;
    await onMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(handleMCPRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onToolResult: cb }),
    );
  });

  it('clearToolResultCallback() clears the callback on subsequent dispatches', async () => {
    const { service } = build();
    const cb = jest.fn();
    service.setToolResultCallback(cb);
    await service.start();

    service.clearToolResultCallback();

    const onMCPRequest = startHttpServer.mock.calls[0][0].onMCPRequest;
    await onMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(handleMCPRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onToolResult: undefined }),
    );
  });
});

describe('CodeExecutionMCP â€” ensureRegisteredForSubagents', () => {
  it('no-ops when server has not been started', async () => {
    const { service } = build({ folders: ['/ws'] });
    await service.ensureRegisteredForSubagents();
    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });

  it('writes the ptah entry into .mcp.json when workspace + port are known', async () => {
    fsExistsSyncMock.mockReturnValue(false);
    const { service } = build({ folders: ['/ws'] });
    await service.start();

    await service.ensureRegisteredForSubagents();

    expect(fsWriteFileSyncMock).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = fsWriteFileSyncMock.mock.calls[0];
    expect(String(writtenPath)).toContain('.mcp.json');
    const parsed = JSON.parse(String(writtenContent)) as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    expect(parsed.mcpServers['ptah']).toEqual({
      type: 'http',
      url: 'http://localhost:51820',
    });
  });

  it('is idempotent â€” second call after registration writes nothing', async () => {
    const { service } = build({ folders: ['/ws'] });
    await service.start();

    await service.ensureRegisteredForSubagents();
    await service.ensureRegisteredForSubagents();

    expect(fsWriteFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('skips registration when no workspace folder is open', async () => {
    const { service } = build({ folders: [] });
    await service.start();

    await service.ensureRegisteredForSubagents();

    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });

  it('warns and reports write-failed, without throwing, when .mcp.json is unparseable', async () => {
    fsExistsSyncMock.mockReturnValue(true);
    fsReadFileSyncMock.mockReturnValue('{not json');

    const { service, logger } = build({ folders: ['/ws'] });
    await service.start();

    // Does not throw — but no longer resolves as SUCCESS either, which was the
    // whole defect (TASK_2026_332).
    await expect(service.ensureRegisteredForSubagents()).resolves.toEqual({
      registered: false,
      reason: 'write-failed',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to register in .mcp.json'),
      'CodeExecutionMCP',
    );
  });

  /**
   * TASK_2026_318. `harness-sync` documents the rule this used to break: "Never
   * add a SECOND writer to an MCP config fileâ€¦ A module that hand-rolls its own
   * read-modify-write on a file this lib also writes will lose an entry â€” not
   * corrupt it, lose it, silently." `.mcp.json` IS a file harness-sync writes
   * (it is the `claude` target's MCP facet), and this service performed a raw
   * `readFileSync` â†’ mutate â†’ `writeFileSync` outside the lock.
   *
   * Atomicity would not have helped: a temp+rename stops a reader seeing half a
   * file and does nothing about two writers that each read, each edit their own
   * key, and each write their copy back.
   */
  it('takes the harness-sync config lock, and writes inside it', async () => {
    fsExistsSyncMock.mockReturnValue(false);
    const { service } = build({ folders: ['/ws'] });
    await service.start();

    await service.ensureRegisteredForSubagents();

    expect(withMcpConfigLockMock).toHaveBeenCalledWith(
      expect.stringContaining('.mcp.json'),
      expect.any(Function),
    );
    // Ordering, not just presence: a lock taken AFTER the write would satisfy
    // `toHaveBeenCalled` and protect nothing.
    const lockOrder = (withMcpConfigLockMock as unknown as jest.Mock).mock
      .invocationCallOrder[0];
    const writeOrder = fsWriteFileSyncMock.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(writeOrder);
  });

  /**
   * The removal half of the same rule. This used to assert only that the lock
   * was CALLED, which a lock taken around nothing at all would satisfy — and
   * the removal is the side that needs the critical section MOST: deciding
   * `ptah` is present and then deleting it are two halves of one decision, so
   * a read outside the lock is a stale read written back over a reconcile.
   * Asserted the way the register test above does it.
   */
  it('takes the same lock to REMOVE the entry, with the read AND the write inside it', async () => {
    fsExistsSyncMock.mockReturnValue(true);
    fsReadFileSyncMock.mockReturnValue(
      JSON.stringify({ mcpServers: { ptah: { type: 'http', url: 'x' } } }),
    );
    const { service } = build({ folders: ['/ws'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    // Count only the unregister's calls, not the registration's.
    (withMcpConfigLockMock as unknown as jest.Mock).mockClear();
    fsExistsSyncMock.mockClear();
    fsReadFileSyncMock.mockClear();
    fsWriteFileSyncMock.mockClear();

    await service.stop();

    expect(withMcpConfigLockMock).toHaveBeenCalledWith(
      expect.stringContaining('.mcp.json'),
      expect.any(Function),
    );

    const lockOrder = (withMcpConfigLockMock as unknown as jest.Mock).mock
      .invocationCallOrder[0];
    const existsOrder = fsExistsSyncMock.mock.invocationCallOrder[0];
    const readOrder = fsReadFileSyncMock.mock.invocationCallOrder[0];
    const writeOrder = fsWriteFileSyncMock.mock.invocationCallOrder[0];

    // Ordering, not just presence. The read is the half that matters: a lock
    // taken after it protects a decision already made on stale data.
    expect(lockOrder).toBeLessThan(existsOrder);
    expect(lockOrder).toBeLessThan(readOrder);
    expect(readOrder).toBeLessThan(writeOrder);
    // ...and the lock is released only after the write, i.e. exactly one
    // critical section covers both.
    expect(withMcpConfigLockMock).toHaveBeenCalledTimes(1);
  });

  /**
   * TASK_2026_332 — the CONTRACT, not just the log line.
   *
   * The first version of this test asserted `.resolves.toBeUndefined()` together
   * with "no write happened", and in doing so certified the bug: the method
   * reported success while the entry a subagent reads did not exist. That is
   * strictly worse than the lost update the lock was added to prevent, because
   * it attaches a false assurance to the same missing entry. What must be
   * asserted is that the caller can TELL.
   */
  it('reports registered:false with a lock-timeout reason when the config lock times out', async () => {
    (withMcpConfigLockMock as unknown as jest.Mock).mockRejectedValueOnce(
      new FileLockTimeoutError('/ws/.mcp.json.ptah-lock', 2000),
    );

    const { service, logger } = build({ folders: ['/ws'] });
    await service.start();

    const registration = await service.ensureRegisteredForSubagents();

    expect(registration).toEqual({
      registered: false,
      reason: 'lock-timeout',
    });
    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
    // A lock timeout is reported as its own thing, not folded into the generic
    // I/O warning — that distinction is the production consumer of
    // `isFileLockTimeoutError`.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('held the config lock'),
      'CodeExecutionMCP',
    );

    // Loud AND retryable: no registration was recorded, so the next call tries
    // again rather than believing an entry it never wrote.
    const retry = await service.ensureRegisteredForSubagents();
    expect(retry).toEqual({ registered: true });
    expect(fsWriteFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('reports write-failed — distinct from lock-timeout — for an ordinary I/O error', async () => {
    fsExistsSyncMock.mockReturnValue(false);
    fsWriteFileSyncMock.mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });

    const { service, logger } = build({ folders: ['/ws'] });
    await service.start();

    expect(await service.ensureRegisteredForSubagents()).toEqual({
      registered: false,
      reason: 'write-failed',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to register in .mcp.json'),
      'CodeExecutionMCP',
    );
  });

  it('reports registered:true on the happy path and on the idempotent repeat', async () => {
    const { service } = build({ folders: ['/ws'] });
    await service.start();

    expect(await service.ensureRegisteredForSubagents()).toEqual({
      registered: true,
    });
    // The second call writes nothing, and must still say the entry is there.
    expect(await service.ensureRegisteredForSubagents()).toEqual({
      registered: true,
    });
    expect(fsWriteFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('reports not-started before start() and no-workspace with no folder open', async () => {
    const withoutServer = build({ folders: ['/ws'] });
    expect(await withoutServer.service.ensureRegisteredForSubagents()).toEqual({
      registered: false,
      reason: 'not-started',
    });

    const withoutFolder = build({ folders: [] });
    await withoutFolder.service.start();
    expect(await withoutFolder.service.ensureRegisteredForSubagents()).toEqual({
      registered: false,
      reason: 'no-workspace',
    });
  });

  /**
   * A removal that could not be performed must not be FORGOTTEN.
   *
   * TASK_2026_332 enforced that by refusing to register anywhere else while a
   * removal was outstanding — necessary then, because the service tracked ONE
   * `registeredMcpJsonPath`, so writing B overwrote the only record that A
   * still held an entry and nothing could ever clean it up.
   *
   * TASK_2026_354 keys the record by path, which makes the coupling both
   * unnecessary and harmful: contention on a CLOSED folder's config file would
   * report `mcpServerRunning: false` for a session in the folder the user is
   * actually working in, whose entry is on disk and perfectly usable. So the
   * registration proceeds and the invariant that matters is asserted directly —
   * A's record survives, and the retry at `stop()` removes it.
   */
  it('keeps the record of an entry it could not remove, and still registers the open folder', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    // Contention on A's config file specifically, for as long as it lasts.
    (withMcpConfigLockMock as unknown as jest.Mock).mockImplementation(
      async (configPath: string, task: () => Promise<unknown>) => {
        if (configPath === ROOT_A) {
          throw new FileLockTimeoutError(`${ROOT_A}.ptah-lock`, 2000);
        }
        return task();
      },
    );

    workspaceProvider.__state.setFolders(['/wsB']);
    await settleMcpJsonWrites();

    // The folder the user is in gets its entry, and says so honestly.
    expect(await service.ensureRegisteredForSubagents()).toEqual({
      registered: true,
    });
    expect(serversIn(disk, ROOT_B)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
    // A's entry is still on disk because the lock refused the removal...
    expect(serversIn(disk, ROOT_A)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });

    // ...and the record of it survived, so the retry cleans it up.
    (withMcpConfigLockMock as unknown as jest.Mock).mockImplementation(
      async (_configPath: string, task: () => Promise<unknown>) => task(),
    );
    await service.stop();
    expect(serversIn(disk, ROOT_A)).toEqual({});
    expect(serversIn(disk, ROOT_B)).toEqual({});
  });
});

// ===========================================================================
// 3. Error propagation â€” dispatch + dispose surfaces
// ===========================================================================

describe('CodeExecutionMCP â€” error propagation', () => {
  it('surfaces MCP handler errors up to the HTTP dispatch boundary (does not swallow)', async () => {
    const boom = new Error('handler exploded');
    handleMCPRequest.mockRejectedValue(boom);

    const { service } = build();
    await service.start();
    const onMCPRequest = startHttpServer.mock.calls[0][0].onMCPRequest;

    await expect(
      onMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
    ).rejects.toThrow('handler exploded');
  });

  it('propagates startHttpServer rejections out of start()', async () => {
    startHttpServer.mockRejectedValue(new Error('port taken'));
    const { service } = build();
    await expect(service.start()).rejects.toThrow('port taken');
    expect(service.getPort()).toBeNull();
  });

  it('disposeAsync() propagates stop() failures to the caller', async () => {
    const { service } = build();
    await service.start();
    stopHttpServer.mockRejectedValue(new Error('shutdown failed'));

    await expect(service.disposeAsync()).rejects.toThrow('shutdown failed');
  });

  it('dispose() logs teardown errors instead of throwing synchronously', async () => {
    const { service, logger } = build();
    await service.start();
    stopHttpServer.mockRejectedValue(new Error('shutdown failed'));

    // Must not throw even though the underlying stop() rejects.
    expect(() => service.dispose()).not.toThrow();

    // Await microtask flush so the .catch handler runs.
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error during dispose'),
      expect.any(Error),
    );
  });

  it('unregister step warns but does not throw when .mcp.json rewrite fails', async () => {
    fsExistsSyncMock.mockReturnValue(true);
    fsReadFileSyncMock.mockReturnValue(
      JSON.stringify({ mcpServers: { ptah: { type: 'http', url: 'x' } } }),
    );

    const { service, logger } = build({ folders: ['/ws'] });
    await service.start();
    // Must register first â€” unregisterFromMcpJson now early-returns when the
    // service was never registered, guarding the on-shutdown disk read.
    await service.ensureRegisteredForSubagents();

    // Fail the unregister rewrite (the registration write already succeeded).
    fsWriteFileSyncMock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    await expect(service.stop()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to unregister from .mcp.json'),
      'CodeExecutionMCP',
    );
  });
});

// ===========================================================================
// 4. unregister idempotency â€” Bug #9 (Wave A.B1)
// ===========================================================================

describe('CodeExecutionMCP â€” unregister idempotency', () => {
  it('stop() without prior ensureRegisteredForSubagents() does not read .mcp.json', async () => {
    // Repro of Bug #9: stop() unconditionally invoked unregisterFromMcpJson(),
    // which in turn fs.readFileSync'd .mcp.json on every shutdown â€” even when
    // ensureRegisteredForSubagents() never ran (e.g., free-tier sessions).
    const { service } = build({ folders: ['/ws'] });
    await service.start();

    // Note: NO ensureRegisteredForSubagents() call here.
    await service.stop();

    expect(fsReadFileSyncMock).not.toHaveBeenCalled();
    expect(fsExistsSyncMock).not.toHaveBeenCalled();
    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });

  it('stop() after ensureRegisteredForSubagents() does perform the unregister read+write', async () => {
    fsExistsSyncMock.mockReturnValue(true);
    fsReadFileSyncMock.mockReturnValue(
      JSON.stringify({ mcpServers: { ptah: { type: 'http', url: 'x' } } }),
    );

    const { service } = build({ folders: ['/ws'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    // Reset write counter so we count only the unregister write, not register.
    fsWriteFileSyncMock.mockClear();
    fsReadFileSyncMock.mockClear();

    await service.stop();

    expect(fsReadFileSyncMock).toHaveBeenCalledTimes(1);
    expect(fsWriteFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('a second stop() is a no-op for the .mcp.json read after a successful unregister', async () => {
    fsExistsSyncMock.mockReturnValue(true);
    fsReadFileSyncMock.mockReturnValue(
      JSON.stringify({ mcpServers: { ptah: { type: 'http', url: 'x' } } }),
    );

    const { service } = build({ folders: ['/ws'] });
    await service.start();
    await service.ensureRegisteredForSubagents();
    await service.stop();

    fsReadFileSyncMock.mockClear();
    fsExistsSyncMock.mockClear();
    fsWriteFileSyncMock.mockClear();

    await service.stop();

    expect(fsReadFileSyncMock).not.toHaveBeenCalled();
    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Shared .mcp.json helpers (sections 5 and 6)
// ===========================================================================

const ROOT_A = path.join('/wsA', '.mcp.json');
const ROOT_B = path.join('/wsB', '.mcp.json');
const ROOT_C = path.join('/wsC', '.mcp.json');

/** Back `fs` with a path-keyed in-memory disk so per-file state is real. */
function useVirtualDisk(
  seed: Record<string, string> = {},
): Map<string, string> {
  const disk = new Map<string, string>(Object.entries(seed));
  fsExistsSyncMock.mockImplementation((p) => disk.has(String(p)));
  fsReadFileSyncMock.mockImplementation((p) => {
    const content = disk.get(String(p));
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${String(p)}'`);
    }
    return content;
  });
  fsWriteFileSyncMock.mockImplementation((p, data) => {
    disk.set(String(p), String(data));
  });
  return disk;
}

function serversIn(disk: Map<string, string>, file: string): unknown {
  const raw = disk.get(file);
  if (raw === undefined) return undefined;
  return (JSON.parse(raw) as { mcpServers?: Record<string, unknown> })
    .mcpServers;
}

/**
 * Drain the fire-and-forget re-point that `onDidChangeWorkspaceFolders`
 * triggers. The `.mcp.json` writes became async in TASK_2026_318 (they take
 * `harness-sync`'s config-file lock), and the folder event has no promise to
 * hand back — so a `setFolders` followed by a synchronous disk assertion reads
 * the state from BEFORE the re-point.
 *
 * Several turns, not one: TASK_2026_332 put the re-point behind an
 * operation-level queue, so a settled state is several promise hops away rather
 * than exactly one.
 */
const settleMcpJsonWrites = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/**
 * Hold every `.mcp.json` mutation at the config lock until the returned
 * function is called.
 *
 * This is what makes the TASK_2026_332 races observable at all. The lock stub
 * installed at the top of this file runs its task straight through, so a
 * mutation completes within one microtask and two of them can never actually be
 * in flight together — a queue defect would pass unnoticed. Deferring the lock
 * widens the window the way a real contended `withMcpConfigLock` does.
 */
function deferConfigLock(): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  (withMcpConfigLockMock as unknown as jest.Mock).mockImplementation(
    async (_configPath: string, task: () => Promise<unknown>) => {
      await gate;
      return task();
    },
  );
  return release;
}

// ===========================================================================
// 5. .mcp.json path symmetry across a workspace switch â€” TASK_2026_315 A3
// ===========================================================================

/**
 * The A3 defect had two halves and both are pinned here.
 *
 *   1. `ensureRegisteredForSubagents` was one-shot behind a boolean, so the
 *      SECOND workspace of a session never got an entry at all and subagents
 *      spawned there could not discover the Ptah MCP server.
 *   2. `unregisterFromMcpJson` resolved its target through `getMcpJsonPath()` â€”
 *      the CURRENT workspace root â€” instead of the path it had actually
 *      written, so the first repository kept a `ptah` entry pointing at a dead
 *      port indefinitely.
 *
 * The write is into a USER-OWNED file, so the read-merge-write contract gets
 * its own assertions: a hand-authored server, and unrelated top-level keys,
 * must survive both register and unregister untouched.
 */
describe('CodeExecutionMCP â€” .mcp.json path symmetry across a workspace switch', () => {
  it("stop() after a workspace switch removes ptah from the ORIGINAL root's .mcp.json", async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();

    await service.ensureRegisteredForSubagents();
    expect(serversIn(disk, ROOT_A)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });

    // Workspace root moves A -> B.
    workspaceProvider.__state.setFolders(['/wsB']);
    await settleMcpJsonWrites();

    await service.stop();

    // The whole point: A must not keep a dead-port entry.
    expect(serversIn(disk, ROOT_A)).toEqual({});
    expect(JSON.stringify(serversIn(disk, ROOT_A))).not.toContain('ptah');
  });

  it('a hand-authored .mcp.json survives register + unregister with only the ptah key touched', async () => {
    const handAuthored =
      JSON.stringify(
        {
          $schema: 'https://example.invalid/mcp.schema.json',
          mcpServers: {
            'my-own-server': { type: 'stdio', command: 'node', args: ['x.js'] },
          },
        },
        null,
        2,
      ) + '\n';
    const disk = useVirtualDisk({ [ROOT_A]: handAuthored });

    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();

    await service.ensureRegisteredForSubagents();
    expect(serversIn(disk, ROOT_A)).toEqual({
      'my-own-server': { type: 'stdio', command: 'node', args: ['x.js'] },
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });

    workspaceProvider.__state.setFolders(['/wsB']);
    await service.stop();

    const after = JSON.parse(disk.get(ROOT_A) as string) as Record<
      string,
      unknown
    >;
    expect(after['mcpServers']).toEqual({
      'my-own-server': { type: 'stdio', command: 'node', args: ['x.js'] },
    });
    // Unrelated top-level keys are preserved too â€” this is a read-merge-write,
    // not a rewrite.
    expect(after['$schema']).toBe('https://example.invalid/mcp.schema.json');
  });

  it('moves the entry into the second workspace on a switch (subagents there can discover it)', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    workspaceProvider.__state.setFolders(['/wsB']);
    // The folder event has nowhere to return a promise to, so the re-point is
    // the one deliberately fire-and-forget path (TASK_2026_318). Let it settle
    // before reading the disk.
    await settleMcpJsonWrites();

    expect(serversIn(disk, ROOT_B)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
    expect(serversIn(disk, ROOT_A)).toEqual({});
  });

  it('ensureRegisteredForSubagents() after a switch registers in the new root', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    workspaceProvider.__state.setFolders(['/wsB']);
    await settleMcpJsonWrites();
    // The one-shot boolean used to make this a no-op forever.
    await service.ensureRegisteredForSubagents();

    expect(serversIn(disk, ROOT_B)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
  });

  it('unregisters from the written path when the LAST folder is removed, and stop() is then clean', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    // Zero folders open â€” getMcpJsonPath() resolves to null.
    workspaceProvider.__state.setFolders([]);
    await settleMcpJsonWrites();
    expect(serversIn(disk, ROOT_A)).toEqual({});

    fsWriteFileSyncMock.mockClear();
    await service.stop();
    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });

  it('a workspace change without a prior registration never touches disk', async () => {
    useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();

    // No ensureRegisteredForSubagents() â€” we own no entry, so the switch must
    // not start writing into the user's repositories (the Bug #9 rule).
    workspaceProvider.__state.setFolders(['/wsB']);

    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
    expect(fsReadFileSyncMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5b. One entry per OPEN folder, and no write when nothing changed
//     - TASK_2026_354
// ===========================================================================

/**
 * The service used to own exactly ONE `.mcp.json`: whichever the active root
 * resolved to. On Electron `setActiveFolder()` fires
 * `onDidChangeWorkspaceFolders` and `workspace:switch` calls it on every tab
 * switch, so switching between two folders that were BOTH already open produced
 * an unregister + register pair - a write into a file inside the user's
 * version-controlled repository, six times in the session that produced
 * `tmp/logs/log.log`, for a change that altered nothing they could observe.
 *
 * Ownership is now the folder SET, so a switch is a no-op by construction, and
 * a registration whose desired entry already matches disk writes nothing even
 * when the set DID change.
 */
describe('CodeExecutionMCP - one .mcp.json per open workspace folder', () => {
  it('registers in every open folder, not just the active one', async () => {
    const disk = useVirtualDisk();
    const { service } = build({ folders: ['/wsA', '/wsB'] });
    await service.start();

    expect(await service.ensureRegisteredForSubagents()).toEqual({
      registered: true,
    });

    // A subagent spawned for either folder reads ITS file, so both need one.
    const entry = { ptah: { type: 'http', url: 'http://localhost:51820' } };
    expect(serversIn(disk, ROOT_A)).toEqual(entry);
    expect(serversIn(disk, ROOT_B)).toEqual(entry);
  });

  it('switching the active folder between two open folders writes nothing', async () => {
    useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA', '/wsB'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    fsWriteFileSyncMock.mockClear();

    // What `workspace:switch` does on Electron: `setActiveFolder` fires the
    // folder-change event with the folder SET unchanged. Fired twice, because
    // one user session switches back and forth.
    workspaceProvider.__state.fireWorkspaceFoldersChange();
    workspaceProvider.__state.fireWorkspaceFoldersChange();
    await settleMcpJsonWrites();

    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });

  it('emits no register/unregister log line on a switch between open folders', async () => {
    useVirtualDisk();
    const { service, workspaceProvider, logger } = build({
      folders: ['/wsA', '/wsB'],
    });
    await service.start();
    await service.ensureRegisteredForSubagents();

    logger.info.mockClear();
    workspaceProvider.__state.fireWorkspaceFoldersChange();
    await settleMcpJsonWrites();

    const mcpJsonLines = logger.info.mock.calls.filter(([message]) =>
      /Registered ptah|Unregistered ptah/.test(String(message)),
    );
    expect(mcpJsonLines).toEqual([]);
  });

  it('does not rewrite a .mcp.json that already holds the exact desired entry', async () => {
    const disk = useVirtualDisk({
      [ROOT_A]:
        JSON.stringify(
          {
            mcpServers: {
              // Field order deliberately reversed: the comparison is
              // structural, so this must still count as "already correct".
              ptah: { url: 'http://localhost:51820', type: 'http' },
            },
          },
          null,
          2,
        ) + '\n',
    });
    const before = disk.get(ROOT_A);

    const { service, logger } = build({ folders: ['/wsA'] });
    await service.start();

    expect(await service.ensureRegisteredForSubagents()).toEqual({
      registered: true,
    });

    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
    expect(disk.get(ROOT_A)).toBe(before);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Registered ptah'),
      'CodeExecutionMCP',
    );
  });

  it('rewrites when the entry on disk points at a different port', async () => {
    const disk = useVirtualDisk({
      [ROOT_A]:
        JSON.stringify({
          mcpServers: { ptah: { type: 'http', url: 'http://localhost:9999' } },
        }) + '\n',
    });

    const { service } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    expect(serversIn(disk, ROOT_A)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
  });

  it('unregisters only the folder that left the workspace', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({
      folders: ['/wsA', '/wsB'],
    });
    await service.start();
    await service.ensureRegisteredForSubagents();

    // /wsB closed; /wsA is still open and must keep its entry.
    workspaceProvider.__state.setFolders(['/wsA']);
    await settleMcpJsonWrites();

    expect(serversIn(disk, ROOT_A)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
    expect(serversIn(disk, ROOT_B)).toEqual({});
  });

  it('registers a folder ADDED to an already-registered workspace', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    workspaceProvider.__state.setFolders(['/wsA', '/wsB']);
    await settleMcpJsonWrites();

    const entry = { ptah: { type: 'http', url: 'http://localhost:51820' } };
    expect(serversIn(disk, ROOT_A)).toEqual(entry);
    expect(serversIn(disk, ROOT_B)).toEqual(entry);
  });

  it('stop() gives back the entry in EVERY open folder', async () => {
    const disk = useVirtualDisk();
    const { service } = build({ folders: ['/wsA', '/wsB', '/wsC'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    await service.stop();

    expect(serversIn(disk, ROOT_A)).toEqual({});
    expect(serversIn(disk, ROOT_B)).toEqual({});
    expect(serversIn(disk, ROOT_C)).toEqual({});
  });
});

// ===========================================================================
// 6. The re-pointing operation queue â€” TASK_2026_332 defect 1
// ===========================================================================

/**
 * TASK_2026_315 A3 made re-pointing correct and asynchronous. Nothing then
 * ordered those async operations against each other, and `withMcpConfigLock`
 * could not: it is keyed per FILE and the racing writes target DIFFERENT files.
 *
 * Every test here defers the config lock (`deferConfigLock`) so more than one
 * mutation is genuinely in flight at once. Without that the straight-through
 * lock stub completes each mutation inside a microtask and neither race is
 * reachable, which is why the pre-existing switch specs above passed against
 * the defective code.
 */
describe('CodeExecutionMCP â€” re-pointing queue', () => {
  it('A -> B -> C leaves NO ptah entry in the intermediate workspace', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    // Both changes land while the first re-point is still stuck at the lock.
    // Unqueued, both operations read the registration record as {A} and then
    // write B and C independently â€” B keeps a live entry for a server that no
    // longer serves it, and nothing ever removes it.
    const release = deferConfigLock();
    workspaceProvider.__state.setFolders(['/wsB']);
    workspaceProvider.__state.setFolders(['/wsC']);
    release();
    await settleMcpJsonWrites();

    expect(serversIn(disk, ROOT_C)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
    // B was never written at all â€” the superseded re-point is dropped before
    // it touches disk, so there is no transient entry to strand.
    expect(serversIn(disk, ROOT_B)).toBeUndefined();
    expect(serversIn(disk, ROOT_A)).toEqual({});
  });

  it('the last requested workspace wins even when the changes arrive back to back', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    const release = deferConfigLock();
    workspaceProvider.__state.setFolders(['/wsB']);
    workspaceProvider.__state.setFolders(['/wsC']);
    workspaceProvider.__state.setFolders(['/wsB']);
    release();
    await settleMcpJsonWrites();

    // Exactly one workspace advertises this server, and it is the current one.
    expect(serversIn(disk, ROOT_B)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
    expect(serversIn(disk, ROOT_C)).toBeUndefined();
    expect(serversIn(disk, ROOT_A)).toEqual({});
  });

  it('stop() immediately after a switch cancels the re-point and leaves no entry anywhere', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    // Scenario (b): the stop finishes unregistering A while the outstanding
    // event writes B back â€” with a port that is about to die.
    const release = deferConfigLock();
    workspaceProvider.__state.setFolders(['/wsB']);
    const stopping = service.stop();
    release();
    await stopping;
    await settleMcpJsonWrites();

    expect(serversIn(disk, ROOT_A)).toEqual({});
    expect(serversIn(disk, ROOT_B)).toBeUndefined();
  });

  it('a folder change that fires DURING stop() is dropped too', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    const release = deferConfigLock();
    const stopping = service.stop();
    // The generation bump cannot cover this one â€” it was requested after the
    // stop â€” so the stopped flag has to.
    workspaceProvider.__state.setFolders(['/wsB']);
    release();
    await stopping;
    await settleMcpJsonWrites();

    expect(serversIn(disk, ROOT_A)).toEqual({});
    expect(serversIn(disk, ROOT_B)).toBeUndefined();
  });

  it('a restart after stop() re-arms re-pointing', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();
    await service.stop();

    await service.start();
    await service.ensureRegisteredForSubagents();
    workspaceProvider.__state.setFolders(['/wsB']);
    await settleMcpJsonWrites();

    expect(serversIn(disk, ROOT_B)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
    expect(serversIn(disk, ROOT_A)).toEqual({});
  });

  it('ensureRegisteredForSubagents() joins the queue instead of racing a re-point', async () => {
    const disk = useVirtualDisk();
    const { service, workspaceProvider } = build({ folders: ['/wsA'] });
    await service.start();
    await service.ensureRegisteredForSubagents();

    // A session start and a folder event, overlapping. Both used to read the
    // registration record as {A} and then write different files.
    const release = deferConfigLock();
    workspaceProvider.__state.setFolders(['/wsB']);
    const explicit = service.ensureRegisteredForSubagents();
    release();
    await explicit;
    await settleMcpJsonWrites();

    // The awaited call still resolves only once ITS write has landed, which is
    // the contract `ChatSessionService` depends on before spawning a subagent.
    expect(serversIn(disk, ROOT_B)).toEqual({
      ptah: { type: 'http', url: 'http://localhost:51820' },
    });
    expect(serversIn(disk, ROOT_A)).toEqual({});
  });
});
