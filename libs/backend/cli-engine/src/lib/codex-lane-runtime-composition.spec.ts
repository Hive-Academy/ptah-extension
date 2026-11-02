import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import {
  SDK_TOKENS,
  resolveCodexNativeBinaryPath,
  type SessionMetadata,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  CliDetectionService,
  CodexAppServerLaneAdapter,
  type CodexAdapterFactory,
} from '@ptah-extension/cli-agent-runtime';
import {
  CodexParityGate,
  CodexRuntime,
  CodexAccountUsageClient,
  CodexExecutableInspectionError,
  buildCodexExecutionProfile,
  findCodexExecutablePin,
  inspectCodexExecutable,
  normalizeCodexHomeKey,
  normalizeCodexWorkspaceKey,
  type CodexThreadIdentity,
  type CodexContext,
  type CodexExecutionProfile,
} from '@ptah-extension/codex-runtime';
import { SessionId } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { registerCliCodexLaneFactory } from './codex-lane-runtime-composition';

jest.mock('@ptah-extension/codex-runtime', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/codex-runtime')>('@ptah-extension/codex-runtime'),
  findCodexExecutablePin: jest.fn(),
  inspectCodexExecutable: jest.fn(),
}));
jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/agent-sdk')>('@ptah-extension/agent-sdk'),
  resolveCodexNativeBinaryPath: jest.fn(),
}));

const platform = { platform: 'win32', arch: 'x64' };

function fakeContext(profile: CodexExecutionProfile): CodexContext {
  const identity = {
    threadId: profile.contextId, contextId: profile.contextId, processGeneration: 1,
    normalizedHome: profile.normalizedHome, workspaceId: profile.workspaceId,
    providerId: profile.providerId, profileFingerprint: profile.profileFingerprint,
  };
  return {
    identity,
    get turnPermissionLevel() { return profile.permissionLevel; },
    listModels: async () => [],
    events: async function* (signal) {
      yield {
        type: 'terminal' as const, contextId: identity.contextId,
        processGeneration: 1, threadId: identity.threadId, turnId: 'turn-1',
        sequence: 1, status: 'completed' as const, usage: {},
      };
      await new Promise<void>((done) => {
        if (signal.aborted) done();
        else signal.addEventListener('abort', () => done(), { once: true });
      });
    },
    startTurn: async () => ({ threadId: identity.threadId, turnId: 'turn-1', revision: 1 }),
    steer: async () => ({ threadId: identity.threadId, turnId: 'turn-1', revision: 1 }),
    interrupt: async () => false,
    updateNextTurn: async () => ({ timing: 'nextTurn' as const, revision: 1 }),
    compact: async () => undefined,
    close: async () => undefined,
  };
}

function laneProfile(home: string, work: string): CodexExecutionProfile {
  return buildCodexExecutionProfile({
    session: {
      contextId: 'lane-close', consumer: 'lane', providerId: 'codex',
      workspaceId: work, cwd: work, normalizedHome: home,
      model: 'gpt-5', permissionLevel: 'ask',
      lane: { suppressedTools: [], explicitFullAccess: false },
    },
    paths: {
      platform: process.platform === 'win32' ? 'win32' : 'posix',
      baseDirectory: work,
      entries: {
        [home]: { kind: 'directory', realpath: home },
        [work]: { kind: 'directory', realpath: work },
      },
    },
  });
}

function withGate<T>(enabled: boolean, action: () => T): T {
  const original = Object.getOwnPropertyDescriptor(CodexParityGate.prototype, 'isEnabled');
  Object.defineProperty(CodexParityGate.prototype, 'isEnabled', {
    configurable: true, value: () => enabled,
  });
  try {
    return action();
  } finally {
    if (original) Object.defineProperty(CodexParityGate.prototype, 'isEnabled', original);
  }
}

async function withGateAsync<T>(enabled: boolean, action: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(CodexParityGate.prototype, 'isEnabled');
  Object.defineProperty(CodexParityGate.prototype, 'isEnabled', {
    configurable: true, value: () => enabled,
  });
  try {
    return await action();
  } finally {
    if (original) Object.defineProperty(CodexParityGate.prototype, 'isEnabled', original);
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ptah-cli-codex-lane-'));
  const home = join(root, 'codex-home');
  const work = join(root, 'workspace');
  const binary = join(root, 'codex.exe');
  mkdirSync(home);
  mkdirSync(work);
  writeFileSync(binary, 'fixture');
  const digest = createHash('sha256').update('fixture').digest('hex');
  jest.mocked(findCodexExecutablePin).mockReturnValue({
    ...platform, pinnedVersion: '0.165.0', version: '0.165.0',
    binarySha256: digest, schemaSha256: 'b'.repeat(64),
  });
  jest.mocked(inspectCodexExecutable).mockResolvedValue({
    executablePath: binary, sha256: digest, versionOutput: 'codex-cli 0.165.0',
  });
  jest.mocked(resolveCodexNativeBinaryPath).mockReturnValue(binary);
  const container = rootContainer.createChildContainer();
  const logger = createMockLogger();
  const spawn = jest.fn();
  container.register(TOKENS.LOGGER, { useValue: logger });
  container.register(TOKENS.SENTRY_SERVICE, { useValue: { captureException: jest.fn() } });
  container.register(TOKENS.AUTH_SECRETS_SERVICE, {
    useValue: { getProviderKey: jest.fn(async () => undefined) },
  });
  container.register(SDK_TOKENS.SDK_PROCESS_SPAWNER, { useValue: { spawn } });
  const rows = new Map<string, SessionMetadata>();
  const metadata: Pick<SessionMetadataStore, 'get' | 'getAll' | 'updateCodexExecution'> = {
    get: async (id) => rows.get(id) ?? null,
    getAll: async () => [...rows.values()],
    updateCodexExecution: async (id, updateExecution, updateThread) => {
      const current = rows.get(id);
      const next = updateExecution(current?.codexExecution);
      const execution = { ...next,
        workspaceId: normalizeCodexWorkspaceKey(next.workspaceId, process.platform),
      };
      const thread = updateThread?.(current?.codexThread, execution);
      rows.set(id, {
        sessionId: id, name: 'Codex lane', workspaceId: execution.workspaceId,
        createdAt: 1, lastActiveAt: 1, totalCost: 0,
        totalTokens: { input: 0, output: 0 },
        codexExecution: execution, codexThread: thread,
      });
    },
  };
  container.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, { useValue: metadata });
  return { container, logger, registeredLogger: container.resolve<Logger>(TOKENS.LOGGER),
    spawn, rows, root, home, work, binary };
}

function detection(container: DependencyContainer): CliDetectionService {
  const factory = container.isRegistered(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, true)
    ? container.resolve<CodexAdapterFactory>(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY)
    : null;
  return new CliDetectionService(
    container.resolve(TOKENS.LOGGER),
    container.resolve<ConstructorParameters<typeof CliDetectionService>[1]>(TOKENS.SENTRY_SERVICE),
    container.resolve<ConstructorParameters<typeof CliDetectionService>[2]>(SDK_TOKENS.SDK_PROCESS_SPAWNER),
    container.resolve<ConstructorParameters<typeof CliDetectionService>[3]>(TOKENS.AUTH_SECRETS_SERVICE),
    null,
    factory,
  );
}

describe('CLI/TUI Codex lane composition', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(resolveCodexNativeBinaryPath).mockReset();
    jest.mocked(inspectCodexExecutable).mockClear();
    jest.mocked(findCodexExecutablePin).mockClear();
  });
  it('keeps the legacy adapter and leaves the factory unbound when the gate is closed', () => {
    const f = fixture();
    try {
      registerCliCodexLaneFactory(f.container, f.registeredLogger,
        { env: { CODEX_HOME: f.home }, platform });
      expect(f.container.isRegistered(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, true))
        .toBe(false);
      expect(detection(f.container).getAdapter('codex')).not.toBeInstanceOf(
        CodexAppServerLaneAdapter,
      );
      expect(f.spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('selects the native adapter through the CLI shared constructor', async () => {
    const f = fixture();
    try {
      const adapter = withGate(true, () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: f.home }, platform });
        return detection(f.container).getAdapter('codex');
      });
      expect(adapter).toBeInstanceOf(CodexAppServerLaneAdapter);
      const native = adapter as CodexAppServerLaneAdapter;
      const second = f.container.resolve<CodexAdapterFactory>(
        CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY,
      ).create();
      if (!(second instanceof CodexAppServerLaneAdapter))
        throw new Error('Expected native Codex lane adapter');
      expect(second).not.toBe(native);
      expect(second['writers']).toBe(native['writers']);
      jest.spyOn(native['binary'], 'resolve').mockResolvedValue(undefined);
      const result = await native.detect();
      expect(result.installed).toBe(false);
      expect(result.messagingMode).toBe('queue');
      expect(f.spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('checks the reviewed binary hash during detection without spawning', async () => {
    const f = fixture();
    try {
      const mismatch = new CodexExecutableInspectionError(
        'Codex executable digest does not match the reviewed pin', 'codex-digest-mismatch',
      );
      jest.mocked(inspectCodexExecutable).mockRejectedValue(mismatch);
      const adapter = withGate(true, () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: f.home }, platform });
        return detection(f.container).getAdapter('codex');
      }) as CodexAppServerLaneAdapter;
      await expect(adapter['binary'].resolve()).rejects.toBe(mismatch);
      expect((await adapter.detect()).installed).toBe(false);
      expect(f.spawn).not.toHaveBeenCalled();
      expect(f.logger.warn).toHaveBeenCalledWith(
        '[CodexAppServerLaneAdapter] Codex detection failed',
        { errorClass: 'CodexExecutableInspectionError' },
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('refuses an explicit binary whose realpath differs from the native binary', async () => {
    const f = fixture();
    try {
      const other = join(f.root, 'other-codex.exe');
      writeFileSync(other, 'fixture');
      const adapter = withGate(true, () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: f.home }, platform });
        return detection(f.container).getAdapter('codex');
      }) as CodexAppServerLaneAdapter;
      await expect(adapter['binary'].resolve(other))
        .rejects.toThrow('Codex executable does not match the host binary');
      expect(inspectCodexExecutable).not.toHaveBeenCalled();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('passes the selected home to credentials, catalog and user MCP discovery', async () => {
    const f = fixture();
    const previousHome = process.env['CODEX_HOME'];
    try {
      const otherHome = join(f.root, 'other-home');
      mkdirSync(otherHome);
      writeFileSync(join(f.home, 'config.toml'),
        '[mcp_servers.selected_home_server]\ncommand = "echo"\n');
      writeFileSync(join(otherHome, 'config.toml'),
        '[mcp_servers.other_home_server]\ncommand = "echo"\n');
      process.env['CODEX_HOME'] = otherHome;
      const adapter = withGate(true, () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: f.home }, platform });
        return detection(f.container).getAdapter('codex');
      }) as CodexAppServerLaneAdapter;
      const check = jest.spyOn(adapter['credentials'], 'check').mockResolvedValue('fresh');
      await adapter.ensureTokensFresh();
      expect(check).toHaveBeenCalledWith(resolve(f.home));
      const catalog = jest.spyOn(adapter['runtime'], 'openCatalog')
        .mockResolvedValue(fakeContext(laneProfile(f.home, f.work)));
      await adapter.listModels();
      expect(catalog).toHaveBeenCalledWith(f.binary, resolve(f.home));
      const opened: CodexExecutionProfile[] = [];
      jest.spyOn(adapter['runtime'], 'open').mockImplementation(async (profile) => {
        opened.push(profile);
        return fakeContext(profile);
      });
      const handle = await adapter.runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      });
      await handle.done;
      expect(opened[0].normalizedHome).toBe(normalizeCodexHomeKey(f.home, process.platform));
      expect(opened[0].lane?.disabledUserMcpServers).toContain('selected_home_server');
      expect(opened[0].lane?.disabledUserMcpServers).not.toContain('other_home_server');
      handle.abort.abort();
      expect(f.spawn).not.toHaveBeenCalled();
    } finally {
      if (previousHome === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = previousHome;
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reports an explicitly empty home once during detection', async () => {
    const f = fixture();
    try {
      const adapter = withGate(true, () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: '' }, platform });
        return detection(f.container).getAdapter('codex');
      }) as CodexAppServerLaneAdapter;
      jest.spyOn(adapter['binary'], 'resolve').mockResolvedValue({
        path: join(f.root, 'codex.exe'), version: '0.165.0',
      });
      expect((await adapter.detect()).installed).toBe(false);
      expect(f.logger.warn).toHaveBeenCalledWith(
        '[CodexAppServerLaneAdapter] Codex home is empty',
      );
      expect(f.logger.warn).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('uses one home for profiles and persists the lane marker for resume', async () => {
    const f = fixture();
    try {
      const adapter = withGate(true, () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: f.home }, platform });
        return detection(f.container).getAdapter('codex');
      }) as CodexAppServerLaneAdapter;
      const first = await adapter['profiles'].resolve({ task: 'work',
        workingDirectory: f.work, model: 'gpt-5' }, 'first-turn');
      expect(normalizeCodexHomeKey(first.lane.identity.normalizedHome, process.platform))
        .toBe(normalizeCodexHomeKey(f.home, process.platform));
      expect(first.lane.config.workingDirectory).toBe(resolve(f.work));
      const threadId = SessionId.create();
      const identity: CodexThreadIdentity = {
        threadId, contextId: first.lane.identity.contextId,
        processGeneration: 1, normalizedHome: first.lane.identity.normalizedHome,
        workspaceId: first.lane.identity.workspaceId,
        providerId: 'codex', profileFingerprint: 'profile-one',
      };
      await adapter['identities'].persist(identity);
      expect(f.rows.get(threadId)?.codexThread?.consumer).toBe('lane');
      expect(await adapter['identities'].readByThreadId(threadId)).toEqual(identity);
      const resumed = await adapter['profiles'].resolve({ task: 'resume',
        workingDirectory: f.work, resumeSessionId: threadId }, 'resume');
      expect(resumed.lane.identity.contextId).toBe(identity.contextId);
      expect(normalizeCodexWorkspaceKey(resumed.lane.identity.workspaceId, process.platform))
        .toBe(normalizeCodexWorkspaceKey(f.work, process.platform));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('refuses a missing reviewed executable pin visibly before opening a scope', async () => {
    const f = fixture();
    try {
      const missingPin = new CodexExecutableInspectionError(
        'No reviewed Codex executable pin for this platform', 'codex-pin-unavailable',
      );
      jest.mocked(inspectCodexExecutable).mockRejectedValue(missingPin);
      const adapter = withGate(true, () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger, {
          env: { CODEX_HOME: f.home }, platform: { platform: 'linux', arch: 'arm64' },
        });
        return detection(f.container).getAdapter('codex');
      }) as CodexAppServerLaneAdapter;
      await expect(adapter['runtime'].open(
        laneProfile(f.home, f.work),
        undefined, { request: async () => 'decline' }, f.binary,
      )).rejects.toBe(missingPin);
      expect(f.spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('rechecks the executable on open and rejects a digest mismatch before registering a scope', async () => {
    const f = fixture();
    try {
      const adapter = withGate(true, () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: f.home }, platform });
        return detection(f.container).getAdapter('codex');
      }) as CodexAppServerLaneAdapter;
      await expect(adapter['binary'].resolve()).resolves.toEqual({
        path: f.binary, version: '0.165.0',
      });
      const mismatch = new CodexExecutableInspectionError(
        'Codex executable digest does not match the reviewed pin', 'codex-digest-mismatch',
      );
      jest.mocked(inspectCodexExecutable).mockRejectedValueOnce(mismatch);
      const open = jest.spyOn(CodexRuntime.prototype, 'open');
      await expect(adapter['runtime'].open(
        laneProfile(f.home, f.work), undefined,
        { request: async () => 'decline' }, f.binary,
      )).rejects.toBe(mismatch);
      expect(inspectCodexExecutable).toHaveBeenCalledTimes(2);
      expect(open).not.toHaveBeenCalled();
      expect(f.spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('owns each opened context and disposes its child scope once', async () => {
    const f = fixture();
    try {
      const measuredDigest = 'c'.repeat(64);
      expect(measuredDigest).not.toBe(createHash('sha256').update('fixture').digest('hex'));
      jest.mocked(inspectCodexExecutable).mockResolvedValue({
        executablePath: f.binary, sha256: measuredDigest,
        versionOutput: 'codex-cli 0.165.0',
      });
      const child = f.container.createChildContainer();
      const disposeChild = jest.spyOn(child, 'dispose');
      jest.spyOn(f.container, 'createChildContainer').mockReturnValue(child);
      const open = jest.spyOn(CodexRuntime.prototype, 'open').mockImplementation(async function (this: CodexRuntime, profile) {
        expect(this['options'].binary.sha256).toBe(measuredDigest);
        expect(this['options'].binary.versionOutput).toBe('codex-cli 0.165.0');
        return fakeContext(profile);
      });
      const close = jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
      const closeUsage = jest.spyOn(CodexAccountUsageClient.prototype, 'close')
        .mockResolvedValue(undefined);
      const result = await withGateAsync(true, async () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: f.home }, platform });
        const adapter = detection(f.container).getAdapter('codex') as CodexAppServerLaneAdapter;
        return adapter['runtime'].open(
          laneProfile(f.home, f.work),
          undefined, { request: async () => 'decline' }, f.binary,
        );
      });
      expect(open).toHaveBeenCalledTimes(1);
      expect(inspectCodexExecutable).toHaveBeenCalledWith(f.binary, platform);
      expect(f.spawn).not.toHaveBeenCalled();
      await Promise.all([result.close(), result.close()]);
      expect(close).toHaveBeenCalledTimes(1);
      expect(closeUsage).not.toHaveBeenCalled();
      expect(disposeChild).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('disposes the child scope when opening fails', async () => {
    const f = fixture();
    try {
      const child = f.container.createChildContainer();
      const disposeChild = jest.spyOn(child, 'dispose');
      jest.spyOn(f.container, 'createChildContainer').mockReturnValue(child);
      jest.spyOn(CodexRuntime.prototype, 'open').mockRejectedValue(new Error('open failed'));
      jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
      await withGateAsync(true, async () => {
        registerCliCodexLaneFactory(f.container, f.registeredLogger,
          { env: { CODEX_HOME: f.home }, platform });
        const adapter = detection(f.container).getAdapter('codex') as CodexAppServerLaneAdapter;
        await expect(adapter['runtime'].open(
          laneProfile(f.home, f.work),
          undefined, { request: async () => 'decline' }, f.binary,
        )).rejects.toThrow('open failed');
      });
      expect(disposeChild).toHaveBeenCalledTimes(1);
      expect(f.spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
