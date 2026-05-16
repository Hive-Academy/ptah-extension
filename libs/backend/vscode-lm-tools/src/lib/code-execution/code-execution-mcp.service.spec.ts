/**
 * code-execution-mcp.service — unit specs.
 *
 * `CodeExecutionMCP` is a thin orchestrator that wires HTTP server lifecycle
 * + MCP JSON-RPC dispatch together, delegating the actual work to helpers in
 * `./mcp-handlers`. The behaviours this spec locks down are:
 *
 *   1. MCP tool registration — constructor wiring:
 *        - builds `PtahAPI` eagerly via the injected `PtahAPIBuilder`,
 *        - resolves `WebviewManager` lazily only when registered in the
 *          container (present in VS Code, absent in Electron),
 *        - detects `hasIDECapabilities` via `container.isRegistered`.
 *
 *   2. Request dispatch — `start()` / `stop()`:
 *        - `start()` reads the configured port from `IWorkspaceProvider`,
 *          delegates to `startHttpServer`, stores the returned server + port
 *          for later shutdown, and wires `onMCPRequest` to `handleMCPRequest`
 *          with the correct context (api, permissions, webview, flags,
 *          disabled namespaces).
 *        - Calling `start()` twice returns the existing port without
 *          re-spinning the server.
 *        - `stop()` tears the server down via `stopHttpServer` and clears
 *          internal state.
 *        - `ensureRegisteredForSubagents()` is idempotent and writes the
 *          `.mcp.json` config only once.
 *        - `setToolResultCallback` / `clearToolResultCallback` forward the
 *          callback to the dispatch context on the NEXT `start()`.
 *
 *   3. Error propagation — MCP request dispatch surfaces handler errors via
 *      the mocked `handleMCPRequest` without swallowing them, and `dispose()`
 *      surfaces `stop()` failures to the logger instead of silently eating
 *      them (the regression that motivated `disposeAsync`).
 *
 * External surfaces are mocked:
 *   - `./mcp-handlers` — HTTP + protocol helpers replaced with `jest.fn()`s.
 *   - `fs` — `.mcp.json` read/write isolated from disk.
 *   - `tsyringe.container` — registration checks controlled per-test via
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

// Replace ptah-api-builder.service at the module boundary — its real impl
// transitively loads workspace-intelligence + agent-sdk which in turn pull in
// the `vscode` ambient module.  We only need the IDE_CAPABILITIES_TOKEN
// Symbol (read by the SUT constructor) and the class as a type.
jest.mock('./ptah-api-builder.service', () => ({
  IDE_CAPABILITIES_TOKEN: Symbol.for('IDECapabilities'),
  PtahAPIBuilder: class PtahAPIBuilderStub {},
}));

// Replace the permission-prompt service for the same reason: it transitively
// pulls in webview/agent-sdk types we don't want to load here.
jest.mock('../permission/permission-prompt.service', () => ({
  PermissionPromptService: class PermissionPromptServiceStub {},
}));

jest.mock('./mcp-handlers', () => ({
  startHttpServer: jest.fn(),
  stopHttpServer: jest.fn(),
  getConfiguredPort: jest.fn(),
  handleMCPRequest: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

import * as http from 'http';
import * as fs from 'fs';
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
import { CodeExecutionMCP } from './code-execution-mcp.service';
import { IDE_CAPABILITIES_TOKEN } from './ptah-api-builder.service';
import type { PtahAPIBuilder } from './ptah-api-builder.service';
import type { PermissionPromptService } from '../permission/permission-prompt.service';
import type { PtahAPI, MCPRequest, MCPResponse } from './types';
import {
  startHttpServer as startHttpServerMock,
  stopHttpServer as stopHttpServerMock,
  getConfiguredPort as getConfiguredPortMock,
  handleMCPRequest as handleMCPRequestMock,
} from './mcp-handlers';

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
  // Protocol handlers never call anything on this object — it's opaque to
  // the SUT; stopHttpServer is mocked. A plain Record is enough.
  return {} as unknown as http.Server;
}

// Typed aliases for the mocked helpers — avoids `as any` at every callsite.
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

  // Constructor reads container.isRegistered(TOKENS.WEBVIEW_MANAGER) +
  // IDE_CAPABILITIES_TOKEN. We control both per-test via registerInstance.
  if (opts.registerWebview) {
    container.registerInstance(TOKENS.WEBVIEW_MANAGER, opts.registerWebview);
  }
  if (opts.registerIdeCapabilities) {
    container.registerInstance(IDE_CAPABILITIES_TOKEN, {});
  }

  const service = new CodeExecutionMCP(
    apiBuilder,
    asLogger(logger),
    workspaceState as unknown as IStateStorage,
    workspaceProvider as unknown as IWorkspaceProvider,
    permissionPromptService,
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
  // Sensible defaults — individual tests override as needed.
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
});

afterEach(() => {
  container.clearInstances();
  container.reset();
});

// ===========================================================================
// 1. MCP tool registration — constructor wiring
// ===========================================================================

describe('CodeExecutionMCP — construction / tool registration', () => {
  it('builds the ptah API eagerly via the injected PtahAPIBuilder', () => {
    const { apiBuilder } = build();
    expect(apiBuilder.build).toHaveBeenCalledTimes(1);
  });

  it('resolves WebviewManager when registered in the container (VS Code host)', async () => {
    const webview = buildWebviewManager();
    const { service } = build({ registerWebview: webview });
    await service.start();

    // Wire-through assertion — the dispatch closure receives the same webview.
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
// 2. Request dispatch — start/stop lifecycle and MCP routing
// ===========================================================================

describe('CodeExecutionMCP — start/stop lifecycle', () => {
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
    // stopHttpServer is still invoked with null — the helper guards internally.
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

describe('CodeExecutionMCP — ensureRegisteredForSubagents', () => {
  it('no-ops when server has not been started', () => {
    const { service } = build({ folders: ['/ws'] });
    service.ensureRegisteredForSubagents();
    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });

  it('writes the ptah entry into .mcp.json when workspace + port are known', async () => {
    fsExistsSyncMock.mockReturnValue(false);
    const { service } = build({ folders: ['/ws'] });
    await service.start();

    service.ensureRegisteredForSubagents();

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

  it('is idempotent — second call after registration writes nothing', async () => {
    const { service } = build({ folders: ['/ws'] });
    await service.start();

    service.ensureRegisteredForSubagents();
    service.ensureRegisteredForSubagents();

    expect(fsWriteFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('skips registration when no workspace folder is open', async () => {
    const { service } = build({ folders: [] });
    await service.start();

    service.ensureRegisteredForSubagents();

    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });

  it('warns but does not throw when .mcp.json is unparseable', async () => {
    fsExistsSyncMock.mockReturnValue(true);
    fsReadFileSyncMock.mockReturnValue('{not json');

    const { service, logger } = build({ folders: ['/ws'] });
    await service.start();

    expect(() => service.ensureRegisteredForSubagents()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to register in .mcp.json'),
      'CodeExecutionMCP',
    );
  });
});

// ===========================================================================
// 3. Error propagation — dispatch + dispose surfaces
// ===========================================================================

describe('CodeExecutionMCP — error propagation', () => {
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
    // Must register first — unregisterFromMcpJson now early-returns when the
    // service was never registered, guarding the on-shutdown disk read.
    service.ensureRegisteredForSubagents();

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
// 4. unregister idempotency — Bug #9 (Wave A.B1)
// ===========================================================================

describe('CodeExecutionMCP — unregister idempotency', () => {
  it('stop() without prior ensureRegisteredForSubagents() does not read .mcp.json', async () => {
    // Repro of Bug #9: stop() unconditionally invoked unregisterFromMcpJson(),
    // which in turn fs.readFileSync'd .mcp.json on every shutdown — even when
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
    service.ensureRegisteredForSubagents();

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
    service.ensureRegisteredForSubagents();
    await service.stop();

    fsReadFileSyncMock.mockClear();
    fsExistsSyncMock.mockClear();
    fsWriteFileSyncMock.mockClear();

    await service.stop();

    expect(fsReadFileSyncMock).not.toHaveBeenCalled();
    expect(fsWriteFileSyncMock).not.toHaveBeenCalled();
  });
});
