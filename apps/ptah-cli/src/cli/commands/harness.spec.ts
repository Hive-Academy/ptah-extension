/**
 * Unit tests for `ptah harness` command.
 *
 * Coverage:
 *   - init:
 *       * pure mkdir, no DI
 *       * idempotent — second run reports skipped[] and changed:false
 *   - status:
 *       * pure fs.readdir, no DI
 *       * absent .ptah/ → has_ptah_dir:false
 *       * populated .ptah/ → emits skill / agent / spec / preset arrays
 *   - scan:
 *       * dispatches harness:initialize and emits 4 notifications
 *   - apply:
 *       * UsageError without --preset
 *       * loads presets, finds match, dispatches harness:apply
 *       * unknown preset bubbles via task.error
 *   - preset save:
 *       * UsageError without <name> or --from
 *       * reads JSON config, dispatches harness:save-preset
 *   - preset load: dispatches harness:load-presets
 *   - chat (B10d alias for session start --scope harness-skill):
 *       * delegates to executeSessionStart with scope:harness-skill
 *       * forwards --profile / --session / --task into the delegation
 *       * propagates non-zero exit codes from the underlying session start
 *   - analyze-intent:
 *       * UsageError when --intent < 10 chars
 *       * dispatches harness:analyze-intent
 *   - design-agents:
 *       * generic mode emits agent_design.start + agent_design.complete
 *       * --workspace mode derives persona from harness:initialize
 *   - generate-document:
 *       * UsageError when --kind not in {prd, spec}
 *       * dispatches harness:generate-document and emits start + complete
 *   - doctor (exit code IS the feature — this doctor gates CI, unlike
 *     `ptah spec doctor` which always exits 0):
 *       * healthy report → exit 0 + harness.doctor
 *       * detected target with missing[] → exit 1
 *       * sources !== 'ok' → exit 1
 *       * writeFailed → exit 1
 *       * UNdetected target with missing[] → exit 0 (an uninstalled CLI is
 *         not a gap)
 *       * --fix calls harness:reconcile FIRST and reports its health
 *       * subcommand --json overrides an earlier --human
 *   - remove:
 *       * UsageError without --yes, and NO rpc call is made
 *       * --yes dispatches harness:remove { confirm: true }
 *   - unknown sub-command → exit 2
 *
 * The mock container's `resolve` THROWS on purpose: every harness sub-command
 * must reach the backend over the RPC transport, so that VS Code, Electron, the
 * CLI and the TUI's `/harness` all dispatch the identical verb.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { execute } from './harness.js';
import type { HarnessExecuteHooks, HarnessOptions } from './harness.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';
import {
  summarizeHarnessHealth,
  type HarnessFacetMatrix,
  type HarnessHealth,
  type HarnessHealthSummary,
  type HarnessTargetHealth,
} from '@ptah-extension/shared';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/test-workspace',
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

function makeStderr(): { stderr: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stderr: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

interface MockEngine {
  withEngine: HarnessExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  /**
   * Globals as they reached `withEngine`. This is the only observable proof
   * that a subcommand-level `--json` rewrote them, since the tests inject a
   * formatter and therefore never exercise `buildFormatter`.
   */
  engineGlobals: GlobalOptions[];
  /**
   * Options as they reached `withEngine`. `doctor` and `remove` are filesystem
   * verbs, so `requireSdk: false` is part of their contract, not a detail —
   * see the `boot contract` block below.
   */
  engineOpts: Array<{ mode: string; requireSdk?: boolean }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const engineGlobals: MockEngine['engineGlobals'] = [];
  const engineOpts: MockEngine['engineOpts'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: { __default: method } };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => {
      throw new Error(
        'container.resolve hit — harness cmd should not reach DI directly',
      );
    }),
  };

  const withEngine = (async (
    globals: GlobalOptions,
    opts: { mode: string; requireSdk?: boolean },
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    engineGlobals.push(globals);
    engineOpts.push(opts);
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as HarnessExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, engineGlobals, engineOpts, scripted };
}

interface MockFs {
  mkdir: jest.Mock;
  readdir: jest.Mock;
  stat: jest.Mock;
  readFile: jest.Mock;
}

function makeMockFs(): MockFs {
  return {
    mkdir: jest.fn(async (_p: string, _o: { recursive: boolean }) => undefined),
    readdir: jest.fn(async (_p: string) => [] as string[]),
    stat: jest.fn(async (_p: string) => ({
      isDirectory: () => false,
    })),
    readFile: jest.fn(async (_p: string) => '{}'),
  };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  fs: MockFs;
  hooks: HarnessExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const fs = makeMockFs();
  const hooks: HarnessExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
    mkdir: fs.mkdir,
    readdir: fs.readdir,
    stat: fs.stat,
    readFile: fs.readFile,
  };
  return { formatterTrace, stderrTrace, engine, fs, hooks };
}

// ---------------------------------------------------------------------------
// harness health fixtures (doctor / remove)
// ---------------------------------------------------------------------------
const ALL_SUPPORTED: HarnessFacetMatrix = {
  skills: 'supported',
  commands: 'supported',
  agents: 'supported',
  mcp: 'supported',
};

function makeTarget(
  overrides: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target: 'claude',
    detected: true,
    facets: ALL_SUPPORTED,
    expected: 3,
    found: 3,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 4,
    ...overrides,
  };
}

function makeHealth(overrides: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: 'D:/test-workspace',
    generatedAt: '2026-08-18T00:00:00.000Z',
    mode: 'full',
    reason: 'cli:doctor',
    sources: 'ok',
    targets: [makeTarget()],
    collisions: [],
    ...overrides,
  };
}

/** A `harness:health` success payload built from a report. */
function healthResponse(health: HarnessHealth): {
  success: true;
  data: {
    health: HarnessHealth;
    summary: HarnessHealthSummary;
    cached: boolean;
  };
} {
  return {
    success: true,
    data: { health, summary: summarizeHarnessHealth(health), cached: false },
  };
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
describe('ptah harness init', () => {
  it('creates the .ptah scaffold and emits changed:true on first run', async () => {
    const { formatterTrace, fs, hooks } = buildHooks();
    fs.stat.mockRejectedValue(new Error('ENOENT'));

    const exit = await execute(
      { subcommand: 'init' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fs.mkdir).toHaveBeenCalledTimes(5); // 5 scaffold dirs
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('harness.initialized');
    expect(last?.params).toMatchObject({ changed: true });
    expect(
      (last?.params as { created: string[] }).created.length,
    ).toBeGreaterThan(0);
  });

  it('is idempotent — second run reports skipped[] and changed:false', async () => {
    const { formatterTrace, fs, hooks } = buildHooks();
    fs.stat.mockResolvedValue({ isDirectory: () => true });

    const exit = await execute(
      { subcommand: 'init' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fs.mkdir).not.toHaveBeenCalled();
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.params).toMatchObject({ changed: false });
    expect((last?.params as { skipped: string[] }).skipped.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------
describe('ptah harness status', () => {
  it('emits has_ptah_dir:false when .ptah is missing', async () => {
    const { formatterTrace, fs, hooks } = buildHooks();
    fs.readdir.mockRejectedValue(new Error('ENOENT'));

    const exit = await execute(
      { subcommand: 'status' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe('harness.status');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      has_ptah_dir: false,
      has_skills: false,
    });
  });

  it('emits populated arrays when .ptah/ has children', async () => {
    const { formatterTrace, fs, hooks } = buildHooks();
    fs.readdir.mockImplementation(async (p: string) => {
      if (p.endsWith('.ptah') || p.endsWith('.ptah/')) {
        return ['skills', 'agents'];
      }
      if (p.endsWith('skills')) return ['skill-a', 'skill-b'];
      if (p.endsWith('agents')) return ['agent-1'];
      return [];
    });

    const exit = await execute(
      { subcommand: 'status' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const params = formatterTrace.notifications[0]?.params as {
      has_ptah_dir: boolean;
      has_skills: boolean;
      skills: string[];
      agents: string[];
    };
    expect(params.has_ptah_dir).toBe(true);
    expect(params.has_skills).toBe(true);
    expect(params.skills).toEqual(['skill-a', 'skill-b']);
    expect(params.agents).toEqual(['agent-1']);
  });
});

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------
describe('ptah harness scan', () => {
  it('dispatches harness:initialize and emits 4 notifications', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:initialize', {
      success: true,
      data: {
        workspaceContext: { projectName: 'app', projectType: 'node' },
        availableAgents: [{ id: 'a1' }],
        availableSkills: [{ id: 's1' }],
        existingPresets: [],
      },
    });
    const exit = await execute(
      { subcommand: 'scan' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'harness.workspace_context',
      'harness.available_agents',
      'harness.available_skills',
      'harness.existing_presets',
    ]);
  });
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------
describe('ptah harness apply', () => {
  it('exits 2 when --preset is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'apply' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--preset <id> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('loads presets, finds match by id, dispatches harness:apply', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:load-presets', {
      success: true,
      data: {
        presets: [
          {
            id: 'preset-1',
            name: 'Preset One',
            config: { name: 'Preset One' },
          },
        ],
      },
    });
    engine.scripted.set('harness:apply', {
      success: true,
      data: { appliedPaths: ['.ptah/presets/preset-1.json'], warnings: [] },
    });
    const exit = await execute(
      { subcommand: 'apply', preset: 'preset-1' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('harness.applied');
    expect(last?.params).toMatchObject({ presetId: 'preset-1' });
  });

  it('bubbles unknown preset as task.error', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:load-presets', {
      success: true,
      data: { presets: [] },
    });
    const exit = await execute(
      { subcommand: 'apply', preset: 'missing' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

// ---------------------------------------------------------------------------
// preset save / load
// ---------------------------------------------------------------------------
describe('ptah harness preset save', () => {
  it('exits 2 when <name> is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'preset-save', from: 'p.json' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/<name> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('exits 2 when --from is missing', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'preset-save', name: 'p1' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--from <path> is required/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('reads JSON config and dispatches harness:save-preset', async () => {
    const { formatterTrace, engine, fs, hooks } = buildHooks();
    fs.readFile.mockResolvedValue(
      JSON.stringify({ name: 'Preset One', persona: { label: 'l' } }),
    );
    engine.scripted.set('harness:save-preset', {
      success: true,
      data: {
        presetId: 'preset-one',
        presetPath: '.ptah/presets/preset-one.json',
      },
    });
    const exit = await execute(
      {
        subcommand: 'preset-save',
        name: 'Preset One',
        from: 'D:/cfg.json',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(fs.readFile).toHaveBeenCalledWith('D:/cfg.json');
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('harness.preset.saved');
  });
});

describe('ptah harness preset load', () => {
  it('dispatches harness:load-presets and emits harness.preset.list', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:load-presets', {
      success: true,
      data: { presets: [{ id: 'p1', name: 'P1' }] },
    });
    const exit = await execute(
      { subcommand: 'preset-load' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe('harness.preset.list');
  });
});

// ---------------------------------------------------------------------------
// chat — delegates to `session start --scope harness-skill` via
// `executeSessionStart`. The body is a thin pass-through;
// these tests verify the delegation surface (option forwarding + exit-code
// propagation) without exercising the full session DI bootstrap.
// ---------------------------------------------------------------------------
type DelegateMock = jest.MockedFunction<
  NonNullable<HarnessExecuteHooks['executeSessionStart']>
>;

function makeDelegate(returnCode: number): DelegateMock {
  return jest.fn(async () => returnCode) as unknown as DelegateMock;
}

describe('ptah harness chat (alias for session start --scope harness-skill)', () => {
  it('delegates to executeSessionStart with scope:harness-skill and exits 0 on success', async () => {
    const { hooks } = buildHooks();
    const delegate = makeDelegate(0);
    hooks.executeSessionStart = delegate;

    const exit = await execute(
      {
        subcommand: 'chat',
        task: 'hello',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(delegate).toHaveBeenCalledTimes(1);
    const callOpts = delegate.mock.calls[0]?.[0];
    expect(callOpts).toMatchObject({
      task: 'hello',
      scope: 'harness-skill',
      cwd: baseGlobals.cwd,
    });
  });

  it('forwards --profile and --session through the delegation surface', async () => {
    const { hooks } = buildHooks();
    const delegate = makeDelegate(0);
    hooks.executeSessionStart = delegate;

    const exit = await execute(
      {
        subcommand: 'chat',
        task: 'follow-up',
        profile: 'enhanced',
        session: 'sdk-session-1',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    const callOpts = delegate.mock.calls[0]?.[0];
    expect(callOpts).toMatchObject({
      task: 'follow-up',
      profile: 'enhanced',
      scope: 'harness-skill',
      resumeId: 'sdk-session-1',
    });
  });

  it('propagates a non-zero exit code from executeSessionStart', async () => {
    const { hooks } = buildHooks();
    const delegate = makeDelegate(1);
    hooks.executeSessionStart = delegate;

    const exit = await execute(
      { subcommand: 'chat', task: 'boom' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.GeneralError);
  });
});

// ---------------------------------------------------------------------------
// analyze-intent
// ---------------------------------------------------------------------------
describe('ptah harness analyze-intent', () => {
  it('exits 2 when --intent is missing or shorter than 10 chars', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'analyze-intent',
        intent: 'short',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/min 10 chars/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches harness:analyze-intent and emits harness.intent.analysis', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:analyze-intent', {
      success: true,
      data: {
        persona: { label: 'p', description: 'd', goals: [] },
        suggestedAgents: { 'agent-1': true },
        suggestedSubagents: [],
        suggestedSkills: [],
        suggestedSkillSpecs: [],
        suggestedMcpServers: [],
        summary: 's',
        reasoning: 'r',
      },
    });
    const exit = await execute(
      {
        subcommand: 'analyze-intent',
        intent: 'I want to ship a new feature for my Node app',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.method).toBe('harness:analyze-intent');
    expect(formatterTrace.notifications[0]?.method).toBe(
      'harness.intent.analysis',
    );
  });
});

// ---------------------------------------------------------------------------
// design-agents
// ---------------------------------------------------------------------------
describe('ptah harness design-agents', () => {
  it('emits start + complete notifications in generic mode', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:design-agents', {
      success: true,
      data: { subagents: [{ id: 'sub-1' }], reasoning: 'r' },
    });
    const exit = await execute(
      { subcommand: 'design-agents' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'harness.agent_design.start',
      'harness.agent_design.complete',
    ]);
    // Should NOT call harness:initialize without --workspace.
    expect(
      engine.rpcCalls.find((c) => c.method === 'harness:initialize'),
    ).toBeUndefined();
  });

  it('derives persona from harness:initialize when --workspace is set', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:initialize', {
      success: true,
      data: {
        workspaceContext: {
          projectName: 'my-app',
          projectType: 'node',
          frameworks: ['react'],
        },
        availableAgents: [{ id: 'existing-1' }],
      },
    });
    engine.scripted.set('harness:design-agents', {
      success: true,
      data: { subagents: [], reasoning: '' },
    });
    const exit = await execute(
      { subcommand: 'design-agents', workspace: true } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const initCall = engine.rpcCalls.find(
      (c) => c.method === 'harness:initialize',
    );
    expect(initCall).toBeDefined();
    const startEvt = formatterTrace.notifications[0];
    expect(startEvt?.method).toBe('harness.agent_design.start');
    expect(startEvt?.params).toMatchObject({
      workspace: true,
      persona: { label: 'my-app', goals: ['react'] },
    });
  });
});

// ---------------------------------------------------------------------------
// generate-document
// ---------------------------------------------------------------------------
describe('ptah harness generate-document', () => {
  it('exits 2 when --kind is not in {prd, spec}', async () => {
    const { stderrTrace, engine, hooks } = buildHooks();
    const exit = await execute(
      {
        subcommand: 'generate-document',
        kind: 'novel',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--kind must be one of/);
    expect(engine.rpcCalls).toHaveLength(0);
  });

  it('dispatches harness:generate-document and emits start + complete', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:initialize', {
      success: true,
      data: {
        workspaceContext: { projectName: 'x', projectType: 'node' },
        availableAgents: [],
        availableSkills: [],
        existingPresets: [],
      },
    });
    engine.scripted.set('harness:generate-document', {
      success: true,
      data: { document: '# PRD', sections: { Overview: 'overview' } },
    });
    const exit = await execute(
      { subcommand: 'generate-document', kind: 'prd' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'harness.document.start',
      'harness.document.complete',
    ]);
  });
});

// ---------------------------------------------------------------------------
// doctor
//
// The exit code is the whole point of this sub-command: unlike `ptah spec
// doctor`, it goes non-zero on drift so it can gate CI. Every case below is an
// exit-code case.
// ---------------------------------------------------------------------------
describe('ptah harness doctor', () => {
  it('exits 0 and emits harness.doctor on a healthy report', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:health', healthResponse(makeHealth()));

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    // The selection read trails the measurement and is informational only
    // (TASK_2026_316): it feeds the sources line and never the exit code.
    expect(engine.rpcCalls).toEqual([
      { method: 'harness:health', params: { refresh: true } },
      { method: 'harness:get-skill-selection', params: {} },
    ]);
    expect(formatterTrace.notifications).toHaveLength(1);
    const evt = formatterTrace.notifications[0];
    expect(evt?.method).toBe('harness.doctor');
    expect(evt?.params).toMatchObject({
      fixed: false,
      summary: { level: 'ok', missing: 0, detectedTargets: 1 },
    });
  });

  it('exits 1 when a detected target is missing entries', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set(
      'harness:health',
      healthResponse(
        makeHealth({
          targets: [
            makeTarget({ found: 2, missing: ['.claude/skills/run-tests'] }),
          ],
        }),
      ),
    );

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.GeneralError);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      summary: { level: 'degraded', missing: 1 },
    });
  });

  it('exits 1 when the sources themselves are unavailable', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set(
      'harness:health',
      healthResponse(makeHealth({ sources: 'sources-missing' })),
    );

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.GeneralError);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      summary: { level: 'degraded', sources: 'sources-missing' },
    });
  });

  it('exits 0 when the only unhealthy target is not detected', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set(
      'harness:health',
      healthResponse(
        makeHealth({
          targets: [
            makeTarget(),
            // An uninstalled CLI carries nothing — that is not a gap, and
            // counting it would leave a single-CLI workspace permanently red.
            makeTarget({
              target: 'codex',
              detected: false,
              expected: 5,
              found: 0,
              missing: ['a', 'b', 'c', 'd', 'e'],
            }),
          ],
        }),
      ),
    );

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      summary: { level: 'ok', missing: 0, detectedTargets: 1 },
    });
  });

  it('exits 1 when a detected target could not be written', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set(
      'harness:health',
      healthResponse(
        makeHealth({
          targets: [
            makeTarget({
              writeFailed: [
                { relPath: '.claude/skills/locked', reason: 'EPERM' },
              ],
            }),
          ],
        }),
      ),
    );

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.GeneralError);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      summary: { level: 'error', writeFailed: 1 },
    });
  });

  it('--fix reconciles first and reports on the post-fix health', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    const fixed = makeHealth({ reason: 'cli:doctor --fix' });
    engine.scripted.set('harness:reconcile', {
      success: true,
      data: { health: fixed, summary: summarizeHarnessHealth(fixed) },
    });

    const exit = await execute(
      { subcommand: 'doctor', fix: true } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    // The reconcile is the FIRST call, and its result is what gets reported —
    // a follow-up `harness:health` would only re-walk the tree it just wrote.
    expect(engine.rpcCalls[0]).toEqual({
      method: 'harness:reconcile',
      params: { mode: 'full' },
    });
    expect(
      engine.rpcCalls.findIndex((c) => c.method === 'harness:health'),
    ).toBe(-1);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      fixed: true,
      health: { reason: 'cli:doctor --fix' },
    });
  });

  it('lets a subcommand-level --json override an earlier --human', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('harness:health', healthResponse(makeHealth()));

    const exit = await execute(
      { subcommand: 'doctor', json: true } satisfies HarnessOptions,
      { ...baseGlobals, json: false, human: true },
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.engineGlobals[0]).toMatchObject({
      json: true,
      human: false,
    });
  });

  it('leaves globals untouched when --json is absent', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('harness:health', healthResponse(makeHealth()));

    await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      { ...baseGlobals, json: false, human: true },
      hooks,
    );

    expect(engine.engineGlobals[0]).toMatchObject({
      json: false,
      human: true,
    });
  });
});

// ---------------------------------------------------------------------------
// doctor's skill-selection sources-line clause (TASK_2026_316)
//
// `harness:get-skill-selection` feeds the doctor's sources line PURELY as
// information — `summarizeHarnessHealth` remains the one verdict, and a
// 'selected' workspace with an empty allowlist is `ok` (R4 / task 4.3), not
// degraded. A failed or malformed read must degrade to no clause and must
// never move the exit code either way.
// ---------------------------------------------------------------------------
describe('ptah harness doctor — skill-selection sources-line clause', () => {
  it('an empty allowlist under mode:selected does not push the exit code to 1', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:health', healthResponse(makeHealth()));
    engine.scripted.set('harness:get-skill-selection', {
      success: true,
      data: {
        mode: 'selected',
        slugs: [],
        available: [{ slug: 'a', name: 'A', description: '', pluginId: null }],
        derived: false,
      },
    });

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    // 'ok' health + a narrow allowlist is still 'ok' — an exit-1 here would
    // break CI for every correctly-configured new workspace.
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      selection: { mode: 'selected', selected: 0, available: 1 },
      summary: { level: 'ok' },
    });
  });

  it('a narrow selection does not mask an otherwise-degraded harness', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set(
      'harness:health',
      healthResponse(
        makeHealth({
          targets: [
            makeTarget({ found: 2, missing: ['.claude/skills/run-tests'] }),
          ],
        }),
      ),
    );
    engine.scripted.set('harness:get-skill-selection', {
      success: true,
      data: { mode: 'selected', slugs: [], available: [], derived: false },
    });

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    // The verdict comes from `summarizeHarnessHealth` alone — a clean
    // selection read must not rescue a degraded target's exit code.
    expect(exit).toBe(ExitCode.GeneralError);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      selection: { mode: 'selected', selected: 0 },
      summary: { level: 'degraded' },
    });
  });

  it('a failed skill-selection read degrades to no clause and does not touch the exit code', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:health', healthResponse(makeHealth()));
    engine.scripted.set('harness:get-skill-selection', {
      success: false,
      error: 'backend too old to answer',
    });

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      selection: null,
      summary: { level: 'ok' },
    });
  });

  it('a malformed skill-selection answer degrades to no clause and does not touch the exit code', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('harness:health', healthResponse(makeHealth()));
    engine.scripted.set('harness:get-skill-selection', {
      success: true,
      data: { unexpected: 'shape' },
    });

    const exit = await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      selection: null,
      summary: { level: 'ok' },
    });
  });
});

// ---------------------------------------------------------------------------
// boot contract for the two filesystem verbs
//
// `doctor` and `remove` walk `~/.ptah/user`, compare hashes and copy or unlink
// files. Neither asks a model anything, so neither may sit behind the SDK
// adapter's `initialize()` — booting them with the default `requireSdk` made
// `ptah harness doctor` die with `sdk_init_failed` on every machine without an
// API key, which is precisely the machine a CI gate on harness drift runs on.
//
// `mode` must nevertheless stay `'full'`: the three RPC methods live in DI
// phase 4, and so do `PluginLoaderService.initialize()` and `bootHarness` — the
// wiring that gives the reconciler its desired state. Under `'minimal'` the
// doctor would answer over an empty plugin overlay and report a clean harness
// for a workspace missing every plugin skill.
// ---------------------------------------------------------------------------
describe('harness filesystem verbs boot without the SDK', () => {
  it('doctor boots mode=full with requireSdk:false', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('harness:health', healthResponse(makeHealth()));

    await execute(
      { subcommand: 'doctor' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(engine.engineOpts[0]).toEqual({ mode: 'full', requireSdk: false });
  });

  it('doctor --fix boots mode=full with requireSdk:false', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('harness:reconcile', {
      success: true,
      data: { health: makeHealth() },
    });

    await execute(
      { subcommand: 'doctor', fix: true } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(engine.engineOpts[0]).toEqual({ mode: 'full', requireSdk: false });
  });

  it('remove --yes boots mode=full with requireSdk:false', async () => {
    const { engine, hooks } = buildHooks();
    engine.scripted.set('harness:remove', {
      success: true,
      data: { health: makeHealth(), removed: 0 },
    });

    await execute(
      { subcommand: 'remove', yes: true } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(engine.engineOpts[0]).toEqual({ mode: 'full', requireSdk: false });
  });

  // The counterexample that gives the assertion above its meaning: the verbs
  // that DO reach a model keep the default.
  it('analyze-intent still boots with the SDK required', async () => {
    const { engine, hooks } = buildHooks();

    await execute(
      {
        subcommand: 'analyze-intent',
        intent: 'build me a backend harness',
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(engine.engineOpts[0]).toEqual({ mode: 'full' });
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------
describe('ptah harness remove', () => {
  it('exits 2 without --yes and makes no RPC call at all', async () => {
    const { stderrTrace, engine, formatterTrace, hooks } = buildHooks();

    const exit = await execute(
      { subcommand: 'remove' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/--yes is required/);
    expect(engine.rpcCalls).toHaveLength(0);
    expect(formatterTrace.notifications).toHaveLength(0);
  });

  it('dispatches harness:remove with confirm:true and emits harness.removed', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    const after = makeHealth({
      targets: [
        makeTarget({ expected: 0, found: 0, removed: ['a', 'b', 'c'] }),
      ],
    });
    engine.scripted.set('harness:remove', {
      success: true,
      data: {
        health: after,
        summary: summarizeHarnessHealth(after),
        removed: 3,
      },
    });

    const exit = await execute(
      { subcommand: 'remove', yes: true } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls).toEqual([
      { method: 'harness:remove', params: { confirm: true } },
    ]);
    const evt = formatterTrace.notifications[0];
    expect(evt?.method).toBe('harness.removed');
    expect(evt?.params).toMatchObject({ removed: 3 });
  });
});

// ---------------------------------------------------------------------------
// harness-sync isolation — the doctor's skill-selection clause reads
// `harness:get-skill-selection` over RPC, and must never resolve
// `@ptah-extension/harness-sync` directly (TASK_2026_316 hard rule).
// ---------------------------------------------------------------------------
describe('ptah harness doctor — harness-sync isolation', () => {
  it('harness-doctor.ts does not import @ptah-extension/harness-sync', () => {
    const source = readFileSync(
      path.resolve(__dirname, 'harness-doctor.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"]@ptah-extension\/harness-sync['"]/);
  });
});

// ---------------------------------------------------------------------------
// unknown sub-command
// ---------------------------------------------------------------------------
describe('ptah harness unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'init' } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});

// ---------------------------------------------------------------------------
// Router-level harness chat parser sanity (flag set must mirror
// `session start --scope harness-skill` since the body now delegates).
// ---------------------------------------------------------------------------
describe('ptah harness chat — router parsing', () => {
  it('accepts --task / --profile / --session / --auto-approve without parser error', async () => {
    // We can't instantiate the full router cheaply here, so this test just
    // documents the contract via the harness execute() entry point — any
    // flags on the harness sub-subcommand parser must NOT cause execute()
    // itself to error. The parser surface lives in router.ts and is
    // smoke-tested via `ptah harness chat --help`.
    const { hooks } = buildHooks();
    const delegate = makeDelegate(0);
    hooks.executeSessionStart = delegate;

    const exit = await execute(
      {
        subcommand: 'chat',
        task: 'a task',
        profile: 'claude_code',
        session: 'sid',
        autoApprove: true,
      } satisfies HarnessOptions,
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(delegate).toHaveBeenCalledTimes(1);
  });
});
