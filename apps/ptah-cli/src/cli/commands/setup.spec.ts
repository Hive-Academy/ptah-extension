/**
 * Unit tests for `ptah setup`.
 *
 * Coverage:
 *   1. Happy path: 5 phases complete → exit 0, `setup.complete` emitted with
 *      non-zero counters.
 *   2. Phase 3 fails → exit 1 with `data.phase: 'install_pack'`; phase 1+2
 *      succeed; phase 3 added agent files removed by rollback.
 *   3. Phase 4 timeout → exit 1 with `data.phase: 'generate'`; rollback
 *      prints warning to stderr.
 *   4. Phase 4 broadcast failure (`success: false`) → exit 1 with
 *      `data.phase: 'generate'`, `data.error: <broadcast error>`.
 *   5. `--dry-run` → only phases 1+2 run; no install-pack-agents /
 *      submit-selection / harness:apply calls.
 *   6. `setup.phase.progress` notifications emitted during phase 4 from
 *      `setup-wizard:generation-progress` broadcasts.
 *   7. `setup.lastCompletedPhase` written to `WORKSPACE_STATE_STORAGE` after
 *      every successful phase.
 */

import { EventEmitter } from 'events';

import { execute, SETUP_GENERATE_TIMEOUT_MS } from './setup.js';
import type { SetupExecuteHooks, SetupOptions } from './setup.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/tmp/ws',
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

function makeStderr(): {
  stderr: { write: jest.Mock };
  buffer: { value: string };
} {
  const buffer = { value: '' };
  return {
    buffer,
    stderr: {
      write: jest.fn((chunk: string) => {
        buffer.value += chunk;
        return true;
      }),
    },
  };
}

interface StorageStub {
  values: Map<string, unknown>;
  get: jest.Mock;
  update: jest.Mock;
  keys: jest.Mock;
}

function makeStorage(seed: Record<string, unknown> = {}): StorageStub {
  const values = new Map<string, unknown>(Object.entries(seed));
  return {
    values,
    get: jest.fn((key: string) => values.get(key)),
    update: jest.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    keys: jest.fn(() => Array.from(values.keys())),
  };
}

interface ScriptedRpc {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
}

interface MockEngine {
  withEngine: SetupExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedRpc | (() => ScriptedRpc)>;
  pushAdapter: EventEmitter;
  storage: StorageStub;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const pushAdapter = new EventEmitter();
  const storage = makeStorage();

  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const r = scripted.get(method);
      if (typeof r === 'function') return r();
      if (r) return r;
      return {
        success: true,
        data: { __default: method },
      } satisfies ScriptedRpc;
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => storage),
  };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: EventEmitter;
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({ container, transport, pushAdapter });
  }) as unknown as SetupExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted, pushAdapter, storage };
}

// Common: scripted analysis result + recommendation result reused by tests.
const ANALYSIS_RESULT = {
  isMultiPhase: true,
  manifest: {
    slug: 'demo',
    analyzedAt: '2026-04-26T00:00:00Z',
    model: 'sonnet',
    totalDurationMs: 1234,
    phases: {},
  },
  phaseContents: {},
  analysisDir: 'D:/tmp/ws/.ptah/analyses/demo',
};

const RECOMMENDATIONS = {
  recommendations: [
    {
      agentId: 'architect',
      agentName: 'Architect',
      relevanceScore: 95,
      matchedCriteria: ['typescript'],
      category: 'planning',
      recommended: true,
    },
    {
      agentId: 'qa',
      agentName: 'QA',
      relevanceScore: 80,
      matchedCriteria: ['nestjs'],
      category: 'qa',
      recommended: true,
    },
    {
      agentId: 'creative',
      agentName: 'Creative',
      relevanceScore: 50,
      matchedCriteria: [],
      category: 'creative',
      recommended: false,
    },
  ],
};

const PACK_LIST = {
  packs: [
    {
      name: 'core-pack',
      version: '1.0.0',
      description: 'Core agents',
      source: 'github:ptah/core-pack',
      agents: [
        {
          file: 'architect.md',
          name: 'Architect',
          description: '',
          category: '',
        },
        { file: 'qa.md', name: 'QA', description: '', category: '' },
        {
          file: 'creative.md',
          name: 'Creative',
          description: '',
          category: '',
        },
      ],
    },
  ],
};

function scriptHappyPathThroughPhase3(engine: MockEngine): void {
  engine.scripted.set('wizard:deep-analyze', {
    success: true,
    data: ANALYSIS_RESULT,
  });
  engine.scripted.set('wizard:recommend-agents', {
    success: true,
    data: RECOMMENDATIONS,
  });
  engine.scripted.set('wizard:list-agent-packs', {
    success: true,
    data: PACK_LIST,
  });
  engine.scripted.set('wizard:install-pack-agents', {
    success: true,
    data: { success: true, agentsDownloaded: 2, fromCache: false },
  });
}

// ---------------------------------------------------------------------------
// 1. Happy path — 5 phases complete, exit 0, setup.complete with counters.
// ---------------------------------------------------------------------------

describe('ptah setup — happy path', () => {
  it('runs all 5 phases, emits setup.complete, exits 0', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    scriptHappyPathThroughPhase3(engine);
    engine.scripted.set('wizard:submit-selection', {
      success: true,
      data: { success: true },
    });
    engine.scripted.set('harness:apply', {
      success: true,
      data: {
        appliedPaths: ['D:/tmp/ws/.ptah/presets/setup.json'],
        warnings: [],
      },
    });

    let nowValue = 1_000;
    const promise = execute(
      { dryRun: false } satisfies SetupOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        readdir: async () => [],
        readFile: async () => '{}',
        writeFile: async () => undefined,
        unlink: async () => undefined,
        now: () => {
          nowValue += 100;
          return nowValue;
        },
      },
    );

    // Emit the generation-complete event after the phase-4 submit-selection
    // accept resolves. setImmediate twice to let the listener attach.
    setImmediate(() => {
      setImmediate(() => {
        engine.pushAdapter.emit('setup-wizard:generation-complete', {
          success: true,
          generatedCount: 2,
        });
      });
    });

    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);

    // setup.complete fired with non-zero counters.
    const complete = fmt.notifications.find(
      (n) => n.method === 'setup.complete',
    );
    expect(complete).toBeDefined();
    expect(complete?.params).toMatchObject({
      agents_installed: 2,
      plugins_enabled: 0, // selectedSkills is empty in the synthetic config
      mcp_installed: 0,
    });
    expect(
      (complete?.params as { duration_ms: number }).duration_ms,
    ).toBeGreaterThan(0);

    // No task.error fired.
    expect(
      fmt.notifications.find((n) => n.method === 'task.error'),
    ).toBeUndefined();

    // RPC sequence — analyze → recommend → list-packs → install-pack → submit-selection → harness:apply
    expect(engine.rpcCalls.map((c) => c.method)).toEqual([
      'wizard:deep-analyze',
      'wizard:recommend-agents',
      'wizard:list-agent-packs',
      'wizard:install-pack-agents',
      'wizard:submit-selection',
      'harness:apply',
    ]);

    // 7. setup.lastCompletedPhase written after each successful phase.
    expect(engine.storage.update).toHaveBeenCalledWith(
      'setup.lastCompletedPhase',
      'analyze',
    );
    expect(engine.storage.update).toHaveBeenCalledWith(
      'setup.lastCompletedPhase',
      'recommend',
    );
    expect(engine.storage.update).toHaveBeenCalledWith(
      'setup.lastCompletedPhase',
      'install_pack',
    );
    expect(engine.storage.update).toHaveBeenCalledWith(
      'setup.lastCompletedPhase',
      'generate',
    );
    expect(engine.storage.update).toHaveBeenCalledWith(
      'setup.lastCompletedPhase',
      'apply_harness',
    );
  });

  it('forwards selectedAgentIds (recommended-only) to install-pack and submit-selection', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    scriptHappyPathThroughPhase3(engine);
    engine.scripted.set('wizard:submit-selection', {
      success: true,
      data: { success: true },
    });
    engine.scripted.set('harness:apply', {
      success: true,
      data: { appliedPaths: [], warnings: [] },
    });

    const promise = execute({}, baseGlobals, {
      formatter: fmt.formatter,
      stderr: makeStderr().stderr,
      withEngine: engine.withEngine,
      readdir: async () => [],
      readFile: async () => null as unknown as string,
      writeFile: async () => undefined,
      unlink: async () => undefined,
    });
    setImmediate(() => {
      setImmediate(() =>
        engine.pushAdapter.emit('setup-wizard:generation-complete', {
          success: true,
          generatedCount: 2,
        }),
      );
    });
    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);

    // install-pack-agents must only forward agentFiles for recommended agents
    // ('architect' + 'qa', NOT 'creative').
    const installCall = engine.rpcCalls.find(
      (c) => c.method === 'wizard:install-pack-agents',
    );
    expect(installCall?.params).toMatchObject({
      source: 'github:ptah/core-pack',
      agentFiles: expect.arrayContaining(['architect.md', 'qa.md']),
    });
    expect(
      (installCall?.params as { agentFiles: string[] }).agentFiles,
    ).not.toContain('creative.md');

    // submit-selection forwards selectedAgentIds + analysisData + analysisDir.
    const submitCall = engine.rpcCalls.find(
      (c) => c.method === 'wizard:submit-selection',
    );
    expect(submitCall?.params).toMatchObject({
      selectedAgentIds: ['architect', 'qa'],
      analysisDir: ANALYSIS_RESULT.analysisDir,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Phase 3 fails — exit 1, data.phase: 'install_pack', rollback runs.
// ---------------------------------------------------------------------------

describe('ptah setup — phase 3 (install_pack) failure', () => {
  it('exits 1 with data.phase: install_pack and removes added agent files', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:deep-analyze', {
      success: true,
      data: ANALYSIS_RESULT,
    });
    engine.scripted.set('wizard:recommend-agents', {
      success: true,
      data: RECOMMENDATIONS,
    });
    engine.scripted.set('wizard:list-agent-packs', {
      success: true,
      data: PACK_LIST,
    });
    engine.scripted.set('wizard:install-pack-agents', {
      success: false,
      error: 'GitHub rate-limited',
    });

    // Snapshot starts empty; after the (failed) install we pretend two agent
    // files appeared on disk — the rollback should delete both.
    let agentsAfterCall = 0;
    const readdir = jest.fn(async () => {
      agentsAfterCall += 1;
      if (agentsAfterCall === 1) return []; // pre-snapshot
      return ['architect.md', 'qa.md']; // post-failure
    });
    const unlink: jest.Mock<Promise<void>, [string]> = jest.fn(
      async (_path: string) => undefined,
    );

    const exit = await execute({}, baseGlobals, {
      formatter: fmt.formatter,
      stderr: makeStderr().stderr,
      withEngine: engine.withEngine,
      readdir,
      readFile: async () => '',
      writeFile: async () => undefined,
      unlink,
    });

    expect(exit).toBe(ExitCode.GeneralError);
    const taskError = fmt.notifications.find((n) => n.method === 'task.error');
    expect(taskError?.params).toMatchObject({
      ptah_code: 'wizard_phase_failed',
      data: { phase: 'install_pack' },
    });

    // Rollback removed both added files.
    expect(unlink).toHaveBeenCalledTimes(2);
    const unlinkPaths = unlink.mock.calls.map((call) => String(call[0]));
    expect(unlinkPaths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('architect.md'),
        expect.stringContaining('qa.md'),
      ]),
    );

    // Phases 1+2 succeeded — lastCompletedPhase reached at least 'recommend'
    // (not 'install_pack' since that's where it failed).
    const updates = engine.storage.update.mock.calls.map(
      ([, value]: [string, unknown]) => value,
    );
    expect(updates).toContain('analyze');
    expect(updates).toContain('recommend');
    expect(updates).not.toContain('install_pack');
  });
});

// ---------------------------------------------------------------------------
// 3. Phase 4 timeout — exit 1, data.phase: 'generate', warning to stderr.
// ---------------------------------------------------------------------------

describe('ptah setup — phase 4 (generate) timeout', () => {
  it('exits 1 with data.phase: generate; rollback prints warning to stderr', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask'] });
    try {
      const fmt = makeFormatter();
      const stderrTrace = makeStderr();
      const engine = makeEngine();
      scriptHappyPathThroughPhase3(engine);
      engine.scripted.set('wizard:submit-selection', {
        success: true,
        data: { success: true },
      });
      // No completion event will be emitted — phase 4 must time out at
      // SETUP_GENERATE_TIMEOUT_MS.

      const promise = execute({}, baseGlobals, {
        formatter: fmt.formatter,
        stderr: stderrTrace.stderr,
        withEngine: engine.withEngine,
        readdir: async () => [],
        readFile: async () => '',
        writeFile: async () => undefined,
        unlink: async () => undefined,
      });

      // Step the fake timers forward past the timeout. We need the microtask
      // queue to drain between advances so awaits resolve before the next
      // setTimeout fires. `runAllTimersAsync` triggers the timeout reject.
      await jest.advanceTimersByTimeAsync(SETUP_GENERATE_TIMEOUT_MS + 10);

      const exit = await promise;
      expect(exit).toBe(ExitCode.GeneralError);

      const taskError = fmt.notifications.find(
        (n) => n.method === 'task.error',
      );
      expect(taskError?.params).toMatchObject({
        ptah_code: 'wizard_phase_failed',
        data: { phase: 'generate' },
      });
      expect(stderrTrace.buffer.value).toContain('ptah wizard cancel');
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Phase 4 broadcast failure (success: false) — exit 1, data.error from broadcast.
// ---------------------------------------------------------------------------

describe('ptah setup — phase 4 (generate) broadcast failure', () => {
  it('exits 1 with data.phase: generate, data.error from broadcast', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    scriptHappyPathThroughPhase3(engine);
    engine.scripted.set('wizard:submit-selection', {
      success: true,
      data: { success: true },
    });

    const promise = execute({}, baseGlobals, {
      formatter: fmt.formatter,
      stderr: makeStderr().stderr,
      withEngine: engine.withEngine,
      readdir: async () => [],
      readFile: async () => '',
      writeFile: async () => undefined,
      unlink: async () => undefined,
    });

    setImmediate(() => {
      setImmediate(() =>
        engine.pushAdapter.emit('setup-wizard:generation-complete', {
          success: false,
          generatedCount: 0,
          errors: ['template missing'],
        }),
      );
    });

    const exit = await promise;
    expect(exit).toBe(ExitCode.GeneralError);

    const taskError = fmt.notifications.find((n) => n.method === 'task.error');
    expect(taskError?.params).toMatchObject({
      ptah_code: 'wizard_phase_failed',
      data: { phase: 'generate', error: 'template missing' },
    });
  });
});

// ---------------------------------------------------------------------------
// 5. --dry-run — only phases 1+2 run; no install/generate/apply RPCs.
// ---------------------------------------------------------------------------

describe('ptah setup — --dry-run', () => {
  it('runs only phases 1+2; emits setup.complete with dry_run: true', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:deep-analyze', {
      success: true,
      data: ANALYSIS_RESULT,
    });
    engine.scripted.set('wizard:recommend-agents', {
      success: true,
      data: RECOMMENDATIONS,
    });

    const exit = await execute(
      { dryRun: true } satisfies SetupOptions,
      baseGlobals,
      {
        formatter: fmt.formatter,
        stderr: makeStderr().stderr,
        withEngine: engine.withEngine,
        readdir: async () => [],
        readFile: async () => '',
        writeFile: async () => undefined,
        unlink: async () => undefined,
      },
    );

    expect(exit).toBe(ExitCode.Success);

    // Only the two read-only RPCs fired.
    expect(engine.rpcCalls.map((c) => c.method)).toEqual([
      'wizard:deep-analyze',
      'wizard:recommend-agents',
    ]);
    // Phases 3-5 RPCs MUST NOT have been invoked.
    expect(
      engine.rpcCalls.find((c) =>
        [
          'wizard:install-pack-agents',
          'wizard:submit-selection',
          'harness:apply',
        ].includes(c.method),
      ),
    ).toBeUndefined();

    const complete = fmt.notifications.find(
      (n) => n.method === 'setup.complete',
    );
    expect(complete?.params).toMatchObject({
      agents_installed: 0,
      plugins_enabled: 0,
      mcp_installed: 0,
      dry_run: true,
    });
  });
});

// ---------------------------------------------------------------------------
// 6. setup.phase.progress notifications during phase 4.
// ---------------------------------------------------------------------------

describe('ptah setup — phase 4 progress forwarding', () => {
  it('emits setup.phase.progress notifications from setup-wizard:generation-progress broadcasts', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    scriptHappyPathThroughPhase3(engine);
    engine.scripted.set('wizard:submit-selection', {
      success: true,
      data: { success: true },
    });
    engine.scripted.set('harness:apply', {
      success: true,
      data: { appliedPaths: [], warnings: [] },
    });

    const promise = execute({}, baseGlobals, {
      formatter: fmt.formatter,
      stderr: makeStderr().stderr,
      withEngine: engine.withEngine,
      readdir: async () => [],
      readFile: async () => '',
      writeFile: async () => undefined,
      unlink: async () => undefined,
    });

    setImmediate(() => {
      setImmediate(() => {
        engine.pushAdapter.emit('setup-wizard:generation-progress', {
          completed: 1,
          total: 2,
        });
        engine.pushAdapter.emit('setup-wizard:generation-progress', {
          completed: 2,
          total: 2,
        });
        engine.pushAdapter.emit('setup-wizard:generation-complete', {
          success: true,
          generatedCount: 2,
        });
      });
    });

    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);

    const progressNotifs = fmt.notifications.filter(
      (n) => n.method === 'setup.phase.progress',
    );
    expect(progressNotifs.length).toBeGreaterThanOrEqual(2);
    expect(progressNotifs[0]?.params).toMatchObject({
      phase: 'generate',
      completed: 1,
      total: 2,
    });
    expect(progressNotifs[1]?.params).toMatchObject({
      phase: 'generate',
      completed: 2,
      total: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Phase 1 failure — exit 1 with data.phase: 'analyze'.
// ---------------------------------------------------------------------------

describe('ptah setup — phase 1 (analyze) failure', () => {
  it('exits 1 with data.phase: analyze when wizard:deep-analyze fails', async () => {
    const fmt = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:deep-analyze', {
      success: false,
      error: 'license_required',
      errorCode: 'license_required',
    });

    const exit = await execute({}, baseGlobals, {
      formatter: fmt.formatter,
      stderr: makeStderr().stderr,
      withEngine: engine.withEngine,
      readdir: async () => [],
      readFile: async () => '',
      writeFile: async () => undefined,
      unlink: async () => undefined,
    });

    expect(exit).toBe(ExitCode.GeneralError);
    const taskError = fmt.notifications.find((n) => n.method === 'task.error');
    expect(taskError?.params).toMatchObject({
      ptah_code: 'wizard_phase_failed',
      data: { phase: 'analyze' },
    });
    // No subsequent phases ran.
    expect(engine.rpcCalls.map((c) => c.method)).toEqual([
      'wizard:deep-analyze',
    ]);
  });
});
