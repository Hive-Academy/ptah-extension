/**
 * AgentProcessManager Unit Tests - SDK Execution Path
 * TASK_2025_158 Batch 3, Task 3.2
 *
 * Tests: SDK spawn path, output streaming, stop/abort, timeout, steer rejection,
 *        shutdownAll with mixed CLI/SDK agents, concurrent limit enforcement.
 */

import 'reflect-metadata';

// ---- Mock vscode before any imports that use it ----
const mockGetConfiguration = jest.fn();
const mockWorkspaceFolders = [{ uri: { fsPath: '/workspace/root' } }];

jest.mock(
  'vscode',
  () => ({
    workspace: {
      getConfiguration: mockGetConfiguration,
      get workspaceFolders() {
        return mockWorkspaceFolders;
      },
    },
  }),
  { virtual: true },
);

// Mock child_process (for CLI path, we don't test that deeply here but need it importable)
const mockSpawn = jest.fn();
const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  spawn: mockSpawn,
  execFile: mockExecFile,
}));

// Stub axios so resolveMcpPort()'s health check never performs a real HTTP
// request. A rejection causes MCP to be disabled for the CLI agent, which
// is the behavior we want in these unit tests (MCP wiring is out of scope
// here — covered by the Copilot/Gemini MCP installer specs).
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockRejectedValue(new Error('mocked: MCP server down')),
    isAxiosError: jest.fn(() => false),
  },
  isAxiosError: jest.fn(() => false),
}));

// Mock tsyringe decorators to no-ops
jest.mock('tsyringe', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
}));

// Mock the Logger token + service classes that AgentProcessManager now
// depends on after Wave C5 / C7a god-service split-up. The source file
// constructor-injects LicenseService, SubagentRegistryService, and
// SentryService alongside the original logger/cliDetection.
jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    LOGGER: Symbol('LOGGER'),
    CLI_DETECTION_SERVICE: Symbol('CLI_DETECTION_SERVICE'),
    LICENSE_SERVICE: Symbol('LICENSE_SERVICE'),
    SUBAGENT_REGISTRY_SERVICE: Symbol('SUBAGENT_REGISTRY_SERVICE'),
    SENTRY_SERVICE: Symbol('SENTRY_SERVICE'),
  },
  Logger: class {},
  LicenseService: class {},
  SubagentRegistryService: class {},
  SentryService: class {},
}));

// Mock platform-core for the PLATFORM_TOKENS.WORKSPACE_PROVIDER injection.
jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: {
    WORKSPACE_PROVIDER: Symbol('WORKSPACE_PROVIDER'),
  },
}));

// We need uuid to generate valid AgentIds, but shared uses it internally
jest.mock('uuid', () => ({
  v4: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
}));

import { AgentProcessManager } from './agent-process-manager.service';
import { CliDetectionService } from './cli-detection.service';
import type {
  CliAdapter,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CliDetectionResult } from '@ptah-extension/shared';

// ---- Test Helpers ----

function createMockLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

interface MockSdkHandleControls {
  handle: SdkHandle;
  /** Call to resolve the done promise with given exit code */
  resolve: (code: number) => void;
  /** Call to reject the done promise */
  reject: (err: Error) => void;
  /** All output callbacks registered */
  outputCallbacks: Array<(data: string) => void>;
  /** Push output to all registered callbacks */
  emitOutput: (data: string) => void;
  /** The abort controller */
  abortController: AbortController;
}

function createMockSdkHandle(): MockSdkHandleControls {
  const abortController = new AbortController();
  const outputCallbacks: Array<(data: string) => void> = [];

  let resolvePromise!: (code: number) => void;
  let rejectPromise!: (err: Error) => void;

  const done = new Promise<number>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const handle: SdkHandle = {
    abort: abortController,
    done,
    onOutput: (cb: (data: string) => void) => {
      outputCallbacks.push(cb);
    },
  };

  return {
    handle,
    resolve: resolvePromise,
    reject: rejectPromise,
    outputCallbacks,
    emitOutput: (data: string) => {
      for (const cb of outputCallbacks) {
        cb(data);
      }
    },
    abortController,
  };
}

/**
 * Create a fake SDK adapter (has runSdk) for testing.
 */
function createSdkAdapter(
  sdkHandleControls: MockSdkHandleControls,
): jest.Mocked<CliAdapter> {
  return {
    name: 'codex',
    displayName: 'Codex CLI',
    detect: jest.fn<Promise<CliDetectionResult>, []>().mockResolvedValue({
      cli: 'codex',
      installed: true,
      path: '/usr/local/bin/codex',
      version: '1.0.0',
      supportsSteer: false,
    }),
    buildCommand: jest.fn().mockReturnValue({
      binary: 'codex',
      args: ['--quiet', 'test task'],
    }),
    supportsSteer: jest.fn().mockReturnValue(false),
    parseOutput: jest.fn((raw: string) => raw),
    runSdk: jest
      .fn<Promise<SdkHandle>, []>()
      .mockResolvedValue(sdkHandleControls.handle),
  } as unknown as jest.Mocked<CliAdapter>;
}

/**
 * Create a mock CliDetectionService.
 */
function createMockCliDetection(
  adapter: CliAdapter,
  detection?: CliDetectionResult,
): jest.Mocked<CliDetectionService> {
  const det: CliDetectionResult = detection ?? {
    cli: 'codex',
    installed: true,
    path: '/usr/local/bin/codex',
    version: '1.0.0',
    supportsSteer: false,
  };

  return {
    getAdapter: jest.fn().mockReturnValue(adapter),
    getDetection: jest.fn().mockResolvedValue(det),
    getInstalledClis: jest.fn().mockResolvedValue([det]),
    detectAll: jest.fn().mockResolvedValue([det]),
    invalidateCache: jest.fn(),
  } as unknown as jest.Mocked<CliDetectionService>;
}

/** Shared store of config values so setupVscodeConfig can re-prime the
 *  IWorkspaceProvider stub between tests (tests call setupVscodeConfig
 *  mid-suite to tweak maxConcurrentAgents etc.). */
let currentConfig: Record<string, unknown> = {};

function setupVscodeConfig(overrides: Record<string, unknown> = {}): void {
  const defaults: Record<string, unknown> = {
    maxConcurrentAgents: 3,
    preferredAgentOrder: [],
  };
  currentConfig = { ...defaults, ...overrides };
  // Also prime the legacy mock in case anything transitively pulls on
  // the vscode namespace mock (belt + braces).
  mockGetConfiguration.mockReturnValue({
    get: <T>(key: string, defaultValue?: T): T => {
      return (
        currentConfig[key] !== undefined ? currentConfig[key] : defaultValue
      ) as T;
    },
  });
}

/** Build a minimal IWorkspaceProvider stub backed by currentConfig. */
function createMockWorkspaceProvider(): Record<string, jest.Mock> {
  return {
    getWorkspaceFolders: jest.fn().mockReturnValue(['/workspace/root']),
    getWorkspaceRoot: jest.fn().mockReturnValue('/workspace/root'),
    getConfiguration: jest.fn(
      <T>(section: string, key: string, defaultValue?: T): T | undefined => {
        // Production code uses two forms:
        //   - workspace.getConfiguration('ptah.agentOrchestration', 'foo')
        //   - workspace.getConfiguration('ptah', 'agentOrchestration.foo')
        // Normalise to a single suffix lookup so tests can set bare keys
        // (e.g. 'maxConcurrentAgents') regardless of which form production uses.
        const sectionSuffix = section.startsWith('ptah.')
          ? section.slice('ptah.'.length) + '.'
          : section === 'ptah'
            ? ''
            : section + '.';
        const fullKey = sectionSuffix + key;
        const lastSegment = fullKey.split('.').pop() ?? key;
        const lookup =
          currentConfig[fullKey] !== undefined
            ? currentConfig[fullKey]
            : currentConfig[key] !== undefined
              ? currentConfig[key]
              : currentConfig[lastSegment];
        return (lookup !== undefined ? lookup : defaultValue) as T | undefined;
      },
    ),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
  };
}

/** Build a LicenseService stub that reports premium so MCP resolution
 *  reaches the HTTP health check (mocked to fail above — no real network). */
function createMockLicenseService(): Record<string, jest.Mock> {
  const status = { tier: 'pro', plan: { isPremium: true } };
  return {
    getCachedStatus: jest.fn().mockReturnValue(status),
    verifyLicense: jest.fn().mockResolvedValue(status),
  };
}

/** Minimal SubagentRegistryService stub — spawn() only touches it when a
 *  parentSessionId is provided (none of these tests do). */
function createMockSubagentRegistry(): Record<string, jest.Mock> {
  return {
    getRunningBySession: jest.fn().mockReturnValue([]),
    update: jest.fn(),
  };
}

/** Minimal SentryService stub. */
function createMockSentryService(): Record<string, jest.Mock> {
  return {
    captureException: jest.fn(),
  };
}

describe('AgentProcessManager - SDK Execution Path', () => {
  let manager: AgentProcessManager;
  let logger: jest.Mocked<Logger>;
  let sdkControls: MockSdkHandleControls;
  let sdkAdapter: jest.Mocked<CliAdapter>;
  let cliDetection: jest.Mocked<CliDetectionService>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    logger = createMockLogger();
    sdkControls = createMockSdkHandle();
    sdkAdapter = createSdkAdapter(sdkControls);
    cliDetection = createMockCliDetection(sdkAdapter);

    setupVscodeConfig();

    // Instantiate manager directly (tsyringe decorators are mocked to no-ops).
    // After Wave C5/C7a the constructor takes 6 deps: logger, cliDetection,
    // licenseService, subagentRegistry, workspaceProvider, sentryService.
    const licenseService = createMockLicenseService();
    const subagentRegistry = createMockSubagentRegistry();
    const workspaceProvider = createMockWorkspaceProvider();
    const sentryService = createMockSentryService();
    manager = new AgentProcessManager(
      logger,
      cliDetection,
      licenseService as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[2],
      subagentRegistry as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[3],
      workspaceProvider as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[4],
      sentryService as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[5],
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('spawn() with SDK adapter', () => {
    it('should call runSdk() instead of child_process.spawn for SDK adapters', async () => {
      // Auto-resolve the SDK handle after a tick
      setTimeout(() => sdkControls.resolve(0), 10);

      const result = await manager.spawn({
        task: 'Write unit tests',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      expect(result.cli).toBe('codex');
      expect(result.status).toBe('running');
      expect(result.agentId).toBeDefined();
      expect(sdkAdapter.runSdk).toHaveBeenCalledTimes(1);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should pass unsanitized task to runSdk (SDK runs in-process, not via shell)', async () => {
      setTimeout(() => sdkControls.resolve(0), 10);

      await manager.spawn({
        task: 'Run tests $(injected)',
        cli: 'codex',
        workingDirectory: '/workspace/root',
        files: ['src/app.ts'],
        taskFolder: '/tmp/task',
      });

      const runSdkCall = (sdkAdapter.runSdk as jest.Mock).mock.calls[0][0];
      // SDK adapters should receive the original task without shell sanitization
      // because they run in-process and $, (), {} are legitimate code content
      expect(runSdkCall.task).toBe('Run tests $(injected)');
      expect(runSdkCall.workingDirectory).toBe('/workspace/root');
      expect(runSdkCall.files).toEqual(['src/app.ts']);
      expect(runSdkCall.taskFolder).toBe('/tmp/task');
    });

    it('should set agent status to running initially', async () => {
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      const status = manager.getStatus(result.agentId);
      expect(status).toHaveProperty('status', 'running');
    });
  });

  describe('SDK output in readOutput()', () => {
    it('should capture SDK output in the stdout buffer', async () => {
      const result = await manager.spawn({
        task: 'Write code',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      // Emit output from SDK
      sdkControls.emitOutput('Line 1\n');
      sdkControls.emitOutput('Line 2\n');

      const output = manager.readOutput(result.agentId);

      expect(output.stdout).toContain('Line 1');
      expect(output.stdout).toContain('Line 2');
      expect(output.stderr).toBe('');
    });
  });

  describe('stop() on SDK agent', () => {
    it('should call AbortController.abort() when stopping an SDK agent', async () => {
      const result = await manager.spawn({
        task: 'Long task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      const abortSpy = jest.spyOn(sdkControls.abortController, 'abort');

      // Stop the agent - the done promise needs to resolve for cleanup
      const stopPromise = manager.stop(result.agentId);

      // Simulate the SDK responding to abort by resolving
      sdkControls.resolve(1);
      // TASK_2025_175: killProcess() awaits a 500ms grace period after
      // calling AbortController.abort() for SDK agents, so we must advance
      // past that window (jest.useFakeTimers() is active via beforeEach).
      jest.advanceTimersByTime(600);

      const info = await stopPromise;

      expect(abortSpy).toHaveBeenCalled();
      expect(info.status).toBe('stopped');
    });

    it('should return current info if agent already completed', async () => {
      const result = await manager.spawn({
        task: 'Quick task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      // Simulate completion
      sdkControls.resolve(0);
      // Advance timers so handleExit processes
      jest.advanceTimersByTime(10);

      // Wait for the microtask to process
      await Promise.resolve();

      const info = await manager.stop(result.agentId);
      expect(info.status).toBe('completed');
    });
  });

  describe('timeout for SDK agents', () => {
    it('should trigger handleTimeout when timeout expires for SDK agent', async () => {
      const result = await manager.spawn({
        task: 'Slow task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
        timeout: 5000, // 5 second timeout
      });

      // Advance past the timeout
      jest.advanceTimersByTime(6000);

      // Wait for async handleTimeout to process
      await Promise.resolve();
      await Promise.resolve();

      const status = manager.getStatus(result.agentId);
      expect(status).toHaveProperty('status', 'timeout');
    });
  });

  describe('handleExit for SDK agents', () => {
    it('should set status to completed on exit code 0', async () => {
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      sdkControls.resolve(0);

      // Wait for promise resolution
      await Promise.resolve();
      await Promise.resolve();

      const status = manager.getStatus(result.agentId);
      expect(status).toHaveProperty('status', 'completed');
    });

    it('should set status to failed on exit code 1', async () => {
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      sdkControls.resolve(1);
      await Promise.resolve();
      await Promise.resolve();

      const status = manager.getStatus(result.agentId);
      expect(status).toHaveProperty('status', 'failed');
    });

    it('should set status to failed on SDK done promise rejection', async () => {
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      sdkControls.reject(new Error('SDK crash'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const status = manager.getStatus(result.agentId);
      expect(status).toHaveProperty('status', 'failed');
    });

    it('should not double-exit when timeout fires after SDK already resolved', async () => {
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
        timeout: 10000,
      });

      // SDK completes first
      sdkControls.resolve(0);
      await Promise.resolve();
      await Promise.resolve();

      const statusAfterComplete = manager.getStatus(result.agentId);
      expect(statusAfterComplete).toHaveProperty('status', 'completed');

      // Then timeout fires (should be a no-op due to hasExited guard)
      jest.advanceTimersByTime(15000);
      await Promise.resolve();

      // Status should still be 'completed', not overridden by timeout
      const statusAfterTimeout = manager.getStatus(result.agentId);
      expect(statusAfterTimeout).toHaveProperty('status', 'completed');
    });
  });

  describe('steer() on SDK agent', () => {
    it('should throw an error for SDK-based agents that do not support steering', async () => {
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      expect(() => manager.steer(result.agentId, 'do something else')).toThrow(
        /not supported/i,
      );
    });
  });

  describe('shutdownAll() with SDK agents', () => {
    it('should stop all running SDK agents', async () => {
      await manager.spawn({
        task: 'Task 1',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      const abortSpy = jest.spyOn(sdkControls.abortController, 'abort');

      // Trigger shutdownAll
      const shutdownPromise = manager.shutdownAll();

      // The abort should trigger the SDK to resolve
      sdkControls.resolve(1);
      // TASK_2025_175: killProcess() awaits a 500ms grace period for SDK
      // agents. Advance past it so the awaited timeout actually fires.
      jest.advanceTimersByTime(600);
      await Promise.resolve();

      await shutdownPromise;

      expect(abortSpy).toHaveBeenCalled();
      // Verify logger recorded shutdown
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('shut down'),
      );
    });
  });

  describe('concurrent limit includes SDK agents', () => {
    it('should count SDK agents towards the concurrent limit', async () => {
      setupVscodeConfig({ maxConcurrentAgents: 1 });

      // First SDK agent spawns successfully
      await manager.spawn({
        task: 'Task 1',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      // Second spawn should fail due to concurrent limit
      await expect(
        manager.spawn({
          task: 'Task 2',
          cli: 'codex',
          workingDirectory: '/workspace/root',
        }),
      ).rejects.toThrow(/Maximum concurrent agent limit/);
    });

    it('should allow new spawn after SDK agent completes', async () => {
      setupVscodeConfig({ maxConcurrentAgents: 1 });

      // First SDK agent
      await manager.spawn({
        task: 'Task 1',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      // Complete it
      sdkControls.resolve(0);
      await Promise.resolve();
      await Promise.resolve();

      // Create a new SDK handle for the second spawn
      const sdkControls2 = createMockSdkHandle();
      (sdkAdapter.runSdk as jest.Mock).mockResolvedValue(sdkControls2.handle);

      // Second spawn should succeed now
      const result2 = await manager.spawn({
        task: 'Task 2',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      expect(result2.status).toBe('running');
      sdkControls2.resolve(0);
    });
  });

  describe('getPreferredCli() auto-detect', () => {
    it('should auto-detect codex when no preference is set', async () => {
      setupVscodeConfig({ preferredAgentOrder: [] });

      const result = await manager.spawn({
        task: 'Task without explicit CLI',
        workingDirectory: '/workspace/root',
      });

      // Since our mock detection returns codex as installed, it should be chosen
      expect(result.cli).toBe('codex');
    });
  });
});
