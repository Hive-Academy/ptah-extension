import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { SessionId, type IAgentAdapter } from '@ptah-extension/shared';
import {
  createCodexChatHostPorts,
  type CodexChatHostPorts,
} from '@ptah-extension/rpc-handlers';
import type { ElectronCodexBindingInput, ElectronCodexPreparedSession } from './codex-binding.types';
import {
  createElectronCodexSessionState,
  createElectronCodexSessionLifecycle,
} from './codex-session-binding';
import { TOKENS } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import {
  mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ELECTRON_CODEX_BOUND_TOKENS } from './expected-resolvable';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  CodexParityGate,
  findCodexExecutablePin,
  buildCodexExecutionProfile,
  normalizeCodexHomeKey,
  normalizeCodexWorkspaceKey,
  CodexSessionHistoryError,
  type CodexSessionHistory,
  resolveGatedCodexRuntime,
  type CodexRuntime,
  type CodexExecutionProfile,
  type CodexThreadIdentity,
} from '@ptah-extension/codex-runtime';
import {
  CodexChatAdapter,
  registerCodexChatServices,
  SDK_TOKENS,
  SessionTurnStateRegistry,
  wireAgentAdapterAliases,
  type CodexChatAdapterPorts,
  type SessionMetadata,
  type PermissionPromptLifecycleEvent,
  resolveCodexNativeBinaryPath,
} from '@ptah-extension/agent-sdk';
import {
  bindElectronCodexChat,
  createElectronCodexExecutable,
  inspectElectronCodexBinary,
  resolveElectronCodexBundledRoot,
  createElectronCodexRouting,
  createElectronCodexScopeFactory,
  createElectronCodexHistoryPort,
  ElectronCodexHistoryError,
  type ElectronCodexScopeInput,
  type ElectronCodexHistoryDeps,
} from './codex-runtime-composition';
import { resolveElectronCodexLaneRuntime } from './codex-lane-composition';
import { isElectronCodexConsumerAdmitted } from './codex-electron-admission';

jest.mock('@ptah-extension/codex-runtime', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/codex-runtime')>(
    '@ptah-extension/codex-runtime',
  ),
  findCodexExecutablePin: jest.fn(),
  buildCodexExecutionProfile: jest.fn(
    jest.requireActual<typeof import('@ptah-extension/codex-runtime')>(
      '@ptah-extension/codex-runtime',
    ).buildCodexExecutionProfile,
  ),
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/agent-sdk')>(
    '@ptah-extension/agent-sdk',
  ),
  resolveCodexNativeBinaryPath: jest.fn(),
}));

jest.mock('@ptah-extension/rpc-handlers', () => {
  const actual = jest.requireActual<typeof import('@ptah-extension/rpc-handlers')>(
    '@ptah-extension/rpc-handlers',
  );
  return {
    ...actual,
    createCodexChatHostPorts: jest.fn(actual.createCodexChatHostPorts),
  };
});

function historyFixture() {
  const home = join(temporaryRoot, 'saved-home');
  const workspace = join(temporaryRoot, 'workspace');
  mkdirSync(home);
  mkdirSync(workspace);
  const mcpConfig = '[mcp_servers.ptah]\nurl = "http://127.0.0.1:7700/mcp"\n';
  writeFileSync(join(home, 'config.toml'), mcpConfig);
  const sessionId = SessionId.create();
  const row: SessionMetadata = {
    sessionId,
    name: 'Saved native chat',
    workspaceId: workspace,
    providerId: 'openai-codex',
    createdAt: 1,
    lastActiveAt: 1,
    totalCost: 0,
    totalTokens: { input: 0, output: 0 },
    codexExecution: {
      version: 1,
      runtime: 'codex-app-server',
      sessionId,
      providerId: 'openai-codex',
      workspaceId: normalizeCodexWorkspaceKey(workspace, process.platform),
      codex: { normalizedHome: normalizeCodexHomeKey(home, process.platform) },
    },
  };
  const snapshot: CodexSessionHistory = { rootThreadId: sessionId, threads: [] };
  const readHistory = jest.fn(async (
    _profile: CodexExecutionProfile,
    _resume: CodexThreadIdentity,
    _signal?: AbortSignal,
  ): Promise<CodexSessionHistory> => snapshot);
  const runtime = {
    open: jest.fn(async () => { throw new Error('History must not resume a thread'); }),
    readHistory,
  };
  const scopes: Array<{ container: ReturnType<typeof container.createChildContainer>; dispose: jest.Mock }> = [];
  const verifyBinary = jest.fn(async () => undefined);
  const logger = { error: jest.fn() };
  const liveProfiles = new Map<SessionId, ElectronCodexPreparedSession>();
  const deps: ElectronCodexHistoryDeps = {
    currentHome: () => home,
    verifyBinary,
    createScope: () => {
      const child = container.createChildContainer();
      const dispose = jest.fn(async () => child.dispose());
      scopes.push({ container: child, dispose });
      return { container: child, dispose };
    },
    resolveRuntime: () => runtime,
    liveProfiles,
    timeoutMs: 25,
    logger,
  };
  return { home, workspace, row, snapshot, runtime, readHistory, scopes, verifyBinary, logger, deps, mcpConfig };
}

describe('Electron native history binding', () => {
  it('reads after live scope loss with the saved home and unchanged MCP configuration', async () => {
    const h = historyFixture();
    const port = createElectronCodexHistoryPort(h.deps);
    expect(await port.readHistory(h.row)).toBe(h.snapshot);
    expect(h.scopes).toHaveLength(1);
    expect(h.scopes[0]?.dispose).toHaveBeenCalledTimes(1);
    const firstCall = h.readHistory.mock.calls[0];
    if (!firstCall) throw new Error('History reader was not called');
    const [profile, resume] = firstCall;
    expect(profile.normalizedHome).toBe(h.row.codexExecution?.codex.normalizedHome);
    expect(profile.cwd).toBe(realpathSync(h.workspace));
    expect(resume.threadId).toBe(h.row.sessionId);
    expect(readFileSync(join(h.home, 'config.toml'), 'utf8')).toBe(h.mcpConfig);
    expect(h.runtime.open).not.toHaveBeenCalled();
  });

  it('keeps the matching live session MCP references in the read profile', async () => {
    const h = historyFixture();
    const profile = buildCodexExecutionProfile({
      session: {
        contextId: 'live-chat', consumer: 'chat', providerId: 'openai-codex',
        workspaceId: h.workspace, cwd: h.workspace, model: 'gpt', permissionLevel: 'ask',
        normalizedHome: h.home,
        mcpServers: [{
          name: 'ptah', transport: 'http', url: 'http://127.0.0.1:7700/mcp',
          urlReference: 'ptah-url', headerReferences: { Authorization: 'ptah-auth' },
          authReference: 'ptah-auth', toolTimeoutSec: 15,
        }, {
          name: 'local', transport: 'stdio', command: 'local-mcp', args: ['--safe'],
          envReferences: { TOKEN: 'local-token' }, toolTimeoutSec: 20,
        }],
      },
      paths: {
        platform: process.platform === 'win32' ? 'win32' : 'posix',
        baseDirectory: h.workspace,
        entries: {
          [h.workspace]: { kind: 'directory', realpath: realpathSync(h.workspace) },
          [h.home]: { kind: 'directory', realpath: realpathSync(h.home) },
        },
      },
    });
    if (!h.row.codexExecution) throw new Error('Missing fixture execution');
    h.deps.liveProfiles.set(h.row.codexExecution.sessionId, { profile });
    await createElectronCodexHistoryPort(h.deps).readHistory(h.row);
    expect(h.readHistory.mock.calls[0]?.[0].mcpServers).toEqual(profile.mcpServers);
    expect(h.scopes[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not copy a live profile from another Codex home', async () => {
    const h = historyFixture();
    const otherHome = join(temporaryRoot, 'live-other-home');
    mkdirSync(otherHome);
    const live = buildCodexExecutionProfile({
      session: {
        contextId: 'other', consumer: 'chat', providerId: 'openai-codex',
        workspaceId: h.workspace, cwd: h.workspace, model: 'gpt', permissionLevel: 'ask',
        normalizedHome: otherHome,
        mcpServers: [{ name: 'other', transport: 'http', url: 'http://127.0.0.1:7701/mcp', headerReferences: {} }],
      },
      paths: {
        platform: process.platform === 'win32' ? 'win32' : 'posix',
        baseDirectory: h.workspace,
        entries: {
          [h.workspace]: { kind: 'directory', realpath: realpathSync(h.workspace) },
          [otherHome]: { kind: 'directory', realpath: realpathSync(otherHome) },
        },
      },
    });
    if (!h.row.codexExecution) throw new Error('Missing fixture execution');
    h.deps.liveProfiles.set(h.row.codexExecution.sessionId, { profile: live });
    await createElectronCodexHistoryPort(h.deps).readHistory(h.row);
    expect(h.readHistory.mock.calls[0]?.[0].mcpServers).toEqual([]);
  });

  it('rejects a changed home before binary verification or scope allocation', async () => {
    const h = historyFixture();
    const other = join(temporaryRoot, 'other-home');
    mkdirSync(other);
    const port = createElectronCodexHistoryPort({ ...h.deps, currentHome: () => other });
    await expect(port.readHistory(h.row)).rejects.toMatchObject({ code: 'homeMismatch' });
    expect(h.verifyBinary).not.toHaveBeenCalled();
    expect(h.scopes).toHaveLength(0);
  });

  it('reports binary failure without allocating a scope', async () => {
    const h = historyFixture();
    const port = createElectronCodexHistoryPort({
      ...h.deps,
      verifyBinary: async () => { throw new Error('sensitive executable path'); },
    });
    await expect(port.readHistory(h.row)).rejects.toEqual(
      new ElectronCodexHistoryError('binaryUnavailable'),
    );
    expect(h.scopes).toHaveLength(0);
  });

  it('maps a missing rollout to a fixed user-safe error and disposes', async () => {
    const h = historyFixture();
    h.readHistory.mockRejectedValueOnce(new CodexSessionHistoryError('threadNotFound'));
    await expect(createElectronCodexHistoryPort(h.deps).readHistory(h.row))
      .rejects.toEqual(new ElectronCodexHistoryError('threadNotFound'));
    expect(h.scopes[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes on timeout and abort', async () => {
    const h = historyFixture();
    h.readHistory.mockImplementation(async () => new Promise<CodexSessionHistory>(() => undefined));
    const port = createElectronCodexHistoryPort({ ...h.deps, timeoutMs: 5 });
    await expect(port.readHistory(h.row)).rejects.toMatchObject({ code: 'timeout' });
    const controller = new AbortController();
    const abortPort = createElectronCodexHistoryPort({ ...h.deps, timeoutMs: 1000 });
    const pending = abortPort.readHistory(h.row, controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(h.readHistory.mock.calls[0]?.[2]?.aborted).toBe(true);
    expect(h.readHistory.mock.calls[1]?.[2]?.aborted).toBe(true);
    expect(h.scopes).toHaveLength(2);
    expect(h.scopes.every((scope) => scope.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('preserves success and timeout when scope disposal fails', async () => {
    const h = historyFixture();
    const dispose = jest.fn(async () => { throw new Error('dispose failed'); });
    const createScope: ElectronCodexHistoryDeps['createScope'] = () => {
      const child = container.createChildContainer();
      return {
        container: child,
        dispose: async () => {
          await child.dispose();
          await dispose();
        },
      };
    };
    const port = createElectronCodexHistoryPort({ ...h.deps, createScope });
    expect(await port.readHistory(h.row)).toBe(h.snapshot);
    h.readHistory.mockImplementation(async () => new Promise<CodexSessionHistory>(() => undefined));
    await expect(port.readHistory(h.row)).rejects.toMatchObject({ code: 'timeout' });
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(h.logger.error).toHaveBeenCalledTimes(2);
  });

  it('maps scope creation failure and rejects a pre-aborted signal before setup', async () => {
    const h = historyFixture();
    const port = createElectronCodexHistoryPort({
      ...h.deps,
      createScope: () => { throw new Error('scope failed'); },
    });
    await expect(port.readHistory(h.row)).rejects.toMatchObject({ code: 'runtimeFailed' });
    const controller = new AbortController();
    controller.abort();
    await expect(port.readHistory(h.row, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(h.scopes).toHaveLength(0);
    expect(h.readHistory).not.toHaveBeenCalled();
  });

  it('disposes a scope whose runtime has no history reader', async () => {
    const h = historyFixture();
    const port = createElectronCodexHistoryPort({
      ...h.deps,
      resolveRuntime: () => ({ open: h.runtime.open }),
    });
    await expect(port.readHistory(h.row)).rejects.toMatchObject({ code: 'runtimeFailed' });
    expect(h.scopes[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('limits simultaneous history processes to two', async () => {
    const h = historyFixture();
    const controllers: Array<(snapshot: CodexSessionHistory) => void> = [];
    h.readHistory.mockImplementation(() => new Promise<CodexSessionHistory>((resolve) => controllers.push(resolve)));
    const port = createElectronCodexHistoryPort(h.deps);
    const first = port.readHistory(h.row);
    const second = port.readHistory(h.row);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(port.readHistory(h.row)).rejects.toMatchObject({ code: 'busy' });
    expect(h.scopes).toHaveLength(2);
    for (const resolve of controllers) resolve(h.snapshot);
    await expect(Promise.all([first, second])).resolves.toEqual([h.snapshot, h.snapshot]);
  });

  it('gives simultaneous sessions distinct scopes and thread identities', async () => {
    const h = historyFixture();
    const secondId = SessionId.create();
    if (!h.row.codexExecution) throw new Error('Missing fixture execution');
    const second: SessionMetadata = {
      ...h.row,
      sessionId: secondId,
      codexExecution: { ...h.row.codexExecution, sessionId: secondId },
    };
    const port = createElectronCodexHistoryPort(h.deps);
    const [firstResult, secondResult] = await Promise.all([
      port.readHistory(h.row), port.readHistory(second),
    ]);
    expect(firstResult).toBe(h.snapshot);
    expect(secondResult).toBe(h.snapshot);
    expect(h.scopes).toHaveLength(2);
    expect(h.scopes[0]?.container).not.toBe(h.scopes[1]?.container);
    expect(h.readHistory.mock.calls.map(([, resume]) => resume.threadId)).toEqual([
      h.row.sessionId, secondId,
    ]);
    expect(h.scopes.every((scope) => scope.dispose.mock.calls.length === 1)).toBe(true);
  });
});

let temporaryRoot: string;
let bundledRoot: string;
let executablePath: string;
beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'ptah-codex-'));
  bundledRoot = join(temporaryRoot, 'node_modules');
  mkdirSync(bundledRoot);
  executablePath = join(bundledRoot, 'codex');
  writeFileSync(executablePath, 'fixture');
  jest.mocked(findCodexExecutablePin).mockReset().mockReturnValue({
    ...manifest, binarySha256: createHash('sha256').update('fixture').digest('hex'),
  });
  jest.mocked(resolveCodexNativeBinaryPath).mockReset().mockReturnValue(executablePath);
});
afterEach(() => rmSync(temporaryRoot, { recursive: true, force: true }));

const platform = { platform: 'win32', arch: 'x64' };
const manifest = {
  ...platform,
  pinnedVersion: '0.155.1',
  version: '0.155.1',
  binarySha256: 'a'.repeat(64),
  schemaSha256: 'b'.repeat(64),
};

function setup(isPackaged = false, env: Record<string, string> = {}) {
  const parent = container.createChildContainer();
  const input: ElectronCodexScopeInput = {
    parent,
    isPackaged,
    env,
    platform,
    expectedManifestRow: manifest,
    bundledRoot,
    ports: {
      binary: {
        ...platform,
        executablePath: realpathSync(executablePath),
        versionOutput: 'codex-cli 0.155.1',
        sha256: 'a'.repeat(64),
      },
      spawner: {
        spawnProcess: jest.fn(() => {
          throw new Error('Unexpected spawn');
        }),
      },
      store: {
        persist: jest.fn(async () => undefined),
        markInactive: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
      },
      clock: {
        now: () => 0,
        setTimeout: () => ({ dispose: jest.fn() }),
      },
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      usage: null,
    },
  };
  return { input, parent };
}

describe('Electron Codex runtime infrastructure', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not inspect the executable when creating a factory or rejecting native-off use', async () => {
    const { input, parent } = setup(true);
    jest.mocked(resolveCodexNativeBinaryPath).mockClear();
    const factory = createElectronCodexScopeFactory({
      ...input, platform: { platform: 'linux', arch: 'x64' },
    });
    expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
    expect(() => factory({ request: async () => 'decline' })).toThrow(
      'Native Codex chat is disabled',
    );
    expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
    await parent.dispose();
  });

  it('owns lane and chat runtimes in separate scopes with separate approval sinks', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const chatSink = { request: jest.fn(async () => 'decline' as const) };
    const laneSink = { request: jest.fn(async () => 'decline' as const) };
    const chat = createElectronCodexScopeFactory(input)(chatSink);
    const lane = createElectronCodexScopeFactory(input, 'lane')(laneSink);
    try {
      expect(chat.container.resolve(CODEX_RUNTIME_TOKENS.Runtime))
        .not.toBe(lane.container.resolve(CODEX_RUNTIME_TOKENS.Runtime));
      expect(chat.container.resolve(CODEX_RUNTIME_TOKENS.ApprovalSink)).toBe(chatSink);
      expect(lane.container.resolve(CODEX_RUNTIME_TOKENS.ApprovalSink)).toBe(laneSink);
      expect(resolveGatedCodexRuntime(chat.container, 'chat', platform)).toBeDefined();
      expect(resolveElectronCodexLaneRuntime(lane.container, {
        isPackaged: false, platform,
      })).toBe(lane.container.resolve(CODEX_RUNTIME_TOKENS.Runtime));
      expect(resolveElectronCodexLaneRuntime(lane.container, {
        isPackaged: true, platform,
      })).toBe(lane.container.resolve(CODEX_RUNTIME_TOKENS.Runtime));
      expect(() => resolveElectronCodexLaneRuntime(lane.container, {
        isPackaged: true, platform: { platform: 'linux', arch: 'x64' },
      })).toThrow('parity gate');
      expect(input.ports.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await lane.dispose();
      await chat.dispose();
      await parent.dispose();
    }
  });

  it('uses the gated runtime for a packaged lane after parity admission', async () => {
    const original = Object.getOwnPropertyDescriptor(CodexParityGate.prototype, 'isEnabled');
    Object.defineProperty(CodexParityGate.prototype, 'isEnabled', {
      configurable: true, value: () => true,
    });
    const { input, parent } = setup(true);
    const lane = createElectronCodexScopeFactory(input, 'lane')({
      request: async () => 'decline',
    });
    try {
      expect(resolveElectronCodexLaneRuntime(lane.container, {
        isPackaged: true, platform,
      })).toBe(resolveGatedCodexRuntime(lane.container, 'lane', platform));
    } finally {
      await lane.dispose();
      await parent.dispose();
      if (original) Object.defineProperty(CodexParityGate.prototype, 'isEnabled', original);
    }
  });

  it('defers a missing bundled binary until native scope creation without allocating a child', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    jest.mocked(resolveCodexNativeBinaryPath).mockClear();
    const factory = createElectronCodexScopeFactory(input);
    expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
    const createChild = jest.spyOn(parent, 'createChildContainer');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(undefined);
    expect(() => factory({ request: async () => 'decline' })).toThrow(
      'Bundled Codex executable unavailable',
    );
    expect(createChild).not.toHaveBeenCalled();
    await parent.dispose();
  });

  it('refuses unpackaged chat without a development route', () => {
    expect(
      createElectronCodexRouting({ platform, isPackaged: false, env: {} }),
    ).toEqual({
      devRoute: null,
      capabilities: { nativeCodex: false, nativeCodexGateway: false },
    });
  });

  it('ignores the development switch in packaged Electron', () => {
    expect(
      createElectronCodexRouting({
        platform,
        isPackaged: true,
        env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      }),
    ).toEqual({
      devRoute: null,
      capabilities: { nativeCodex: true, nativeCodexGateway: false },
    });
  });

  it('uses the shared chat and gateway gates without the development switch', () => {
    const gate = new CodexParityGate();
    expect(
      createElectronCodexRouting({ platform, isPackaged: false, env: {} }).capabilities,
    ).toEqual({
      nativeCodex: gate.isEnabled('chat', platform),
      nativeCodexGateway: gate.isEnabled('gateway', platform),
    });
  });

  it('does not admit unpackaged chat from a gateway-only development route', () => {
    expect(isElectronCodexConsumerAdmitted(
      { isPackaged: false, platform }, 'chat',
      { consumers: ['gateway'], source: 'PTAH_CODEX_RUNTIME_DEV' },
    )).toBe(false);
  });

  it('enables development chat and gateway while leaving lane gated', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const scope = createElectronCodexScopeFactory(input)({
      request: async () => 'decline',
    });
    try {
      expect(createElectronCodexRouting(input).capabilities).toEqual({
        nativeCodex: true,
        nativeCodexGateway: true,
      });
      expect(resolveGatedCodexRuntime(scope.container, 'chat', platform)).toBe(
        resolveGatedCodexRuntime(scope.container, 'chat', platform),
      );
      expect(resolveGatedCodexRuntime(scope.container, 'gateway', platform)).toBe(
        resolveGatedCodexRuntime(scope.container, 'chat', platform),
      );
      expect(() =>
        resolveGatedCodexRuntime(scope.container, 'lane', platform),
      ).toThrow('parity gate');
      expect(parent.isRegistered(CODEX_RUNTIME_TOKENS.Runtime)).toBe(false);
      expect(input.ports.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await scope.dispose();
      await parent.dispose();
    }
  });

  it('closes runtime before container after a rejected open; disposal is idempotent', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const scope = createElectronCodexScopeFactory(input)({
      request: async () => 'decline',
    });
    const runtime = scope.container.resolve<CodexRuntime>(
      CODEX_RUNTIME_TOKENS.Runtime,
    );
    const order: string[] = [];
    jest.spyOn(runtime, 'close').mockImplementation(async () => {
      order.push('runtime');
    });
    const dispose = scope.container.dispose.bind(scope.container);
    jest.spyOn(scope.container, 'dispose').mockImplementation(async () => {
      order.push('container');
      await dispose();
    });
    const profile = buildCodexExecutionProfile({
      session: {
        contextId: 'chat-1',
        consumer: 'chat',
        providerId: 'openai-codex',
        workspaceId: 'workspace-1',
        cwd: '/work',
        model: 'model',
        permissionLevel: 'ask',
      },
      defaultHome: '/home',
      paths: {
        platform: 'posix',
        baseDirectory: '/',
        entries: {
          '/work': { kind: 'directory', realpath: '/work' },
          '/home': { kind: 'directory', realpath: '/home' },
        },
      },
    });
    // Real open reaches the deliberately failing process port. Cleanup follows
    // the adapter's finally path and must still close runtime before container.
    try {
      await expect(
        resolveGatedCodexRuntime(scope.container, 'chat', platform).open(
          profile,
        ),
      ).rejects.toThrow();
    } finally {
      await Promise.all([scope.dispose(), scope.dispose()]);
    }
    expect(order).toEqual(['runtime', 'container']);
    await parent.dispose();
  });

  it('disposes the container even when runtime close fails', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const scope = createElectronCodexScopeFactory(input)({
      request: async () => 'decline',
    });
    const runtime = scope.container.resolve<CodexRuntime>(
      CODEX_RUNTIME_TOKENS.Runtime,
    );
    jest.spyOn(runtime, 'close').mockRejectedValue(new Error('close failed'));
    const dispose = jest.spyOn(scope.container, 'dispose');
    await expect(scope.dispose()).rejects.toThrow('close failed');
    expect(dispose).toHaveBeenCalledTimes(1);
    await parent.dispose();
  });

  it('uses only the bundled resolver and refuses an absent executable', () => {
    expect(
      createElectronCodexExecutable(manifest, bundledRoot).resolvedPath,
    ).toBe(realpathSync(executablePath));
    expect(resolveCodexNativeBinaryPath).toHaveBeenLastCalledWith();
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(undefined);
    expect(() => createElectronCodexExecutable(manifest, bundledRoot)).toThrow(
      'Bundled Codex executable unavailable',
    );
    const globalExecutable = join(temporaryRoot, 'global-codex');
    writeFileSync(globalExecutable, 'global');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(globalExecutable);
    expect(() => createElectronCodexExecutable(manifest, bundledRoot)).toThrow(
      'outside the host bundle',
    );
  });
  it('finds the nearest workspace node_modules from the dist app', () => {
    expect(resolveElectronCodexBundledRoot({
      isPackaged: false, resourcesPath: join(temporaryRoot, 'resources'),
      appPath: join(temporaryRoot, 'dist', 'apps', 'ptah-electron'),
    })).toBe(bundledRoot);
  });

  it('keeps the packaged root strict even when it does not exist', () => {
    const resourcesPath = join(temporaryRoot, 'resources');
    const root = resolveElectronCodexBundledRoot({
      isPackaged: true, resourcesPath, appPath: temporaryRoot,
    });
    expect(root).toBe(join(resourcesPath, 'app.asar.unpacked', 'node_modules'));
    expect(() => createElectronCodexExecutable(manifest, root)).toThrow();
  });

  it('rejects a packaged build whose executable resolves outside the bundle', () => {
    const resourcesPath = join(temporaryRoot, 'resources');
    const root = resolveElectronCodexBundledRoot({
      isPackaged: true, resourcesPath, appPath: temporaryRoot,
    });
    mkdirSync(root, { recursive: true });
    const globalExecutable = join(temporaryRoot, 'packaged-global-codex');
    writeFileSync(globalExecutable, 'global');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(globalExecutable);
    expect(() => createElectronCodexExecutable(manifest, root)).toThrow(
      'Codex executable is outside the host bundle',
    );
  });

  it('accepts a worktree junction and reports the canonical executable identity', () => {
    const junction = join(temporaryRoot, 'worktree-modules');
    symlinkSync(bundledRoot, junction, 'junction');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValue(join(junction, 'codex'));
    expect(createElectronCodexExecutable(manifest, junction).resolvedPath)
      .toBe(realpathSync(executablePath));
  });

  it('rejects a package symlink escaping the bundle', () => {
    const outside = join(temporaryRoot, 'global');
    mkdirSync(outside);
    writeFileSync(join(outside, 'codex'), 'global');
    const link = join(bundledRoot, 'linked-package');
    symlinkSync(outside, link, 'junction');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValue(join(link, 'codex'));
    expect(() => createElectronCodexExecutable(manifest, bundledRoot))
      .toThrow('Codex executable is outside the host bundle');
  });

  it('disposes an allocated child when runtime resolution fails', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const child = parent.createChildContainer();
    jest.spyOn(parent, 'createChildContainer').mockReturnValue(child);
    jest.spyOn(child, 'resolve').mockImplementation(() => { throw new Error('resolve failed'); });
    const dispose = jest.spyOn(child, 'dispose');
    expect(() => createElectronCodexScopeFactory(input)({ request: async () => 'decline' }))
      .toThrow('resolve failed');
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
    await parent.dispose();
  });
});

function bindingFixture() {
  const parent = container.createChildContainer();
  const unsubscribe = jest.fn();
  const logger = createMockLogger();
  parent.register(TOKENS.LOGGER, { useValue: logger });
  parent.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
    useValue: {
      getAll: jest.fn(async () => []),
      get: jest.fn(async () => null),
      onMetadataChanged: () => unsubscribe,
      updateCodexExecution: jest.fn(async () => undefined),
    },
  });
  const scopeResolver = { readForPath: jest.fn() };
  const settingsStore: ElectronCodexBindingInput['settingsStore'] = {
    readGlobal: jest.fn(),
    writeGlobal: jest.fn(async () => undefined),
    readSecret: jest.fn(async () => undefined),
    writeSecret: jest.fn(async () => undefined),
    deleteSecret: jest.fn(async () => undefined),
    watchGlobal: jest.fn(() => ({ dispose: jest.fn() })),
    watchSecret: jest.fn(() => ({ dispose: jest.fn() })),
    flushSync: jest.fn(),
  };
  parent.register(
    AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER,
    {
      useValue: { resolveExecutionProfile: jest.fn() },
    },
  );
  parent.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: { getWorkspaceFolders: jest.fn(() => []) },
  });
  parent.register(PLATFORM_TOKENS.PLATFORM_INFO, {
    useValue: { extensionPath: '/bundled', globalStoragePath: '/data' },
  });
  parent.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: { broadcastMessage: jest.fn(async () => undefined) },
  });
  parent.register(SDK_TOKENS.HOST_ATTENTION_COORDINATOR, {
    useValue: { resolve: jest.fn() },
  });
  const legacy = { initialize: jest.fn(async () => true) };
  parent.register(SDK_TOKENS.SDK_AGENT_ADAPTER, { useValue: legacy });
  const permissionHandler = {
    handleResponse: jest.fn(),
    publishPromptLifecycle: jest.fn(),
  };
  parent.register(SDK_TOKENS.SDK_PERMISSION_HANDLER, {
    useValue: permissionHandler,
  });
  parent.register(SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY, {
    useValue: new SessionTurnStateRegistry(),
  });
  registerCodexChatServices(parent);
  wireAgentAdapterAliases(parent);
  return {
    parent, unsubscribe, legacy, permissionHandler, scopeResolver, settingsStore, logger,
  };
}

describe('Electron complete Codex binding', () => {
  it('keeps unpackaged chat without a development route gated at the resolver', async () => {
    const { parent, scopeResolver, settingsStore } = bindingFixture();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false, env: {}, platform, bundledRoot, scopeResolver, settingsStore,
    });
    const scope = parent.createChildContainer();
    scope.register(CODEX_RUNTIME_TOKENS.ParityGate, { useValue: new CodexParityGate() });
    scope.register(CODEX_RUNTIME_TOKENS.DevRouteOverride, { useFactory: () => null });
    try {
      expect(binding.capabilities.nativeCodex).toBe(false);
      const ports = parent.resolve<CodexChatAdapterPorts>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
      expect(() => ports.resolveRuntime?.(scope, 'chat')).toThrow(
        'Codex production routing disabled by parity gate',
      );
    } finally {
      await scope.dispose();
      await binding.dispose();
      await parent.dispose();
    }
  });

  it('resolves unpackaged chat through the development route and emits its warning', async () => {
    const { input, parent: scopeParent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const { parent, scopeResolver, settingsStore } = bindingFixture();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false, env: input.env, platform, bundledRoot, scopeResolver, settingsStore,
    });
    const scope = createElectronCodexScopeFactory(input)({ request: async () => 'decline' });
    try {
      expect(binding.capabilities.nativeCodex).toBe(true);
      const ports = parent.resolve<CodexChatAdapterPorts>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
      expect(ports.resolveRuntime?.(scope.container, 'chat')).toBe(
        scope.container.resolve(CODEX_RUNTIME_TOKENS.Runtime),
      );
      expect(input.ports.logger?.warn).toHaveBeenCalledWith(
        'PTAH_CODEX_RUNTIME_DEV enables development-only Codex chat routing; production parity gate remains disabled',
      );
    } finally {
      await scope.dispose();
      await binding.dispose();
      await scopeParent.dispose();
      await parent.dispose();
    }
  });

  it('admits packaged win32/x64 chat, resolves its scoped runtime, and logs once', async () => {
    const { parent, scopeResolver, settingsStore, logger } = bindingFixture();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: true, env: {}, platform, bundledRoot, scopeResolver, settingsStore,
    });
    const scope = parent.createChildContainer();
    const runtime = { open: jest.fn() };
    scope.register(CODEX_RUNTIME_TOKENS.Runtime, { useValue: runtime });
    try {
      expect(binding.capabilities.nativeCodex).toBe(true);
      expect(binding.capabilities.nativeCodexGateway).toBe(false);
      const ports = parent.resolve<CodexChatAdapterPorts>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
      expect(ports.resolveRuntime?.(scope, 'chat')).toBe(runtime);
      const admissionLogs = jest.mocked(logger.info).mock.calls.filter(
        ([message]) => message ===
          'Codex chat admitted for packaged Electron win32/x64 by signed proof (D29/D30)',
      );
      expect(admissionLogs).toHaveLength(1);
    } finally {
      await scope.dispose();
      await binding.dispose();
      await parent.dispose();
    }
  });

  it.each([
    { platform: 'linux', arch: 'x64' },
    { platform: 'darwin', arch: 'arm64' },
  ] as const)('denies packaged chat on $platform/$arch', async (deniedPlatform) => {
    const { parent, scopeResolver, settingsStore, logger } = bindingFixture();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: true, env: {}, platform: deniedPlatform,
      bundledRoot, scopeResolver, settingsStore,
    });
    const scope = parent.createChildContainer();
    try {
      expect(binding.capabilities.nativeCodex).toBe(false);
      const ports = parent.resolve<CodexChatAdapterPorts>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
      expect(() => ports.resolveRuntime?.(scope, 'chat')).toThrow(
        'Codex chat production routing disabled by parity gate',
      );
      expect(logger.info).not.toHaveBeenCalled();
    } finally {
      await scope.dispose();
      await binding.dispose();
      await parent.dispose();
    }
  });

  it('forwards Codex prompt lifecycle events to the permission handler', async () => {
    const { parent, permissionHandler, scopeResolver, settingsStore } = bindingFixture();
    jest.mocked(createCodexChatHostPorts).mockClear();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false,
      env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      platform,
      bundledRoot,
      scopeResolver,
      settingsStore,
    });
    try {
      const deps = jest.mocked(createCodexChatHostPorts).mock.calls.at(-1)?.[0];
      const event: PermissionPromptLifecycleEvent = {
        phase: 'requested',
        requestId: 'codex-request-1',
        routingHint: 'gw-conversation-1',
        toolName: 'Bash',
        description: 'Run a command',
        routable: false,
        timeoutMs: 60_000,
      };

      expect(deps?.promptLifecycle).toBeDefined();
      deps?.promptLifecycle?.publish(event);

      expect(permissionHandler.publishPromptLifecycle).toHaveBeenCalledWith(event);
    } finally {
      await binding.dispose();
      await parent.dispose();
    }
  });

  it('binds the saved Codex permission reader to the profile workspace', async () => {
    const { parent, scopeResolver, settingsStore } = bindingFixture();
    parent.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
      useValue: createMockWorkspaceProvider({ folders: [temporaryRoot] }),
    });
    parent.register(AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER, {
      useValue: {
        resolveExecutionProfile: jest.fn().mockResolvedValue({
          runtime: 'codex-app-server',
          seed: {
            providerId: 'openai-codex', consumer: 'chat',
            workspacePath: temporaryRoot, home: temporaryRoot,
            normalizedHome: temporaryRoot, model: 'gpt-5',
          },
        }),
      },
    });
    scopeResolver.readForPath.mockImplementation((name: string) => ({
      'autopilot.enabled': true,
      'autopilot.permissionLevel': 'auto-edit',
    })[name as 'autopilot.enabled' | 'autopilot.permissionLevel']);
    jest.mocked(buildCodexExecutionProfile).mockClear();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false, env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      platform, bundledRoot, scopeResolver, settingsStore,
    });
    try {
      const ports = parent.resolve<CodexChatHostPorts>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
      await expect(ports.profile({
        projectPath: temporaryRoot, workspaceId: temporaryRoot, model: 'gpt-5',
      })).rejects.toThrow('Codex executable verification failed');
      expect(scopeResolver.readForPath).toHaveBeenCalledWith('autopilot.enabled', temporaryRoot, true);
      expect(scopeResolver.readForPath).toHaveBeenCalledWith('autopilot.permissionLevel', temporaryRoot, true);
      expect(jest.mocked(buildCodexExecutionProfile).mock.calls.at(-1)?.[0].session.permissionLevel).toBe('auto-edit');
    } finally {
      await binding.dispose();
      await parent.dispose();
    }
  });
  it.each([
    { isPackaged: false, env: {}, chat: false, gateway: false },
    { isPackaged: true, env: { PTAH_CODEX_RUNTIME_DEV: '1' }, chat: true, gateway: false },
    { isPackaged: false, env: { PTAH_CODEX_RUNTIME_DEV: '1' }, chat: true, gateway: true },
  ])(
    'binds six stable ports without binary I/O: %j',
    async ({ isPackaged, env, chat, gateway }) => {
      const { parent, unsubscribe, legacy, scopeResolver, settingsStore } = bindingFixture();
      jest.mocked(resolveCodexNativeBinaryPath).mockClear();
      const binding = await bindElectronCodexChat(parent, {
        isPackaged,
        env,
        platform,
        bundledRoot,
        scopeResolver,
        settingsStore,
      });
      try {
        for (const token of ELECTRON_CODEX_BOUND_TOKENS) {
          const value = parent.resolve(token);
          expect(value).not.toBeNull();
          expect(parent.resolve(token)).toBe(value);
        }
        expect(binding.capabilities.nativeCodex).toBe(chat);
        expect(binding.capabilities.nativeCodexGateway).toBe(gateway);
        if (isPackaged || Object.keys(env).length === 0) expect(binding.devRoute).toBeNull();
        await expect(
          parent.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER).initialize(),
        ).resolves.toBe(true);
        expect(legacy.initialize).toHaveBeenCalledTimes(1);
        expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
        const ports = parent.resolve<
          CodexChatHostPorts
        >(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
        expect(typeof ports.handlePermissionResponse).toBe('function');
      } finally {
        await binding.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        await parent.dispose();
      }
    },
  );

  it('rejects scope creation when the profile port bypasses verification', async () => {
    const { parent, scopeResolver, settingsStore } = bindingFixture();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false,
      env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      platform,
      bundledRoot,
      scopeResolver,
      settingsStore,
    });
    const ports = parent.resolve<CodexChatAdapterPorts>(
      SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
    );
    const profile = buildCodexExecutionProfile({
      session: {
        contextId: 'chat',
        consumer: 'chat',
        providerId: 'openai-codex',
        workspaceId: '/work',
        cwd: '/work',
        model: 'gpt',
        permissionLevel: 'ask',
      },
      defaultHome: '/home',
      paths: {
        platform: 'posix',
        baseDirectory: '/',
        entries: {
          '/work': { kind: 'directory', realpath: '/work' },
          '/home': { kind: 'directory', realpath: '/home' },
        },
      },
    });
    const adapter = new CodexChatAdapter({
      ...ports,
      profile: async () => ({ profile }),
    }, new SessionTurnStateRegistry());
    try {
      await expect(
        adapter.startChatSession({ tabId: 'tab', prompt: 'hello' }),
      ).rejects.toMatchObject({ code: 'runtime-failed' });
    } finally {
      adapter.dispose();
      await binding.dispose();
      await parent.dispose();
    }
  });
});

describe('Electron Codex binding failure', () => {
  it('retains default ports and disposes the identity lookup if a dependency fails', async () => {
    const { parent, unsubscribe, scopeResolver, settingsStore } = bindingFixture();
    const defaults = new Map(ELECTRON_CODEX_BOUND_TOKENS
      .map((token) => [token, parent.resolve(token)]));
    parent.register(PLATFORM_TOKENS.PLATFORM_INFO, {
      useFactory: () => { throw new Error('platform unavailable'); },
    });
    try {
      await expect(bindElectronCodexChat(parent, {
        isPackaged: false, env: { PTAH_CODEX_RUNTIME_DEV: '1' }, platform,
        bundledRoot, scopeResolver, settingsStore,
      })).rejects.toThrow('platform unavailable');
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      for (const token of ELECTRON_CODEX_BOUND_TOKENS) {
        expect(parent.resolve(token)).toBe(defaults.get(token));
      }
    } finally {
      await parent.dispose();
    }
  });
});

describe('Electron Codex asynchronous binary inspection', () => {
  it('shares one inspection across concurrent opens and repeats only after a file change', async () => {
    const readVersion = jest.fn(async () => 'codex-cli 0.155.1');
    const [first, second] = await Promise.all([
      inspectElectronCodexBinary(executablePath, readVersion, platform),
      inspectElectronCodexBinary(executablePath, readVersion, platform),
    ]);
    expect(first).toBe(second);
    expect(first.sha256).toHaveLength(64);
    expect(first.versionOutput).toBe('codex-cli 0.155.1');
    expect(readVersion).toHaveBeenCalledTimes(1);
    await inspectElectronCodexBinary(executablePath, readVersion, platform);
    expect(readVersion).toHaveBeenCalledTimes(1);
    writeFileSync(executablePath, 'updated fixture with a different size');
    jest.mocked(findCodexExecutablePin).mockReturnValue({
      ...manifest,
      binarySha256: createHash('sha256').update('updated fixture with a different size').digest('hex'),
    });
    const changed = await inspectElectronCodexBinary(executablePath, readVersion, platform);
    expect(changed.sha256).not.toBe(first.sha256);
    expect(readVersion).toHaveBeenCalledTimes(2);
  });

  it.each(['version process failed', 'version process timed out', 'EBUSY'])(
    'retries a rejected inspection on the next open: %s', async (message) => {
      const failure = new Error(message);
      const readVersion = jest.fn<Promise<string>, [string]>()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue('codex-cli 0.155.1');
      await expect(inspectElectronCodexBinary(executablePath, readVersion, platform)).rejects.toBe(failure);
      await expect(inspectElectronCodexBinary(executablePath, readVersion, platform)).resolves.toMatchObject({
        versionOutput: 'codex-cli 0.155.1',
      });
      expect(readVersion).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects an unreviewed digest without executing the binary', async () => {
    jest.mocked(findCodexExecutablePin).mockReturnValue(manifest);
    const readVersion = jest.fn(async () => 'codex-cli 0.155.1');
    await expect(inspectElectronCodexBinary(executablePath, readVersion, platform)).rejects.toMatchObject({
      code: 'codex-digest-mismatch',
    });
    expect(readVersion).not.toHaveBeenCalled();
    jest.mocked(findCodexExecutablePin).mockReturnValue({
      ...manifest, binarySha256: createHash('sha256').update('fixture').digest('hex'),
    });
    await expect(inspectElectronCodexBinary(executablePath, readVersion, platform)).resolves.toMatchObject({
      versionOutput: 'codex-cli 0.155.1',
    });
    expect(readVersion).toHaveBeenCalledTimes(1);
  });

  it('rejects a platform without a reviewed pin without executing the binary', async () => {
    jest.mocked(findCodexExecutablePin).mockReturnValue(undefined);
    const readVersion = jest.fn(async () => 'codex-cli 0.155.1');
    await expect(inspectElectronCodexBinary(executablePath, readVersion, { platform: 'linux', arch: 'arm64' })).rejects.toMatchObject({
      code: 'codex-pin-unavailable',
    });
    expect(readVersion).not.toHaveBeenCalled();
  });
});


describe('Electron Codex session lifecycle composition', () => {
  it('records opening and closing before Electron effects without mutating record hooks', async () => {
    const parent = container.createChildContainer();
    const state = createElectronCodexSessionState(parent);
    const id = SessionId.from('11111111-1111-4111-8111-111111111111');
    const prepared = {
      profile: buildCodexExecutionProfile({
        session: {
          contextId: 'chat', consumer: 'chat', providerId: 'openai-codex',
          workspaceId: '/work', cwd: '/work', model: 'gpt', permissionLevel: 'ask',
        },
        defaultHome: '/home',
        paths: {
          platform: 'posix', baseDirectory: '/',
          entries: {
            '/work': { kind: 'directory', realpath: '/work' },
            '/home': { kind: 'directory', realpath: '/home' },
          },
        },
      }),
    };
    state.preparedTabs.set(prepared, 'tab-1');
    const order: string[] = [];
    const record = {
      lifecycle: Object.freeze({
        opened: jest.fn(() => {
          expect(state.profiles.has(id)).toBe(false);
          expect(state.tabs.has(id)).toBe(false);
          order.push('record opened');
        }),
        closed: jest.fn(() => {
          expect(state.profiles.get(id)).toBe(prepared);
          expect(state.tabs.get(id)).toBe('tab-1');
          order.push('record closed');
        }),
      }),
    };
    const lookup = {
      releaseSession: jest.fn(() => {
        expect(state.profiles.has(id)).toBe(false);
        expect(state.tabs.has(id)).toBe(false);
        order.push('identity released');
      }),
    };
    const controls = {
      releaseSession: jest.fn(() => { order.push('controls released'); }),
    };
    const lifecycle = createElectronCodexSessionLifecycle(record, state, lookup, controls);
    try {
      expect(lifecycle).not.toBe(record.lifecycle);
      lifecycle.opened(id, prepared);
      expect(state.profiles.get(id)).toBe(prepared);
      expect(state.tabs.get(id)).toBe('tab-1');
      lifecycle.closed(id);
      expect(record.lifecycle.opened).toHaveBeenCalledWith(id, prepared);
      expect(record.lifecycle.closed).toHaveBeenCalledWith(id);
      expect(lookup.releaseSession).toHaveBeenCalledWith(id);
      expect(controls.releaseSession).toHaveBeenCalledWith(id);
      expect(order).toEqual([
        'record opened', 'record closed', 'identity released', 'controls released',
      ]);
    } finally {
      await parent.dispose();
    }
  });
});
