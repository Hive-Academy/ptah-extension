import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { container } from 'tsyringe';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, resolveCodexNativeBinaryPath } from '@ptah-extension/agent-sdk';
import { CLI_AGENT_RUNTIME_TOKENS, CodexAppServerLaneAdapter,
  type CodexAdapterFactory } from '@ptah-extension/cli-agent-runtime';
import { CODEX_RUNTIME_TOKENS, CodexRuntime, CodexParityGate,
  CodexExecutableInspectionError, buildCodexExecutionProfile, findCodexExecutablePin,
  inspectCodexExecutable, normalizeCodexHomeKey,
  type CodexApprovalRequest, type CodexContext, type CodexExecutionProfile,
  type CodexRuntimeRegistrationPorts } from '@ptah-extension/codex-runtime';
import { registerVsCodeCodexLaneFactory, resolveVsCodeCodexLaneRuntime,
  inspectVsCodeCodexBinary } from './codex-lane-runtime-composition';

jest.mock('@ptah-extension/codex-runtime', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/codex-runtime')>('@ptah-extension/codex-runtime'),
  findCodexExecutablePin: jest.fn(),
  inspectCodexExecutable: jest.fn(),
}));
jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/agent-sdk')>('@ptah-extension/agent-sdk'),
  resolveCodexNativeBinaryPath: jest.fn(),
}));
const platform = { platform: process.platform, arch: process.arch };

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

function fixture(envOverride: Record<string, string | undefined> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ptah-vscode-codex-lane-'));
  const home = join(root, 'home');
  const work = join(root, 'work');
  mkdirSync(home);
  mkdirSync(work);
  writeFileSync(join(home, 'auth.json'), '{"openai_api_key":"fixture"}');
  const binaryPath = join(root, 'codex');
  writeFileSync(binaryPath, 'fixture');
  const executable = realpathSync(binaryPath);
  const manifest = {
    ...platform, pinnedVersion: '0.165.0', version: '0.165.0',
    binarySha256: createHash('sha256').update('fixture').digest('hex'),
    schemaSha256: 'b'.repeat(64),
  };
  jest.mocked(findCodexExecutablePin).mockReturnValue(manifest);
  jest.mocked(inspectCodexExecutable).mockResolvedValue({
    executablePath: executable, sha256: manifest.binarySha256,
    versionOutput: `codex-cli ${manifest.pinnedVersion}`,
  });
  jest.mocked(resolveCodexNativeBinaryPath).mockReturnValue(executable);
  const parent = container.createChildContainer();
  const logger = createMockLogger();
  parent.register(TOKENS.LOGGER, { useValue: logger });
  const spawner: CodexRuntimeRegistrationPorts['spawner'] = {
    spawnProcess: jest.fn(() => { throw new Error('Unexpected process spawn'); }),
  };
  parent.register(SDK_TOKENS.SDK_PROCESS_SPAWNER, { useValue: spawner });
  parent.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, { useValue: {
    get: jest.fn(async () => null), getAll: jest.fn(async () => []),
    updateCodexExecution: jest.fn(async () => undefined),
  } });
  const input = { isDevelopment: true, env: { CODEX_HOME: home, ...envOverride }, platform };
  registerVsCodeCodexLaneFactory(parent, parent.resolve<Logger>(TOKENS.LOGGER), input);
  const factory = parent.resolve<CodexAdapterFactory>(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY);
  return { root, home, work, executable, parent, logger, spawner, input, factory };
}

describe('VS Code Codex lane composition', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(findCodexExecutablePin).mockReset();
    jest.mocked(inspectCodexExecutable).mockReset();
    jest.mocked(resolveCodexNativeBinaryPath).mockReset();
  });

  it('creates and detects without spawning, and reports a missing native binary', async () => {
    const f = fixture();
    try {
      const adapter = f.factory.create();
      expect(adapter).toBeInstanceOf(CodexAppServerLaneAdapter);
      expect(await adapter.detect()).toMatchObject({ installed: true, path: f.executable });
      expect(f.spawner.spawnProcess).not.toHaveBeenCalled();
      jest.mocked(resolveCodexNativeBinaryPath).mockReturnValue(undefined);
      if (!(adapter instanceof CodexAppServerLaneAdapter)) throw new Error('Expected native adapter');
      await expect(adapter['binary'].resolve()).rejects.toThrow('Native Codex executable unavailable');
      expect(await adapter.detect()).toMatchObject({ installed: false });
      expect(f.logger.warn).toHaveBeenCalledWith(
        '[CodexAppServerLaneAdapter] Codex detection failed', expect.any(Object),
      );
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('refuses a mismatched digest during detection and lane open', async () => {
    const f = fixture();
    const mismatch = new CodexExecutableInspectionError(
      'Codex executable digest does not match the reviewed pin', 'codex-digest-mismatch',
    );
    jest.mocked(inspectCodexExecutable).mockRejectedValue(mismatch);
    try {
      const adapter = f.factory.create();
      expect(await adapter.detect()).toMatchObject({ installed: false });
      await expect(adapter.runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      })).rejects.toMatchObject({ code: 'codex-digest-mismatch' });
      expect(f.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reports an unavailable reviewed pin with its inspection code', async () => {
    const f = fixture();
    jest.mocked(findCodexExecutablePin).mockReturnValue(undefined);
    try {
      const adapter = f.factory.create();
      expect(await adapter.detect()).toMatchObject({ installed: false });
      await expect(adapter.runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      })).rejects.toMatchObject({ code: 'codex-pin-unavailable' });
      expect(f.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('declines user input with one kind-only output line', async () => {
    const f = fixture();
    let requestUserInput: CodexRuntimeRegistrationPorts['requestUserInput'];
    jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
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
      expect(await requestUserInput?.(request, new AbortController().signal)).toEqual({});
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

  it('reports one diagnostic for an explicitly empty home', async () => {
    const f = fixture({ CODEX_HOME: undefined, HOME: '', USERPROFILE: undefined });
    try {
      expect(await f.factory.create().detect()).toMatchObject({ installed: false });
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

  it('uses the selected home and reviewed binary', async () => {
    const f = fixture();
    const measuredDigest = 'c'.repeat(64);
    expect(measuredDigest).not.toBe(createHash('sha256').update('fixture').digest('hex'));
    jest.mocked(inspectCodexExecutable).mockResolvedValue({
      executablePath: f.executable, sha256: measuredDigest,
      versionOutput: 'codex-cli 0.165.0',
    });
    jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
    const opened: CodexExecutionProfile[] = [];
    jest.spyOn(CodexRuntime.prototype, 'open').mockImplementation(async function (this: CodexRuntime, profile) {
      opened.push(profile);
      expect(this['options'].executable.resolvedPath).toBe(f.executable);
      expect(this['options'].binary.sha256).toBe(measuredDigest);
      expect(this['options'].binary.versionOutput).toBe('codex-cli 0.165.0');
      return fakeContext(profile);
    });
    try {
      const adapter = f.factory.create();
      if (!(adapter instanceof CodexAppServerLaneAdapter)) throw new Error('Expected native adapter');
      const handle = await adapter.runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      });
      await handle.done;
      expect(opened[0].consumer).toBe('lane');
      expect(opened[0].normalizedHome).toBe(normalizeCodexHomeKey(f.home, process.platform));
      expect(inspectCodexExecutable).toHaveBeenCalledWith(f.executable, platform);
      handle.abort.abort();
      expect(f.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('closes its child scope exactly once', async () => {
    const f = fixture();
    const child = f.parent.createChildContainer();
    const dispose = jest.spyOn(child, 'dispose');
    jest.spyOn(f.parent, 'createChildContainer').mockReturnValue(child);
    const close = jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
    jest.spyOn(CodexRuntime.prototype, 'open').mockImplementation(async (profile) => fakeContext(profile));
    try {
      const adapter = f.factory.create();
      if (!(adapter instanceof CodexAppServerLaneAdapter)) throw new Error('Expected native adapter');
      const profile = buildCodexExecutionProfile({
        session: {
          contextId: 'lane-close', consumer: 'lane', providerId: 'codex',
          workspaceId: f.work, cwd: f.work, normalizedHome: f.home,
          model: 'gpt-5', permissionLevel: 'ask',
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
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('disposes the scope when open fails', async () => {
    const f = fixture();
    const child = f.parent.createChildContainer();
    const dispose = jest.spyOn(child, 'dispose');
    jest.spyOn(f.parent, 'createChildContainer').mockReturnValue(child);
    const close = jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
    jest.spyOn(CodexRuntime.prototype, 'open').mockRejectedValue(new Error('open failed'));
    try {
      const adapter = f.factory.create();
      await expect(adapter.runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      })).rejects.toThrow('open failed');
      expect(close).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('preserves the open error and logs a dispose failure', async () => {
    const f = fixture();
    const child = f.parent.createChildContainer();
    const disposeError = new Error('dispose failed');
    const openError = new Error('open failed');
    const dispose = jest.spyOn(child, 'dispose').mockRejectedValue(disposeError);
    jest.spyOn(f.parent, 'createChildContainer').mockReturnValue(child);
    jest.spyOn(CodexRuntime.prototype, 'close').mockResolvedValue(undefined);
    jest.spyOn(CodexRuntime.prototype, 'open').mockRejectedValue(openError);
    try {
      await expect(f.factory.create().runSdk({
        task: 'report', workingDirectory: f.work, agentId: 'lane-1', mcpPort: 51820,
      })).rejects.toBe(openError);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(f.logger.error).toHaveBeenCalledWith(
        'Failed to dispose Codex lane scope after open failure', disposeError,
      );
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('routes a gate-admitted production lane through the gated runtime', async () => {
    const f = fixture();
    const original = Object.getOwnPropertyDescriptor(CodexParityGate.prototype, 'isEnabled');
    Object.defineProperty(CodexParityGate.prototype, 'isEnabled', {
      configurable: true, value: () => true,
    });
    try {
      const gate = new CodexParityGate();
      const isEnabled = jest.fn(() => true);
      Object.defineProperty(gate, 'isEnabled', { configurable: true, value: isEnabled });
      f.parent.register(CODEX_RUNTIME_TOKENS.ParityGate, { useValue: gate });
      const runtime = { open: jest.fn() };
      f.parent.register(CODEX_RUNTIME_TOKENS.Runtime, { useValue: runtime });
      expect(resolveVsCodeCodexLaneRuntime(f.parent, {
        isDevelopment: false, platform,
      })).toBe(runtime);
      expect(isEnabled).toHaveBeenCalledWith('lane', platform);
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
      if (original) Object.defineProperty(CodexParityGate.prototype, 'isEnabled', original);
    }
  });

  it('rejects closed production routing while development can use its owned runtime', async () => {
    const f = fixture();
    try {
      jest.spyOn(CodexParityGate.prototype, 'isEnabled').mockReturnValue(false);
      const runtime = { open: jest.fn() };
      f.parent.register(CODEX_RUNTIME_TOKENS.Runtime, { useValue: runtime });
      expect(() => resolveVsCodeCodexLaneRuntime(f.parent, {
        isDevelopment: false, platform,
      })).toThrow('production routing disabled');
      expect(resolveVsCodeCodexLaneRuntime(f.parent, {
        isDevelopment: true, platform,
      })).toBe(runtime);
    } finally {
      await f.parent.dispose();
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
