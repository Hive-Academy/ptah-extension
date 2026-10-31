import 'reflect-metadata';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { container } from 'tsyringe';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, resolveCodexNativeBinaryPath } from '@ptah-extension/agent-sdk';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  CODEX_LANE_DEFAULT_MODEL,
  CodexAppServerLaneAdapter,
  type CodexAdapterFactory,
} from '@ptah-extension/cli-agent-runtime';
import {
  buildCodexExecutionProfile,
  CodexRuntime,
  findCodexExecutablePin,
  normalizeCodexHomeKey,
  resolveGatedCodexRuntime,
  type CodexApprovalRequest,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexRuntimeRegistrationPorts,
} from '@ptah-extension/codex-runtime';
import {
  createElectronCodexScopeFactory,
  inspectElectronCodexBinary,
} from './codex-runtime-composition';
import { registerElectronCodexLaneFactory } from './codex-lane-composition';

jest.mock('@ptah-extension/codex-runtime', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/codex-runtime')>(
    '@ptah-extension/codex-runtime',
  ),
  findCodexExecutablePin: jest.fn(),
}));
jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/agent-sdk')>(
    '@ptah-extension/agent-sdk',
  ),
  resolveCodexNativeBinaryPath: jest.fn(),
}));
jest.mock('./codex-runtime-composition', () => ({
  ...jest.requireActual<typeof import('./codex-runtime-composition')>(
    './codex-runtime-composition',
  ),
  inspectElectronCodexBinary: jest.fn(),
}));

const platform = { platform: 'win32', arch: 'x64' };
const manifest = {
  ...platform,
  pinnedVersion: '0.155.1',
  version: '0.155.1',
  binarySha256: 'a'.repeat(64),
  schemaSha256: 'b'.repeat(64),
};

function fakeContext(profile: CodexExecutionProfile): CodexContext & { readonly profile: CodexExecutionProfile } {
  const identity = {
    threadId: profile.contextId,
    contextId: profile.contextId,
    processGeneration: 1,
    normalizedHome: profile.normalizedHome,
    workspaceId: profile.workspaceId,
    providerId: profile.providerId,
    profileFingerprint: profile.profileFingerprint,
  };
  return {
    profile,
    identity,
    get turnPermissionLevel() { return profile.permissionLevel; },
    listModels: async () => [],
    events: async function* (signal) {
      await Promise.resolve();
      yield {
        type: 'terminal' as const,
        contextId: identity.contextId,
        processGeneration: identity.processGeneration,
        threadId: identity.threadId,
        turnId: 'turn-1',
        sequence: 1,
        status: 'completed' as const,
        usage: {},
      };
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
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

function fixture(envOverride: Record<string, string | undefined> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ptah-codex-lane-'));
  const home = join(root, 'selected-home');
  const otherHome = join(root, 'other-home');
  const work = join(root, 'work');
  const secondWork = join(root, 'second-work');
  const bundledRoot = join(root, 'node_modules');
  for (const path of [home, otherHome, work, secondWork, bundledRoot]) mkdirSync(path);
  const executable = join(bundledRoot, 'codex');
  writeFileSync(executable, 'fixture');
  writeFileSync(join(home, 'auth.json'), '{"openai_api_key":"fixture"}');
  writeFileSync(join(home, 'config.toml'), '[mcp_servers.selected_home_server]\ncommand = "echo"\n');
  writeFileSync(join(otherHome, 'config.toml'), '[mcp_servers.other_home_server]\ncommand = "echo"\n');
  jest.mocked(findCodexExecutablePin).mockReturnValue(manifest);
  jest.mocked(resolveCodexNativeBinaryPath).mockReturnValue(executable);
  jest.mocked(inspectElectronCodexBinary).mockImplementation(async () => ({
    executablePath: executable,
    sha256: manifest.binarySha256,
    versionOutput: 'codex-cli 0.155.1',
  }));
  const parent = container.createChildContainer();
  const logger = createMockLogger();
  parent.register(TOKENS.LOGGER, { useValue: logger });
  const spawner: CodexRuntimeRegistrationPorts['spawner'] = {
    spawnProcess: jest.fn(() => { throw new Error('Unexpected process spawn'); }),
  };
  const metadata = {
    get: jest.fn(async () => null),
    getAll: jest.fn(async () => []),
    updateCodexExecution: jest.fn(async () => undefined),
  };
  parent.register(SDK_TOKENS.SDK_PROCESS_SPAWNER, { useValue: spawner });
  parent.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, { useValue: metadata });
  const input = {
    isPackaged: false,
    resourcesPath: root,
    appPath: root,
    env: { CODEX_HOME: home, ...envOverride },
    platform,
  };
  registerElectronCodexLaneFactory(parent, parent.resolve<Logger>(TOKENS.LOGGER), input);
  const factory = parent.resolve<CodexAdapterFactory>(
    CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY,
  );
  return { root, home, otherHome, work, secondWork, bundledRoot, executable,
    parent, logger, spawner, metadata, input, factory };
}

function chatProfile(
  home: string, work: string, model: string,
  permissionLevel: CodexExecutionProfile['permissionLevel'] = 'ask',
): CodexExecutionProfile {
  return buildCodexExecutionProfile({
    session: {
      contextId: `chat-${model}`, consumer: 'chat', providerId: 'codex',
      workspaceId: work, cwd: work, model, permissionLevel,
    },
    defaultHome: home,
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

describe('Electron Codex lane composition', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(findCodexExecutablePin).mockReset();
    jest.mocked(resolveCodexNativeBinaryPath).mockReset();
    jest.mocked(inspectElectronCodexBinary).mockReset();
  });

  it('creates and detects the adapter without spawning an App Server process', async () => {
    const f = fixture();
    try {
      const adapter = f.factory.create();
      const second = f.factory.create();
      if (!(adapter instanceof CodexAppServerLaneAdapter) ||
        !(second instanceof CodexAppServerLaneAdapter))
        throw new Error('Expected native Codex lane adapters');
      expect(second).not.toBe(adapter);
      expect(second['writers']).toBe(adapter['writers']);
      expect(f.spawner.spawnProcess).not.toHaveBeenCalled();
      await adapter.detect();
      expect(f.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it.each(['chat-first', 'lane-first'] as const)(
    'keeps opened context profiles and policies independent (%s)', async (order) => {
    const f = fixture();
    const opened: ReturnType<typeof fakeContext>[] = [];
    jest.spyOn(CodexRuntime.prototype, 'open').mockImplementation(async (profile) => {
      const context = fakeContext(profile);
      opened.push(context);
      return context;
    });
    const contextState = (context: ReturnType<typeof fakeContext>) => ({
      profile: context.profile,
      profileFingerprint: context.identity.profileFingerprint,
      turnPermissionLevel: context.turnPermissionLevel,
      sandboxPolicy: context.profile.sandboxPolicy,
      approvalPolicy: context.profile.approvalPolicy,
    });
    const snapshots: Array<ReturnType<typeof contextState>> = [];
    const captureAndCompare = () => {
      const latest = opened[opened.length - 1];
      if (!latest) throw new Error('Expected an opened Codex context');
      snapshots.push(structuredClone(contextState(latest)));
      expect(opened.map(contextState)).toEqual(snapshots);
    };
    const chatPorts: Omit<CodexRuntimeRegistrationPorts, 'sink' | 'executable' | 'devRoute'> = {
      binary: { ...platform, executablePath: f.executable,
        versionOutput: 'codex-cli 0.155.1', sha256: manifest.binarySha256 },
      spawner: f.spawner,
      store: { persist: async () => undefined, markInactive: async () => undefined,
        read: async () => undefined },
      clock: { now: Date.now, setTimeout: () => ({ dispose: () => undefined }) },
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      usage: null,
    };
    const scopeInput = {
      parent: f.parent, isPackaged: false, env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      platform, expectedManifestRow: manifest, bundledRoot: f.bundledRoot,
      ports: chatPorts,
    };
    const chat1 = createElectronCodexScopeFactory(scopeInput)({
      request: async () => 'decline',
    });
    const chat2 = createElectronCodexScopeFactory(scopeInput)({
      request: async () => 'decline',
    });
    const handles: Array<{ abort: AbortController }> = [];
    try {
      const sequence = order === 'chat-first'
        ? ['chat-one', 'lane-one', 'chat-two', 'lane-two'] as const
        : ['lane-one', 'chat-one', 'lane-two', 'chat-two'] as const;
      for (const action of sequence) {
        if (action === 'chat-one' || action === 'chat-two') {
          const first = action === 'chat-one';
          const scope = first ? chat1 : chat2;
          await resolveGatedCodexRuntime(scope.container, 'chat', platform).open(
            chatProfile(first ? f.home : f.otherHome,
              first ? f.work : f.secondWork, action, first ? 'ask' : 'plan'),
          );
          captureAndCompare();
        } else {
          const first = action === 'lane-one';
          const handle = await f.factory.create().runSdk({
            task: 'report', workingDirectory: first ? f.work : f.secondWork,
            agentId: first ? 'lane-1' : 'lane-2', mcpPort: 51820, model: action,
          });
          handles.push(handle);
          captureAndCompare();
          await handle.done;
        }
      }
      expect(opened.map((context) => context.profile.consumer))
        .toEqual(sequence.map((action) => action.startsWith('chat') ? 'chat' : 'lane'));
      expect(opened.map((context) => context.profile.model)).toEqual(sequence);
      expect(new Set(opened.map((context) => context.profile)).size).toBe(4);
      expect(opened.find((context) => context.profile.model === 'chat-two')?.profile.normalizedHome)
        .toBe(normalizeCodexHomeKey(f.otherHome, process.platform));
      expect(opened.find((context) => context.profile.model === 'chat-two')?.turnPermissionLevel)
        .toBe('plan');
      expect(opened.find((context) => context.profile.model === 'chat-two')?.profile.sandboxPolicy.mode)
        .toBe('read-only');
      expect(opened.find((context) => context.profile.model === 'lane-one')?.profile.approvalPolicy)
        .toBe('never');
    } finally {
      for (const handle of handles) handle.abort.abort();
      await chat2.dispose();
      await chat1.dispose();
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('passes the selected home to credentials, catalog and user MCP discovery', async () => {
    const f = fixture();
    const previous = process.env['CODEX_HOME'];
    process.env['CODEX_HOME'] = f.otherHome;
    const opened: CodexExecutionProfile[] = [];
    jest.spyOn(CodexRuntime.prototype, 'open').mockImplementation(async (profile) => {
      opened.push(profile);
      return fakeContext(profile);
    });
    try {
      const adapter = f.factory.create();
      expect(await adapter.ensureTokensFresh?.()).toBe(true);
      expect(await adapter.listModels?.()).toBeDefined();
      expect(opened[0].normalizedHome).toBe(normalizeCodexHomeKey(f.home, process.platform));
      expect(opened[0].model).toBe(CODEX_LANE_DEFAULT_MODEL);
      expect(opened[0].cwd).not.toBe(f.home);
      const handle = await adapter.runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      });
      await handle.done;
      expect(opened[1].normalizedHome).toBe(normalizeCodexHomeKey(f.home, process.platform));
      expect(opened[1].lane?.disabledUserMcpServers).toContain('selected_home_server');
      expect(opened[1].lane?.disabledUserMcpServers).not.toContain('other_home_server');
      handle.abort.abort();
    } finally {
      if (previous === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = previous;
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('rejects non-lane profiles and disposes owned contexts exactly once', async () => {
    const f = fixture();
    const close = jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
    jest.spyOn(CodexRuntime.prototype, 'open').mockImplementation(async (profile) =>
      fakeContext(profile));
    try {
      const adapter = f.factory.create();
      if (!(adapter instanceof CodexAppServerLaneAdapter))
        throw new Error('Expected native Codex lane adapter');
      await expect(adapter['runtime'].open(
        chatProfile(f.home, f.work, 'chat'),
        undefined, { request: async () => 'decline' }, f.executable,
      )).rejects.toThrow('lane consumer required');
      const profile = buildCodexExecutionProfile({
        session: {
          contextId: 'lane-close', consumer: 'lane', providerId: 'codex',
          workspaceId: f.work, cwd: f.work, normalizedHome: f.home,
          model: CODEX_LANE_DEFAULT_MODEL, permissionLevel: 'ask',
          lane: { suppressedTools: [], explicitFullAccess: false },
        },
        paths: {
          platform: process.platform === 'win32' ? 'win32' : 'posix',
          baseDirectory: f.work,
          entries: {
            [f.home]: { kind: 'directory', realpath: f.home },
            [f.work]: { kind: 'directory', realpath: f.work },
          },
        },
      });
      const owned = await adapter['runtime'].open(
        profile, undefined, { request: async () => 'decline' }, f.executable,
      );
      await owned.close();
      await owned.close();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('disposes the lane scope when open fails', async () => {
    const f = fixture();
    const close = jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
    jest.spyOn(CodexRuntime.prototype, 'open').mockRejectedValue(
      new Error('fixture open failed'),
    );
    try {
      const adapter = f.factory.create();
      await expect(adapter.runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      })).rejects.toThrow('fixture open failed');
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reports one kind-only line and declines user input', async () => {
    const f = fixture();
    let requestUserInput: CodexRuntimeRegistrationPorts['requestUserInput'];
    jest.spyOn(CodexRuntime.prototype, 'open').mockImplementation(async function (
      this: CodexRuntime, profile,
    ) {
      requestUserInput = this['options'].requestUserInput;
      return fakeContext(profile);
    });
    try {
      const adapter = f.factory.create();
      const handle = await adapter.runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      });
      const lines: string[] = [];
      handle.onOutput((line) => lines.push(line));
      const request: CodexApprovalRequest = {
        kind: 'userInput', contextId: 'ctx', processGeneration: 1,
        threadId: 'thread', turnId: 'turn-1', requestId: 'question',
        normalizedHome: f.home, workspaceId: f.work, providerId: 'codex',
        message: 'secret question', details: {},
      };
      expect(requestUserInput).toBeDefined();
      expect(await requestUserInput?.(request, new AbortController().signal)).toEqual({});
      // Lifecycle lines such as turn usage may follow; only the decline line is checked.
      expect(lines.filter((line) => line.startsWith('Codex approval'))).toEqual([
        'Codex approval declined: userInput\n',
      ]);
      expect(lines.join('')).not.toContain('secret question');
      handle.abort.abort();
      await handle.done;
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('refuses an explicitly empty home with one visible diagnostic', async () => {
    const f = fixture({ CODEX_HOME: '' });
    try {
      const adapter = f.factory.create();
      expect(await adapter.detect()).toMatchObject({ installed: false });
      expect(f.logger.warn).toHaveBeenCalledTimes(1);
      expect(f.logger.warn).toHaveBeenCalledWith(
        '[CodexAppServerLaneAdapter] Codex home is empty',
      );
      expect(f.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

