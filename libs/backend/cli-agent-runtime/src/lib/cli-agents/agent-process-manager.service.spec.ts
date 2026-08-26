/**
 * AgentProcessManager Unit Tests - SDK Execution Path
 *
 * Tests: SDK spawn path, output streaming, stop/abort, timeout, steer rejection,
 *        idle subprocess release, disposeAll with mixed CLI/SDK agents,
 *        concurrent limit enforcement.
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

// Mock tsyringe decorators to no-ops
jest.mock('tsyringe', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
}));

// Mock the Logger token + service classes that AgentProcessManager now
// depends on after the god-service split-up. The source file
// constructor-injects SubagentRegistryService and SentryService alongside
// the original logger/cliDetection.
jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    LOGGER: Symbol('LOGGER'),
    CLI_DETECTION_SERVICE: Symbol('CLI_DETECTION_SERVICE'),
    SUBAGENT_REGISTRY_SERVICE: Symbol('SUBAGENT_REGISTRY_SERVICE'),
    SENTRY_SERVICE: Symbol('SENTRY_SERVICE'),
  },
  Logger: class {},
  SubagentRegistryService: class {},
  SentryService: class {},
}));

// Mock platform-core for the PLATFORM_TOKENS.WORKSPACE_PROVIDER injection.
jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: {
    WORKSPACE_PROVIDER: Symbol('WORKSPACE_PROVIDER'),
    MCP_SERVER_STATUS: Symbol('MCP_SERVER_STATUS'),
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
  BUFFER_LOW_WATER_SIZE,
  COMPLETED_AGENT_TTL,
  DEFAULT_TIMEOUT,
  MAX_BUFFER_SIZE,
  SDK_IDLE_RELEASE_MS,
  countNewlines,
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
  let getMcpPort: jest.Mock<number | null, []>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    logger = createMockLogger();
    sdkControls = createMockSdkHandle();
    sdkAdapter = createSdkAdapter(sdkControls);
    cliDetection = createMockCliDetection(sdkAdapter);

    setupVscodeConfig();

    // Instantiate manager directly (tsyringe decorators are mocked to no-ops).
    // The constructor takes 6 deps: logger, cliDetection, subagentRegistry,
    // workspaceProvider, sentryService, reasoningSettings.
    const subagentRegistry = createMockSubagentRegistry();
    const workspaceProvider = createMockWorkspaceProvider();
    const sentryService = createMockSentryService();
    reasoningEffortGet = jest.fn(() => '');
    const reasoningSettings = { effort: { get: reasoningEffortGet } };
    getMcpPort = jest.fn<number | null, []>(() => null);
    manager = new AgentProcessManager(
      logger,
      cliDetection,
      subagentRegistry as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[2],
      workspaceProvider as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[3],
      sentryService as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[4],
      reasoningSettings as unknown as ConstructorParameters<
        typeof AgentProcessManager
      >[5],
      null,
      { getPort: getMcpPort },
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

    it('propagates the actual MCP status port to MCP-capable adapters', async () => {
      getMcpPort.mockReturnValue(51821);
      setTimeout(() => sdkControls.resolve(0), 10);

      await manager.spawn({
        task: 'Use Ptah tools',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      expect(getMcpPort).toHaveBeenCalledTimes(1);
      expect((sdkAdapter.runSdk as jest.Mock).mock.calls[0][0].mcpPort).toBe(
        51821,
      );
    });

    it('does not resolve an MCP port for adapters that opt out', async () => {
      Object.assign(sdkAdapter, { supportsMcp: false });
      getMcpPort.mockReturnValue(51821);
      setTimeout(() => sdkControls.resolve(0), 10);

      await manager.spawn({
        task: 'No MCP support',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      expect(getMcpPort).not.toHaveBeenCalled();
      expect(
        (sdkAdapter.runSdk as jest.Mock).mock.calls[0][0].mcpPort,
      ).toBeUndefined();
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

      // `stop()` on a finished agent is no longer a no-op — it reclaims the
      // subprocess a continuation-capable handle may still be holding, and
      // waits for the kill to settle (TASK_2026_323 B11). Pump the fake clock
      // past that settle so the awaited call can resolve.
      const pending = manager.stop(result.agentId);
      jest.advanceTimersByTime(600);
      const info = await pending;
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

  describe('disposeAll() with SDK agents', () => {
    it('should stop all running SDK agents', async () => {
      await manager.spawn({
        task: 'Task 1',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      const abortSpy = jest.spyOn(sdkControls.abortController, 'abort');

      const disposePromise = manager.disposeAll();

      // The abort should trigger the SDK to resolve
      sdkControls.resolve(1);
      // agents. Advance past it so the awaited timeout actually fires.
      jest.advanceTimersByTime(600);
      await Promise.resolve();

      await disposePromise;

      expect(abortSpy).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('agents disposed'),
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

    // Regression: the system-CLI allowlist used to be a hard-coded
    // ['codex','copilot','cursor'] triple, so antigravity/opencode/pi were
    // silently skipped when preferred and the manager fell through to
    // auto-detect. It now derives from SYSTEM_CLI_TYPES.
    it.each(['antigravity', 'opencode', 'pi'])(
      'honours %s as a preferred CLI',
      async (cli) => {
        setupVscodeConfig({ preferredAgentOrder: [cli] });

        const result = await manager.spawn({
          task: 'Task without explicit CLI',
          workingDirectory: '/workspace/root',
        });

        expect(result.cli).toBe(cli);
      },
    );

    it('skips a preferred CLI that is disabled', async () => {
      setupVscodeConfig({
        preferredAgentOrder: ['antigravity'],
        disabledClis: ['antigravity'],
      });

      const result = await manager.spawn({
        task: 'Task without explicit CLI',
        workingDirectory: '/workspace/root',
      });

      // Falls through to auto-detect, which the mock reports as codex.
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

    it('announces the TTL removal so the UI can stop offering a continuation', async () => {
      const agentId = await spawnContinuable();
      const expired: string[] = [];
      manager.events.on('agent:expired', (payload: { agentId: string }) =>
        expired.push(payload.agentId),
      );
      await completeTurn1();

      expect(expired).toEqual([]);

      jest.advanceTimersByTime(COMPLETED_AGENT_TTL);

      // Without this the card keeps a live-looking follow-up box wired to an id
      // the manager can only answer `not_found` for.
      expect(expired).toEqual([agentId]);
    });

    it('does not announce an expiry for an agent kept alive by continue', async () => {
      const agentId = await spawnContinuable();
      const expired: string[] = [];
      manager.events.on('agent:expired', (payload: { agentId: string }) =>
        expired.push(payload.agentId),
      );
      await completeTurn1();
      await manager.continueConversation(agentId, 'keep me alive');

      jest.advanceTimersByTime(COMPLETED_AGENT_TTL);

      expect(expired).toEqual([]);
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

  /**
   * TASK_2026_323 B11 — a finished agent must not keep its process.
   *
   * A continuation-capable handle deliberately outlives its turn: on the
   * ptah-cli path `query()` is fed a prompt mailbox whose generator returns only
   * once the mailbox is closed, and it closes only on abort. `handleExit` marked
   * the agent completed and aborted nothing, and `scheduleCleanup` then deleted
   * the last reference to that abort controller — so the subprocess lived until
   * the host quit. Measured on the user's machine: 16 idle `claude.exe` at
   * 90-180 MB each, three hours after their tasks finished, memory at 99%.
   */
  describe('idle subprocess release', () => {
    let controls: MockSdkHandleControls;

    const spawnContinuable = async (): Promise<string> => {
      controls = createMockSdkHandle({ supportsContinuation: true });
      (sdkAdapter.runSdk as jest.Mock).mockResolvedValue(controls.handle);
      const result = await manager.spawn({
        task: 'Initial task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });
      return result.agentId;
    };

    const completeTurn1 = async (): Promise<void> => {
      controls.resolve(0);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(3100);
      await Promise.resolve();
    };

    /** Let the release's post-abort settle (killProcess' 500 ms wait) finish. */
    const settleRelease = async (): Promise<void> => {
      jest.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };

    it('aborts the handle exactly once after the idle window, keeping the record readable', async () => {
      const agentId = await spawnContinuable();
      const abortSpy = jest.spyOn(controls.abortController, 'abort');
      controls.emitOutput('work in progress\n');
      await completeTurn1();

      expect(abortSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(SDK_IDLE_RELEASE_MS);
      await settleRelease();

      // Exactly once: the record is deliberately kept, so every later caller
      // (TTL cleanup, stop, disposeAll) walks the same release path and must
      // find it already done rather than issuing a second abort + tree-kill.
      expect(abortSpy).toHaveBeenCalledTimes(1);

      // The record and its buffered output survive the process. This is what
      // keeps `ptah_agent_read` answering until COMPLETED_AGENT_TTL — releasing
      // the process must not look, to a reader, like the agent never ran.
      expect(manager.getStatus(agentId)).toHaveProperty('status', 'completed');
      expect(manager.readOutput(agentId).stdout).toContain('work in progress');
    });

    it('rejects a continuation with `released` and names the resume path', async () => {
      const agentId = await spawnContinuable();
      await completeTurn1();

      jest.advanceTimersByTime(SDK_IDLE_RELEASE_MS);
      await settleRelease();

      const error = await manager
        .continueConversation(agentId, 'follow up')
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(AgentContinueError);
      expect(error).toMatchObject({ code: 'released' });
      // The caller's recovery is a session resume, so the message has to name
      // the parameter that performs it — a bare "released" tells the agent
      // holding this handle nothing it can act on.
      expect((error as Error).message).toContain('resume_session_id');
      expect(controls.continueCallCount()).toBe(0);
    });

    it('keeps the process alive for a follow-up sent inside the idle window', async () => {
      const agentId = await spawnContinuable();
      const abortSpy = jest.spyOn(controls.abortController, 'abort');
      await completeTurn1();

      // Comfortably inside the window — `completeTurn1` has already burnt the
      // 3.1 s graceful-exit delay off the clock the release timer runs on.
      jest.advanceTimersByTime(SDK_IDLE_RELEASE_MS - 60_000);
      await manager.continueConversation(agentId, 'quick follow-up');

      // The continuation is the reason the process was held — arming a release
      // and then letting it fire mid-turn would kill a live run.
      jest.advanceTimersByTime(SDK_IDLE_RELEASE_MS * 2);
      await Promise.resolve();

      expect(abortSpy).not.toHaveBeenCalled();
      expect(controls.continueCallCount()).toBe(1);
      expect(manager.getStatus(agentId)).toHaveProperty('status', 'running');
    });

    it('re-arms the idle window when the continued turn ends', async () => {
      const agentId = await spawnContinuable();
      const abortSpy = jest.spyOn(controls.abortController, 'abort');
      await completeTurn1();
      await manager.continueConversation(agentId, 'second turn');

      controls.resolveContinue(0);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(3100);
      await Promise.resolve();

      jest.advanceTimersByTime(SDK_IDLE_RELEASE_MS);
      await settleRelease();

      expect(abortSpy).toHaveBeenCalledTimes(1);
    });

    it('announces the release so the card stops offering a continuation', async () => {
      const released: Array<{ agentId: string; reason: string }> = [];
      const agentId = await spawnContinuable();
      manager.events.on('agent:released', (payload) => released.push(payload));
      await completeTurn1();

      jest.advanceTimersByTime(SDK_IDLE_RELEASE_MS);
      await settleRelease();

      expect(released).toEqual([
        expect.objectContaining({ agentId, reason: 'idle' }),
      ]);
    });

    it('honours a configured idle window', async () => {
      setupVscodeConfig({ maxConcurrentAgents: 3, sdkIdleReleaseMs: 20_000 });
      const agentId = await spawnContinuable();
      const abortSpy = jest.spyOn(controls.abortController, 'abort');
      await completeTurn1();

      // 3.1 s of the 20 s window is already gone (graceful-exit delay).
      jest.advanceTimersByTime(10_000);
      expect(abortSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(15_000);
      await settleRelease();

      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(() => manager.getStatus(agentId)).not.toThrow();
    });

    it('releases at TTL for a handle that never supported continuation', async () => {
      // No idle timer is armed for these — nothing about them is meant to
      // outlive the turn — so the cleanup sweep is their only backstop, and
      // deleting the record without aborting first is what made an orphan
      // permanent: after the delete nothing holds the controller.
      const abortSpy = jest.spyOn(sdkControls.abortController, 'abort');
      const result = await manager.spawn({
        task: 'One shot',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      sdkControls.resolve(0);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(3100);
      await Promise.resolve();

      expect(abortSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(COMPLETED_AGENT_TTL);
      await settleRelease();

      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(() => manager.getStatus(result.agentId)).toThrow(/not found/i);
    });

    it('reclaims a completed agent on stop() without relabelling its status', async () => {
      const agentId = await spawnContinuable();
      const abortSpy = jest.spyOn(controls.abortController, 'abort');
      await completeTurn1();

      const stopped = await (async () => {
        const pending = manager.stop(agentId);
        await settleRelease();
        return pending;
      })();

      expect(abortSpy).toHaveBeenCalledTimes(1);
      // `ptah_agent_stop` on a finished agent is a memory request, not a
      // cancellation — reporting `stopped` would relabel a successful run.
      expect(stopped.status).toBe('completed');
      expect(manager.getStatus(agentId)).toHaveProperty('status', 'completed');
    });

    it('releases every agent on disposeAll, running or not', async () => {
      const finishedId = await spawnContinuable();
      const finishedControls = controls;
      const finishedAbort = jest.spyOn(
        finishedControls.abortController,
        'abort',
      );
      await completeTurn1();

      const runningControls = createMockSdkHandle({
        supportsContinuation: true,
      });
      (sdkAdapter.runSdk as jest.Mock).mockResolvedValue(
        runningControls.handle,
      );
      const running = await manager.spawn({
        task: 'Still going',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });
      const runningAbort = jest.spyOn(runningControls.abortController, 'abort');

      const disposePromise = manager.disposeAll();
      await settleRelease();
      await disposePromise;

      // The COMPLETED one is the whole point: the old shutdown filtered to
      // `status === 'running'` and walked straight past every orphan.
      expect(finishedAbort).toHaveBeenCalledTimes(1);
      expect(runningAbort).toHaveBeenCalledTimes(1);
      expect(() => manager.getStatus(finishedId)).toThrow(/not found/i);
      expect(() => manager.getStatus(running.agentId)).toThrow(/not found/i);
    });
  });

  /**
   * TASK_2026_295 — `''` is not a tab id.
   *
   * The loop matched `record.parentSessionId === tabId` with no guard, so one
   * call with an empty tabId re-parented EVERY agent whose parent was also
   * empty — agents from unrelated sessions, or from none — onto whichever
   * session happened to resolve first.
   */
  describe('resolveParentSessionId()', () => {
    const spawnWithParent = async (
      parentSessionId: string | undefined,
    ): Promise<string> => {
      const controls = createMockSdkHandle();
      (sdkAdapter.runSdk as jest.Mock).mockResolvedValue(controls.handle);
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
        parentSessionId,
      });
      return result.agentId;
    };

    const parentOf = (agentId: string): string | undefined =>
      (manager.getStatus(agentId) as { parentSessionId?: string })
        .parentSessionId;

    it('does not re-parent unrelated agents when the tab id is empty', async () => {
      const orphan = await spawnWithParent('');
      const real = await spawnWithParent(
        '11111111-2222-4333-8444-555555555555',
      );

      manager.resolveParentSessionId(
        '',
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      );

      expect(parentOf(orphan)).toBe('');
      expect(parentOf(real)).toBe('11111111-2222-4333-8444-555555555555');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('blank id'),
        expect.anything(),
      );
    });

    it('does not rewrite a parent to an empty real session id', async () => {
      const tabId = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111';
      const agentId = await spawnWithParent(tabId);

      manager.resolveParentSessionId(tabId, '');

      expect(parentOf(agentId)).toBe(tabId);
    });

    it('still remaps matching agents for a real tab id', async () => {
      const tabId = 'aaaaaaaa-bbbb-4ccc-8ddd-222222222222';
      const realSessionId = '11111111-2222-4333-8444-555555555555';
      const matching = await spawnWithParent(tabId);
      const other = await spawnWithParent('');

      manager.resolveParentSessionId(tabId, realSessionId);

      expect(parentOf(matching)).toBe(realSessionId);
      expect(parentOf(other)).toBe('');
    });
  });

  /**
   * TASK_2026_323 B1 — the stdout buffer trim.
   *
   * The trim used to remove only the OVERFLOW, so a buffer that reached 1 MB
   * stayed pinned at 1 MB: it dropped one line and copied the surviving
   * megabyte on EVERY subsequent chunk. On the ptah-cli path a chunk is one
   * token, which made a chatty agent copy a megabyte per token on the Electron
   * main thread. The trim now cuts back to a low-water mark, so the copy is
   * amortized.
   */
  describe('output buffer trimming (TASK_2026_323 B1)', () => {
    /** Exactly 1 KB including the trailing newline, so line boundaries are exact. */
    const LINE = `${'x'.repeat(1023)}\n`;

    const spawnAgent = async (): Promise<string> => {
      const result = await manager.spawn({
        task: 'Chatty task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });
      return result.agentId;
    };

    it('cuts back to the low-water mark on the first trim, not to the cap', async () => {
      const agentId = await spawnAgent();

      // 1024 x 1 KB lands the buffer on exactly MAX_BUFFER_SIZE, which does not
      // trim. Line 1025 is the first append that crosses it, so exactly one
      // trim has run when the loop ends.
      for (let i = 0; i < 1025; i++) {
        sdkControls.emitOutput(LINE);
      }

      const output = manager.readOutput(agentId);

      // This is the assertion the whole fix is about. The overflow-only trim
      // left ~1 MB here — still saturated, so the next chunk copied it again.
      expect(output.stdout.length).toBeLessThanOrEqual(BUFFER_LOW_WATER_SIZE);
      expect(output.stdout.length).toBeGreaterThanOrEqual(
        BUFFER_LOW_WATER_SIZE - LINE.length,
      );
      expect(output.truncated).toBe(true);
    });

    it('keeps a saturated buffer between the low-water mark and the cap', async () => {
      const agentId = await spawnAgent();

      // 2 MB — twice the cap, so the trim runs several times.
      for (let i = 0; i < 2048; i++) {
        sdkControls.emitOutput(LINE);
      }

      const output = manager.readOutput(agentId);

      expect(output.stdout.length).toBeLessThanOrEqual(MAX_BUFFER_SIZE);
      // A trim cuts to the low-water mark and then forward to the next line
      // boundary, so it can undershoot by at most one line.
      expect(output.stdout.length).toBeGreaterThanOrEqual(
        BUFFER_LOW_WATER_SIZE - LINE.length,
      );
      expect(output.truncated).toBe(true);
    });

    it('counts lines exactly while the buffer is below the cap', async () => {
      const agentId = await spawnAgent();

      sdkControls.emitOutput('alpha\nbeta\n');
      sdkControls.emitOutput('gamma\n');

      const output = manager.readOutput(agentId);
      expect(output.lineCount).toBe(3);
      expect(output.truncated).toBe(false);
    });

    it('reports the lines still in the buffer after a trim, not the lines ever seen', async () => {
      const agentId = await spawnAgent();
      const linesEmitted = 2048;

      for (let i = 0; i < linesEmitted; i++) {
        sdkControls.emitOutput(LINE);
      }

      const output = manager.readOutput(agentId);

      // The invariant that matters: the counter and the buffer agree.
      expect(output.lineCount).toBe(countNewlines(output.stdout));
      expect(output.lineCount).toBeGreaterThan(0);
      expect(output.lineCount).toBeLessThan(linesEmitted);
    });

    describe('append cost past saturation', () => {
      beforeEach(() => {
        // The measurement below needs a real clock, and jest's modern fake
        // timers fake `performance` alongside `setTimeout`.
        jest.useFakeTimers({ doNotFake: ['performance'] });
      });

      it('stays cheap for many small chunks once the buffer is saturated', async () => {
        const agentId = await spawnAgent();

        // Saturate first, in 1 KB lines, so the measured loop starts at the cap.
        for (let i = 0; i < 1024; i++) {
          sdkControls.emitOutput(LINE);
        }

        const chunk = `${'y'.repeat(99)}\n`; // 100 B
        const chunkCount = 10_000; // ~1 MB, so the trim runs ~4 times

        const startedAt = performance.now();
        for (let i = 0; i < chunkCount; i++) {
          sdkControls.emitOutput(chunk);
        }
        const elapsedMs = performance.now() - startedAt;

        // With the overflow-only trim this loop copied ~1 MB per chunk — 10 GB
        // of string copying, tens of seconds. With the low-water trim it copies
        // ~768 KB roughly four times. The bound is two orders of magnitude
        // above the fixed cost and two below the broken one, so it separates
        // the two without being a wall-clock coin flip.
        expect(elapsedMs).toBeLessThan(500);
        expect(manager.readOutput(agentId).stdout.length).toBeLessThanOrEqual(
          MAX_BUFFER_SIZE,
        );
      });
    });
  });

  /**
   * TASK_2026_323 B9 — every per-agent timer must be unref'd.
   *
   * These are watchdogs and housekeeping ticks: they must fire IF the process
   * is alive, and must never be the reason it stays alive. Ref'd, one spawned
   * agent pinned the event loop for up to an hour and a completed one for a
   * further thirty minutes. Same defect class as commit 5dc525f02.
   */
  describe("agent timers are unref'd (TASK_2026_323 B9)", () => {
    interface TimerBearingAgent {
      timeoutHandle: NodeJS.Timeout;
      cleanupHandle?: NodeJS.Timeout;
      exitEmitHandle?: NodeJS.Timeout;
    }

    const trackedAgent = (agentId: string): TimerBearingAgent => {
      const agents = (
        manager as unknown as { agents: Map<string, TimerBearingAgent> }
      ).agents;
      const tracked = agents.get(agentId);
      if (!tracked) throw new Error(`No tracked agent for ${agentId}`);
      return tracked;
    };

    const flushTimerFor = (agentId: string): NodeJS.Timeout | undefined =>
      (
        manager as unknown as { flushTimers: Map<string, NodeJS.Timeout> }
      ).flushTimers.get(agentId);

    it('does not hold the loop open with the spawn timeout or the output flush timer', async () => {
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      expect(trackedAgent(result.agentId).timeoutHandle.hasRef()).toBe(false);

      sdkControls.emitOutput('some output\n');

      const flushTimer = flushTimerFor(result.agentId);
      expect(flushTimer).toBeDefined();
      expect(flushTimer?.hasRef()).toBe(false);
    });

    it('does not hold the loop open with the deferred exit emit or the TTL cleanup timer', async () => {
      const result = await manager.spawn({
        task: 'Task',
        cli: 'codex',
        workingDirectory: '/workspace/root',
      });

      sdkControls.resolve(0);
      await Promise.resolve();
      await Promise.resolve();

      const tracked = trackedAgent(result.agentId);
      expect(tracked.exitEmitHandle).toBeDefined();
      expect(tracked.exitEmitHandle?.hasRef()).toBe(false);
      expect(tracked.cleanupHandle).toBeDefined();
      expect(tracked.cleanupHandle?.hasRef()).toBe(false);
    });
  });

  /**
   * TASK_2026_323 B10 — the spawn mutex must not serialize whole spawns.
   *
   * The lock is global to the host. It used to wrap the ENTIRE spawn: CLI
   * detection, the working-directory `realpath`, the 1500 ms harness preflight
   * and the SDK process launch. One slow spawn in session A therefore blocked
   * sessions B and C from starting one at all. It now covers only the
   * check-and-reserve against the concurrent cap.
   *
   * Two things have to hold at once, which is why both tests live here: spawns
   * must OVERLAP, and the cap must still be EXACT.
   */
  describe('spawn concurrency (TASK_2026_323 B10)', () => {
    /** Let queued microtasks and promise chains drain. */
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    describe('spawns overlap outside the lock', () => {
      let overlapManager: AgentProcessManager;
      let ensure: jest.Mock<Promise<void>, [string]>;
      let releasePreflight: () => void;

      beforeEach(() => {
        // The overlap is observed across real microtask turns, and the manager
        // under test arms real (unref'd) watchdog timers it never needs to fire.
        jest.useRealTimers();

        let resolveGate: () => void = () => {
          /* replaced below */
        };
        const gate = new Promise<void>((resolve) => {
          resolveGate = () => resolve();
        });
        releasePreflight = resolveGate;
        ensure = jest.fn<Promise<void>, [string]>(() => gate);

        // Each spawn needs its own handle: one shared handle would make the two
        // agents indistinguishable in the manager's map.
        (sdkAdapter.runSdk as jest.Mock).mockImplementation(() =>
          Promise.resolve(createMockSdkHandle().handle),
        );

        setupVscodeConfig({ maxConcurrentAgents: 3 });

        overlapManager = new AgentProcessManager(
          logger,
          cliDetection,
          createMockSubagentRegistry() as unknown as ConstructorParameters<
            typeof AgentProcessManager
          >[2],
          createMockWorkspaceProvider() as unknown as ConstructorParameters<
            typeof AgentProcessManager
          >[3],
          createMockSentryService() as unknown as ConstructorParameters<
            typeof AgentProcessManager
          >[4],
          {
            effort: { get: jest.fn(() => '') },
          } as unknown as ConstructorParameters<typeof AgentProcessManager>[5],
          { ensure } as unknown as ConstructorParameters<
            typeof AgentProcessManager
          >[6],
          { getPort: jest.fn(() => null) },
        );
      });

      afterEach(async () => {
        releasePreflight();
        await flush();
        jest.useFakeTimers();
      });

      it('runs the second session harness preflight while the first is still inside it', async () => {
        const spawnA = overlapManager.spawn({
          task: 'Session A task',
          cli: 'codex',
          workingDirectory: '/workspace/root',
        });
        const spawnB = overlapManager.spawn({
          task: 'Session B task',
          cli: 'codex',
          workingDirectory: '/workspace/root',
        });

        await flush();

        // The assertion the whole fix is about. The gate is still closed, so A
        // is parked inside its preflight. Under the old shape B was still
        // queued behind A on the global mutex and had not reached `ensure` at
        // all, so this read 1.
        expect(ensure).toHaveBeenCalledTimes(2);

        releasePreflight();
        const [resultA, resultB] = await Promise.all([spawnA, spawnB]);

        expect(resultA.status).toBe('running');
        expect(resultB.status).toBe('running');
        expect(resultA.agentId).not.toBe(resultB.agentId);
      });
    });

    describe('the cap stays exact under a burst', () => {
      it.each([2, 3])(
        'admits exactly %i spawns from a 10-way burst and rejects the rest',
        async (max) => {
          setupVscodeConfig({ maxConcurrentAgents: max });
          (sdkAdapter.runSdk as jest.Mock).mockImplementation(() =>
            Promise.resolve(createMockSdkHandle().handle),
          );

          const outcomes = await Promise.allSettled(
            Array.from({ length: 10 }, (_, i) =>
              manager.spawn({
                task: `Burst task ${i}`,
                cli: 'codex',
                workingDirectory: '/workspace/root',
              }),
            ),
          );

          const admitted = outcomes.filter((o) => o.status === 'fulfilled');
          const refused = outcomes.filter((o) => o.status === 'rejected');

          // Shrinking the critical section must not widen the cap: the
          // reservation is taken INSIDE the lock precisely so a burst cannot
          // over-admit.
          expect(admitted).toHaveLength(max);
          expect(refused).toHaveLength(10 - max);
          for (const outcome of refused) {
            expect(
              ((outcome as PromiseRejectedResult).reason as Error).message,
            ).toContain('Maximum concurrent agent limit reached');
          }
        },
      );
    });
  });
});
