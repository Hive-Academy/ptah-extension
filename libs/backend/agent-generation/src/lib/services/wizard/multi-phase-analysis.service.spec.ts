/**
 * MultiPhaseAnalysisService Tests
 *
 * Drives the analysis pipeline with fake SDK streams against the real
 * `AnalysisStorageService` over an in-memory file system, so every assertion
 * about the manifest is an assertion about what is on disk.
 *
 * Covers:
 * - success with an agent-written file
 * - success where the file is created from the complete captured text
 * - no result / error result / timeout => failed with an error, diagnostic
 *   text kept, never `completed`
 * - user pause => `paused`, active phase back to `pending`, slug kept
 * - resume skips completed phases, restarts a stale `running` phase, keeps
 *   the runId, never deletes
 * - resume without a resumable manifest falls back to a fresh run
 * - text capture ignores the throttled UI emitter
 */

import 'reflect-metadata';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { join, resolve } from 'path';

jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: class {},
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
    WEBVIEW_MANAGER: Symbol.for('WebviewManager'),
  },
}));

jest.mock('@ptah-extension/settings-core', () => ({
  SETTINGS_TOKENS: { MODEL_SETTINGS: Symbol.for('ModelSettings') },
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: {
    SDK_INTERNAL_QUERY_SERVICE: Symbol.for('InternalQueryService'),
  },
  // Drains the stream like the real processor and emits a throttled UI text
  // delta that MUST NOT reach any persisted phase file.
  SdkStreamProcessor: class {
    constructor(
      private readonly config: {
        emitter: { emit: (event: unknown) => void };
      },
    ) {}
    async process(stream: AsyncIterable<unknown>): Promise<unknown> {
      this.config.emitter.emit({
        kind: 'text',
        content: 'UI-ONLY-DELTA',
        timestamp: Date.now(),
      });
      for await (const _message of stream) {
        /* drain */
      }
      return { structuredOutput: null };
    }
  },
  discoverPluginSkills: jest.fn(() => []),
  formatSkillsForPrompt: jest.fn(() => ''),
}));

import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import { AnalysisStorageService } from '../analysis-storage.service';
import {
  MultiPhaseAnalysisService,
  PER_PHASE_TIMEOUT_MS,
} from './multi-phase-analysis.service';
import {
  PHASE_CONFIGS,
  type MultiPhaseManifest,
} from '../../types/multi-phase.types';

const WORKSPACE = resolve('/ws/demo');
const SLUG_DIR = join(WORKSPACE, '.ptah', 'analysis', 'demo');
const FILES = PHASE_CONFIGS.map((c) => c.file);

type SdkMessage = Record<string, unknown>;
type Scenario = (signal: AbortSignal) => AsyncIterable<SdkMessage>;

const assistant = (text: string): SdkMessage => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
});
const success = (result?: string): SdkMessage => ({
  type: 'result',
  subtype: 'success',
  result,
  num_turns: 1,
  total_cost_usd: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
});
const errorResult = (): SdkMessage => ({
  type: 'result',
  subtype: 'error_during_execution',
  errors: ['model exploded'],
});

function abortError(reason: unknown): Error {
  const error = new Error(`aborted: ${String(reason)}`);
  error.name = 'AbortError';
  return error;
}

/** Yields the given messages, running `sideEffect` before the result. */
function streamOf(
  messages: SdkMessage[],
  sideEffect?: () => Promise<void> | void,
): Scenario {
  return async function* () {
    for (const message of messages) {
      if (message['type'] === 'result' && sideEffect) await sideEffect();
      yield message;
    }
  };
}

/** Yields partial text, then hangs until the phase signal aborts. */
function hangingStream(afterPartial?: () => void): Scenario {
  return async function* (signal: AbortSignal) {
    yield assistant('partial output');
    afterPartial?.();
    await new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(abortError(signal.reason));
        return;
      }
      signal.addEventListener(
        'abort',
        () => reject(abortError(signal.reason)),
        {
          once: true,
        },
      );
    });
  };
}

describe('MultiPhaseAnalysisService', () => {
  let fs: MockFileSystemProvider;
  let storage: AnalysisStorageService;
  let service: MultiPhaseAnalysisService;
  let scenarios: Scenario[];
  let execute: jest.Mock<
    (config: { abortController: AbortController }) => Promise<{
      stream: AsyncIterable<SdkMessage>;
      close: () => void;
      abort: () => void;
    }>
  >;
  let closeFn: jest.Mock;
  let broadcastMessage: jest.Mock;
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  /** Scenario whose agent writes the expected phase file itself. */
  const agentWritesFile = (file: string, text = 'agent wrote'): Scenario =>
    streamOf([assistant(text), success(text)], () =>
      storage.writePhaseFile(SLUG_DIR, file, `# ${file}\n${text}`),
    );

  async function readManifest(): Promise<MultiPhaseManifest> {
    return JSON.parse(
      await fs.readFile(join(SLUG_DIR, 'manifest.json')),
    ) as MultiPhaseManifest;
  }

  function manifestWrites(): MultiPhaseManifest[] {
    return fs.writeFile.mock.calls
      .filter(([path]) => String(path).endsWith('manifest.json'))
      .map(([, content]) => JSON.parse(String(content)) as MultiPhaseManifest);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    fs = createMockFileSystemProvider();
    storage = new AnalysisStorageService(logger as never, fs);
    scenarios = [];
    closeFn = jest.fn();
    execute = jest.fn(async (config: { abortController: AbortController }) => {
      const scenario = scenarios.shift();
      if (!scenario) throw new Error('No scenario left for execute()');
      return {
        stream: scenario(config.abortController.signal),
        close: closeFn,
        abort: jest.fn(),
      };
    });
    broadcastMessage = jest.fn();
    service = new MultiPhaseAnalysisService(
      logger as never,
      { broadcastMessage } as never,
      { execute } as never,
      storage,
      { selectedModel: { get: () => 'test-model' } } as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('requires the MCP server', async () => {
    const result = await service.analyzeWorkspace(WORKSPACE, {
      mcpServerRunning: false,
    });
    expect(result.isErr()).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('completes every phase whose agent wrote its file and checkpoints each transition', async () => {
    scenarios = FILES.map((file) => agentWritesFile(file));

    const result = await service.analyzeWorkspace(WORKSPACE, {
      mcpServerRunning: true,
    });

    expect(result.isOk()).toBe(true);
    const manifest = result.value!;
    expect(manifest.version).toBe(3);
    expect(manifest.runId).toHaveLength(26);
    expect(manifest.lifecycle).toBe('completed');
    for (const config of PHASE_CONFIGS) {
      expect(manifest.phases[config.id].status).toBe('completed');
    }
    expect(await readManifest()).toEqual(manifest);
    expect(closeFn).toHaveBeenCalledTimes(4);

    const writes = manifestWrites();
    // before phase 1, running + terminal per phase, and the final finish
    expect(writes.length).toBeGreaterThanOrEqual(1 + 2 * 4 + 1);
    expect(
      Object.values(writes[0].phases).every((p) => p.status === 'pending'),
    ).toBe(true);
    expect(writes[0].lifecycle).toBe('running');
    expect(writes[1].phases['project-profile'].status).toBe('running');
  });

  it('creates the phase file from the complete captured text when the agent did not write it', async () => {
    scenarios = [
      streamOf([
        assistant('First turn'),
        assistant('Second turn'),
        success('Second turn'),
      ]),
      ...FILES.slice(1).map((file) => agentWritesFile(file)),
    ];

    const result = await service.analyzeWorkspace(WORKSPACE, {
      mcpServerRunning: true,
    });

    expect(result.value!.phases['project-profile'].status).toBe('completed');
    const file = await fs.readFile(join(SLUG_DIR, FILES[0]));
    expect(file).toBe('First turn\n\nSecond turn');
    expect(file).not.toContain('UI-ONLY-DELTA');
  });

  it('marks a phase failed when the stream ends without a result, keeping the text for diagnosis', async () => {
    scenarios = [
      streamOf([assistant('diagnostic text')]),
      ...FILES.slice(1).map((file) => agentWritesFile(file)),
    ];

    const result = await service.analyzeWorkspace(WORKSPACE, {
      mcpServerRunning: true,
    });

    const phase = result.value!.phases['project-profile'];
    expect(phase.status).toBe('failed');
    expect(phase.error).toBe('Stream ended without a result');
    expect(await fs.readFile(join(SLUG_DIR, FILES[0]))).toBe('diagnostic text');
    expect(result.value!.lifecycle).toBe('failed');
    expect((await readManifest()).phases['project-profile'].status).toBe(
      'failed',
    );
  });

  it('marks a phase failed on an error result even when a file exists', async () => {
    scenarios = [
      streamOf([assistant('some text'), errorResult()], () =>
        storage.writePhaseFile(SLUG_DIR, FILES[0], 'partial file'),
      ),
      ...FILES.slice(1).map((file) => agentWritesFile(file)),
    ];

    const result = await service.analyzeWorkspace(WORKSPACE, {
      mcpServerRunning: true,
    });

    const phase = result.value!.phases['project-profile'];
    expect(phase.status).toBe('failed');
    expect(phase.error).toContain('error_during_execution');
    expect(phase.error).toContain('model exploded');
    expect(await fs.readFile(join(SLUG_DIR, FILES[0]))).toBe('partial file');
  });

  it('fails a phase with analysis_timeout when the per-phase timer fires', async () => {
    jest.useFakeTimers();
    scenarios = [
      hangingStream(),
      ...FILES.slice(1).map((file) => agentWritesFile(file)),
    ];

    const pending = service.analyzeWorkspace(WORKSPACE, {
      mcpServerRunning: true,
    });
    while (execute.mock.calls.length === 0) {
      await Promise.resolve();
    }
    await jest.advanceTimersByTimeAsync(PER_PHASE_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.isOk()).toBe(true);
    const phase = result.value!.phases['project-profile'];
    expect(phase.status).toBe('failed');
    expect(phase.error).toContain('analysis_timeout');
    expect(await fs.readFile(join(SLUG_DIR, FILES[0]))).toBe('partial output');
    expect(result.value!.phases['elevation-plan'].status).toBe('completed');
    expect(result.value!.lifecycle).toBe('failed');
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('pauses on cancel: active phase back to pending, partial file kept, slug not deleted', async () => {
    scenarios = [
      agentWritesFile(FILES[0]),
      hangingStream(() => {
        void storage.writePhaseFile(SLUG_DIR, FILES[1], 'half written');
        service.cancelAnalysis();
      }),
    ];

    const result = await service.analyzeWorkspace(WORKSPACE, {
      mcpServerRunning: true,
    });

    expect(result.isOk()).toBe(true);
    const manifest = result.value!;
    expect(manifest.lifecycle).toBe('paused');
    expect(manifest.phases['project-profile'].status).toBe('completed');
    expect(manifest.phases['architecture-assessment'].status).toBe('pending');
    expect(manifest.phases['quality-audit'].status).toBe('pending');
    expect(manifest.phases['elevation-plan'].status).toBe('pending');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(await fs.readFile(join(SLUG_DIR, FILES[1]))).toBe('half written');
    expect(await fs.exists(SLUG_DIR)).toBe(true);
    expect((await readManifest()).lifecycle).toBe('paused');
  });

  describe('resume', () => {
    function seedPausedManifest(): MultiPhaseManifest {
      return {
        version: 3,
        runId: 'RUN-KEEP',
        slug: 'demo',
        analyzedAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:05:00.000Z',
        lifecycle: 'paused',
        model: 'persisted-model',
        totalDurationMs: 5_000,
        phases: {
          'project-profile': {
            status: 'completed',
            file: FILES[0],
            durationMs: 10,
          },
          'architecture-assessment': {
            status: 'running',
            file: FILES[1],
            durationMs: 0,
          },
          'quality-audit': { status: 'pending', file: FILES[2], durationMs: 0 },
          'elevation-plan': {
            status: 'pending',
            file: FILES[3],
            durationMs: 0,
          },
        },
      };
    }

    it('skips completed phases, restarts a stale running phase and keeps the runId', async () => {
      await storage.writeManifest(SLUG_DIR, seedPausedManifest());
      await storage.writePhaseFile(SLUG_DIR, FILES[0], 'OLD PROFILE');
      await storage.writePhaseFile(SLUG_DIR, FILES[1], 'stale partial');
      fs.writeFile.mockClear();
      scenarios = FILES.slice(1).map((file) => agentWritesFile(file));

      const result = await service.analyzeWorkspace(WORKSPACE, {
        mcpServerRunning: true,
        resume: true,
      });

      expect(result.isOk()).toBe(true);
      const manifest = result.value!;
      expect(manifest.runId).toBe('RUN-KEEP');
      expect(manifest.model).toBe('persisted-model');
      expect(manifest.lifecycle).toBe('completed');
      expect(manifest.totalDurationMs).toBeGreaterThanOrEqual(5_000);
      expect(execute).toHaveBeenCalledTimes(3);
      expect(fs.delete).not.toHaveBeenCalled();
      expect(await fs.readFile(join(SLUG_DIR, FILES[0]))).toBe('OLD PROFILE');
      expect(await fs.readFile(join(SLUG_DIR, FILES[1]))).toContain(
        'agent wrote',
      );
      // The first checkpoint of the resumed run normalized `running` to `pending`.
      const firstWrite = manifestWrites()[0];
      expect(firstWrite.phases['architecture-assessment'].status).toBe(
        'pending',
      );
      expect(firstWrite.lifecycle).toBe('running');
    });

    it('falls back to a fresh run when no resumable manifest exists', async () => {
      scenarios = FILES.map((file) => agentWritesFile(file));

      const result = await service.analyzeWorkspace(WORKSPACE, {
        mcpServerRunning: true,
        resume: true,
      });

      expect(result.isOk()).toBe(true);
      expect(result.value!.runId).toHaveLength(26);
      expect(execute).toHaveBeenCalledTimes(4);
    });

    it('does not resume a version-2 manifest', async () => {
      await fs.writeFile(
        join(SLUG_DIR, 'manifest.json'),
        JSON.stringify({ version: 2, slug: 'demo', phases: {} }),
      );
      scenarios = FILES.map((file) => agentWritesFile(file));

      const result = await service.analyzeWorkspace(WORKSPACE, {
        mcpServerRunning: true,
        resume: true,
      });

      expect(result.value!.version).toBe(3);
      expect(execute).toHaveBeenCalledTimes(4);
    });

    it('fresh runs start with a new runId and pending phases', async () => {
      await storage.writeManifest(SLUG_DIR, seedPausedManifest());
      scenarios = FILES.map((file) => agentWritesFile(file));

      const result = await service.analyzeWorkspace(WORKSPACE, {
        mcpServerRunning: true,
      });

      expect(result.value!.runId).not.toBe('RUN-KEEP');
      expect(execute).toHaveBeenCalledTimes(4);
    });
  });

  it('returns an error and starts no SDK work when the first checkpoint cannot be written', async () => {
    fs.writeFile.mockRejectedValueOnce(new Error('EROFS'));
    scenarios = FILES.map((file) => agentWritesFile(file));

    const result = await service.analyzeWorkspace(WORKSPACE, {
      mcpServerRunning: true,
    });

    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toBe('EROFS');
    expect(execute).not.toHaveBeenCalled();
  });

  it('broadcasts scan progress with per-phase statuses', async () => {
    scenarios = FILES.map((file) => agentWritesFile(file));

    await service.analyzeWorkspace(WORKSPACE, { mcpServerRunning: true });

    const progress = broadcastMessage.mock.calls
      .map(([, payload]) => payload as { phaseStatuses?: unknown })
      .filter((payload) => payload && Array.isArray(payload.phaseStatuses));
    expect(progress.length).toBeGreaterThan(0);
    const last = progress.at(-1) as {
      phaseStatuses: Array<{ status: string }>;
    };
    expect(last.phaseStatuses.every((s) => s.status === 'completed')).toBe(
      true,
    );
  });
});
