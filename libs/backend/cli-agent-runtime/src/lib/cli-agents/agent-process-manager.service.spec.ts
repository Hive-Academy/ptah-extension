/**
 * AgentProcessManager Unit Tests - SDK Execution Path
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

// Mock fs.promises so validateWorkingDirectory()'s realpath() calls don't
// hit the real filesystem (the tests use the synthetic path '/workspace/root'
// which doesn't exist on CI runners). Identity-resolve any input so the
// startsWith() prefix check downstream still works.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      realpath: jest.fn((p: string) => Promise.resolve(p)),
    },
  };
});

// Stub axios so resolveMcpPort()'s health check never performs a real HTTP
// request. A rejection causes MCP to be disabled for the CLI agent, which
// is the behavior we want in these unit tests (MCP wiring is out of scope
// here — covered by the Copilot MCP installer specs).
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
// depends on after the god-service split-up. The source file
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

// We need uuid to generate valid AgentIds, but shared uses it internally.
// Produce unique-but-valid v4-shaped ids so multiple agents can coexist in
// the manager's map (a constant id would make every spawn overwrite the
// previous tracked agent under the same key).
let uuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => {
    const seq = (uuidCounter++).toString(16).padStart(12, '0');
    return `aaaaaaaa-bbbb-4ccc-8ddd-${seq}`;
  },
}));

import {
  AgentProcessManager,
  AgentContinueError,
} from './agent-process-manager.service';
import {
  COMPLETED_AGENT_TTL,
  DEFAULT_TIMEOUT,
} from './agent-process-manager-helpers';
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
  /** Messages passed to continue() */
  continueMessages: string[];
  /** Resolve the most recently created continue() turn done promise */
  resolveContinue: (code: number) => void;
  /** Number of times continue() was invoked */
  continueCallCount: () => number;
}

function createMockSdkHandle(
  options: { supportsContinuation?: boolean } = {},
): MockSdkHandleControls {
  const abortController = new AbortController();
  const outputCallbacks: Array<(data: string) => void> = [];

  let resolvePromise!: (code: number) => void;
  let rejectPromise!: (err: Error) => void;

  const done = new Promise<number>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const continueMessages: string[] = [];
  let continueResolve: ((code: number) => void) | null = null;
  let continueCalls = 0;

  const handle: SdkHandle = {
    abort: abortController,
    done,
    onOutput: (cb: (data: string) => void) => {
      outputCallbacks.push(cb);
    },
    ...(options.supportsContinuation
      ? {
          supportsContinuation: () => true,
          continue: (message: string) => {
            continueCalls += 1;
            continueMessages.push(message);
            const turnDone = new Promise<number>((resolve) => {
              continueResolve = resolve;
            });
            return Promise.resolve({ done: turnDone });
          },
        }
      : {}),
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
    continueMessages,
    resolveContinue: (code: number) => {
      continueResolve?.(code);
    },
    continueCallCount: () => continueCalls,
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
  let reasoningEffortGet: jest.Mock<string, []>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    logger = createMockLogger();
    sdkControls = createMockSdkHandle();
    sdkAdapter = createSdkAdapter(sdkControls);
    cliDetection = createMockCliDetection(sdkAdapter);

    setupVscodeConfig();

    // Instantiate manager directly (tsyringe decorators are mocked to no-ops).
    // The constructor takes 7 deps: logger, cliDetection, licenseService,
    // subagentRegistry, workspaceProvider, sentryService, reasoningSettings.
    const licenseService = createMockLicenseService();
    const subagentRegistry = createMockSubagentRegistry();
    const workspaceProvider = createMockWorkspaceProvider();
    const sentryService = createMockSentryService();
    reasoningEffortGet = jest.fn(() => '');
    const reasoningSettings = { effort: { get: reasoningEffortGet } };
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
      reasoningSettings as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[6],
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

  describe('reasoning effort resolution', () => {
    const spawnCodex = async () => {
      setTimeout(() => sdkControls.resolve(0), 10);
      await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });
      return (sdkAdapter.runSdk as jest.Mock).mock.calls[0][0];
    };

    it('lets the UI effort selection drive the CLI agent', async () => {
      reasoningEffortGet.mockReturnValue('high');
      setupVscodeConfig({ codexReasoningEffort: 'low' });

      const runSdkCall = await spawnCodex();

      expect(runSdkCall.reasoningEffort).toBe('high');
    });

    it("maps UI 'max' to 'xhigh' (Codex/Copilot have no max tier)", async () => {
      reasoningEffortGet.mockReturnValue('max');

      const runSdkCall = await spawnCodex();

      expect(runSdkCall.reasoningEffort).toBe('xhigh');
    });

    it('falls back to the per-CLI config when no UI effort is set', async () => {
      reasoningEffortGet.mockReturnValue('');
      setupVscodeConfig({ codexReasoningEffort: 'low' });

      const runSdkCall = await spawnCodex();

      expect(runSdkCall.reasoningEffort).toBe('low');
    });

    it('is undefined when neither UI effort nor config is set', async () => {
      reasoningEffortGet.mockReturnValue('');
      setupVscodeConfig({ codexReasoningEffort: '' });

      const runSdkCall = await spawnCodex();

      expect(runSdkCall.reasoningEffort).toBeUndefined();
    });

    const spawnPi = async () => {
      setTimeout(() => sdkControls.resolve(0), 10);
      await manager.spawn({
        task: 'Task',
        cli: 'pi',
        workingDirectory: '/workspace/root',
      });
      return (sdkAdapter.runSdk as jest.Mock).mock.calls[0][0];
    };

    // Pi maps effort to `--thinking` and supports the full off..max scale, so
    // the configured value must flow through RAW — no `max`→`xhigh` coercion
    // (unlike Codex/Copilot). These cases guard that documented divergence.
    it.each([
      ['max', 'max'],
      ['off', 'off'],
      ['high', 'high'],
    ])(
      "passes Pi reasoning effort '%s' through raw (no max->xhigh coercion)",
      async (configured, expected) => {
        // UI driver is Codex/Copilot-only; it must NOT influence Pi.
        reasoningEffortGet.mockReturnValue('max');
        setupVscodeConfig({ piReasoningEffort: configured });

        const runSdkCall = await spawnPi();

        expect(runSdkCall.reasoningEffort).toBe(expected);
      },
    );

    it('is undefined for Pi when no reasoning effort is configured', async () => {
      setupVscodeConfig({ piReasoningEffort: '' });

      const runSdkCall = await spawnPi();

      expect(runSdkCall.reasoningEffort).toBeUndefined();
    });
  });

  describe('model resolution', () => {
    const spawnWith = async (cli: 'pi' | 'opencode' | 'antigravity') => {
      setTimeout(() => sdkControls.resolve(0), 10);
      await manager.spawn({
        task: 'Task',
        cli,
        workingDirectory: '/workspace/root',
      });
      return (sdkAdapter.runSdk as jest.Mock).mock.calls[0][0];
    };

    // MODEL_CONFIG_KEYS maps each CLI to its `agentOrchestration.*Model` key;
    // these cases guard the three new CLI entries added for this task.
    it.each([
      ['pi', 'piModel', 'anthropic/claude-sonnet'],
      ['opencode', 'opencodeModel', 'gpt-5-codex'],
      ['antigravity', 'antigravityModel', 'gemini-2.5-pro'],
    ] as const)(
      'reads %s model via MODEL_CONFIG_KEYS (%s)',
      async (cli, configKey, model) => {
        setupVscodeConfig({ [configKey]: model });

        const runSdkCall = await spawnWith(cli);

        expect(runSdkCall.model).toBe(model);
      },
    );
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

    it('routes steering to sdkHandle.steer when the handle exposes it', async () => {
      // Simulate a steer-capable SDK adapter (e.g. Pi RPC mode): the adapter
      // reports supportsSteer() true and the handle owns a live steer channel.
      const steerSpy = jest.fn();
      (sdkControls.handle as { steer?: (message: string) => void }).steer =
        steerSpy;
      sdkAdapter.supportsSteer.mockReturnValue(true);

      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      expect(() =>
        manager.steer(result.agentId, 'also handle errors'),
      ).not.toThrow();
      expect(steerSpy).toHaveBeenCalledWith('also handle errors');
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

  describe('continueConversation()', () => {
    let continuableControls: MockSdkHandleControls;

    const spawnContinuable = async (): Promise<string> => {
      continuableControls = createMockSdkHandle({ supportsContinuation: true });
      (sdkAdapter.runSdk as jest.Mock).mockResolvedValue(
        continuableControls.handle,
      );
      const result = await manager.spawn({
        task: 'Initial task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });
      return result.agentId;
    };

    const completeTurn1 = async (): Promise<void> => {
      continuableControls.resolve(0);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(3100);
      await Promise.resolve();
    };

    it('throws not_found for an unknown agent', async () => {
      await expect(
        manager.continueConversation('missing-agent', 'hello'),
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('throws unsupported when the handle does not support continuation', async () => {
      const result = await manager.spawn({
        task: 'No continuation',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      await expect(
        manager.continueConversation(result.agentId, 'hello'),
      ).rejects.toMatchObject({ code: 'unsupported' });

      sdkControls.resolve(0);
    });

    it('throws busy when the agent is still running', async () => {
      const agentId = await spawnContinuable();

      await expect(
        manager.continueConversation(agentId, 'hello'),
      ).rejects.toMatchObject({ code: 'busy' });

      continuableControls.resolve(0);
    });

    it('emits agent:spawned with supportsContinuation in the info payload', async () => {
      const spawnedInfos: Array<{ supportsContinuation?: boolean }> = [];
      manager.events.on('agent:spawned', (info) => spawnedInfos.push(info));

      await spawnContinuable();

      expect(spawnedInfos[0]).toMatchObject({ supportsContinuation: true });

      continuableControls.resolve(0);
    });

    it('stores the sdkHandle and reaches the continued turn via the same handle', async () => {
      const agentId = await spawnContinuable();
      await completeTurn1();

      expect(manager.getStatus(agentId)).toHaveProperty('status', 'completed');

      await manager.continueConversation(agentId, 'follow-up message');

      expect(continuableControls.continueCallCount()).toBe(1);
      expect(continuableControls.continueMessages).toEqual([
        'follow-up message',
      ]);
    });

    it('re-opens the agent to running and re-emits agent:spawned with the same id', async () => {
      const agentId = await spawnContinuable();
      await completeTurn1();

      const spawnedIds: string[] = [];
      manager.events.on('agent:spawned', (info: { agentId: string }) =>
        spawnedIds.push(info.agentId),
      );

      await manager.continueConversation(agentId, 'continue please');

      expect(spawnedIds).toEqual([agentId]);
      const status = manager.getStatus(agentId) as { status: string };
      expect(status.status).toBe('running');
    });

    it('does not double-fire handleExit across turn1 -> continue -> turn2', async () => {
      const agentId = await spawnContinuable();

      const exitInfos: Array<{ agentId: string; status: string }> = [];
      manager.events.on('agent:exited', (info) => exitInfos.push(info));

      await completeTurn1();
      expect(exitInfos).toHaveLength(1);

      await manager.continueConversation(agentId, 'second turn');
      continuableControls.resolveContinue(0);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(3100);
      await Promise.resolve();

      expect(exitInfos).toHaveLength(2);
      expect(manager.getStatus(agentId)).toHaveProperty('status', 'completed');
    });

    it('re-attaches a fresh exit handler so a failing continued turn marks failed', async () => {
      const agentId = await spawnContinuable();
      await completeTurn1();

      await manager.continueConversation(agentId, 'turn that fails');
      continuableControls.resolveContinue(1);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(3100);
      await Promise.resolve();

      expect(manager.getStatus(agentId)).toHaveProperty('status', 'failed');
    });

    it('exposes a typed AgentContinueError', async () => {
      await manager
        .continueConversation('missing-agent', 'hello')
        .catch((error: unknown) => {
          expect(error).toBeInstanceOf(AgentContinueError);
        });
    });

    it('arms a cleanup timer on turn1 completion that removes the agent after TTL', async () => {
      const agentId = await spawnContinuable();
      await completeTurn1();

      expect(manager.getStatus(agentId)).toHaveProperty('status', 'completed');

      jest.advanceTimersByTime(COMPLETED_AGENT_TTL);

      expect(() => manager.getStatus(agentId)).toThrow(/not found/i);
    });

    it('clears the cleanup timer on continue so TTL no longer removes the agent', async () => {
      const agentId = await spawnContinuable();
      await completeTurn1();

      await manager.continueConversation(agentId, 'keep me alive');

      jest.advanceTimersByTime(COMPLETED_AGENT_TTL);

      expect(manager.getStatus(agentId)).toHaveProperty('status', 'running');
    });

    it('reinstalls the running timeout on continue so the continued turn can time out', async () => {
      const agentId = await spawnContinuable();
      await completeTurn1();

      await manager.continueConversation(agentId, 'long-running follow-up');

      jest.advanceTimersByTime(DEFAULT_TIMEOUT);
      await Promise.resolve();
      await Promise.resolve();

      expect(manager.getStatus(agentId)).toHaveProperty('status', 'timeout');
    });

    it('fires the abort path when stopping a continued (re-running) agent', async () => {
      const agentId = await spawnContinuable();
      await completeTurn1();

      const abortSpy = jest.spyOn(continuableControls.abortController, 'abort');

      await manager.continueConversation(agentId, 'second turn');
      expect(manager.getStatus(agentId)).toHaveProperty('status', 'running');

      const stopPromise = manager.stop(agentId);
      continuableControls.resolveContinue(1);
      jest.advanceTimersByTime(600);
      const info = await stopPromise;

      expect(abortSpy).toHaveBeenCalled();
      expect(info.status).toBe('stopped');
    });

    it('succeeds even when the concurrent limit is occupied (accepted v1 edge case)', async () => {
      setupVscodeConfig({ maxConcurrentAgents: 1 });

      const agentId = await spawnContinuable();
      await completeTurn1();

      const blockerControls = createMockSdkHandle();
      (sdkAdapter.runSdk as jest.Mock).mockResolvedValue(
        blockerControls.handle,
      );
      const blocker = await manager.spawn({
        task: 'Occupies the only concurrent slot',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });
      expect(manager.getStatus(blocker.agentId)).toHaveProperty(
        'status',
        'running',
      );

      await expect(
        manager.continueConversation(agentId, 'continue past the limit'),
      ).resolves.toBeUndefined();
      expect(manager.getStatus(agentId)).toHaveProperty('status', 'running');

      blockerControls.resolve(0);
    });
  });
});
